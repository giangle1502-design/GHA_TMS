-- =============================================================================
-- GHA 9011: Chi phí ngoài chuyến, cân đối thu chi để báo cáo thuế, phiếu đề nghị thanh toán / tạm ứng
-- (LE yêu cầu 15/11/2026)
--   * overhead_categories: danh mục loại phí ngoài chuyến (thêm được): thuê kế toán, dầu xe, xăng đi lại, sửa chữa…
--   * overhead_expenses: từng khoản chi ngoài chuyến: ngày, loại phí, xe (dầu/sửa xe), số lít × đơn giá,
--     tiền trước thuế, thuế suất VAT -> tiền thuế, tổng thanh toán; hóa đơn; ai chi (công ty / cá nhân ứng trước).
--   * report_overhead_vehicle_month: tổng hợp dầu, sửa chữa, chi khác theo xe theo tháng.
--   * report_overhead_by_category: tổng theo loại phí theo tháng.
--   * report_spending_lines thêm nguồn 'overhead' (Tổng chi theo nhóm có cả chi phí ngoài chuyến).
--   * payment_request_forms: phiếu đề nghị thanh toán / tạm ứng đã lập (in lại được).
--   * Quyền mới overhead.* : chỉ Super Admin, Admin, Giám đốc, Kế toán. Tài khoản khách hàng (customer_admin)
--     không có nên không thấy chi phí nội bộ (chặn ở CSDL bằng RLS).
-- Không xóa, không sửa dữ liệu nghiệp vụ có sẵn.
-- =============================================================================

-- 1. Quyền
insert into public.permissions (code, module, action, name, description, sort_order) values
  ('overhead.view', 'overhead', 'view', 'Xem - Chi phí ngoài chuyến', 'Chi phí nội bộ, cân đối thu chi báo cáo thuế. Không cấp cho tài khoản khách hàng', 2721),
  ('overhead.create', 'overhead', 'create', 'Thêm - Chi phí ngoài chuyến', null, 2722),
  ('overhead.update', 'overhead', 'update', 'Sửa - Chi phí ngoài chuyến', null, 2723),
  ('overhead.delete', 'overhead', 'delete', 'Xóa - Chi phí ngoài chuyến', null, 2724),
  ('overhead.export', 'overhead', 'export', 'Xuất dữ liệu - Chi phí ngoài chuyến', null, 2725)
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
cross join (values ('overhead.view'), ('overhead.create'), ('overhead.update'), ('overhead.delete'), ('overhead.export')) p(code)
where r.code in ('super_admin', 'admin', 'director', 'accountant')
on conflict do nothing;

-- 2. Danh mục loại phí ngoài chuyến
create table if not exists public.overhead_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  name text not null check (length(trim(name)) between 1 and 150),
  group_name text check (group_name is null or length(group_name) <= 100),
  kind text not null default 'other' check (kind in ('fuel', 'vehicle', 'office', 'tax', 'salary', 'other')),
  default_vat_rate numeric(5,2) check (default_vat_rate is null or default_vat_rate between 0 and 100),
  tax_deductible boolean not null default true,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  notes text check (notes is null or length(notes) <= 1000),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.overhead_categories is 'Loại phí ngoài chuyến (thuê kế toán, dầu xe, xăng đi lại, sửa chữa…)';
comment on column public.overhead_categories.kind is 'fuel = dầu/xăng (có số lít), vehicle = chi phí xe, office = văn phòng, tax = thuế/kế toán, salary = lương, other = khác';
select private.attach_standard_triggers('public.overhead_categories');
create trigger trg_overhead_categories_code before insert on public.overhead_categories
  for each row execute function private.fill_master_code('LP');
create trigger trg_overhead_categories_audit after insert or update or delete on public.overhead_categories
  for each row execute function private.audit_row_change('id');
alter table public.overhead_categories enable row level security;
create policy overhead_categories_select on public.overhead_categories for select to authenticated
  using ((select private.has_perm('overhead.view')) or (select private.has_perm('overhead.create')));
create policy overhead_categories_insert on public.overhead_categories for insert to authenticated
  with check ((select private.has_perm('overhead.create')));
create policy overhead_categories_update on public.overhead_categories for update to authenticated
  using ((select private.has_perm('overhead.update'))) with check ((select private.has_perm('overhead.update')));
create policy overhead_categories_delete on public.overhead_categories for delete to authenticated
  using ((select private.has_perm('overhead.delete')));
revoke all on public.overhead_categories from anon;
grant select, insert, update, delete on public.overhead_categories to authenticated;

insert into public.overhead_categories (name, group_name, kind, default_vat_rate, tax_deductible, sort_order)
select v.name, v.grp, v.kind, v.vat, v.ded, v.ord
from (values
  ('Dầu xe (đổ dầu theo xe)', 'Xe', 'fuel', 10::numeric, true, 10),
  ('Xăng đi lại', 'Đi lại', 'fuel', 10, true, 20),
  ('Sửa chữa xe', 'Xe', 'vehicle', 10, true, 30),
  ('Bảo dưỡng, thay nhớt, lốp', 'Xe', 'vehicle', 10, true, 40),
  ('Đăng kiểm, phí đường bộ, bảo hiểm xe', 'Xe', 'vehicle', null, true, 50),
  ('Thuê kế toán, báo cáo thuế', 'Thuế, kế toán', 'tax', null, true, 60),
  ('Thuế môn bài, lệ phí', 'Thuế, kế toán', 'tax', null, true, 70),
  ('Lương nhân viên văn phòng', 'Lương', 'salary', null, true, 80),
  ('Thuê văn phòng, kho bãi', 'Văn phòng', 'office', 10, true, 90),
  ('Điện, nước, internet, điện thoại', 'Văn phòng', 'office', 10, true, 100),
  ('Văn phòng phẩm', 'Văn phòng', 'office', 10, true, 110),
  ('Sửa chữa văn phòng', 'Văn phòng', 'office', 10, true, 120),
  ('Phí ngân hàng', 'Tài chính', 'other', null, true, 130),
  ('Tiếp khách, công tác phí', 'Khác', 'other', 10, true, 140),
  ('Chi phí khác', 'Khác', 'other', null, true, 990)
) as v(name, grp, kind, vat, ded, ord)
where not exists (select 1 from public.overhead_categories c where lower(c.name) = lower(v.name))
order by v.ord;

-- 3. Khoản chi ngoài chuyến
create table if not exists public.overhead_expenses (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  expense_date date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  category_id uuid not null references public.overhead_categories (id),
  vehicle_id uuid references public.vehicles (id),
  description text check (description is null or length(description) <= 500),
  quantity numeric(14,3) check (quantity is null or quantity >= 0),
  unit_price numeric(18,2) check (unit_price is null or unit_price >= 0),
  amount numeric(18,2) not null default 0 check (amount >= 0),
  vat_rate numeric(5,2) check (vat_rate is null or vat_rate between 0 and 100),
  vat_amount numeric(18,2) generated always as (round(amount * coalesce(vat_rate, 0) / 100, 0)) stored,
  total_amount numeric(18,2) generated always as (amount + round(amount * coalesce(vat_rate, 0) / 100, 0)) stored,
  has_invoice boolean not null default false,
  invoice_no text check (invoice_no is null or length(invoice_no) <= 100),
  invoice_date date,
  tax_deductible boolean,
  supplier_id uuid references public.suppliers (id),
  seller_name text check (seller_name is null or length(seller_name) <= 200),
  paid_by text not null default 'company' check (paid_by in ('company', 'personal')),
  spender_name text check (spender_name is null or length(spender_name) <= 150),
  payment_status text not null default 'paid' check (payment_status in ('paid', 'unpaid')),
  paid_date date,
  odometer_km integer check (odometer_km is null or odometer_km >= 0),
  notes text check (notes is null or length(notes) <= 1000),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.overhead_expenses is 'Chi phí ngoài chuyến: thuê kế toán, dầu theo xe, xăng đi lại, sửa chữa… (cân đối thu chi, báo cáo thuế)';
comment on column public.overhead_expenses.amount is 'Tiền trước thuế VAT (không có hóa đơn thì là số tiền thực chi)';
comment on column public.overhead_expenses.paid_by is 'company = công ty chi; personal = cá nhân chi trước, công ty hoàn lại (đề nghị thanh toán)';
create index if not exists overhead_expenses_date_idx on public.overhead_expenses (expense_date desc);
create index if not exists overhead_expenses_vehicle_idx on public.overhead_expenses (vehicle_id, expense_date) where vehicle_id is not null;
create index if not exists overhead_expenses_category_idx on public.overhead_expenses (category_id, expense_date);
select private.attach_standard_triggers('public.overhead_expenses');
create trigger trg_overhead_expenses_code before insert on public.overhead_expenses
  for each row execute function private.fill_master_code('CN', '5');
create trigger trg_overhead_expenses_audit after insert or update or delete on public.overhead_expenses
  for each row execute function private.audit_row_change('id');

-- Số lít × đơn giá -> tiền khi chưa nhập tiền; thuế suất, "được trừ thuế" lấy theo loại phí khi để trống
create or replace function private.overhead_expense_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.overhead_categories;
begin
  select * into c from public.overhead_categories where id = new.category_id;
  if new.quantity is not null and new.unit_price is not null and coalesce(new.amount, 0) = 0 then
    new.amount := round(new.quantity * new.unit_price, 0);
  end if;
  if tg_op = 'INSERT' and new.vat_rate is null and new.has_invoice then
    new.vat_rate := c.default_vat_rate;
  end if;
  if new.tax_deductible is null then
    new.tax_deductible := coalesce(c.tax_deductible, true);
  end if;
  if new.payment_status = 'paid' and new.paid_date is null and new.paid_by = 'company' then
    new.paid_date := new.expense_date;
  end if;
  return new;
end;
$$;
create trigger trg_overhead_expenses_fill before insert or update on public.overhead_expenses
  for each row execute function private.overhead_expense_fill();

alter table public.overhead_expenses enable row level security;
create policy overhead_expenses_select on public.overhead_expenses for select to authenticated
  using ((select private.has_perm('overhead.view')));
create policy overhead_expenses_insert on public.overhead_expenses for insert to authenticated
  with check ((select private.has_perm('overhead.create')));
create policy overhead_expenses_update on public.overhead_expenses for update to authenticated
  using ((select private.has_perm('overhead.update'))) with check ((select private.has_perm('overhead.update')));
create policy overhead_expenses_delete on public.overhead_expenses for delete to authenticated
  using ((select private.has_perm('overhead.delete')));
revoke all on public.overhead_expenses from anon;
grant select, insert, update, delete on public.overhead_expenses to authenticated;

-- 4. Tổng hợp theo xe theo tháng (dầu: số lít, tiền; sửa chữa; chi khác)
create or replace view public.report_overhead_vehicle_month with (security_invoker = true) as
select to_char(date_trunc('month', e.expense_date), 'YYYY-MM') || ':' || e.vehicle_id as id,
       date_trunc('month', e.expense_date)::date as report_month,
       to_char(date_trunc('month', e.expense_date), 'MM/YYYY') as month_label,
       e.vehicle_id, v.plate_number,
       count(*) filter (where c.kind = 'fuel') as fuel_count,
       coalesce(sum(e.quantity) filter (where c.kind = 'fuel'), 0) as fuel_liters,
       coalesce(sum(e.amount) filter (where c.kind = 'fuel'), 0) as fuel_amount,
       coalesce(sum(e.amount) filter (where c.kind = 'vehicle'), 0) as vehicle_amount,
       coalesce(sum(e.amount) filter (where c.kind not in ('fuel', 'vehicle')), 0) as other_amount,
       coalesce(sum(e.amount), 0) as amount,
       coalesce(sum(e.vat_amount), 0) as vat_amount,
       coalesce(sum(e.total_amount), 0) as total_amount,
       case when sum(e.quantity) filter (where c.kind = 'fuel') > 0
            then round(sum(e.amount) filter (where c.kind = 'fuel') / sum(e.quantity) filter (where c.kind = 'fuel'), 0) end as avg_fuel_price
from public.overhead_expenses e
join public.overhead_categories c on c.id = e.category_id
join public.vehicles v on v.id = e.vehicle_id
group by 1, 2, 3, e.vehicle_id, v.plate_number;
comment on view public.report_overhead_vehicle_month is 'Chi phí ngoài chuyến theo xe theo tháng: dầu (lít, tiền), sửa chữa, chi khác';
revoke all on public.report_overhead_vehicle_month from anon;
grant select on public.report_overhead_vehicle_month to authenticated;

create or replace view public.report_overhead_by_category with (security_invoker = true) as
select to_char(date_trunc('month', e.expense_date), 'YYYY-MM') || ':' || e.category_id as id,
       date_trunc('month', e.expense_date)::date as report_month,
       to_char(date_trunc('month', e.expense_date), 'MM/YYYY') as month_label,
       e.category_id, c.name as category_name, coalesce(nullif(trim(c.group_name), ''), 'Khác') as group_name,
       count(*) as expense_count,
       coalesce(sum(e.amount), 0) as amount,
       coalesce(sum(e.vat_amount), 0) as vat_amount,
       coalesce(sum(e.total_amount), 0) as total_amount,
       coalesce(sum(e.amount) filter (where e.has_invoice), 0) as invoiced_amount,
       coalesce(sum(e.amount) filter (where not e.has_invoice), 0) as no_invoice_amount,
       coalesce(sum(e.total_amount) filter (where e.paid_by = 'personal' and e.payment_status = 'unpaid'), 0) as personal_unpaid
from public.overhead_expenses e
join public.overhead_categories c on c.id = e.category_id
group by 1, 2, 3, e.category_id, c.name, c.group_name;
comment on view public.report_overhead_by_category is 'Chi phí ngoài chuyến theo loại phí theo tháng';
revoke all on public.report_overhead_by_category from anon;
grant select on public.report_overhead_by_category to authenticated;

-- 5. Tổng chi theo nhóm: thêm nguồn "Chi phí ngoài chuyến" (tiền trước thuế; chỉ người có overhead.view thấy)
create or replace view public.report_spending_lines as
select 'cp:' || e.id as id, 'trip'::text as source,
       coalesce(g.name, nullif(trim(c.group_name), ''), 'Khác') as group_name,
       coalesce(g.sort_order, 9000) as group_sort,
       c.name as item_name,
       (e.incurred_at at time zone 'Asia/Ho_Chi_Minh')::date as report_date,
       e.amount, e.status, c.is_pass_through,
       e.code, s.shipment_code, v.plate_number, d.full_name as driver_name, cu.name as customer_name,
       sp.name as supplier_name, e.paid_by, e.ref_no, e.note
from public.shipment_expenses e
join public.expense_categories c on c.id = e.category_id
left join public.expense_groups g on g.id = c.group_id
join public.shipments s on s.id = e.shipment_id
left join public.transport_orders o on o.id = s.order_id
left join public.customers cu on cu.id = o.customer_id
left join public.drivers d on d.id = e.driver_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.suppliers sp on sp.id = e.supplier_id
where e.status in ('approved', 'pending') and private.has_perm('reports.view')
union all
select 'bd:' || m.id, 'vehicle',
       case when m.record_type in ('inspection', 'insurance') then 'Kiểm định, bảo hiểm'
            when m.record_type = 'other' then 'Chi phí xe khác'
            else 'Bảo trì, sửa chữa' end,
       9500,
       case m.record_type when 'repair' then 'Sửa chữa máy móc' when 'maintenance' then 'Bảo dưỡng' when 'tire' then 'Thay lốp'
            when 'tire_patch' then 'Vá lốp' when 'oil' then 'Thay nhớt' when 'inspection' then 'Phí kiểm định'
            when 'insurance' then 'Phí bảo hiểm' else 'Khác' end,
       m.performed_at, m.amount, 'approved', false,
       null, null, v.plate_number, null, null, sp.name, 'company', null, m.description
from public.maintenance_records m
join public.vehicles v on v.id = m.vehicle_id
left join public.suppliers sp on sp.id = m.supplier_id
where m.status = 'recorded' and m.amount > 0 and private.has_perm('reports.view')
union all
select 'tn:' || k.id, 'carrier', 'Thuê xe ngoài 3PL', 9600,
       case k.cost_kind when 'freight' then 'Cước trả 3PL' when 'pass_through' then 'Chi hộ trả 3PL' else 'Chi phí khác 3PL' end
         || coalesce(': ' || nullif(trim(k.description), ''), ''),
       (coalesce(s.completed_at, s.pickup_at, s.created_at) at time zone 'Asia/Ho_Chi_Minh')::date,
       k.amount, 'approved', k.cost_kind = 'pass_through',
       null, s.shipment_code, v.plate_number, d.full_name, cu.name, sp.name, 'company', k.ref_no, k.note
from public.shipment_carrier_costs k
join public.shipments s on s.id = k.shipment_id
left join public.transport_orders o on o.id = s.order_id
left join public.customers cu on cu.id = o.customer_id
left join public.drivers d on d.id = s.driver_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.suppliers sp on sp.id = s.carrier_supplier_id
where s.status <> 'cancelled' and private.has_perm('reports.view')
union all
select 'dn:' || p.id, 'purchase', coalesce(nullif(trim(t.group_name), ''), 'Đề nghị chi, mua sắm'), 9700,
       t.name,
       (p.paid_at at time zone 'Asia/Ho_Chi_Minh')::date,
       p.amount, 'approved', false,
       p.code, null, null, null, null, coalesce(sp.name, pr.payee), null, pr.code, pr.title
from public.payments p
join public.purchase_requests pr on pr.id = p.purchase_request_id
join public.purchase_request_types t on t.id = pr.type_id
left join public.suppliers sp on sp.id = pr.supplier_id
where p.purpose = 'purchase_request' and p.status = 'posted' and p.direction = 'out' and private.has_perm('reports.view')
union all
select 'cn:' || x.id, 'overhead', 'Ngoài chuyến: ' || coalesce(nullif(trim(oc.group_name), ''), 'Khác'), 9800 + oc.sort_order,
       oc.name,
       x.expense_date, x.amount, 'approved', false,
       x.code, null, v.plate_number, null, null, coalesce(sp.name, x.seller_name),
       case x.paid_by when 'personal' then 'personal' else 'company' end, x.invoice_no, coalesce(x.description, x.notes)
from public.overhead_expenses x
join public.overhead_categories oc on oc.id = x.category_id
left join public.vehicles v on v.id = x.vehicle_id
left join public.suppliers sp on sp.id = x.supplier_id
where x.amount > 0 and private.has_perm('reports.view') and private.has_perm('overhead.view');

comment on view public.report_spending_lines is 'Báo cáo tổng chi: từng khoản chi (chi phí chuyến, chi phí xe, trả 3PL, đề nghị chi, chi phí ngoài chuyến) có nhóm phí và cờ chi hộ';
revoke all on public.report_spending_lines from anon;
grant select on public.report_spending_lines to authenticated;

-- 6. Phiếu đề nghị thanh toán / đề nghị tạm ứng (lưu để in lại)
create table if not exists public.payment_request_forms (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  form_type text not null check (form_type in ('payment', 'advance')),
  form_date date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  recipient text check (recipient is null or length(recipient) <= 300),
  requester_name text not null check (length(trim(requester_name)) between 1 and 150),
  department text check (department is null or length(department) <= 200),
  content text check (content is null or length(content) <= 2000),
  amount numeric(18,2) not null default 0 check (amount >= 0),
  advance_amount numeric(18,2) not null default 0 check (advance_amount >= 0),
  due_date date,
  payment_method text not null default 'cash' check (payment_method in ('cash', 'transfer')),
  bank_account_no text check (bank_account_no is null or length(bank_account_no) <= 50),
  bank_name text check (bank_name is null or length(bank_name) <= 200),
  account_holder text check (account_holder is null or length(account_holder) <= 150),
  attachment_count integer check (attachment_count is null or attachment_count >= 0),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  overhead_ids uuid[] not null default '{}',
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.payment_request_forms is 'Giấy đề nghị thanh toán / đề nghị tạm ứng (mẫu A4 có logo GHA)';
comment on column public.payment_request_forms.items is 'Danh sách khoản: [{content, invoice_no, invoice_date, amount}]';
select private.attach_standard_triggers('public.payment_request_forms');

-- Số phiếu: DNTT-2611-001 (thanh toán) / DNTU-2611-001 (tạm ứng), đếm theo tháng
create or replace function private.payment_request_form_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefix text := case new.form_type when 'advance' then 'DNTU' else 'DNTT' end;
  ym text := to_char(new.form_date, 'YYMM');
  v integer;
begin
  if new.code is not null and btrim(new.code) <> '' then
    new.code := upper(btrim(new.code));
    return new;
  end if;
  loop
    insert into public.code_sequences as cs (scope, period, last_value)
    values ('form:' || prefix, ym, 1)
    on conflict (scope, period) do update set last_value = cs.last_value + 1
    returning last_value into v;
    new.code := prefix || '-' || ym || '-' || lpad(v::text, 3, '0');
    exit when not exists (select 1 from public.payment_request_forms where code = new.code);
  end loop;
  return new;
end;
$$;
create trigger trg_payment_request_forms_code before insert on public.payment_request_forms
  for each row execute function private.payment_request_form_code();
create trigger trg_payment_request_forms_audit after insert or update or delete on public.payment_request_forms
  for each row execute function private.audit_row_change('id');

alter table public.payment_request_forms enable row level security;
create policy payment_request_forms_select on public.payment_request_forms for select to authenticated
  using ((select private.has_perm('overhead.view')) or created_by = (select auth.uid()));
create policy payment_request_forms_insert on public.payment_request_forms for insert to authenticated
  with check ((select private.has_perm('overhead.create')));
create policy payment_request_forms_update on public.payment_request_forms for update to authenticated
  using ((select private.has_perm('overhead.update')) or created_by = (select auth.uid()))
  with check ((select private.has_perm('overhead.update')) or created_by = (select auth.uid()));
create policy payment_request_forms_delete on public.payment_request_forms for delete to authenticated
  using ((select private.has_perm('overhead.delete')));
revoke all on public.payment_request_forms from anon;
grant select, insert, update, delete on public.payment_request_forms to authenticated;

-- 7. Trường bổ sung cho loại phí và khoản chi ngoài chuyến
CREATE OR REPLACE FUNCTION private.custom_field_table(p_module text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
    when 'expense_groups' then 'expense_groups'
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
    when 'leaves' then 'leave_requests'
    when 'purchase_requests' then 'purchase_requests'
    when 'purchase_request_types' then 'purchase_request_types'
    when 'tasks' then 'tasks'
    when 'transport_plans' then 'transport_plans'
    when 'pay_zones' then 'pay_zones'
    when 'trip_pay_rates' then 'trip_pay_rates'
    when 'pay_components' then 'pay_components'
    when 'driver_pay_components' then 'driver_pay_components'
    when 'pay_holidays' then 'pay_holidays'
    when 'products' then 'products'
    when 'order_items' then 'transport_order_items'
    when 'overhead_expenses' then 'overhead_expenses'
    when 'overhead_categories' then 'overhead_categories'
  end;
$function$;
