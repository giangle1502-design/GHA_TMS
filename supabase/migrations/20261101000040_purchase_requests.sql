-- =============================================================================
-- 0040: Phiếu đề nghị chi / mua sắm (người dùng 01/11/2026)
--   Ví dụ: Đề nghị mua văn phòng phẩm, Đề nghị sửa văn phòng, Đề nghị mua sắm máy móc thiết bị...
--   Quy trình: nhân viên lập phiếu -> Giám đốc duyệt (theo Cấu hình cấp duyệt, không tự duyệt phiếu của mình,
--   có thể duyệt ít hơn số đề nghị) -> Kế toán chi tiền (chi một lần hoặc nhiều lần, tối đa số đã duyệt)
--   -> báo cáo theo tháng, theo loại đề nghị.
-- - purchase_request_types: Loại đề nghị, người dùng tự thêm (thêm nhanh ngay ở ô chọn).
-- - purchase_requests: phiếu, có danh sách hàng hóa/hạng mục (tên, SL, ĐVT, đơn giá) tự cộng thành số tiền.
-- - Quyền mới purchase_requests.{view, create, delete, pay, export}.
-- - approval_decide: thêm nhánh purchase_request, và móc mở rộng private.on_approval_<entity_type>.
-- - Phiếu chi (payments.purpose = 'purchase_request'), hủy phiếu chi ghi nhầm, xóa dữ liệu thử gồm bảng mới.
-- Không xóa dữ liệu cũ.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Quyền
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, action, name, sort_order) values
  ('purchase_requests.view', 'purchase_requests', 'view', 'Xem - Đề nghị chi, mua sắm', 2501),
  ('purchase_requests.create', 'purchase_requests', 'create', 'Tạo - Đề nghị chi, mua sắm', 2502),
  ('purchase_requests.delete', 'purchase_requests', 'delete', 'Xóa/Hủy - Đề nghị chi, mua sắm', 2504),
  ('purchase_requests.pay', 'purchase_requests', 'pay', 'Thanh toán - Đề nghị chi, mua sắm', 2506),
  ('purchase_requests.export', 'purchase_requests', 'export', 'Xuất dữ liệu - Đề nghị chi, mua sắm', 2507)
on conflict (code) do nothing;

-- Mặc định: Admin toàn quyền; Giám đốc xem tất cả, lập phiếu, xuất; Kế toán xem, lập, hủy, chi tiền, xuất;
-- Điều phối, Quản lý vận hành lập phiếu (thấy phiếu của mình).
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.module = 'purchase_requests' and (
  r.code = 'admin'
  or (r.code = 'director' and p.action in ('view', 'create', 'export'))
  or (r.code = 'accountant' and p.action in ('view', 'create', 'delete', 'pay', 'export'))
  or (r.code in ('dispatcher', 'ops_manager') and p.action = 'create'))
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Loại đề nghị
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_request_types (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  name text not null check (length(trim(name)) between 1 and 150),
  group_name text check (group_name is null or length(group_name) <= 100),
  description text check (description is null or length(description) <= 500),
  requires_document boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.purchase_request_types is 'Loại đề nghị chi / mua sắm: văn phòng phẩm, sửa văn phòng, máy móc thiết bị...';
select private.attach_standard_triggers('public.purchase_request_types');
create trigger trg_purchase_request_types_code before insert on public.purchase_request_types
for each row execute function private.fill_master_code('LDN');
create trigger trg_purchase_request_types_audit after insert or update or delete on public.purchase_request_types
for each row execute function private.audit_row_change('id');
alter table public.purchase_request_types enable row level security;
create policy purchase_request_types_select on public.purchase_request_types for select to authenticated
  using ((select private.is_active_user()));
-- Người lập phiếu được thêm nhanh loại mới ngay ở ô chọn
create policy purchase_request_types_insert on public.purchase_request_types for insert to authenticated
  with check ((select private.has_perm('catalogs.create')) or (select private.has_perm('purchase_requests.create')));
create policy purchase_request_types_update on public.purchase_request_types for update to authenticated
  using ((select private.has_perm('catalogs.update'))) with check ((select private.has_perm('catalogs.update')));
create policy purchase_request_types_delete on public.purchase_request_types for delete to authenticated
  using ((select private.has_perm('catalogs.delete')));
revoke all on public.purchase_request_types from anon;
grant select, insert, update, delete on public.purchase_request_types to authenticated;

insert into public.purchase_request_types (code, name, group_name, description, sort_order)
select v.code, v.name, v.grp, v.descr, v.ord
from (values
  ('VPP', 'Mua văn phòng phẩm', 'Văn phòng', 'Giấy, mực in, bút, sổ, file hồ sơ...', 10),
  ('SUAVP', 'Sửa chữa văn phòng', 'Văn phòng', 'Sửa điện nước, cửa, điều hòa, sơn sửa...', 20),
  ('MMTB', 'Mua sắm máy móc, thiết bị', 'Tài sản', 'Máy tính, máy in, camera, thiết bị kho bãi...', 30),
  ('CTP', 'Công tác phí, tiếp khách', 'Chi phí chung', 'Đi công tác, tiếp khách, hội họp', 40),
  ('KHAC', 'Đề nghị chi khác', 'Khác', 'Các khoản chi khác cần Giám đốc duyệt', 90)
) as v(code, name, grp, descr, ord)
where not exists (select 1 from public.purchase_request_types t where t.code = v.code or lower(t.name) = lower(v.name));

-- -----------------------------------------------------------------------------
-- 3. Phiếu đề nghị
-- -----------------------------------------------------------------------------
create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  type_id uuid not null references public.purchase_request_types (id),
  title text not null check (length(trim(title)) between 1 and 300),
  -- [{ "name": "Giấy A4", "qty": 10, "unit": "ram", "price": 75000 }]
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  amount_requested numeric(18, 2) not null check (amount_requested > 0),
  amount_approved numeric(18, 2) check (amount_approved is null or amount_approved >= 0),
  paid_amount numeric(18, 2) not null default 0 check (paid_amount >= 0),
  needed_by date,
  supplier_id uuid references public.suppliers (id),
  payee text check (payee is null or length(payee) <= 200),
  note text check (note is null or length(note) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'partial', 'paid', 'rejected', 'cancelled')),
  approval_request_id uuid unique references public.approval_requests (id),
  cancel_reason text,
  completed_note text,
  requested_by uuid not null references public.profiles (id),
  client_request_id uuid unique,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (amount_approved is null or paid_amount <= amount_approved)
);
comment on table public.purchase_requests is 'Phiếu đề nghị chi / mua sắm: nhân viên lập, Giám đốc duyệt, Kế toán chi tiền';
create index if not exists purchase_requests_status_idx on public.purchase_requests (status, created_at desc);
create index if not exists purchase_requests_requester_idx on public.purchase_requests (requested_by, created_at desc);
create index if not exists purchase_requests_type_idx on public.purchase_requests (type_id);
select private.attach_standard_triggers('public.purchase_requests');
create trigger trg_purchase_requests_code before insert on public.purchase_requests
for each row execute function private.fill_doc_code('DN');
create trigger trg_purchase_requests_audit after insert or update or delete on public.purchase_requests
for each row execute function private.audit_row_change('id');
alter table public.purchase_requests enable row level security;
-- Ai cũng thấy phiếu của mình; xem tất cả cần purchase_requests.view (Giám đốc, Kế toán) hoặc quyền chi tiền
create policy purchase_requests_select on public.purchase_requests for select to authenticated
  using (requested_by = (select auth.uid())
         or (select private.has_perm('purchase_requests.view'))
         or (select private.has_perm('purchase_requests.pay')));
-- Ghi chỉ qua hàm nghiệp vụ bên dưới
revoke all on public.purchase_requests from anon, authenticated;
grant select on public.purchase_requests to authenticated;

-- Chứng từ (báo giá, hóa đơn) gắn vào phiếu
alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check check (entity_type in (
  'shipment', 'shipment_expense', 'advance_request', 'payment', 'vehicle', 'driver', 'driver_payroll',
  'maintenance_record', 'approval_request', 'receivable', 'payable', 'transport_order', 'location', 'customer',
  'purchase_request'));

-- Phiếu chi cho phiếu đề nghị
alter table public.payments drop constraint if exists payments_purpose_check;
alter table public.payments add constraint payments_purpose_check check (purpose in (
  'advance', 'advance_refund', 'expense_reimbursement', 'driver_settlement', 'receivable', 'payable', 'other', 'purchase_request'));
alter table public.payments add column if not exists purchase_request_id uuid references public.purchase_requests (id);
create index if not exists payments_purchase_request_idx on public.payments (purchase_request_id) where purchase_request_id is not null;

-- Loại phê duyệt: Giám đốc duyệt một cấp (đổi được ở Phê duyệt → Cấu hình cấp duyệt)
insert into public.approval_types (code, name, requires_document, sla_hours, sort_order)
select 'purchase_request', 'Đề nghị chi, mua sắm', false, 48, 5
where not exists (select 1 from public.approval_types where code = 'purchase_request');
insert into public.approval_rules (approval_type_id, level, approver_role_id, min_amount, max_amount)
select t.id, 1, (select id from public.roles where code = 'director'), 0, null
from public.approval_types t
where t.code = 'purchase_request'
  and not exists (select 1 from public.approval_rules ar where ar.approval_type_id = t.id);

-- Trường bổ sung (thêm 'leaves' cho đơn xin nghỉ của 0041)
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
    when 'payrolls' then 'driver_payrolls'
    when 'receivables' then 'receivables'
    when 'payables' then 'payables'
    when 'shipment_items' then 'shipment_items'
    when 'fee_types' then 'fee_types'
    when 'fee_groups' then 'fee_groups'
    when 'declaration_types' then 'declaration_types'
    when 'purchase_requests' then 'purchase_requests'
    when 'purchase_request_types' then 'purchase_request_types'
    when 'leaves' then 'leave_requests'
  end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Lập phiếu, hủy phiếu
-- -----------------------------------------------------------------------------
-- Chuẩn hóa danh sách hạng mục; trả về [items, tổng tiền]
create or replace function private.purchase_items_normalize(p_items jsonb, out items jsonb, out total numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  it jsonb;
  v_name text;
  v_qty numeric;
  v_price numeric;
begin
  items := '[]'::jsonb;
  total := 0;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return;
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'Tối đa 100 dòng hàng hóa / hạng mục' using errcode = '22023';
  end if;
  for it in select value from jsonb_array_elements(p_items) loop
    v_name := trim(coalesce(it ->> 'name', ''));
    continue when v_name = '' and coalesce((it ->> 'price')::numeric, 0) = 0;
    if v_name = '' then
      raise exception 'Nhập tên hàng hóa / hạng mục cho từng dòng' using errcode = '22023';
    end if;
    v_qty := coalesce(nullif(it ->> 'qty', '')::numeric, 1);
    v_price := coalesce(nullif(it ->> 'price', '')::numeric, 0);
    if v_qty <= 0 or v_price < 0 then
      raise exception 'Dòng "%": số lượng phải lớn hơn 0, đơn giá không âm', v_name using errcode = '22023';
    end if;
    items := items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'name', left(v_name, 200), 'qty', v_qty, 'unit', nullif(left(trim(coalesce(it ->> 'unit', '')), 30), ''),
      'price', v_price, 'amount', round(v_qty * v_price, 0))));
    total := total + round(v_qty * v_price, 0);
  end loop;
end;
$$;

create or replace function public.create_purchase_request(
  p_type_id uuid, p_title text, p_amount numeric default null, p_items jsonb default '[]'::jsonb,
  p_needed_by date default null, p_supplier_id uuid default null, p_payee text default null, p_note text default null,
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
  v_type text;
  v_items jsonb;
  v_total numeric;
  v_amount numeric;
begin
  if not private.has_perm('purchase_requests.create') then
    raise exception 'Bạn không có quyền lập phiếu đề nghị' using errcode = '42501';
  end if;
  if p_client_request_id is not null then
    select id into v_id from public.purchase_requests where client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  select name into v_type from public.purchase_request_types where id = p_type_id and is_active;
  if v_type is null then
    raise exception 'Chọn loại đề nghị' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception 'Nhập nội dung đề nghị' using errcode = '22023';
  end if;
  select n.items, n.total into v_items, v_total from private.purchase_items_normalize(p_items) n;
  v_amount := case when jsonb_array_length(v_items) > 0 then v_total else p_amount end;
  if coalesce(v_amount, 0) <= 0 then
    raise exception 'Số tiền đề nghị phải lớn hơn 0' using errcode = '22023';
  end if;
  if p_supplier_id is not null and not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'Nhà cung cấp không hợp lệ' using errcode = '22023';
  end if;
  insert into public.purchase_requests (type_id, title, items, amount_requested, needed_by, supplier_id, payee, note,
    status, requested_by, client_request_id, custom_fields)
  values (p_type_id, left(trim(p_title), 300), v_items, v_amount, p_needed_by, p_supplier_id,
    nullif(left(trim(coalesce(p_payee, '')), 200), ''), nullif(left(trim(coalesce(p_note, '')), 1000), ''),
    'pending', auth.uid(), p_client_request_id, coalesce(p_custom, '{}'::jsonb))
  returning id, code into v_id, v_code;
  update public.purchase_requests set approval_request_id = private.submit_approval(
    'purchase_request', 'purchase_request', v_id, null, v_amount, v_type || ' ' || v_code || ': ' || left(trim(p_title), 200),
    auth.uid(), null, null)
  where id = v_id;
  return v_id;
end;
$$;

-- Người lập hủy phiếu đang chờ duyệt; người có quyền hủy (Kế toán) hủy phiếu chưa chi đồng nào
create or replace function public.cancel_purchase_request(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.purchase_requests;
begin
  select * into pr from public.purchase_requests where id = p_id for update;
  if pr.id is null then
    raise exception 'Không tìm thấy phiếu đề nghị' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Nhập lý do hủy' using errcode = '22023';
  end if;
  if not ((pr.requested_by = auth.uid() and pr.status = 'pending')
          or (private.has_perm('purchase_requests.delete') and pr.status in ('pending', 'approved') and pr.paid_amount = 0)) then
    raise exception 'Chỉ hủy được phiếu chờ duyệt của bạn, hoặc phiếu chưa chi tiền (cần quyền hủy)' using errcode = '42501';
  end if;
  update public.purchase_requests set status = 'cancelled', cancel_reason = left(trim(p_reason), 500) where id = pr.id;
  if pr.approval_request_id is not null then
    update public.approval_requests set status = 'cancelled' where id = pr.approval_request_id and status in ('pending', 'approved');
    insert into public.approval_steps (request_id, level, action, actor_id, comment)
    values (pr.approval_request_id, 0, 'cancel', auth.uid(), left(trim(p_reason), 500));
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Kế toán chi tiền (một hoặc nhiều lần), hoàn tất phiếu chi chưa hết
-- -----------------------------------------------------------------------------
create or replace function public.pay_purchase_request(
  p_id uuid, p_amount numeric default null, p_payment_method_id uuid default null, p_company_bank_account_id uuid default null,
  p_reference_no text default null, p_paid_at timestamptz default null, p_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.purchase_requests;
  p public.payments;
  v_left numeric;
  v_amount numeric;
  v_paid numeric;
begin
  if not private.has_perm('purchase_requests.pay') then
    raise exception 'Bạn không có quyền chi tiền phiếu đề nghị' using errcode = '42501';
  end if;
  select * into pr from public.purchase_requests where id = p_id for update;
  if pr.id is null then
    raise exception 'Không tìm thấy phiếu đề nghị' using errcode = 'P0001';
  end if;
  if pr.status not in ('approved', 'partial') then
    raise exception 'Chỉ chi tiền cho phiếu đã được duyệt và chưa chi xong' using errcode = '22023';
  end if;
  v_left := coalesce(pr.amount_approved, pr.amount_requested) - pr.paid_amount;
  v_amount := coalesce(p_amount, v_left);
  if v_amount <= 0 or v_amount > v_left then
    raise exception 'Số tiền chi phải lớn hơn 0 và không vượt số còn được chi (% đ)', to_char(v_left, 'FM999G999G999G990')
      using errcode = '22023';
  end if;
  insert into public.payments (direction, purpose, payment_method_id, company_bank_account_id, amount, paid_at, supplier_id,
    purchase_request_id, reference_no, note)
  values ('out', 'purchase_request', p_payment_method_id, p_company_bank_account_id, v_amount, coalesce(p_paid_at, now()), pr.supplier_id,
    pr.id, nullif(trim(coalesce(p_reference_no, '')), ''), coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Chi theo đề nghị ' || pr.code))
  returning * into p;
  v_paid := pr.paid_amount + v_amount;
  update public.purchase_requests
     set paid_amount = v_paid, status = case when v_paid >= coalesce(amount_approved, amount_requested) then 'paid' else 'partial' end
   where id = pr.id;
  if v_paid >= coalesce(pr.amount_approved, pr.amount_requested) and pr.approval_request_id is not null then
    update public.approval_requests set status = 'paid' where id = pr.approval_request_id;
    insert into public.approval_steps (request_id, level, action, actor_id, comment)
    values (pr.approval_request_id, 99, 'mark_paid', auth.uid(), 'Chi tiền ' || p.code);
  end if;
  if pr.requested_by is distinct from auth.uid() then
    insert into public.notifications (recipient_id, type, title, entity_type, entity_id, link)
    values (pr.requested_by, 'purchase_paid', 'Đã chi ' || to_char(v_amount, 'FM999G999G999G990') || ' đ cho đề nghị ' || pr.code,
            'purchase_request', pr.id, '/de-nghi');
  end if;
  return p.code;
end;
$$;

-- Mua xong, chi ít hơn số đã duyệt: Kế toán bấm Hoàn tất để đóng phiếu
create or replace function public.complete_purchase_request(p_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.purchase_requests;
begin
  if not private.has_perm('purchase_requests.pay') then
    raise exception 'Bạn không có quyền hoàn tất phiếu đề nghị' using errcode = '42501';
  end if;
  select * into pr from public.purchase_requests where id = p_id for update;
  if pr.id is null then
    raise exception 'Không tìm thấy phiếu đề nghị' using errcode = 'P0001';
  end if;
  if pr.status <> 'partial' then
    raise exception 'Chỉ hoàn tất được phiếu đang chi dở (đã chi một phần). Phiếu chưa chi đồng nào thì hủy phiếu.' using errcode = '22023';
  end if;
  update public.purchase_requests set status = 'paid', completed_note = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = pr.id;
  if pr.approval_request_id is not null then
    update public.approval_requests set status = 'paid' where id = pr.approval_request_id;
    insert into public.approval_steps (request_id, level, action, actor_id, comment)
    values (pr.approval_request_id, 99, 'mark_paid', auth.uid(),
            'Hoàn tất, đã chi ' || to_char(pr.paid_amount, 'FM999G999G999G990') || ' đ' || coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), ''));
  end if;
end;
$$;

-- Yêu cầu đã thanh toán không đổi trạng thái, trừ khi hủy phiếu chi ghi nhầm của phiếu đề nghị (cờ nội bộ)
create or replace function private.guard_approval_requests()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('approved', 'paid') and (new.amount, new.content, new.approval_type_id, new.entity_id)
       is distinct from (old.amount, old.content, old.approval_type_id, old.entity_id) then
    raise exception 'Yêu cầu đã duyệt: không được sửa số tiền hoặc nội dung. Hãy tạo yêu cầu điều chỉnh.' using errcode = '42501';
  end if;
  if old.status = 'paid' and new.status <> 'paid'
     and not (new.status = 'approved' and coalesce(current_setting('app.payment_void_internal', true), '') = 'on') then
    raise exception 'Yêu cầu đã thanh toán không thể đổi trạng thái' using errcode = '42501';
  end if;
  new.version := old.version + 1;
  return new;
end;
$$;

-- Hủy phiếu chi ghi nhầm: thêm phiếu chi của đề nghị (trả lại số còn được chi)
create or replace function public.void_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
  v_paid numeric;
  v_pr public.purchase_requests;
begin
  if not private.has_perm('payments.delete') then
    raise exception 'Bạn không có quyền hủy phiếu thu/chi' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Nhập lý do hủy phiếu' using errcode = '22023';
  end if;
  select * into p from public.payments where id = p_payment_id for update;
  if p.id is null then
    raise exception 'Không tìm thấy phiếu' using errcode = 'P0001';
  end if;
  if p.status = 'voided' then
    raise exception 'Phiếu đã hủy trước đó' using errcode = '22023';
  end if;
  if p.purpose not in ('receivable', 'payable', 'purchase_request') then
    raise exception 'Hiện chỉ hủy được phiếu thu/chi công nợ và phiếu chi đề nghị. Phiếu chuyển tiền ứng và trả lương chưa hỗ trợ hủy.' using errcode = '22023';
  end if;
  update public.payments set status = 'voided', void_reason = trim(p_reason) where id = p.id;
  if p.receivable_id is not null then
    update public.receivables set paid_amount = paid_amount - p.amount,
      status = private.debt_status(amount, paid_amount - p.amount) where id = p.receivable_id;
  elsif p.payable_id is not null then
    update public.payables set paid_amount = paid_amount - p.amount,
      status = private.debt_status(amount, paid_amount - p.amount) where id = p.payable_id;
  elsif p.purchase_request_id is not null then
    select * into v_pr from public.purchase_requests where id = p.purchase_request_id for update;
    v_paid := greatest(v_pr.paid_amount - p.amount, 0);
    update public.purchase_requests
       set paid_amount = v_paid, status = case when v_paid = 0 then 'approved' else 'partial' end, completed_note = null
     where id = v_pr.id;
    if v_pr.approval_request_id is not null then
      perform set_config('app.payment_void_internal', 'on', true);
      update public.approval_requests set status = 'approved' where id = v_pr.approval_request_id and status = 'paid';
      perform set_config('app.payment_void_internal', '', true);
      insert into public.approval_steps (request_id, level, action, actor_id, comment)
      values (v_pr.approval_request_id, 99, 'comment', auth.uid(), 'Hủy phiếu chi ' || p.code || ': ' || trim(p_reason));
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Duyệt / từ chối (bản 0034 + nhánh purchase_request + móc mở rộng)
--    Móc: nếu có hàm private.on_approval_<entity_type>(uuid, uuid, text, text) thì gọi khi duyệt xong cấp cuối
--    ('approve') hoặc từ chối ('reject'), tham số: mã yêu cầu duyệt, mã bản ghi, thao tác, ghi chú.
-- -----------------------------------------------------------------------------
create or replace function private.approval_entity_hook(r public.approval_requests, p_action text, p_comment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fn regprocedure;
begin
  if r.entity_type !~ '^[a-z_]+$' then
    return;
  end if;
  v_fn := to_regprocedure('private.on_approval_' || r.entity_type || '(uuid,uuid,text,text)');
  if v_fn is not null then
    execute format('select %s($1, $2, $3, $4)', v_fn::regproc) using r.id, r.entity_id, p_action, p_comment;
  end if;
end;
$$;
revoke all on function private.approval_entity_hook(public.approval_requests, text, text) from public, anon, authenticated;

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
  v_link := case when r.entity_type = 'shipment_dispatch' then '/chuyen-xe/' || r.entity_id
                 when r.entity_type = 'purchase_request' then '/de-nghi'
                 else '/phe-duyet' end;
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
    elsif r.entity_type = 'purchase_request' then
      update public.purchase_requests set status = 'rejected' where id = r.entity_id;
    else
      perform private.approval_entity_hook(r, 'reject', trim(p_comment));
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
    if r.entity_type not in ('advance_request', 'purchase_request') then
      raise exception 'Chỉ được sửa số tiền khi duyệt ứng tiền hoặc phiếu đề nghị' using errcode = '22023';
    end if;
    if p_amount <= 0 or p_amount > r.amount then
      raise exception 'Số tiền duyệt phải lớn hơn 0 và không vượt số tiền đề nghị' using errcode = '22023';
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
    elsif r.entity_type = 'purchase_request' and v_amount <> r.amount then
      update public.purchase_requests set amount_approved = least(coalesce(amount_approved, v_amount), v_amount) where id = r.entity_id;
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
  elsif r.entity_type = 'purchase_request' then
    update public.purchase_requests
       set status = 'approved', amount_approved = least(coalesce(amount_approved, v_amount), v_amount)
     where id = r.entity_id;
    perform private.notify_permission_holders('purchase_requests.pay', 'purchase_to_pay', 'Chờ chi tiền: ' || r.content, null,
      'purchase_request', r.entity_id, '/de-nghi?f_status=approved');
  else
    perform private.approval_entity_hook(r, 'approve', nullif(trim(coalesce(p_comment, '')), ''));
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

-- -----------------------------------------------------------------------------
-- 7. Danh sách, báo cáo
-- -----------------------------------------------------------------------------
create or replace view public.purchase_request_list with (security_invoker = true) as
select pr.id, pr.code, pr.type_id, t.name as type_name, t.group_name as type_group, pr.title, pr.items,
       jsonb_array_length(pr.items) as item_count,
       pr.amount_requested, pr.amount_approved, coalesce(pr.amount_approved, pr.amount_requested) as amount_to_pay,
       pr.paid_amount,
       case when pr.status in ('approved', 'partial') then coalesce(pr.amount_approved, pr.amount_requested) - pr.paid_amount else 0 end as remaining_amount,
       pr.needed_by, pr.supplier_id, sp.name as supplier_name, coalesce(pr.payee, sp.name) as payee,
       pr.note, pr.status, pr.cancel_reason, pr.completed_note,
       pr.requested_by, private.requester_name(pr.requested_by, null) as requester_name,
       pr.created_at, (pr.created_at at time zone 'Asia/Ho_Chi_Minh')::date as request_date,
       pr.approval_request_id, ar.code as approval_code, ar.decided_at, ar.reject_reason,
       (select string_agg(coalesce(ro.name, private.requester_name(rl.approver_user_id, null)), ', ')
          from public.approval_rules rl left join public.roles ro on ro.id = rl.approver_role_id
         where rl.approval_type_id = ar.approval_type_id and rl.is_active and rl.level = ar.current_level
           and coalesce(ar.amount, 0) >= rl.min_amount and (rl.max_amount is null or coalesce(ar.amount, 0) <= rl.max_amount)) as approver_label,
       (select max(p.paid_at) from public.payments p where p.purchase_request_id = pr.id and p.status = 'posted') as last_paid_at,
       (select string_agg(p.code, ', ' order by p.paid_at) from public.payments p where p.purchase_request_id = pr.id and p.status = 'posted') as payment_codes,
       (select count(*) from public.documents doc where doc.entity_type = 'purchase_request' and doc.entity_id = pr.id and doc.archived_at is null) as file_count,
       (pr.status in ('approved', 'partial') and private.has_perm('purchase_requests.pay')) as can_pay,
       (pr.status = 'partial' and private.has_perm('purchase_requests.pay')) as can_complete,
       ((pr.requested_by = auth.uid() and pr.status = 'pending')
         or (private.has_perm('purchase_requests.delete') and pr.status in ('pending', 'approved') and pr.paid_amount = 0)) as can_cancel,
       (ar.id is not null and private.can_approve(ar.id)) as can_approve,
       pr.custom_fields
from public.purchase_requests pr
join public.purchase_request_types t on t.id = pr.type_id
left join public.suppliers sp on sp.id = pr.supplier_id
left join public.approval_requests ar on ar.id = pr.approval_request_id;

-- Tổng hợp theo tháng (ngày lập phiếu) và loại đề nghị; không tính phiếu bị từ chối, đã hủy vào số duyệt/chi
create or replace view public.report_purchase_requests with (security_invoker = true) as
select (date_trunc('month', pr.created_at at time zone 'Asia/Ho_Chi_Minh'))::date || '|' || pr.type_id as id,
       (date_trunc('month', pr.created_at at time zone 'Asia/Ho_Chi_Minh'))::date as report_month,
       to_char(date_trunc('month', pr.created_at at time zone 'Asia/Ho_Chi_Minh'), 'MM/YYYY') as month_label,
       pr.type_id, t.name as type_name, t.group_name as type_group,
       count(*) as request_count,
       count(*) filter (where pr.status = 'pending') as pending_count,
       count(*) filter (where pr.status = 'rejected') as rejected_count,
       coalesce(sum(pr.amount_requested) filter (where pr.status <> 'cancelled'), 0) as amount_requested,
       coalesce(sum(coalesce(pr.amount_approved, pr.amount_requested)) filter (where pr.status in ('approved', 'partial', 'paid')), 0) as amount_approved,
       coalesce(sum(pr.paid_amount), 0) as paid_amount,
       coalesce(sum(coalesce(pr.amount_approved, pr.amount_requested) - pr.paid_amount) filter (where pr.status in ('approved', 'partial')), 0) as remaining_amount
from public.purchase_requests pr
join public.purchase_request_types t on t.id = pr.type_id
group by 1, 2, 3, pr.type_id, t.name, t.group_name;

create or replace view public.payment_list with (security_invoker = true) as
select p.id, p.code, p.direction, p.purpose, p.amount, p.paid_at, p.status, p.void_reason, p.reference_no, p.note,
       coalesce(c.name, sp.name, d.full_name, pq.payee) as partner_name,
       p.customer_id, p.supplier_id, p.driver_id, p.payment_method_id, pm.name as payment_method_name,
       p.company_bank_account_id, s.shipment_code,
       coalesce(ar.code, ap.code, adv.code, pr.code, pq.code) as source_code,
       (p.status = 'posted' and p.purpose in ('receivable', 'payable', 'purchase_request') and private.has_perm('payments.delete')) as can_void,
       p.created_at
from public.payments p
left join public.customers c on c.id = p.customer_id
left join public.suppliers sp on sp.id = p.supplier_id
left join public.drivers d on d.id = p.driver_id
left join public.payment_methods pm on pm.id = p.payment_method_id
left join public.shipments s on s.id = p.shipment_id
left join public.receivables ar on ar.id = p.receivable_id
left join public.payables ap on ap.id = p.payable_id
left join public.advance_requests adv on adv.id = p.advance_request_id
left join public.driver_payrolls pr on pr.id = p.payroll_id
left join public.purchase_requests pq on pq.id = p.purchase_request_id;

-- Lịch sử duyệt / chi của một phiếu (người xem phải thấy được phiếu)
create or replace function public.purchase_request_history(p_id uuid)
returns table (acted_at timestamptz, action text, actor_name text, comment text)
language sql
stable
security definer
set search_path = ''
as $$
  select st.acted_at, st.action, coalesce(private.requester_name(st.actor_id, null), st.actor_label), st.comment
  from public.purchase_requests pr
  join public.approval_steps st on st.request_id = pr.approval_request_id
  where pr.id = p_id
    and (pr.requested_by = auth.uid() or private.has_perm('purchase_requests.view') or private.has_perm('purchase_requests.pay')
         or private.has_perm('approvals.view'))
  union all
  select p.paid_at, case when p.status = 'voided' then 'payment_voided' else 'payment' end,
         private.requester_name(p.created_by, null),
         p.code || ': ' || to_char(p.amount, 'FM999G999G999G990') || ' đ' || coalesce(' · ' || p.reference_no, '')
           || coalesce(' · Hủy: ' || p.void_reason, '')
  from public.payments p
  join public.purchase_requests pr on pr.id = p.purchase_request_id
  where pr.id = p_id
    and (pr.requested_by = auth.uid() or private.has_perm('purchase_requests.view') or private.has_perm('purchase_requests.pay'))
  order by 1;
$$;

-- -----------------------------------------------------------------------------
-- 8. Xóa dữ liệu thử: thêm phiếu đề nghị (giữ danh mục Loại đề nghị)
-- -----------------------------------------------------------------------------
create or replace function private.test_data_counts_raw()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'transport_orders', (select count(*) from public.transport_orders),
    'shipments', (select count(*) from public.shipments),
    'shipment_items', (select count(*) from public.shipment_items),
    'shipment_fees', (select count(*) from public.shipment_fees),
    'shipment_expenses', (select count(*) from public.shipment_expenses),
    'advance_requests', (select count(*) from public.advance_requests),
    'approval_requests', (select count(*) from public.approval_requests),
    'driver_payrolls', (select count(*) from public.driver_payrolls),
    'receivables', (select count(*) from public.receivables),
    'payables', (select count(*) from public.payables),
    'payments', (select count(*) from public.payments),
    'purchase_requests', (select count(*) from public.purchase_requests),
    'notifications', (select count(*) from public.notifications),
    'customers', (select count(*) from public.customers),
    'vehicles', (select count(*) from public.vehicles),
    'drivers', (select count(*) from public.drivers),
    'profiles', (select count(*) from public.profiles));
$$;
revoke all on function private.test_data_counts_raw() from public, anon, authenticated;

create or replace function public.purge_test_data(p_password text, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  begin
    perform private.check_purge_password(p_password);
  exception when sqlstate '42501' or sqlstate '22023' then
    if sqlerrm = 'Mật khẩu xóa dữ liệu không đúng.' then
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
      values (auth.uid(), 'test_data.password_failed', 'system', 'du-lieu-thu', 'Nhập sai mật khẩu xóa dữ liệu');
    end if;
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  if coalesce(upper(trim(p_confirm)), '') <> 'XOA DU LIEU' then
    raise exception 'Chữ xác nhận chưa đúng. Gõ XOA DU LIEU để xóa.' using errcode = '22023';
  end if;

  v_before := private.test_data_counts_raw();
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, reason)
  values (auth.uid(), 'test_data.purge', 'system', 'du-lieu-thu', v_before, 'Xóa dữ liệu thử trong ứng dụng');

  delete from public.documents
  where entity_type in ('shipment', 'shipment_expense', 'advance_request', 'payment', 'driver_payroll', 'approval_request', 'receivable', 'payable',
                        'transport_order', 'purchase_request');

  truncate table
    public.advance_transactions,
    public.payments,
    public.shipment_expenses,
    public.advance_requests,
    public.purchase_requests,
    public.driver_payrolls,
    public.approval_steps,
    public.approval_requests,
    public.payables,
    public.receivables,
    public.shipment_assignments,
    public.shipment_status_history,
    public.shipment_items,
    public.shipment_fees,
    public.shipments,
    public.transport_orders,
    public.notifications,
    private.driver_upload_tickets;

  delete from public.code_sequences where scope in ('ORD', 'SHP', 'APR', 'ADV', 'PAY', 'AR', 'AP', 'BL', 'DN');
  return jsonb_build_object('ok', true, 'counts', v_before);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Quyền gọi hàm, quyền đọc view
-- -----------------------------------------------------------------------------
revoke all on function private.purchase_items_normalize(jsonb) from public, anon;
grant execute on function private.purchase_items_normalize(jsonb) to authenticated;
revoke all on function public.create_purchase_request(uuid, text, numeric, jsonb, date, uuid, text, text, jsonb, uuid) from public, anon;
revoke all on function public.cancel_purchase_request(uuid, text) from public, anon;
revoke all on function public.pay_purchase_request(uuid, numeric, uuid, uuid, text, timestamptz, text) from public, anon;
revoke all on function public.complete_purchase_request(uuid, text) from public, anon;
revoke all on function public.purchase_request_history(uuid) from public, anon;
revoke all on function public.void_payment(uuid, text) from public, anon;
revoke all on function public.approval_decide(uuid, text, text, numeric) from public, anon;
revoke all on function public.purge_test_data(text, text) from public, anon;
grant execute on function public.create_purchase_request(uuid, text, numeric, jsonb, date, uuid, text, text, jsonb, uuid) to authenticated;
grant execute on function public.cancel_purchase_request(uuid, text) to authenticated;
grant execute on function public.pay_purchase_request(uuid, numeric, uuid, uuid, text, timestamptz, text) to authenticated;
grant execute on function public.complete_purchase_request(uuid, text) to authenticated;
grant execute on function public.purchase_request_history(uuid) to authenticated;
grant execute on function public.void_payment(uuid, text) to authenticated;
grant execute on function public.approval_decide(uuid, text, text, numeric) to authenticated;
grant execute on function public.purge_test_data(text, text) to authenticated;

revoke all on public.purchase_request_list, public.report_purchase_requests, public.payment_list from anon;
grant select on public.purchase_request_list, public.report_purchase_requests, public.payment_list to authenticated;
