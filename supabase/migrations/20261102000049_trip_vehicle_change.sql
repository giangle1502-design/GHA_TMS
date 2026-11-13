-- =============================================================================
-- KHÁNH HÀ TMS - 0049: Đổi xe khi tài xế đã nhận chuyến, sửa số xe / tài xế cả khi chuyến đã hoàn thành (02/11/2026)
--   1. "Hủy nhận xe": xe hư sau khi tài xế đã nhận (hoặc đang chạy) -> điều phối hủy phần nhận, chọn xe khác
--      (và tài xế khác nếu cần), chuyến trở về "Chờ tài xế nhận" trên xe mới. Bắt buộc lý do, ghi nhật ký.
--      Giữ nguyên tài xế thì giữ kết quả Giám đốc đã duyệt; đổi tài xế thì gửi duyệt lại như phân công mới.
--   2. "Sửa xe, tài xế": chuyến đang chạy / đã giao / đã đóng nhập sai số xe hoặc tên tài xế -> sửa thẳng,
--      bắt buộc lý do, ghi nhật ký. Chi phí tài xế tự trả của chuyến (chưa vào bảng lương) chuyển theo tài xế đúng.
--      Chặn đổi tài xế khi bảng lương tháng hoàn thành chuyến của tài xế cũ hoặc mới đã lập.
-- =============================================================================

-- Chuyển trạng thái: thêm "đang chạy -> chờ tài xế nhận" chỉ qua unaccept_shipment
create or replace function private.shipment_transition_allowed(from_s text, to_s text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select from_s = to_s or (from_s, to_s) in (
    ('draft', 'assigned'), ('draft', 'cancelled'),
    ('assigned', 'accepted'), ('assigned', 'draft'), ('assigned', 'cancelled'),
    ('accepted', 'in_transit'), ('accepted', 'assigned'), ('accepted', 'draft'), ('accepted', 'cancelled'),
    ('in_transit', 'driver_completed'), ('in_transit', 'cancelled'),
    ('driver_completed', 'in_transit'), ('driver_completed', 'closed'),
    ('closed', 'driver_completed')
  ) or (from_s = 'cancelled' and to_s = 'draft' and coalesce(current_setting('app.shipment_restore', true), '') = 'on')
    or (from_s = 'in_transit' and to_s = 'assigned' and coalesce(current_setting('app.shipment_unaccept', true), '') = 'on');
$$;

-- Giám đốc duyệt chuyến: hủy nhận xe mà giữ tài xế thì không phải duyệt lại
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
  elsif new.status = 'assigned' and (new.driver_id is distinct from old.driver_id
         -- Hủy nhận xe giữ nguyên tài xế (đổi xe hư): giữ kết quả Giám đốc đã duyệt
         or (old.status is distinct from 'assigned' and old.status not in ('accepted', 'in_transit'))) then
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

-- Kiểm tra xe / tài xế dùng chung cho đổi xe
create or replace function private.check_crew(p_vehicle_id uuid, p_driver_id uuid, p_need_active boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_driver_id is null then
    raise exception 'Chọn tài xế' using errcode = '22023';
  end if;
  select status into v_status from public.drivers where id = p_driver_id and archived_at is null;
  if v_status is null then
    raise exception 'Tài xế không tồn tại hoặc đã lưu trữ' using errcode = 'P0001';
  end if;
  if p_need_active and v_status <> 'active' then
    raise exception 'Tài xế không ở trạng thái đang làm việc' using errcode = '22023';
  end if;
  if p_vehicle_id is null then
    raise exception 'Chọn xe' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.vehicles v where v.id = p_vehicle_id and v.archived_at is null
      and (not p_need_active or v.status in ('active', 'maintenance'))
  ) then
    raise exception 'Xe không tồn tại hoặc đã ngừng hoạt động' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.check_crew(uuid, uuid, boolean) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. Hủy nhận xe (tài xế đã nhận / đang chạy) và giao lại cho xe khác
-- -----------------------------------------------------------------------------
create or replace function public.unaccept_shipment(p_shipment_id uuid, p_vehicle_id uuid, p_driver_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_vehicle uuid;
  v_driver uuid;
  v_note text;
begin
  if not private.has_perm('dispatch.update') then
    raise exception 'Bạn không có quyền điều phối chuyến' using errcode = '42501';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Nhập lý do hủy nhận xe (ít nhất 3 ký tự), ví dụ: Xe hư, đổi xe khác' using errcode = '22023';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = 'P0001';
  end if;
  if s.status not in ('accepted', 'in_transit') then
    raise exception 'Chỉ hủy nhận xe được với chuyến tài xế đã nhận hoặc đang chạy' using errcode = '22023';
  end if;
  v_vehicle := coalesce(p_vehicle_id, s.vehicle_id);
  v_driver := coalesce(p_driver_id, s.driver_id);
  perform private.check_crew(v_vehicle, v_driver, true);

  v_note := 'Hủy nhận xe: ' || v_reason;
  perform set_config('gha.audit_reason', v_note, true);
  perform set_config('app.shipment_unaccept', 'on', true);

  update public.shipment_assignments set response = 'superseded', responded_at = now()
   where shipment_id = s.id and response in ('pending', 'accepted');
  insert into public.shipment_assignments (shipment_id, driver_id, vehicle_id, assigned_by)
  values (s.id, v_driver, v_vehicle, auth.uid());
  update public.shipments
     set status = 'assigned', driver_id = v_driver, vehicle_id = v_vehicle, departed_pickup_at = null,
         vehicle_day_order = case when v_vehicle is distinct from s.vehicle_id then null else vehicle_day_order end
   where id = s.id;

  perform set_config('app.shipment_unaccept', '', true);
  perform set_config('gha.audit_reason', '', true);
  update public.shipment_status_history h set note = v_note
   where h.id = (select max(id) from public.shipment_status_history
                  where shipment_id = s.id and status_field = 'status' and to_status = 'assigned');
  return jsonb_build_object('ok', true, 'vehicle_changed', v_vehicle is distinct from s.vehicle_id);
end;
$$;
revoke all on function public.unaccept_shipment(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.unaccept_shipment(uuid, uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Sửa số xe / tài xế của chuyến đang chạy, đã giao hoặc đã đóng (nhập sai)
-- -----------------------------------------------------------------------------
create or replace function public.correct_shipment_crew(p_shipment_id uuid, p_vehicle_id uuid, p_driver_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_month date;
  v_name text;
  v_moved integer := 0;
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('shipments.update')) then
    raise exception 'Bạn không có quyền sửa chuyến' using errcode = '42501';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Nhập lý do sửa (ít nhất 3 ký tự), ví dụ: Nhập nhầm tài xế' using errcode = '22023';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = 'P0001';
  end if;
  if s.status not in ('in_transit', 'driver_completed', 'closed') then
    raise exception 'Chuyến chưa chạy thì dùng nút Phân công / Đổi để đổi xe, tài xế' using errcode = '22023';
  end if;
  perform private.check_crew(p_vehicle_id, p_driver_id, false);
  if p_vehicle_id is not distinct from s.vehicle_id and p_driver_id is not distinct from s.driver_id then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  if p_driver_id is distinct from s.driver_id and s.completed_at is not null then
    v_month := date_trunc('month', s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date;
    select d.full_name into v_name
    from public.driver_payrolls p join public.drivers d on d.id = p.driver_id
    where p.driver_id in (s.driver_id, p_driver_id) and p.period_month = v_month
      and p.status not in ('cancelled', 'rejected')
    limit 1;
    if v_name is not null then
      raise exception 'Bảng lương tháng % của tài xế % đã lập (tính theo số chuyến). Hủy bảng lương đó trước rồi mới sửa tài xế.',
        to_char(v_month, 'MM/YYYY'), v_name using errcode = '22023';
    end if;
  end if;

  perform set_config('gha.audit_reason', 'Sửa xe, tài xế: ' || v_reason, true);
  update public.shipments
     set vehicle_id = p_vehicle_id, driver_id = p_driver_id,
         vehicle_day_order = case when p_vehicle_id is distinct from s.vehicle_id then null else vehicle_day_order end
   where id = s.id;
  -- Phân công đã nhận đi theo xe / tài xế đúng (ứng dụng tài xế, giờ nhận chuyến)
  update public.shipment_assignments set driver_id = p_driver_id, vehicle_id = p_vehicle_id
   where shipment_id = s.id and response = 'accepted';
  -- Chi phí tài xế tự trả của chuyến, chưa vào bảng lương: chuyển cho tài xế đúng
  if p_driver_id is distinct from s.driver_id then
    update public.shipment_expenses e set driver_id = p_driver_id
     where e.shipment_id = s.id and e.driver_id = s.driver_id and e.paid_by = 'driver'
       and e.payroll_id is null and e.status not in ('cancelled', 'rejected');
    get diagnostics v_moved = row_count;
  end if;
  perform set_config('gha.audit_reason', '', true);
  return jsonb_build_object('ok', true, 'changed', true, 'expenses_moved', v_moved);
end;
$$;
revoke all on function public.correct_shipment_crew(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.correct_shipment_crew(uuid, uuid, uuid, text) to authenticated;
