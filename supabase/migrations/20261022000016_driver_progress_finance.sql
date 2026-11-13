-- =============================================================================
-- KHÁNH HÀ TMS - 0016: Hoàn thiện Giai đoạn 5 và Giai đoạn 6
--   * Tài xế (qua link biển số): Bắt đầu chạy, Hoàn thành chuyến kèm ảnh giao hàng / phiếu ký nhận.
--   * Tải ảnh từ điện thoại không cần tài khoản: mỗi lần chụp xin một "vé tải lên" ngắn hạn,
--     Storage chỉ nhận tệp nằm trong thư mục tx/<vé>/ còn hạn (không dùng service role key).
--   * Ứng tiền và chi phí: tài xế gửi yêu cầu -> Giám đốc duyệt -> Kế toán chuyển tiền.
--     Chi phí tài xế tự trả được cộng lại khi đối soát lương cuối tháng (Giai đoạn 7).
--   * Có thể tắt duyệt cho từng loại chi phí (expense_categories.requires_approval).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Vé tải lên cho điện thoại tài xế
-- -----------------------------------------------------------------------------
create table private.driver_upload_tickets (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  shipment_id uuid references public.shipments (id) on delete cascade,
  purpose text not null check (purpose in ('delivery', 'expense')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  used_at timestamptz
);
create index driver_upload_tickets_vehicle_idx on private.driver_upload_tickets (vehicle_id, created_at desc);

-- Tên tệp hợp lệ: tx/<vé>/<loại>-<uuid>.<đuôi>
create or replace function private.driver_upload_name_ok(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_name ~ '^tx/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(photo|delivery_note|receipt|invoice)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|pdf)$', false);
$$;

-- Storage gọi hàm này khi điện thoại (vai trò anon) tải tệp lên: vé phải còn hạn, chưa dùng, tối đa 10 tệp/vé.
create or replace function private.driver_upload_ok(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ticket uuid;
  n int := 0;
begin
  if not private.driver_upload_name_ok(p_name) then
    return false;
  end if;
  v_ticket := split_part(p_name, '/', 2)::uuid;
  if not exists (select 1 from private.driver_upload_tickets t where t.id = v_ticket and t.used_at is null and t.expires_at > now()) then
    return false;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select count(*) from storage.objects where bucket_id = ''documents'' and name like $1'
      into n using 'tx/' || v_ticket::text || '/%';
  end if;
  return n < 10;
end;
$$;
revoke all on function private.driver_upload_ok(text) from public;
grant usage on schema private to anon;
grant execute on function private.driver_upload_ok(text) to anon, authenticated;

do $outer$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Bỏ qua chính sách Storage cho điện thoại tài xế: không có schema storage.';
    return;
  end if;
  execute 'drop policy if exists documents_driver_link_insert on storage.objects';
  execute $p$
    create policy documents_driver_link_insert on storage.objects for insert to anon, authenticated
    with check (bucket_id = 'documents' and private.driver_upload_ok(name))
  $p$;
end
$outer$;

-- Ghi các tệp đã tải lên theo vé thành chứng từ của bản ghi; trả về số tệp theo từng loại
create or replace function private.driver_attach_uploads(
  p_ticket uuid, p_vehicle_id uuid, p_entity_type text, p_entity_id uuid, p_allowed text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t private.driver_upload_tickets;
  o record;
  v_type text;
  v_mime text;
  v_counts jsonb := '{}'::jsonb;
begin
  if p_ticket is null then
    return v_counts;
  end if;
  select * into t from private.driver_upload_tickets where id = p_ticket and vehicle_id = p_vehicle_id for update;
  if t.id is null or t.used_at is not null then
    raise exception 'Ảnh đã gửi hết hạn. Vui lòng chụp lại.' using errcode = '22023';
  end if;
  if to_regclass('storage.objects') is not null then
    for o in execute 'select name, metadata from storage.objects where bucket_id = ''documents'' and name like $1 order by created_at'
      using 'tx/' || p_ticket::text || '/%'
    loop
      if not private.driver_upload_name_ok(o.name) then continue; end if;
      v_type := split_part(split_part(o.name, '/', 3), '-', 1);
      if not v_type = any (p_allowed) then continue; end if;
      v_mime := coalesce(o.metadata ->> 'mimetype', case when o.name like '%.pdf' then 'application/pdf' else 'image/jpeg' end);
      if v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf') then continue; end if;
      insert into public.documents (bucket, storage_path, file_name, mime_type, size_bytes, entity_type, entity_id, doc_type)
      values ('documents', o.name, split_part(o.name, '/', 3), v_mime,
              greatest(1, least(10485760, coalesce((o.metadata ->> 'size')::bigint, 1))), p_entity_type, p_entity_id, v_type)
      on conflict (bucket, storage_path) do nothing;
      v_counts := jsonb_set(v_counts, array[v_type], to_jsonb(coalesce((v_counts ->> v_type)::int, 0) + 1));
    end loop;
  end if;
  update private.driver_upload_tickets set used_at = now() where id = t.id;
  return v_counts;
end;
$$;
revoke all on function private.driver_attach_uploads(uuid, uuid, text, uuid, text[]) from public, anon, authenticated;

create or replace function public.driver_link_upload_ticket(p_token text, p_shipment_id uuid, p_purpose text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_s public.shipments;
  v_id uuid;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  if p_purpose not in ('delivery', 'expense') then
    return jsonb_build_object('ok', false, 'error', 'Loại ảnh không hợp lệ.');
  end if;
  if p_shipment_id is not null then
    select * into v_s from public.shipments where id = p_shipment_id;
    if v_s.id is null or not private.driver_link_visible(v_me.vehicle_id, v_s) then
      return jsonb_build_object('ok', false, 'error', 'Chuyến này không thuộc xe của bạn.');
    end if;
  end if;
  if (select count(*) from private.driver_upload_tickets
       where vehicle_id = v_me.vehicle_id and created_at > now() - interval '1 hour') >= 60 then
    return jsonb_build_object('ok', false, 'error', 'Gửi ảnh quá nhiều lần. Vui lòng thử lại sau ít phút.');
  end if;
  delete from private.driver_upload_tickets where expires_at < now() - interval '7 days';
  insert into private.driver_upload_tickets (vehicle_id, shipment_id, purpose)
  values (v_me.vehicle_id, p_shipment_id, p_purpose) returning id into v_id;
  return jsonb_build_object('ok', true, 'ticket', v_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Tài xế: Bắt đầu chạy, Hoàn thành chuyến
-- -----------------------------------------------------------------------------
create or replace function private.driver_link_note(p_shipment_id uuid, p_status text, p_note text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.shipment_status_history h set note = p_note
   where h.id = (select max(id) from public.shipment_status_history
                  where shipment_id = p_shipment_id and status_field = 'status' and to_status = p_status);
$$;
revoke all on function private.driver_link_note(uuid, text, text) from public, anon, authenticated;

create or replace function private.notify_dispatcher(p_shipment_id uuid, p_type text, p_title text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, type, title, entity_type, entity_id, link)
  select a.assigned_by, p_type, p_title, 'shipment', p_shipment_id, '/chuyen-xe/' || p_shipment_id
  from public.shipment_assignments a
  where a.shipment_id = p_shipment_id and a.response = 'accepted' and a.assigned_by is not null
  limit 1;
$$;
revoke all on function private.notify_dispatcher(uuid, text, text) from public, anon, authenticated;

create or replace function public.driver_link_start(p_token text, p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_s public.shipments;
  v_name text;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  select * into v_s from public.shipments where id = p_shipment_id for update;
  if v_s.id is null or not private.driver_link_visible(v_me.vehicle_id, v_s) then
    return jsonb_build_object('ok', false, 'error', 'Chuyến này không còn được phân công cho xe của bạn. Tải lại trang để xem.');
  end if;
  if v_s.status = 'in_transit' then
    return jsonb_build_object('ok', true);
  end if;
  if v_s.status <> 'accepted' then
    return jsonb_build_object('ok', false, 'error', 'Chỉ bắt đầu được chuyến đã nhận.');
  end if;
  update public.shipments
     set status = 'in_transit', departed_pickup_at = coalesce(departed_pickup_at, now())
   where id = v_s.id;
  select full_name into v_name from public.drivers where id = v_s.driver_id;
  perform private.driver_link_note(v_s.id, 'in_transit', v_name || ' bắt đầu chạy trên điện thoại');
  perform private.notify_dispatcher(v_s.id, 'shipment_started', 'Tài xế ' || v_name || ' đã bắt đầu chạy chuyến ' || v_s.shipment_code);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.driver_link_complete(
  p_token text, p_shipment_id uuid, p_ticket uuid, p_result text default 'full', p_note text default null
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
         document_status = case when document_status in ('missing', 'rejected') then 'submitted' else document_status end
   where id = v_s.id;
  select full_name into v_name from public.drivers where id = v_s.driver_id;
  perform private.driver_link_note(v_s.id, 'driver_completed', v_name || ' hoàn thành chuyến trên điện thoại (' || v_photos || ' ảnh)');
  perform private.notify_dispatcher(v_s.id, 'shipment_completed', 'Tài xế ' || v_name || ' đã hoàn thành chuyến ' || v_s.shipment_code);
  return jsonb_build_object('ok', true, 'photos', v_photos);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

-- Chuyến trả về cho điện thoại: thêm giờ bắt đầu, giờ hoàn thành, số ảnh đã gửi
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
  photo_count bigint
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
           where doc.entity_type = 'shipment' and doc.entity_id = s.id and doc.archived_at is null)
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

-- -----------------------------------------------------------------------------
-- 3. Phê duyệt: người gửi có thể là tài xế (không có tài khoản); cấp duyệt theo quy tắc
-- -----------------------------------------------------------------------------
alter table public.approval_requests alter column requested_by drop not null;
alter table public.approval_requests
  add column requested_driver_id uuid references public.drivers (id),
  add column levels integer[] not null default '{1}',
  add constraint approval_requests_requester_check check (requested_by is not null or requested_driver_id is not null);
alter table public.approval_steps alter column actor_id drop not null;
alter table public.approval_steps
  add column actor_label text,
  add constraint approval_steps_actor_check check (actor_id is not null or actor_label is not null);

-- Quy trình khách hàng chốt (22/10/2026): Ứng tiền và Chi phí do Giám đốc duyệt một cấp, Kế toán chuyển tiền.
update public.approval_rules set is_active = false
 where approval_type_id in (select id from public.approval_types where code in ('advance', 'expense'));
insert into public.approval_rules (approval_type_id, level, approver_role_id, min_amount, max_amount)
select t.id, 1, (select id from public.roles where code = 'director'), 0, null
from public.approval_types t where t.code in ('advance', 'expense');

-- Sửa trigger chặn sửa số tiền đã duyệt: tách điều kiện theo bảng (bản cũ tham chiếu cột không có ở bảng kia)
create or replace function private.guard_approved_amount()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'shipment_expenses' then
    if old.status = 'approved'
       and (new.amount, new.category_id, new.shipment_id) is distinct from (old.amount, old.category_id, old.shipment_id) then
      raise exception 'Chi phí đã duyệt: không được sửa trực tiếp số tiền/loại chi phí' using errcode = '42501';
    end if;
  elsif tg_table_name = 'advance_requests' then
    if old.status in ('approved', 'paid')
       and (new.amount_requested, new.amount_approved, new.driver_id) is distinct from (old.amount_requested, old.amount_approved, old.driver_id) then
      raise exception 'Yêu cầu ứng đã duyệt: không được sửa trực tiếp số tiền' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Ứng tiền / chi phí: trường bổ sung, mã chi phí, ai trả tiền
alter table public.advance_requests
  add column custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object');
alter table public.shipment_expenses
  add column code text unique,
  add column driver_id uuid references public.drivers (id),
  add column paid_by text not null default 'driver' check (paid_by in ('driver', 'company')),
  add column custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object');
create trigger trg_shipment_expenses_code before insert on public.shipment_expenses
for each row execute function private.fill_doc_code('CP');
create index shipment_expenses_driver_idx on public.shipment_expenses (driver_id, incurred_at desc);

create or replace function private.custom_field_table(p_module text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_module
    when 'vehicles' then 'vehicles'
    when 'drivers' then 'drivers'
    when 'customers' then 'customers'
    when 'suppliers' then 'suppliers'
    when 'locations' then 'locations'
    when 'shipments' then 'shipments'
    when 'transport_orders' then 'transport_orders'
    when 'vehicle_types' then 'vehicle_types'
    when 'routes' then 'routes'
    when 'price_lists' then 'transport_price_lists'
    when 'fuel_rules' then 'fuel_support_rules'
    when 'expense_categories' then 'expense_categories'
    when 'banks' then 'banks'
    when 'payment_methods' then 'payment_methods'
    when 'company_entities' then 'company_entities'
    when 'salary_rules' then 'salary_rules'
    when 'maintenance_records' then 'maintenance_records'
    when 'catalog_items' then 'catalog_items'
    when 'advances' then 'advance_requests'
    when 'expenses' then 'shipment_expenses'
  end;
$$;

-- Các cấp cần duyệt cho số tiền (theo quy tắc đang bật); không có quy tắc thì cấp 1 (chỉ Super Admin duyệt được)
create or replace function private.approval_levels(p_type_id uuid, p_amount numeric)
returns integer[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct r.level order by r.level), '{1}')
  from public.approval_rules r
  where r.approval_type_id = p_type_id and r.is_active
    and coalesce(p_amount, 0) >= r.min_amount and (r.max_amount is null or coalesce(p_amount, 0) <= r.max_amount);
$$;

-- Người dùng hiện tại có được duyệt cấp hiện tại của yêu cầu không (không tự duyệt khoản của mình)
create or replace function private.can_approve(p_request_id uuid)
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
revoke all on function private.can_approve(uuid) from public, anon;
grant execute on function private.can_approve(uuid) to authenticated;

-- Thông báo cho người duyệt cấp hiện tại
create or replace function private.notify_approvers(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.approval_requests;
  v_type text;
  n int;
begin
  select * into r from public.approval_requests where id = p_request_id;
  select name into v_type from public.approval_types where id = r.approval_type_id;
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
  select distinct p.id, 'approval_pending', v_type || ' chờ duyệt: ' || to_char(coalesce(r.amount, 0), 'FM999G999G999G990') || ' đ',
         r.content, 'approval_request', r.id, '/phe-duyet'
  from public.approval_rules ar
  join public.profiles p on p.status = 'active' and (
    p.id = ar.approver_user_id
    or exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role_id = ar.approver_role_id))
  where ar.approval_type_id = r.approval_type_id and ar.is_active and ar.level = r.current_level
    and coalesce(r.amount, 0) >= ar.min_amount and (ar.max_amount is null or coalesce(r.amount, 0) <= ar.max_amount)
    and p.id is distinct from r.requested_by;
  get diagnostics n = row_count;
  if n = 0 then
    perform private.notify_permission_holders('approvals.approve', 'approval_pending', v_type || ' chờ duyệt', r.content, 'approval_request', r.id, '/phe-duyet');
  end if;
end;
$$;
revoke all on function private.notify_approvers(uuid) from public, anon, authenticated;

-- Tạo yêu cầu phê duyệt (gọi từ các hàm nghiệp vụ)
create or replace function private.submit_approval(
  p_type_code text, p_entity_type text, p_entity_id uuid, p_shipment_id uuid, p_amount numeric, p_content text,
  p_requested_by uuid, p_driver_id uuid, p_actor_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.approval_types;
  v_levels int[];
  v_id uuid;
begin
  select * into t from public.approval_types where code = p_type_code and is_active;
  if t.id is null then
    raise exception 'Chưa cấu hình loại phê duyệt %', p_type_code using errcode = 'P0001';
  end if;
  v_levels := private.approval_levels(t.id, p_amount);
  insert into public.approval_requests (approval_type_id, entity_type, entity_id, shipment_id, requested_by, requested_driver_id,
    amount, content, status, levels, current_level, required_levels, due_at)
  values (t.id, p_entity_type, p_entity_id, p_shipment_id, p_requested_by, p_driver_id,
    p_amount, p_content, 'pending', v_levels, v_levels[1], cardinality(v_levels),
    case when t.sla_hours is not null then now() + make_interval(hours => t.sla_hours) end)
  returning id into v_id;
  insert into public.approval_steps (request_id, level, action, actor_id, actor_label)
  values (v_id, 0, 'submit', p_requested_by, case when p_requested_by is null then p_actor_label end);
  perform private.notify_approvers(v_id);
  return v_id;
end;
$$;
revoke all on function private.submit_approval(text, text, uuid, uuid, numeric, text, uuid, uuid, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Ứng tiền và chi phí do nhân viên tạo (Kế toán / Điều phối)
-- -----------------------------------------------------------------------------
create or replace function public.create_advance_request(
  p_driver_id uuid, p_amount numeric, p_reason text, p_shipment_id uuid default null, p_note text default null,
  p_custom jsonb default '{}'::jsonb, p_client_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text;
  v_driver text;
begin
  if not private.has_perm('advances.create') then
    raise exception 'Bạn không có quyền tạo yêu cầu ứng tiền' using errcode = '42501';
  end if;
  if p_client_request_id is not null then
    select id into v_id from public.advance_requests where client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  select full_name into v_driver from public.drivers where id = p_driver_id and archived_at is null;
  if v_driver is null then
    raise exception 'Chọn tài xế' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Số tiền ứng phải lớn hơn 0' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Nhập lý do ứng tiền' using errcode = '22023';
  end if;
  insert into public.advance_requests (driver_id, shipment_id, amount_requested, reason, note, status, client_request_id, requested_by, custom_fields)
  values (p_driver_id, p_shipment_id, p_amount, trim(p_reason), nullif(trim(coalesce(p_note, '')), ''), 'pending', p_client_request_id, auth.uid(),
          coalesce(p_custom, '{}'::jsonb))
  returning id, code into v_id, v_code;
  update public.advance_requests set approval_request_id = private.submit_approval(
    'advance', 'advance_request', v_id, p_shipment_id, p_amount, 'Ứng tiền ' || v_code || ' cho ' || v_driver || ': ' || trim(p_reason),
    auth.uid(), p_driver_id, null)
  where id = v_id;
  return v_id;
end;
$$;

-- Trạng thái ban đầu của chi phí theo loại chi phí: cần duyệt -> chờ duyệt, không cần -> đã duyệt
create or replace function private.insert_expense(
  p_shipment public.shipments, p_category public.expense_categories, p_amount numeric, p_incurred_at timestamptz, p_note text,
  p_source text, p_paid_by text, p_driver_id uuid, p_entered_by uuid, p_custom jsonb, p_client_request_id uuid, p_actor_label text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text;
  v_driver text;
begin
  insert into public.shipment_expenses (shipment_id, category_id, amount, incurred_at, note, source, paid_by, driver_id, status,
    client_request_id, entered_by, custom_fields)
  values (p_shipment.id, p_category.id, p_amount, coalesce(p_incurred_at, now()), nullif(trim(coalesce(p_note, '')), ''), p_source, p_paid_by,
    p_driver_id, case when p_category.requires_approval then 'pending' else 'approved' end,
    p_client_request_id, p_entered_by, coalesce(p_custom, '{}'::jsonb))
  returning id, code into v_id, v_code;
  if p_category.requires_approval then
    select full_name into v_driver from public.drivers where id = p_driver_id;
    update public.shipment_expenses set approval_request_id = private.submit_approval(
      'expense', 'shipment_expense', v_id, p_shipment.id, p_amount,
      p_category.name || ' ' || v_code || ' chuyến ' || p_shipment.shipment_code || coalesce(' (' || v_driver || ')', ''),
      p_entered_by, p_driver_id, p_actor_label)
    where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function private.insert_expense(public.shipments, public.expense_categories, numeric, timestamptz, text, text, text, uuid, uuid, jsonb, uuid, text)
  from public, anon, authenticated;

create or replace function public.add_shipment_expense(
  p_shipment_id uuid, p_category_id uuid, p_amount numeric, p_incurred_at timestamptz default null, p_note text default null,
  p_paid_by text default 'company', p_driver_id uuid default null, p_custom jsonb default '{}'::jsonb, p_client_request_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  c public.expense_categories;
  v_id uuid;
begin
  if not private.has_perm('expenses.create') then
    raise exception 'Bạn không có quyền nhập chi phí' using errcode = '42501';
  end if;
  if p_client_request_id is not null then
    select id into v_id from public.shipment_expenses where client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  select * into s from public.shipments where id = p_shipment_id;
  if s.id is null then
    raise exception 'Chọn chuyến xe' using errcode = '22023';
  end if;
  if s.status = 'cancelled' then
    raise exception 'Chuyến đã hủy, không nhập chi phí' using errcode = '22023';
  end if;
  select * into c from public.expense_categories where id = p_category_id and is_active;
  if c.id is null then
    raise exception 'Chọn loại chi phí' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Số tiền phải lớn hơn 0' using errcode = '22023';
  end if;
  if coalesce(p_paid_by, '') not in ('driver', 'company') then
    raise exception 'Chọn người trả tiền' using errcode = '22023';
  end if;
  return private.insert_expense(s, c, p_amount, p_incurred_at, p_note, 'admin', p_paid_by,
    coalesce(p_driver_id, s.driver_id), auth.uid(), p_custom, p_client_request_id, null);
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Duyệt / từ chối (Giám đốc) và chuyển tiền ứng (Kế toán)
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
    end if;
    if r.requested_by is not null then
      insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
      values (r.requested_by, 'approval_rejected', 'Bị từ chối: ' || r.content, trim(p_comment), 'approval_request', r.id, '/phe-duyet');
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
  end if;
  if r.requested_by is not null then
    insert into public.notifications (recipient_id, type, title, entity_type, entity_id, link)
    values (r.requested_by, 'approval_approved', 'Đã duyệt: ' || r.content, 'approval_request', r.id, '/phe-duyet');
  end if;
  return jsonb_build_object('ok', true, 'status', 'approved');
end;
$$;

create or replace function public.pay_advance(
  p_advance_id uuid, p_payment_method_id uuid default null, p_company_bank_account_id uuid default null,
  p_reference_no text default null, p_paid_at timestamptz default null, p_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.advance_requests;
  p public.payments;
  v_amount numeric;
begin
  if not private.has_perm('advances.pay') then
    raise exception 'Bạn không có quyền chuyển tiền ứng' using errcode = '42501';
  end if;
  select * into a from public.advance_requests where id = p_advance_id for update;
  if a.id is null then
    raise exception 'Không tìm thấy yêu cầu ứng tiền' using errcode = 'P0001';
  end if;
  if a.status = 'paid' then
    raise exception 'Yêu cầu này đã chuyển tiền' using errcode = '22023';
  end if;
  if a.status <> 'approved' then
    raise exception 'Chỉ chuyển tiền cho yêu cầu đã được duyệt' using errcode = '22023';
  end if;
  v_amount := coalesce(a.amount_approved, a.amount_requested);
  insert into public.payments (direction, purpose, payment_method_id, company_bank_account_id, amount, paid_at, driver_id, shipment_id,
    approval_request_id, advance_request_id, reference_no, note)
  values ('out', 'advance', p_payment_method_id, p_company_bank_account_id, v_amount, coalesce(p_paid_at, now()), a.driver_id, a.shipment_id,
    a.approval_request_id, a.id, nullif(trim(coalesce(p_reference_no, '')), ''), nullif(trim(coalesce(p_note, '')), ''))
  returning * into p;
  insert into public.advance_transactions (driver_id, shipment_id, advance_request_id, payment_id, txn_type, amount, occurred_at, note)
  values (a.driver_id, a.shipment_id, a.id, p.id, 'disbursement', v_amount, p.paid_at, 'Chuyển tiền ứng ' || a.code);
  update public.advance_requests set status = 'paid', payment_method_id = p_payment_method_id where id = a.id;
  if a.approval_request_id is not null then
    update public.approval_requests set status = 'paid' where id = a.approval_request_id;
    insert into public.approval_steps (request_id, level, action, actor_id, comment)
    values (a.approval_request_id, 99, 'mark_paid', auth.uid(), 'Chuyển tiền ' || p.code);
  end if;
  if a.requested_by is not null then
    insert into public.notifications (recipient_id, type, title, entity_type, entity_id, link)
    values (a.requested_by, 'advance_paid', 'Đã chuyển tiền ứng ' || a.code || ': ' || to_char(v_amount, 'FM999G999G999G990') || ' đ',
            'advance_request', a.id, '/chi-phi?tab=advances');
  end if;
  return p.code;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Tài xế (qua link): xin ứng tiền, nhập chi phí, xem và hủy yêu cầu
-- -----------------------------------------------------------------------------
create or replace function private.driver_link_driver(p_vehicle_id uuid)
returns public.drivers
language sql
stable
security definer
set search_path = ''
as $$
  select d.* from public.vehicles v join public.drivers d on d.id = v.assigned_driver_id
  where v.id = p_vehicle_id and d.archived_at is null;
$$;
revoke all on function private.driver_link_driver(uuid) from public, anon, authenticated;

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

create or replace function public.driver_link_request_advance(
  p_token text, p_amount numeric, p_reason text, p_shipment_id uuid default null, p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  d public.drivers;
  v_s public.shipments;
  v_id uuid;
  v_code text;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  if p_client_request_id is not null and exists (select 1 from public.advance_requests where client_request_id = p_client_request_id) then
    return jsonb_build_object('ok', true);
  end if;
  if p_shipment_id is not null then
    select * into v_s from public.shipments where id = p_shipment_id;
    if v_s.id is null or not private.driver_link_visible(v_me.vehicle_id, v_s) then
      return jsonb_build_object('ok', false, 'error', 'Chuyến này không thuộc xe của bạn.');
    end if;
    select * into d from public.drivers where id = v_s.driver_id;
  else
    d := private.driver_link_driver(v_me.vehicle_id);
  end if;
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'Xe chưa được gán tài xế. Vui lòng gọi điều phối.');
  end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > 1000000000 then
    return jsonb_build_object('ok', false, 'error', 'Nhập số tiền cần ứng.');
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Nhập lý do ứng tiền.');
  end if;
  insert into public.advance_requests (driver_id, shipment_id, amount_requested, reason, status, client_request_id)
  values (d.id, p_shipment_id, round(p_amount), left(trim(p_reason), 500), 'pending', p_client_request_id)
  returning id, code into v_id, v_code;
  update public.advance_requests set approval_request_id = private.submit_approval(
    'advance', 'advance_request', v_id, p_shipment_id, round(p_amount),
    'Ứng tiền ' || v_code || ' – ' || d.full_name || ': ' || left(trim(p_reason), 200), null, d.id, d.full_name || ' (điện thoại)')
  where id = v_id;
  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;

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
  if v_s.status not in ('accepted', 'in_transit', 'driver_completed', 'closed') then
    return jsonb_build_object('ok', false, 'error', 'Chỉ nhập chi phí cho chuyến đã nhận.');
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
  return jsonb_build_object('ok', true, 'code', (select code from public.shipment_expenses where id = v_id),
                            'needs_approval', c.requires_approval);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

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
  elsif p_kind = 'expense' then
    update public.shipment_expenses set status = 'cancelled'
     where id = p_id and driver_id = d.id and source = 'driver' and status = 'pending' returning approval_request_id into v_req;
    v_hit := found;
  end if;
  if not v_hit then
    return jsonb_build_object('ok', false, 'error', 'Chỉ hủy được yêu cầu đang chờ duyệt.');
  end if;
  if v_req is not null then
    update public.approval_requests set status = 'cancelled', decided_at = now() where id = v_req and status = 'pending';
    insert into public.approval_steps (request_id, level, action, actor_label) values (v_req, 0, 'cancel', d.full_name || ' (điện thoại)');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Danh sách cho màn hình quản lý (theo RLS của người xem)
-- -----------------------------------------------------------------------------
create or replace function private.requester_name(p_profile uuid, p_driver uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)) from public.profiles p where p.id = p_profile),
    (select d.full_name || ' (tài xế)' from public.drivers d where d.id = p_driver));
$$;
revoke all on function private.requester_name(uuid, uuid) from public, anon;
grant execute on function private.requester_name(uuid, uuid) to authenticated;

create or replace view public.approval_list with (security_invoker = true) as
select r.id, r.code, r.approval_type_id, t.name as type_name, t.code as type_code,
       r.entity_type, r.entity_id, r.shipment_id, s.shipment_code,
       r.requested_driver_id as driver_id, d.full_name as driver_name,
       private.requester_name(r.requested_by, r.requested_driver_id) as requester_name,
       r.requested_at, r.amount, r.content, r.status, r.current_level, r.required_levels, r.reject_reason,
       r.decided_at, r.due_at, (r.status = 'pending' and r.due_at < now()) as overdue,
       private.can_approve(r.id) as can_approve,
       (select string_agg(coalesce(ro.name, private.requester_name(ar.approver_user_id, null)), ', ')
          from public.approval_rules ar left join public.roles ro on ro.id = ar.approver_role_id
         where ar.approval_type_id = r.approval_type_id and ar.is_active and ar.level = r.current_level
           and coalesce(r.amount, 0) >= ar.min_amount and (ar.max_amount is null or coalesce(r.amount, 0) <= ar.max_amount)) as approver_label,
       coalesce(a.amount_approved, r.amount) as amount_approved,
       (select count(*) from public.documents doc where doc.archived_at is null
          and doc.entity_type = r.entity_type and doc.entity_id = r.entity_id) as file_count
from public.approval_requests r
join public.approval_types t on t.id = r.approval_type_id
left join public.shipments s on s.id = r.shipment_id
left join public.drivers d on d.id = r.requested_driver_id
left join public.advance_requests a on r.entity_type = 'advance_request' and a.id = r.entity_id;

create or replace view public.advance_list with (security_invoker = true) as
select a.id, a.code, a.driver_id, d.full_name as driver_name, d.code as driver_code, a.shipment_id, s.shipment_code,
       a.amount_requested, a.amount_approved, coalesce(a.amount_approved, a.amount_requested) as amount_to_pay,
       a.reason, a.note, a.status, a.created_at, a.approval_request_id,
       private.requester_name(a.requested_by, case when a.requested_by is null then a.driver_id end) as requester_name,
       ar.reject_reason, ar.decided_at, p.code as payment_code, p.paid_at, p.reference_no,
       (a.status = 'approved' and private.has_perm('advances.pay')) as can_pay,
       a.custom_fields
from public.advance_requests a
join public.drivers d on d.id = a.driver_id
left join public.shipments s on s.id = a.shipment_id
left join public.approval_requests ar on ar.id = a.approval_request_id
left join public.payments p on p.advance_request_id = a.id and p.status = 'posted' and p.purpose = 'advance';

create or replace view public.expense_list with (security_invoker = true) as
select e.id, e.code, e.shipment_id, s.shipment_code, e.category_id, c.name as category_name, c.report_bucket,
       e.amount, e.incurred_at, e.note, e.source, e.paid_by, e.driver_id, d.full_name as driver_name,
       v.plate_number, e.status, e.created_at, e.approval_request_id, ar.reject_reason,
       private.requester_name(e.entered_by, case when e.entered_by is null then e.driver_id end) as entered_by_name,
       (select count(*) from public.documents doc where doc.entity_type = 'shipment_expense' and doc.entity_id = e.id and doc.archived_at is null) as file_count,
       e.custom_fields
from public.shipment_expenses e
join public.shipments s on s.id = e.shipment_id
join public.expense_categories c on c.id = e.category_id
left join public.drivers d on d.id = e.driver_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.approval_requests ar on ar.id = e.approval_request_id;

-- -----------------------------------------------------------------------------
-- 8. Quyền gọi hàm
-- -----------------------------------------------------------------------------
revoke all on function public.driver_link_upload_ticket(text, uuid, text) from public;
revoke all on function public.driver_link_start(text, uuid) from public;
revoke all on function public.driver_link_complete(text, uuid, uuid, text, text) from public;
revoke all on function public.driver_link_trips(text) from public;
revoke all on function public.driver_link_finance(text) from public;
revoke all on function public.driver_link_request_advance(text, numeric, text, uuid, uuid) from public;
revoke all on function public.driver_link_add_expense(text, uuid, uuid, numeric, text, uuid, uuid) from public;
revoke all on function public.driver_link_cancel(text, text, uuid) from public;
grant execute on function public.driver_link_upload_ticket(text, uuid, text) to anon, authenticated;
grant execute on function public.driver_link_start(text, uuid) to anon, authenticated;
grant execute on function public.driver_link_complete(text, uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.driver_link_trips(text) to anon, authenticated;
grant execute on function public.driver_link_finance(text) to anon, authenticated;
grant execute on function public.driver_link_request_advance(text, numeric, text, uuid, uuid) to anon, authenticated;
grant execute on function public.driver_link_add_expense(text, uuid, uuid, numeric, text, uuid, uuid) to anon, authenticated;
grant execute on function public.driver_link_cancel(text, text, uuid) to anon, authenticated;

revoke all on function public.create_advance_request(uuid, numeric, text, uuid, text, jsonb, uuid) from public, anon;
revoke all on function public.add_shipment_expense(uuid, uuid, numeric, timestamptz, text, text, uuid, jsonb, uuid) from public, anon;
revoke all on function public.approval_decide(uuid, text, text, numeric) from public, anon;
revoke all on function public.pay_advance(uuid, uuid, uuid, text, timestamptz, text) from public, anon;
grant execute on function public.create_advance_request(uuid, numeric, text, uuid, text, jsonb, uuid) to authenticated;
grant execute on function public.add_shipment_expense(uuid, uuid, numeric, timestamptz, text, text, uuid, jsonb, uuid) to authenticated;
grant execute on function public.approval_decide(uuid, text, text, numeric) to authenticated;
grant execute on function public.pay_advance(uuid, uuid, uuid, text, timestamptz, text) to authenticated;

revoke all on public.approval_list, public.advance_list, public.expense_list from anon;
grant select on public.approval_list, public.advance_list, public.expense_list to authenticated;
