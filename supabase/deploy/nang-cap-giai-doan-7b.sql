-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Giai đoạn 7b (chi phí tài xế nhập khi hoàn thành chuyến, sửa/hủy chi phí)
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('public.driver_link_update_expense(text,uuid,uuid,numeric,text,uuid)') is not null then
    raise exception 'CSDL đã được nâng cấp Giai đoạn 7b (chi phí tài xế nhập khi hoàn thành chuyến, sửa/hủy chi phí) trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261022000018_driver_expense_on_complete.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0018: Chi phí tài xế gắn với bước Hoàn thành chuyến (khách hàng chốt 22/10/2026)
--   * Khi hoàn thành chuyến tài xế bắt buộc chọn: có chi phí (nhập từng khoản) hoặc "không phát sinh chi phí".
--   * Chỉ nhập / bổ sung chi phí cho chuyến đã hoàn thành, cho tới khi văn phòng đóng chuyến.
--   * Tài xế sửa hoặc hủy khoản chưa duyệt (hoặc loại không cần duyệt, chưa vào bảng lương).
--     Sửa = hủy khoản cũ + tạo khoản mới (giữ lịch sử, chứng từ cũ chuyển sang khoản mới nếu không chụp lại).
-- =============================================================================

alter table public.shipments
  add column expense_declaration text check (expense_declaration in ('none', 'has')),
  add column expense_declared_at timestamptz;
comment on column public.shipments.expense_declaration is 'Tài xế xác nhận khi hoàn thành chuyến: none = không phát sinh chi phí, has = có chi phí';

-- Khoản chi phí tài xế còn được sửa/hủy không
create or replace function private.driver_expense_editable(e public.shipment_expenses, s public.shipments)
returns boolean
language sql
stable
set search_path = ''
as $$
  select e.source = 'driver' and s.status = 'driver_completed' and e.payroll_id is null
    and (e.status = 'pending' or (e.status = 'approved' and e.approval_request_id is null));
$$;
revoke all on function private.driver_expense_editable(public.shipment_expenses, public.shipments) from public, anon, authenticated;

-- Hoàn thành chuyến: thêm lựa chọn bắt buộc về chi phí
drop function public.driver_link_complete(text, uuid, uuid, text, text);
create function public.driver_link_complete(
  p_token text, p_shipment_id uuid, p_ticket uuid, p_result text default 'full', p_note text default null, p_no_expense boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_s public.shipments;
  v_name text;
  v_counts jsonb;
  v_photos int;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  select * into v_s from public.shipments where id = p_shipment_id for update;
  if v_s.id is null or not private.driver_link_visible(v_me.vehicle_id, v_s) then
    return jsonb_build_object('ok', false, 'error', 'Chuyến này không còn được phân công cho xe của bạn. Tải lại trang để xem.');
  end if;
  if v_s.status = 'driver_completed' then
    return jsonb_build_object('ok', true);
  end if;
  if v_s.status <> 'in_transit' then
    return jsonb_build_object('ok', false, 'error', 'Bấm "Bắt đầu chạy" trước khi hoàn thành chuyến.');
  end if;
  if coalesce(p_result, '') not in ('full', 'partial', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'Chọn kết quả giao hàng.');
  end if;
  if p_result <> 'full' and length(trim(coalesce(p_note, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Giao thiếu hoặc không giao được: vui lòng ghi lý do.');
  end if;
  if p_no_expense is null then
    return jsonb_build_object('ok', false, 'error', 'Chọn "Có chi phí" và nhập chi phí, hoặc chọn "Không phát sinh chi phí".');
  end if;

  begin
    v_counts := private.driver_attach_uploads(p_ticket, v_me.vehicle_id, 'shipment', v_s.id, array['photo', 'delivery_note']);
  exception when sqlstate '22023' then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  v_photos := coalesce((v_counts ->> 'photo')::int, 0) + coalesce((v_counts ->> 'delivery_note')::int, 0);
  if v_photos = 0 then
    raise exception 'Cần ít nhất 1 ảnh giao hàng hoặc phiếu ký nhận' using errcode = '22023';
  end if;

  update public.shipments
     set status = 'driver_completed',
         completed_at = now(),
         arrived_delivery_at = coalesce(arrived_delivery_at, now()),
         delivery_result = p_result,
         completion_note = nullif(trim(coalesce(p_note, '')), ''),
         document_status = case when document_status in ('missing', 'rejected') then 'submitted' else document_status end,
         expense_declaration = case when p_no_expense then 'none' else 'has' end,
         expense_declared_at = now()
   where id = v_s.id;
  select full_name into v_name from public.drivers where id = v_s.driver_id;
  perform private.driver_link_note(v_s.id, 'driver_completed', v_name || ' hoàn thành chuyến trên điện thoại (' || v_photos || ' ảnh'
    || case when p_no_expense then ', không phát sinh chi phí' else '' end || ')');
  perform private.notify_dispatcher(v_s.id, 'shipment_completed', 'Tài xế ' || v_name || ' đã hoàn thành chuyến ' || v_s.shipment_code);
  return jsonb_build_object('ok', true, 'photos', v_photos);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- Nhập / bổ sung chi phí: chỉ cho chuyến đã hoàn thành, chưa đóng
create or replace function public.driver_link_add_expense(
  p_token text, p_shipment_id uuid, p_category_id uuid, p_amount numeric, p_note text default null,
  p_ticket uuid default null, p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_s public.shipments;
  c public.expense_categories;
  v_id uuid;
  v_counts jsonb;
  v_files int;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  if p_client_request_id is not null and exists (select 1 from public.shipment_expenses where client_request_id = p_client_request_id) then
    return jsonb_build_object('ok', true);
  end if;
  select * into v_s from public.shipments where id = p_shipment_id;
  if v_s.id is null or not private.driver_link_visible(v_me.vehicle_id, v_s) then
    return jsonb_build_object('ok', false, 'error', 'Chọn chuyến của xe bạn.');
  end if;
  if v_s.status = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'Chuyến đã được văn phòng đóng, không bổ sung chi phí được. Vui lòng gọi kế toán.');
  end if;
  if v_s.status <> 'driver_completed' then
    return jsonb_build_object('ok', false, 'error', 'Chi phí được nhập khi bấm Hoàn thành chuyến.');
  end if;
  select * into c from public.expense_categories
   where id = p_category_id and is_active and 'driver' = any (allowed_role_codes);
  if c.id is null then
    return jsonb_build_object('ok', false, 'error', 'Chọn loại chi phí.');
  end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > 1000000000 then
    return jsonb_build_object('ok', false, 'error', 'Nhập số tiền.');
  end if;

  v_id := private.insert_expense(v_s, c, round(p_amount), now(), left(p_note, 500), 'driver', 'driver', v_s.driver_id, null,
    '{}'::jsonb, p_client_request_id, (select full_name from public.drivers where id = v_s.driver_id) || ' (điện thoại)');
  v_counts := private.driver_attach_uploads(p_ticket, v_me.vehicle_id, 'shipment_expense', v_id, array['receipt', 'invoice', 'photo']);
  v_files := coalesce((select sum(value::int) from jsonb_each_text(v_counts)), 0);
  if c.requires_image and v_files = 0 then
    raise exception 'Loại chi phí "%" cần ảnh hóa đơn/biên lai', c.name using errcode = '22023';
  end if;
  update public.shipments set expense_declaration = 'has', expense_declared_at = coalesce(expense_declared_at, now())
   where id = v_s.id and expense_declaration is distinct from 'has';
  return jsonb_build_object('ok', true, 'code', (select code from public.shipment_expenses where id = v_id),
                            'needs_approval', c.requires_approval);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- Hủy một khoản chi phí của tài xế (dùng chung cho Hủy và Sửa)
create or replace function private.driver_cancel_expense(e public.shipment_expenses, p_label text, p_comment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.shipment_expenses set status = 'cancelled' where id = e.id;
  if e.approval_request_id is not null then
    update public.approval_requests set status = 'cancelled', decided_at = now() where id = e.approval_request_id and status = 'pending';
    insert into public.approval_steps (request_id, level, action, actor_label, comment) values (e.approval_request_id, 0, 'cancel', p_label, p_comment);
  end if;
end;
$$;
revoke all on function private.driver_cancel_expense(public.shipment_expenses, text, text) from public, anon, authenticated;

-- Tài xế sửa khoản chi phí: hủy khoản cũ, tạo khoản mới (giữ lịch sử để đối chiếu)
create function public.driver_link_update_expense(
  p_token text, p_expense_id uuid, p_category_id uuid, p_amount numeric, p_note text default null, p_ticket uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  e public.shipment_expenses;
  v_s public.shipments;
  c public.expense_categories;
  v_name text;
  v_id uuid;
  v_counts jsonb;
  v_files int;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  select * into e from public.shipment_expenses where id = p_expense_id for update;
  select * into v_s from public.shipments where id = e.shipment_id;
  if e.id is null or v_s.id is null or not private.driver_link_visible(v_me.vehicle_id, v_s) or e.driver_id is distinct from v_s.driver_id then
    return jsonb_build_object('ok', false, 'error', 'Không tìm thấy khoản chi phí của xe bạn.');
  end if;
  if not private.driver_expense_editable(e, v_s) then
    return jsonb_build_object('ok', false, 'error', 'Khoản này đã được duyệt, đã vào bảng lương hoặc chuyến đã đóng nên không sửa được. Vui lòng gọi kế toán.');
  end if;
  select * into c from public.expense_categories
   where id = p_category_id and is_active and 'driver' = any (allowed_role_codes);
  if c.id is null then
    return jsonb_build_object('ok', false, 'error', 'Chọn loại chi phí.');
  end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > 1000000000 then
    return jsonb_build_object('ok', false, 'error', 'Nhập số tiền.');
  end if;
  select full_name into v_name from public.drivers where id = v_s.driver_id;

  perform private.driver_cancel_expense(e, v_name || ' (điện thoại)', 'Tài xế sửa khoản chi phí');
  v_id := private.insert_expense(v_s, c, round(p_amount), e.incurred_at, left(p_note, 500), 'driver', 'driver', v_s.driver_id, null,
    e.custom_fields, null, v_name || ' (điện thoại)');
  update public.shipment_expenses
     set note = coalesce(note, '') || case when note is null then '' else ' ' end || '(sửa từ ' || e.code || ')'
   where id = v_id;
  v_counts := private.driver_attach_uploads(p_ticket, v_me.vehicle_id, 'shipment_expense', v_id, array['receipt', 'invoice', 'photo']);
  v_files := coalesce((select sum(value::int) from jsonb_each_text(v_counts)), 0);
  if v_files = 0 then
    -- Không chụp lại: dùng chứng từ của khoản cũ
    update public.documents set entity_id = v_id where entity_type = 'shipment_expense' and entity_id = e.id and archived_at is null;
    get diagnostics v_files = row_count;
  end if;
  if c.requires_image and v_files = 0 then
    raise exception 'Loại chi phí "%" cần ảnh hóa đơn/biên lai', c.name using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'code', (select code from public.shipment_expenses where id = v_id), 'needs_approval', c.requires_approval);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- Hủy: thêm khoản loại không cần duyệt (chưa vào bảng lương, chuyến chưa đóng)
create or replace function public.driver_link_cancel(p_token text, p_kind text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  d public.drivers;
  v_req uuid;
  v_hit boolean := false;
  e public.shipment_expenses;
  v_s public.shipments;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  d := private.driver_link_driver(v_me.vehicle_id);
  if p_kind = 'advance' then
    update public.advance_requests set status = 'cancelled'
     where id = p_id and driver_id = d.id and status = 'pending' returning approval_request_id into v_req;
    v_hit := found;
    if v_hit and v_req is not null then
      update public.approval_requests set status = 'cancelled', decided_at = now() where id = v_req and status = 'pending';
      insert into public.approval_steps (request_id, level, action, actor_label) values (v_req, 0, 'cancel', d.full_name || ' (điện thoại)');
    end if;
  elsif p_kind = 'expense' then
    select * into e from public.shipment_expenses where id = p_id for update;
    select * into v_s from public.shipments where id = e.shipment_id;
    if e.id is not null and v_s.id is not null and private.driver_link_visible(v_me.vehicle_id, v_s)
       and e.driver_id is not distinct from v_s.driver_id and private.driver_expense_editable(e, v_s) then
      perform private.driver_cancel_expense(e, coalesce(d.full_name, 'Tài xế') || ' (điện thoại)', null);
      v_hit := true;
    end if;
  end if;
  if not v_hit then
    return jsonb_build_object('ok', false, 'error', 'Chỉ hủy được khoản chưa duyệt (hoặc loại không cần duyệt, chưa vào bảng lương) của chuyến chưa đóng.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Thẻ chuyến trên điện thoại: thêm xác nhận chi phí, số khoản và tổng tiền
drop function public.driver_link_trips(text);
create function public.driver_link_trips(p_token text)
returns table (
  shipment_id uuid,
  shipment_code text,
  status text,
  pickup_at timestamptz,
  expected_delivery_at timestamptz,
  plate_number text,
  vehicle_type_name text,
  quantity numeric,
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
  driver_name text,
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  delivery_result text,
  photo_count bigint,
  expense_declaration text,
  expense_count bigint,
  expense_total numeric
)
language sql
security definer
set search_path = ''
as $$
  select s.id, s.shipment_code, s.status, s.pickup_at, s.expected_delivery_at,
         v.plate_number, vt.name, s.quantity, s.notes,
         pl.name, pl.full_address, pl.contact_name, pl.phone,
         coalesce(pl.google_maps_url, case when pl.latitude is not null then
           'https://www.google.com/maps/search/?api=1&query=' || pl.latitude || ',' || pl.longitude end),
         pl.gate_instructions,
         dl.name, dl.full_address, dl.contact_name, dl.phone,
         coalesce(dl.google_maps_url, case when dl.latitude is not null then
           'https://www.google.com/maps/search/?api=1&query=' || dl.latitude || ',' || dl.longitude end),
         dl.gate_instructions,
         d.full_name, a.responded_at, s.departed_pickup_at, s.completed_at, s.delivery_result,
         (select count(*) from public.documents doc
           where doc.entity_type = 'shipment' and doc.entity_id = s.id and doc.archived_at is null),
         s.expense_declaration,
         (select count(*) from public.shipment_expenses e where e.shipment_id = s.id and e.source = 'driver' and e.status in ('pending', 'approved')),
         (select coalesce(sum(e.amount), 0) from public.shipment_expenses e where e.shipment_id = s.id and e.source = 'driver' and e.status in ('pending', 'approved'))
  from private.driver_link_session(p_token) me
  join public.shipments s on private.driver_link_visible(me.vehicle_id, s)
  join public.drivers d on d.id = s.driver_id
  join public.locations pl on pl.id = s.pickup_location_id
  join public.locations dl on dl.id = s.delivery_location_id
  left join public.vehicles v on v.id = s.vehicle_id
  left join public.vehicle_types vt on vt.id = s.vehicle_type_id
  left join public.shipment_assignments a
    on a.shipment_id = s.id and a.driver_id = s.driver_id and a.response = 'accepted'
  where (s.status in ('assigned', 'accepted', 'in_transit')
     or (s.status in ('driver_completed', 'closed') and s.pickup_at > now() - interval '3 days'))
  order by (s.status = 'assigned') desc, (s.status = 'in_transit') desc, s.pickup_at
  limit 100;
$$;


-- Danh sách chi phí trên điện thoại: thêm loại, chuyến và cờ "sửa được"
create or replace function public.driver_link_finance(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  d public.drivers;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'expired', true);
  end if;
  d := private.driver_link_driver(v_me.vehicle_id);
  return jsonb_build_object(
    'ok', true,
    'driver_id', d.id,
    'driver_name', d.full_name,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'group', c.group_name, 'requires_image', c.requires_image,
                                          'requires_approval', c.requires_approval) order by c.sort_order, c.name)
      from public.expense_categories c where c.is_active and 'driver' = any (c.allowed_role_codes)), '[]'::jsonb),
    'advances', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'amount', a.amount_requested, 'approved', a.amount_approved,
                                          'reason', a.reason, 'status', a.status, 'created_at', a.created_at,
                                          'shipment_code', s.shipment_code, 'reject_reason', ar.reject_reason) order by a.created_at desc)
      from public.advance_requests a
      left join public.shipments s on s.id = a.shipment_id
      left join public.approval_requests ar on ar.id = a.approval_request_id
      where a.driver_id = d.id and a.created_at > now() - interval '62 days'), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'code', e.code, 'amount', e.amount, 'category', c.name, 'note', e.note,
                                          'category_id', e.category_id, 'shipment_id', e.shipment_id,
                                          'editable', private.driver_expense_editable(e, s),
                                          'status', e.status, 'incurred_at', e.incurred_at, 'shipment_code', s.shipment_code,
                                          'reject_reason', ar.reject_reason,
                                          'files', (select count(*) from public.documents doc where doc.entity_type = 'shipment_expense' and doc.entity_id = e.id))
                        order by e.incurred_at desc)
      from public.shipment_expenses e
      join public.expense_categories c on c.id = e.category_id
      join public.shipments s on s.id = e.shipment_id
      left join public.approval_requests ar on ar.id = e.approval_request_id
      where e.driver_id = d.id and e.source = 'driver' and e.incurred_at > now() - interval '62 days'), '[]'::jsonb),
    'month', jsonb_build_object(
      'advance_paid', (select coalesce(sum(t.amount), 0) from public.advance_transactions t
                        where t.driver_id = d.id and t.txn_type = 'disbursement' and t.occurred_at >= v_month_start),
      'expense_approved', (select coalesce(sum(e.amount), 0) from public.shipment_expenses e
                            where e.driver_id = d.id and e.paid_by = 'driver' and e.status = 'approved' and e.incurred_at >= v_month_start),
      'expense_pending', (select coalesce(sum(e.amount), 0) from public.shipment_expenses e
                           where e.driver_id = d.id and e.paid_by = 'driver' and e.status = 'pending' and e.incurred_at >= v_month_start))
  );
end;
$$;


revoke all on function public.driver_link_complete(text, uuid, uuid, text, text, boolean) from public;
revoke all on function public.driver_link_update_expense(text, uuid, uuid, numeric, text, uuid) from public;
revoke all on function public.driver_link_trips(text) from public;
grant execute on function public.driver_link_complete(text, uuid, uuid, text, text, boolean) to anon, authenticated;
grant execute on function public.driver_link_update_expense(text, uuid, uuid, numeric, text, uuid) to anon, authenticated;
grant execute on function public.driver_link_trips(text) to anon, authenticated;

commit;
