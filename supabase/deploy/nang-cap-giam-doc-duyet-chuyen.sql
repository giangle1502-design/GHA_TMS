-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Giám đốc duyệt chuyến (có ủy quyền duyệt hộ)
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shipments' and column_name = 'dispatch_approval') then
    raise exception 'CSDL đã được nâng cấp Giám đốc duyệt chuyến (có ủy quyền duyệt hộ) trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261101000033_trip_director_approval.sql
-- =============================================================================
-- 0033: Giám đốc phê duyệt chuyến trước khi tài xế nhận (yêu cầu Khánh Hà 01/11/2026)
--   - Điều phối phân công tài xế -> chuyến "Chờ GĐ duyệt"; tài xế CHƯA thấy chuyến trên điện thoại.
--   - Giám đốc duyệt -> tài xế thấy và bấm "Nhận đơn". Từ chối (bắt buộc lý do) -> điều phối sửa rồi gửi duyệt lại.
--   - Đổi tài xế = duyệt lại; chỉ đổi xe (cùng tài xế) không cần duyệt lại.
--   - Bật/tắt bằng tham số dispatch.require_director_approval (Cấu hình). Tắt thì các chuyến đang chờ được thả cho tài xế.
--   - Dùng chung hệ thống phê duyệt: loại "Duyệt chuyến xe" (trip_dispatch), cấp 1 = Giám đốc, sửa được ở Phê duyệt → Cấu hình cấp duyệt.
--   - Chuyến cũ (trước bản nâng cấp) không cần duyệt.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Cột trạng thái duyệt trên chuyến
-- -----------------------------------------------------------------------------
alter table public.shipments
  add column dispatch_approval text not null default 'not_required'
    check (dispatch_approval in ('not_required', 'pending', 'approved', 'rejected')),
  add column dispatch_approval_request_id uuid references public.approval_requests (id),
  add column dispatch_approved_by uuid references public.profiles (id),
  add column dispatch_approved_at timestamptz,
  add column dispatch_reject_reason text;
comment on column public.shipments.dispatch_approval is
  'Giám đốc duyệt chuyến: not_required (không cần), pending (chờ duyệt), approved (đã duyệt), rejected (từ chối). Tài xế chỉ thấy chuyến not_required/approved';
create index shipments_dispatch_approval_idx on public.shipments (dispatch_approval) where dispatch_approval in ('pending', 'rejected');

insert into public.system_settings (key, value, description, is_public) values
  ('dispatch.require_director_approval', 'true',
   'Chuyến phải được Giám đốc duyệt trước khi tài xế nhận (true = bật, false = tắt)', false)
on conflict (key) do nothing;

insert into public.approval_types (code, name, description, requires_document, requires_reject_reason, allow_self_approval, sla_hours, sort_order)
values ('trip_dispatch', 'Duyệt chuyến xe', 'Giám đốc duyệt chuyến điều phối vừa phân công, trước khi tài xế nhận đơn',
        false, true, true, 12, 0)
on conflict (code) do nothing;
insert into public.approval_rules (approval_type_id, level, approver_role_id, min_amount, max_amount)
select t.id, 1, (select id from public.roles where code = 'director'), 0, null
from public.approval_types t
where t.code = 'trip_dispatch'
  and not exists (select 1 from public.approval_rules r where r.approval_type_id = t.id);

-- -----------------------------------------------------------------------------
-- 2. Hàm phụ
-- -----------------------------------------------------------------------------
create or replace function private.trip_approval_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select value = 'true'::jsonb from public.system_settings where key = 'dispatch.require_director_approval'), false);
$$;
revoke all on function private.trip_approval_on() from public, anon;
grant execute on function private.trip_approval_on() to authenticated;

-- Hủy yêu cầu duyệt chuyến còn đang chờ (khi đổi tài xế, gỡ phân công, hủy chuyến, tắt tham số)
create or replace function private.cancel_trip_approval(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_request_id is null then return; end if;
  update public.approval_requests set status = 'cancelled', decided_at = now()
   where id = p_request_id and status = 'pending';
  if found then
    insert into public.approval_steps (request_id, level, action, actor_id, actor_label, comment)
    values (p_request_id, 0, 'cancel', auth.uid(), case when auth.uid() is null then 'Hệ thống' end, p_reason);
  end if;
end;
$$;
revoke all on function private.cancel_trip_approval(uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Trigger trên chuyến: tự gửi duyệt khi phân công, chặn tài xế nhận khi chưa duyệt,
--    không cho sửa trạng thái duyệt trực tiếp (chỉ qua hàm duyệt / gửi lại).
-- -----------------------------------------------------------------------------
create or replace function private.shipments_dispatch_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_internal boolean := coalesce(current_setting('app.trip_approval_internal', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    new.dispatch_approval := case when new.status = 'assigned' and new.driver_id is not null and private.trip_approval_on()
                                  then 'pending' else 'not_required' end;
    new.dispatch_approval_request_id := null;
    new.dispatch_approved_by := null;
    new.dispatch_approved_at := null;
    new.dispatch_reject_reason := null;
    return new;
  end if;

  if not v_internal and (new.dispatch_approval, new.dispatch_approval_request_id, new.dispatch_approved_by, new.dispatch_approved_at, new.dispatch_reject_reason)
       is distinct from (old.dispatch_approval, old.dispatch_approval_request_id, old.dispatch_approved_by, old.dispatch_approved_at, old.dispatch_reject_reason) then
    raise exception 'Không sửa trực tiếp trạng thái duyệt chuyến. Giám đốc duyệt ở màn hình Phê duyệt hoặc trên chuyến.' using errcode = '42501';
  end if;

  if new.status in ('draft', 'cancelled') then
    if old.dispatch_approval in ('pending', 'rejected') then
      perform private.cancel_trip_approval(old.dispatch_approval_request_id,
        case when new.status = 'cancelled' then 'Chuyến đã hủy' else 'Gỡ phân công tài xế' end);
      new.dispatch_approval := 'not_required';
    end if;
  elsif new.status = 'assigned' and (old.status is distinct from 'assigned' or new.driver_id is distinct from old.driver_id) then
    -- Phân công mới hoặc đổi tài xế: gửi duyệt lại
    if old.dispatch_approval = 'pending' then
      perform private.cancel_trip_approval(old.dispatch_approval_request_id, 'Điều phối đổi tài xế, gửi duyệt lại');
    end if;
    if new.driver_id is not null and private.trip_approval_on() then
      new.dispatch_approval := 'pending';
      new.dispatch_approval_request_id := null;
      new.dispatch_approved_by := null;
      new.dispatch_approved_at := null;
      new.dispatch_reject_reason := null;
    else
      new.dispatch_approval := 'not_required';
    end if;
  elsif old.status = 'assigned' and new.status <> 'assigned' and new.dispatch_approval in ('pending', 'rejected') then
    raise exception 'Chuyến % chưa được Giám đốc duyệt nên tài xế chưa nhận được', old.shipment_code using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger trg_shipments_dispatch_approval before insert or update on public.shipments
for each row execute function private.shipments_dispatch_approval();

-- Sau khi lưu: tạo yêu cầu duyệt và báo Giám đốc
create or replace function private.shipments_submit_dispatch_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content text;
  v_id uuid;
begin
  if new.dispatch_approval <> 'pending' or new.dispatch_approval_request_id is not null then
    return null;
  end if;
  select 'Chuyến ' || new.shipment_code
         || ' · ' || coalesce(c.code, c.name, '')
         || ' · ' || coalesce(pl.name, '') || ' → ' || coalesce(dl.name, '')
         || ' · nhận ' || to_char(new.pickup_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY')
         || ' · xe ' || coalesce(v.plate_number, 'chưa chọn')
         || ' · ' || coalesce(d.full_name, '')
    into v_content
  from public.transport_orders o
  left join public.customers c on c.id = o.customer_id
  left join public.locations pl on pl.id = new.pickup_location_id
  left join public.locations dl on dl.id = new.delivery_location_id
  left join public.vehicles v on v.id = new.vehicle_id
  left join public.drivers d on d.id = new.driver_id
  where o.id = new.order_id;

  v_id := private.submit_approval('trip_dispatch', 'shipment_dispatch', new.id, new.id,
    new.freight_amount + new.surcharge_amount + new.fuel_support_amount + new.extra_fee_amount,
    coalesce(v_content, 'Chuyến ' || new.shipment_code), auth.uid(), new.driver_id,
    case when auth.uid() is null then 'Hệ thống' end);
  perform set_config('app.trip_approval_internal', 'on', true);
  update public.shipments set dispatch_approval_request_id = v_id where id = new.id;
  perform set_config('app.trip_approval_internal', '', true);
  return null;
end;
$$;
create trigger trg_shipments_submit_dispatch_approval after insert or update of dispatch_approval, dispatch_approval_request_id, status, driver_id
on public.shipments
for each row execute function private.shipments_submit_dispatch_approval();

-- Tắt tham số: thả các chuyến đang chờ duyệt / bị từ chối cho tài xế nhận
create or replace function private.system_settings_trip_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
begin
  if new.key = 'dispatch.require_director_approval' and new.value is distinct from 'true'::jsonb
     and old.value = 'true'::jsonb then
    perform set_config('app.trip_approval_internal', 'on', true);
    for s in select id, dispatch_approval_request_id from public.shipments where dispatch_approval in ('pending', 'rejected') for update loop
      perform private.cancel_trip_approval(s.dispatch_approval_request_id, 'Đã tắt yêu cầu Giám đốc duyệt chuyến');
      update public.shipments set dispatch_approval = 'not_required' where id = s.id;
    end loop;
    perform set_config('app.trip_approval_internal', '', true);
  end if;
  return null;
end;
$$;
create trigger trg_system_settings_trip_approval after update on public.system_settings
for each row execute function private.system_settings_trip_approval();

-- -----------------------------------------------------------------------------
-- 4. Tài xế chỉ thấy chuyến đã duyệt (hoặc không cần duyệt)
-- -----------------------------------------------------------------------------
create or replace function private.driver_link_visible(p_vehicle_id uuid, p_shipment public.shipments)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_shipment.driver_id is not null
    and p_shipment.dispatch_approval in ('not_required', 'approved')
    and (
      p_shipment.vehicle_id = p_vehicle_id
      or (p_shipment.vehicle_id is null and p_shipment.driver_id =
            (select v.assigned_driver_id from public.vehicles v where v.id = p_vehicle_id))), false);
$$;
revoke all on function private.driver_link_visible(uuid, public.shipments) from public, anon, authenticated;

create or replace function public.driver_list_my_shipments(p_include_finished boolean default false)
returns table (
  shipment_id uuid,
  shipment_code text,
  status text,
  pickup_at timestamptz,
  expected_delivery_at timestamptz,
  plate_number text,
  notes text,
  pickup_name text,
  pickup_address text,
  pickup_contact text,
  pickup_phone text,
  pickup_maps_url text,
  pickup_gate_instructions text,
  delivery_name text,
  delivery_address text,
  delivery_contact text,
  delivery_phone text,
  delivery_maps_url text,
  delivery_gate_instructions text,
  assignment_id uuid,
  assignment_response text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.shipment_code, s.status, s.pickup_at, s.expected_delivery_at,
         v.plate_number, s.notes,
         pl.name, pl.full_address, pl.contact_name, pl.phone,
         coalesce(pl.google_maps_url, case when pl.latitude is not null then
           'https://www.google.com/maps/search/?api=1&query=' || pl.latitude || ',' || pl.longitude end),
         pl.gate_instructions,
         dl.name, dl.full_address, dl.contact_name, dl.phone,
         coalesce(dl.google_maps_url, case when dl.latitude is not null then
           'https://www.google.com/maps/search/?api=1&query=' || dl.latitude || ',' || dl.longitude end),
         dl.gate_instructions,
         a.id, a.response
  from public.shipments s
  join public.locations pl on pl.id = s.pickup_location_id
  join public.locations dl on dl.id = s.delivery_location_id
  left join public.vehicles v on v.id = s.vehicle_id
  left join public.shipment_assignments a
    on a.shipment_id = s.id and a.driver_id = s.driver_id and a.response in ('pending', 'accepted')
  where private.has_perm('driver_app.use')
    and s.driver_id = private.my_driver_id()
    and s.status not in ('draft', 'cancelled')
    and s.dispatch_approval in ('not_required', 'approved')
    and (p_include_finished or s.status not in ('closed'))
  order by s.pickup_at desc
  limit 200;
$$;
revoke all on function public.driver_list_my_shipments(boolean) from public, anon;
grant execute on function public.driver_list_my_shipments(boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Thông báo người duyệt: chuyến thì ghi mã chuyến, mở thẳng chuyến
-- -----------------------------------------------------------------------------
create or replace function private.notify_approvers(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
  v_type text;
  v_title text;
  v_link text;
  n int;
begin
  select * into r from public.approval_requests where id = p_request_id;
  select name into v_type from public.approval_types where id = r.approval_type_id;
  if r.entity_type = 'shipment_dispatch' then
    v_title := 'Chuyến chờ Giám đốc duyệt: ' || coalesce((select shipment_code from public.shipments where id = r.entity_id), '');
    v_link := '/chuyen-xe/' || r.entity_id;
  else
    v_title := v_type || ' chờ duyệt: ' || to_char(coalesce(r.amount, 0), 'FM999G999G999G990') || ' đ';
    v_link := '/phe-duyet';
  end if;
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
  select distinct p.id, 'approval_pending', v_title, r.content, 'approval_request', r.id, v_link
  from public.approval_rules ar
  join public.profiles p on p.status = 'active' and (
    p.id = ar.approver_user_id
    or exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role_id = ar.approver_role_id))
  where ar.approval_type_id = r.approval_type_id and ar.is_active and ar.level = r.current_level
    and coalesce(r.amount, 0) >= ar.min_amount and (ar.max_amount is null or coalesce(r.amount, 0) <= ar.max_amount)
    and p.id is distinct from r.requested_by;
  get diagnostics n = row_count;
  if n = 0 then
    perform private.notify_permission_holders('approvals.approve', 'approval_pending',
      case when r.entity_type = 'shipment_dispatch' then v_title else v_type || ' chờ duyệt' end,
      r.content, 'approval_request', r.id, v_link);
  end if;
end;
$$;
revoke all on function private.notify_approvers(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Duyệt / từ chối: thêm xử lý cho chuyến (giữ nguyên ứng tiền, chi phí, bảng lương như 0017)
-- -----------------------------------------------------------------------------
create or replace function public.approval_decide(p_request_id uuid, p_action text, p_comment text default null, p_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
  v_type text;
  v_next int;
  v_amount numeric;
  v_link text;
begin
  select * into r from public.approval_requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'Không tìm thấy yêu cầu' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'Yêu cầu không còn chờ duyệt' using errcode = '22023';
  end if;
  if not private.can_approve(r.id) then
    raise exception 'Bạn không được duyệt yêu cầu này (không đúng cấp duyệt hoặc là khoản của chính bạn)' using errcode = '42501';
  end if;
  select code into v_type from public.approval_types where id = r.approval_type_id;
  v_link := case when r.entity_type = 'shipment_dispatch' then '/chuyen-xe/' || r.entity_id else '/phe-duyet' end;

  if p_action = 'reject' then
    if length(trim(coalesce(p_comment, ''))) = 0 then
      raise exception 'Nhập lý do từ chối' using errcode = '22023';
    end if;
    insert into public.approval_steps (request_id, level, action, actor_id, comment) values (r.id, r.current_level, 'reject', auth.uid(), trim(p_comment));
    update public.approval_requests set status = 'rejected', reject_reason = trim(p_comment), decided_at = now() where id = r.id;
    if r.entity_type = 'advance_request' then
      update public.advance_requests set status = 'rejected' where id = r.entity_id;
    elsif r.entity_type = 'shipment_expense' then
      update public.shipment_expenses set status = 'rejected' where id = r.entity_id;
    elsif r.entity_type = 'driver_payroll' then
      update public.driver_payrolls set status = 'rejected' where id = r.entity_id;
      update public.shipment_expenses set payroll_id = null where payroll_id = r.entity_id;
    elsif r.entity_type = 'shipment_dispatch' then
      perform set_config('app.trip_approval_internal', 'on', true);
      update public.shipments set dispatch_approval = 'rejected', dispatch_reject_reason = trim(p_comment)
       where id = r.entity_id and dispatch_approval_request_id = r.id;
      perform set_config('app.trip_approval_internal', '', true);
    end if;
    if r.requested_by is not null then
      insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
      values (r.requested_by, 'approval_rejected', 'Bị từ chối: ' || r.content, trim(p_comment), 'approval_request', r.id, v_link);
    end if;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  if p_action <> 'approve' then
    raise exception 'Thao tác không hợp lệ' using errcode = '22023';
  end if;

  v_amount := r.amount;
  if p_amount is not null then
    if r.entity_type <> 'advance_request' then
      raise exception 'Chỉ được sửa số tiền khi duyệt ứng tiền' using errcode = '22023';
    end if;
    if p_amount <= 0 or p_amount > r.amount then
      raise exception 'Số tiền duyệt phải lớn hơn 0 và không vượt số tiền xin ứng' using errcode = '22023';
    end if;
    v_amount := p_amount;
  end if;

  insert into public.approval_steps (request_id, level, action, actor_id, comment)
  values (r.id, r.current_level, 'approve', auth.uid(),
          nullif(trim(coalesce(p_comment, '')), '') || case when v_amount <> r.amount then ' (duyệt ' || to_char(v_amount, 'FM999G999G999G990') || ' đ)' else '' end);
  select min(l) into v_next from unnest(r.levels) l where l > r.current_level;
  if v_next is not null then
    update public.approval_requests set current_level = v_next where id = r.id;
    if r.entity_type = 'advance_request' and v_amount <> r.amount then
      update public.advance_requests set amount_approved = v_amount where id = r.entity_id;
    end if;
    perform private.notify_approvers(r.id);
    return jsonb_build_object('ok', true, 'status', 'pending', 'level', v_next);
  end if;

  update public.approval_requests set status = 'approved', decided_at = now() where id = r.id;
  if r.entity_type = 'advance_request' then
    update public.advance_requests
       set status = 'approved', amount_approved = least(coalesce(amount_approved, v_amount), v_amount)
     where id = r.entity_id;
    perform private.notify_permission_holders('advances.pay', 'advance_to_pay', 'Chờ chuyển tiền: ' || r.content, null,
      'advance_request', r.entity_id, '/chi-phi?tab=advances&f_status=approved');
  elsif r.entity_type = 'shipment_expense' then
    update public.shipment_expenses set status = 'approved' where id = r.entity_id;
  elsif r.entity_type = 'driver_payroll' then
    update public.driver_payrolls set status = 'approved' where id = r.entity_id;
    perform private.notify_permission_holders('settlements.update', 'payroll_to_pay', 'Chờ trả lương: ' || r.content, null,
      'driver_payroll', r.entity_id, '/chi-phi?tab=payrolls&f_status=approved');
  elsif r.entity_type = 'shipment_dispatch' then
    perform set_config('app.trip_approval_internal', 'on', true);
    update public.shipments set dispatch_approval = 'approved', dispatch_approved_by = auth.uid(), dispatch_approved_at = now()
     where id = r.entity_id and dispatch_approval_request_id = r.id;
    perform set_config('app.trip_approval_internal', '', true);
  end if;
  if r.requested_by is not null then
    insert into public.notifications (recipient_id, type, title, entity_type, entity_id, link)
    values (r.requested_by, 'approval_approved', 'Đã duyệt: ' || r.content, 'approval_request', r.id, v_link);
  end if;
  return jsonb_build_object('ok', true, 'status', 'approved');
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Điều phối gửi duyệt lại chuyến bị từ chối (sau khi sửa)
-- -----------------------------------------------------------------------------
create or replace function public.resubmit_trip_approval(p_shipment_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
begin
  if not private.has_perm('dispatch.update') then
    raise exception 'Bạn không có quyền gửi duyệt chuyến' using errcode = '42501';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = 'P0001';
  end if;
  if s.status <> 'assigned' or s.driver_id is null then
    raise exception 'Chỉ gửi duyệt được chuyến đã phân công tài xế và chưa nhận' using errcode = '22023';
  end if;
  if s.dispatch_approval <> 'rejected' then
    raise exception 'Chuyến không ở trạng thái bị từ chối' using errcode = '22023';
  end if;
  if not private.trip_approval_on() then
    raise exception 'Đang tắt yêu cầu Giám đốc duyệt chuyến' using errcode = '22023';
  end if;
  perform set_config('app.trip_approval_internal', 'on', true);
  update public.shipments set dispatch_approval = 'pending', dispatch_approval_request_id = null,
    dispatch_approved_by = null, dispatch_approved_at = null, dispatch_reject_reason = null
  where id = s.id;
  perform set_config('app.trip_approval_internal', '', true);
  if nullif(trim(coalesce(p_note, '')), '') is not null then
    insert into public.approval_steps (request_id, level, action, actor_id, comment)
    select dispatch_approval_request_id, 0, 'comment', auth.uid(), trim(p_note)
    from public.shipments where id = s.id and dispatch_approval_request_id is not null;
  end if;
end;
$$;
revoke all on function public.resubmit_trip_approval(uuid, text) from public, anon;
grant execute on function public.resubmit_trip_approval(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Danh sách chuyến: thêm trạng thái duyệt (cột mới ở cuối view)
-- -----------------------------------------------------------------------------
create or replace view public.shipment_list with (security_invoker = true) as
select
  s.id, s.shipment_code, s.order_id, o.order_code, s.sequence_in_order,
  o.customer_id, c.name as customer_name, c.code as customer_code,
  s.pickup_at, s.expected_delivery_at,
  s.pickup_location_id, pl.name as pickup_name,
  s.delivery_location_id, dl.name as delivery_name,
  s.vehicle_type_id, vt.name as vehicle_type_name,
  s.vehicle_id, v.plate_number,
  s.driver_id, d.full_name as driver_name, d.code as driver_code,
  s.price_list_id, s.unit_price, s.pricing_unit, s.quantity, s.freight_amount, s.surcharge_amount,
  s.fuel_support_rate, s.fuel_support_base, s.fuel_support_amount,
  s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as total_revenue,
  s.status, s.document_status, s.settlement_status,
  s.notes, s.version, s.created_at, s.updated_at,
  s.custom_fields, o.custom_fields as order_custom_fields,
  s.vehicle_day_order,
  s.extra_fee_amount, s.pass_through_amount,
  s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount + s.pass_through_amount as amount_due,
  s.dispatch_approval, s.dispatch_approval_request_id,
  s.dispatch_reject_reason,
  (s.dispatch_approval = 'pending' and s.dispatch_approval_request_id is not null
     and private.can_approve(s.dispatch_approval_request_id)) as can_approve_dispatch
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.customer_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicle_types vt on vt.id = s.vehicle_type_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id;

-- >>> 20261101000034_trip_approval_delegation.sql
-- =============================================================================
-- 0034: Ủy quyền duyệt chuyến (yêu cầu Khánh Hà 01/11/2026)
--   Giám đốc chỉ định người (thường là điều phối) duyệt hộ chuyến khi đi công tác, hội họp.
--   - Ủy quyền có thời hạn (từ lúc tạo đến ngày hết hạn, để trống = đến khi thu hồi), thu hồi được bất cứ lúc nào.
--   - Người được ủy quyền duyệt/từ chối được chuyến (chỉ loại Duyệt chuyến xe), kể cả chuyến do chính họ phân công.
--   - Lịch sử duyệt ghi rõ "Duyệt hộ"; Giám đốc nhận thông báo mỗi lần được duyệt hộ.
-- =============================================================================

create table public.trip_approval_delegations (
  id uuid primary key default gen_random_uuid(),
  delegate_id uuid not null references public.profiles (id),
  granted_by uuid references public.profiles (id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  note text check (note is null or length(note) <= 500),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index trip_approval_delegations_delegate_idx on public.trip_approval_delegations (delegate_id) where revoked_at is null;
alter table public.trip_approval_delegations enable row level security;
-- Chỉ đọc/ghi qua các hàm bên dưới
revoke all on public.trip_approval_delegations from anon, authenticated;

alter table public.shipments add column dispatch_approved_on_behalf boolean not null default false;

-- Người duyệt chuyến chính thức (theo Cấu hình cấp duyệt của loại Duyệt chuyến xe) hoặc Super Admin
create or replace function private.is_trip_approver(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin(p_uid) or exists (
    select 1 from public.approval_rules ar
    join public.approval_types t on t.id = ar.approval_type_id and t.code = 'trip_dispatch'
    join public.profiles p on p.id = p_uid and p.status = 'active'
    where ar.is_active
      and (ar.approver_user_id = p_uid
           or exists (select 1 from public.user_roles ur where ur.user_id = p_uid and ur.role_id = ar.approver_role_id)));
$$;
revoke all on function private.is_trip_approver(uuid) from public, anon;
grant execute on function private.is_trip_approver(uuid) to authenticated;

-- Người dùng đang được ủy quyền duyệt chuyến
create or replace function private.is_trip_delegate(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.trip_approval_delegations g
    join public.profiles p on p.id = g.delegate_id and p.status = 'active'
    where g.delegate_id = p_uid and g.revoked_at is null
      and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()));
$$;
revoke all on function private.is_trip_delegate(uuid) from public, anon;
grant execute on function private.is_trip_delegate(uuid) to authenticated;

-- Quy tắc duyệt cũ (đúng cấp duyệt, không tự duyệt) tách thành hàm riêng
create or replace function private.can_approve_regular(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select r.status = 'pending'
      and private.has_perm('approvals.approve')
      and (t.allow_self_approval or (
        r.requested_by is distinct from auth.uid()
        and not exists (select 1 from public.drivers d where d.id = r.requested_driver_id and d.profile_id = auth.uid())))
      and (private.is_super_admin() or exists (
        select 1 from public.approval_rules ar
        where ar.approval_type_id = r.approval_type_id and ar.is_active and ar.level = r.current_level
          and coalesce(r.amount, 0) >= ar.min_amount and (ar.max_amount is null or coalesce(r.amount, 0) <= ar.max_amount)
          and (ar.approver_user_id = auth.uid()
               or exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role_id = ar.approver_role_id))))
    from public.approval_requests r
    join public.approval_types t on t.id = r.approval_type_id
    where r.id = p_request_id), false);
$$;
revoke all on function private.can_approve_regular(uuid) from public, anon;
grant execute on function private.can_approve_regular(uuid) to authenticated;

-- Duyệt được = đúng cấp duyệt, HOẶC đang được ủy quyền và yêu cầu là Duyệt chuyến xe
create or replace function private.can_approve(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_approve_regular(p_request_id) or coalesce((
    select r.status = 'pending' and r.entity_type = 'shipment_dispatch' and private.is_trip_delegate()
    from public.approval_requests r where r.id = p_request_id), false);
$$;
revoke all on function private.can_approve(uuid) from public, anon;
grant execute on function private.can_approve(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Giao / thu hồi / xem ủy quyền
-- -----------------------------------------------------------------------------
create or replace function public.grant_trip_delegation(p_delegate_id uuid, p_ends_at timestamptz default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text;
  v_me text;
begin
  if not private.is_trip_approver() then
    raise exception 'Chỉ Giám đốc (người duyệt chuyến) mới ủy quyền được' using errcode = '42501';
  end if;
  if p_delegate_id is null or p_delegate_id = auth.uid() then
    raise exception 'Chọn người được ủy quyền (không chọn chính mình)' using errcode = '22023';
  end if;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = p_delegate_id and status = 'active';
  if v_name is null then
    raise exception 'Người được ủy quyền không tồn tại hoặc chưa được kích hoạt' using errcode = '22023';
  end if;
  if p_ends_at is not null and p_ends_at <= now() then
    raise exception 'Ngày hết hạn ủy quyền phải sau thời điểm hiện tại' using errcode = '22023';
  end if;
  insert into public.trip_approval_delegations (delegate_id, granted_by, ends_at, note)
  values (p_delegate_id, auth.uid(), p_ends_at, nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_id;
  select coalesce(nullif(full_name, ''), email) into v_me from public.profiles where id = auth.uid();
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
  values (p_delegate_id, 'trip_delegation', 'Bạn được ủy quyền duyệt chuyến thay Giám đốc',
          coalesce(v_me, 'Giám đốc') || ' ủy quyền'
            || case when p_ends_at is null then ' đến khi thu hồi'
                    else ' đến ' || to_char(p_ends_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY') end
            || '. Duyệt ở màn hình Điều phối (thẻ Chờ GĐ duyệt).',
          'trip_delegation', v_id, '/dieu-phoi?tt=cho-duyet');
  return v_id;
end;
$$;
revoke all on function public.grant_trip_delegation(uuid, timestamptz, text) from public, anon;
grant execute on function public.grant_trip_delegation(uuid, timestamptz, text) to authenticated;

create or replace function public.revoke_trip_delegation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.trip_approval_delegations;
begin
  if not private.is_trip_approver() then
    raise exception 'Chỉ Giám đốc (người duyệt chuyến) mới thu hồi được ủy quyền' using errcode = '42501';
  end if;
  update public.trip_approval_delegations set revoked_at = now(), revoked_by = auth.uid()
   where id = p_id and revoked_at is null
  returning * into g;
  if g.id is null then
    raise exception 'Ủy quyền không tồn tại hoặc đã thu hồi' using errcode = '22023';
  end if;
  insert into public.notifications (recipient_id, type, title, entity_type, entity_id, link)
  values (g.delegate_id, 'trip_delegation', 'Đã thu hồi ủy quyền duyệt chuyến', 'trip_delegation', g.id, '/dieu-phoi');
end;
$$;
revoke all on function public.revoke_trip_delegation(uuid) from public, anon;
grant execute on function public.revoke_trip_delegation(uuid) to authenticated;

-- Trạng thái ủy quyền cho giao diện: người xem có phải người duyệt / người được ủy quyền, danh sách ủy quyền, người chọn được
create or replace function public.trip_delegation_info()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_approver boolean := private.is_trip_approver();
begin
  if not private.is_active_user() then
    return null;
  end if;
  return jsonb_build_object(
    'is_approver', v_approver,
    'is_delegate', private.is_trip_delegate(),
    'my_delegation', (
      select jsonb_build_object('ends_at', g.ends_at, 'granted_by_name', coalesce(nullif(p.full_name, ''), p.email))
      from public.trip_approval_delegations g left join public.profiles p on p.id = g.granted_by
      where g.delegate_id = auth.uid() and g.revoked_at is null and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
      order by g.ends_at desc nulls first limit 1),
    'delegations', case when v_approver then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id, 'delegate_id', g.delegate_id, 'delegate_name', coalesce(nullif(d.full_name, ''), d.email),
        'granted_by_name', coalesce(nullif(b.full_name, ''), b.email), 'starts_at', g.starts_at, 'ends_at', g.ends_at,
        'note', g.note, 'revoked_at', g.revoked_at,
        'active', g.revoked_at is null and (g.ends_at is null or g.ends_at > now()))
        order by (g.revoked_at is null and (g.ends_at is null or g.ends_at > now())) desc, g.created_at desc)
      from (select * from public.trip_approval_delegations order by created_at desc limit 30) g
      join public.profiles d on d.id = g.delegate_id
      left join public.profiles b on b.id = g.granted_by), '[]'::jsonb) end,
    'candidates', case when v_approver then coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name, ''), p.email), 'email', p.email, 'roles', x.roles)
        order by coalesce(nullif(p.full_name, ''), p.email))
      from public.profiles p
      cross join lateral (
        select string_agg(r.name, ', ' order by r.sort_order) as roles,
               bool_or(exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission_code = 'dispatch.update')) as can_dispatch
        from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.id) x
      where p.status = 'active' and p.id <> auth.uid() and coalesce(x.can_dispatch, false)), '[]'::jsonb) end
  );
end;
$$;
revoke all on function public.trip_delegation_info() from public, anon;
grant execute on function public.trip_delegation_info() to authenticated;

-- -----------------------------------------------------------------------------
-- Thông báo chuyến chờ duyệt: gửi thêm cho người đang được ủy quyền
-- -----------------------------------------------------------------------------
-- notifications.entity_type của thông báo duyệt là 'approval_request'; lọc theo yêu cầu chuyến bên dưới
create or replace function private.notify_trip_delegates_on_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type = 'approval_pending' and new.entity_type = 'approval_request'
     and exists (select 1 from public.approval_requests r where r.id = new.entity_id and r.entity_type = 'shipment_dispatch') then
    insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
    select distinct g.delegate_id, 'approval_pending_delegate', new.title || ' (bạn được ủy quyền duyệt)', new.body, new.entity_type, new.entity_id, new.link
    from public.trip_approval_delegations g
    join public.profiles p on p.id = g.delegate_id and p.status = 'active'
    where g.revoked_at is null and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
      and g.delegate_id <> new.recipient_id
      and not exists (select 1 from public.notifications n
                      where n.recipient_id = g.delegate_id and n.entity_id = new.entity_id
                        and n.type in ('approval_pending', 'approval_pending_delegate'));
  end if;
  return null;
end;
$$;
create trigger trg_notifications_trip_delegates after insert on public.notifications
for each row execute function private.notify_trip_delegates_on_request();

-- -----------------------------------------------------------------------------
-- Duyệt / từ chối: ghi "Duyệt hộ" khi người duyệt là người được ủy quyền, báo lại Giám đốc
-- -----------------------------------------------------------------------------
create or replace function public.approval_decide(p_request_id uuid, p_action text, p_comment text default null, p_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
  v_type text;
  v_next int;
  v_amount numeric;
  v_link text;
  v_behalf boolean;
  v_prefix text := '';
  v_me text;
begin
  select * into r from public.approval_requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'Không tìm thấy yêu cầu' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'Yêu cầu không còn chờ duyệt' using errcode = '22023';
  end if;
  if not private.can_approve(r.id) then
    raise exception 'Bạn không được duyệt yêu cầu này (không đúng cấp duyệt hoặc là khoản của chính bạn)' using errcode = '42501';
  end if;
  select code into v_type from public.approval_types where id = r.approval_type_id;
  v_link := case when r.entity_type = 'shipment_dispatch' then '/chuyen-xe/' || r.entity_id else '/phe-duyet' end;
  v_behalf := r.entity_type = 'shipment_dispatch' and not private.can_approve_regular(r.id);
  if v_behalf then
    v_prefix := 'Duyệt hộ Giám đốc (ủy quyền)';
    select coalesce(nullif(full_name, ''), email) into v_me from public.profiles where id = auth.uid();
  end if;

  if p_action = 'reject' then
    if length(trim(coalesce(p_comment, ''))) = 0 then
      raise exception 'Nhập lý do từ chối' using errcode = '22023';
    end if;
    insert into public.approval_steps (request_id, level, action, actor_id, comment)
    values (r.id, r.current_level, 'reject', auth.uid(), case when v_behalf then v_prefix || ': ' else '' end || trim(p_comment));
    update public.approval_requests set status = 'rejected', reject_reason = trim(p_comment), decided_at = now() where id = r.id;
    if r.entity_type = 'advance_request' then
      update public.advance_requests set status = 'rejected' where id = r.entity_id;
    elsif r.entity_type = 'shipment_expense' then
      update public.shipment_expenses set status = 'rejected' where id = r.entity_id;
    elsif r.entity_type = 'driver_payroll' then
      update public.driver_payrolls set status = 'rejected' where id = r.entity_id;
      update public.shipment_expenses set payroll_id = null where payroll_id = r.entity_id;
    elsif r.entity_type = 'shipment_dispatch' then
      perform set_config('app.trip_approval_internal', 'on', true);
      update public.shipments set dispatch_approval = 'rejected', dispatch_reject_reason = trim(p_comment)
       where id = r.entity_id and dispatch_approval_request_id = r.id;
      perform set_config('app.trip_approval_internal', '', true);
    end if;
    if r.requested_by is not null and r.requested_by is distinct from auth.uid() then
      insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
      values (r.requested_by, 'approval_rejected', 'Bị từ chối: ' || r.content, trim(p_comment), 'approval_request', r.id, v_link);
    end if;
    if v_behalf then
      perform private.notify_trip_grantors(r.id, coalesce(v_me, 'Người được ủy quyền') || ' đã từ chối hộ: ' || r.content, trim(p_comment), v_link);
    end if;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  if p_action <> 'approve' then
    raise exception 'Thao tác không hợp lệ' using errcode = '22023';
  end if;

  v_amount := r.amount;
  if p_amount is not null then
    if r.entity_type <> 'advance_request' then
      raise exception 'Chỉ được sửa số tiền khi duyệt ứng tiền' using errcode = '22023';
    end if;
    if p_amount <= 0 or p_amount > r.amount then
      raise exception 'Số tiền duyệt phải lớn hơn 0 và không vượt số tiền xin ứng' using errcode = '22023';
    end if;
    v_amount := p_amount;
  end if;

  insert into public.approval_steps (request_id, level, action, actor_id, comment)
  values (r.id, r.current_level, 'approve', auth.uid(),
          nullif(concat_ws(': ', nullif(v_prefix, ''), nullif(trim(coalesce(p_comment, '')), '')), '')
            || case when v_amount <> r.amount then ' (duyệt ' || to_char(v_amount, 'FM999G999G999G990') || ' đ)' else '' end);
  -- Người được ủy quyền duyệt thay toàn bộ các cấp của chuyến
  select min(l) into v_next from unnest(r.levels) l where l > r.current_level and not v_behalf;
  if v_next is not null then
    update public.approval_requests set current_level = v_next where id = r.id;
    if r.entity_type = 'advance_request' and v_amount <> r.amount then
      update public.advance_requests set amount_approved = v_amount where id = r.entity_id;
    end if;
    perform private.notify_approvers(r.id);
    return jsonb_build_object('ok', true, 'status', 'pending', 'level', v_next);
  end if;

  update public.approval_requests set status = 'approved', decided_at = now() where id = r.id;
  if r.entity_type = 'advance_request' then
    update public.advance_requests
       set status = 'approved', amount_approved = least(coalesce(amount_approved, v_amount), v_amount)
     where id = r.entity_id;
    perform private.notify_permission_holders('advances.pay', 'advance_to_pay', 'Chờ chuyển tiền: ' || r.content, null,
      'advance_request', r.entity_id, '/chi-phi?tab=advances&f_status=approved');
  elsif r.entity_type = 'shipment_expense' then
    update public.shipment_expenses set status = 'approved' where id = r.entity_id;
  elsif r.entity_type = 'driver_payroll' then
    update public.driver_payrolls set status = 'approved' where id = r.entity_id;
    perform private.notify_permission_holders('settlements.update', 'payroll_to_pay', 'Chờ trả lương: ' || r.content, null,
      'driver_payroll', r.entity_id, '/chi-phi?tab=payrolls&f_status=approved');
  elsif r.entity_type = 'shipment_dispatch' then
    perform set_config('app.trip_approval_internal', 'on', true);
    update public.shipments set dispatch_approval = 'approved', dispatch_approved_by = auth.uid(), dispatch_approved_at = now(),
      dispatch_approved_on_behalf = v_behalf
     where id = r.entity_id and dispatch_approval_request_id = r.id;
    perform set_config('app.trip_approval_internal', '', true);
  end if;
  if r.requested_by is not null and r.requested_by is distinct from auth.uid() then
    insert into public.notifications (recipient_id, type, title, entity_type, entity_id, link)
    values (r.requested_by, 'approval_approved', 'Đã duyệt: ' || r.content, 'approval_request', r.id, v_link);
  end if;
  if v_behalf then
    perform private.notify_trip_grantors(r.id, coalesce(v_me, 'Người được ủy quyền') || ' đã duyệt hộ: ' || r.content, null, v_link);
  end if;
  return jsonb_build_object('ok', true, 'status', 'approved');
end;
$$;

-- Báo Giám đốc (người đã giao ủy quyền còn hiệu lực) khi chuyến được duyệt/từ chối hộ
create or replace function private.notify_trip_grantors(p_request_id uuid, p_title text, p_body text, p_link text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
  select distinct g.granted_by, 'trip_delegate_decided', p_title, p_body, 'approval_request', p_request_id, p_link
  from public.trip_approval_delegations g
  where g.delegate_id = auth.uid() and g.granted_by is not null and g.revoked_at is null
    and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now());
$$;
revoke all on function private.notify_trip_grantors(uuid, text, text, text) from public, anon, authenticated;

-- Trigger trên chuyến: xóa cờ "duyệt hộ" khi gửi duyệt lại (giữ nguyên logic 0033)
create or replace function private.shipments_clear_on_behalf()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.dispatch_approval <> 'approved' then
    new.dispatch_approved_on_behalf := false;
  end if;
  return new;
end;
$$;
-- Tên bắt đầu "trg_shipments_e" để chạy sau trg_shipments_dispatch_approval (trigger cùng loại chạy theo thứ tự tên)
create trigger trg_shipments_end_on_behalf before update on public.shipments
for each row execute function private.shipments_clear_on_behalf();

commit;
