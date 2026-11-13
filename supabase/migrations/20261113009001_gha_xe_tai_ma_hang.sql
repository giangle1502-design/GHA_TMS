-- =============================================================================
-- GHA 9001: Phân loại phương tiện (xe tải / đầu kéo / rơ moóc) + Danh mục mã hàng
--           + Đơn cha có dòng mã hàng con (1 shipment = 1 đơn, nhiều mã hàng)
-- Chạy sau toàn bộ migration của nền Khánh Hà TMS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. LOẠI PHƯƠNG TIỆN
--    truck   = Xe tải (tự chở hàng trên thùng; có tải trọng, kiểu thùng, kích thước thùng)
--    tractor = Đầu kéo (kéo rơ moóc/sơ mi rơ moóc chở container hoặc hàng rời)
--    trailer = Rơ moóc / sơ mi rơ moóc (không tự chạy, không có tài xế)
-- -----------------------------------------------------------------------------
alter table public.vehicle_types
  add column if not exists vehicle_kind text not null default 'truck'
    check (vehicle_kind in ('truck', 'tractor', 'trailer'));
comment on column public.vehicle_types.vehicle_kind is 'truck = xe tải, tractor = đầu kéo, trailer = rơ moóc/sơ mi rơ moóc';

alter table public.vehicles
  add column if not exists vehicle_kind text not null default 'truck'
    check (vehicle_kind in ('truck', 'tractor', 'trailer')),
  add column if not exists payload_tons numeric(8,2) check (payload_tons is null or payload_tons >= 0),
  add column if not exists body_type text
    check (body_type is null or body_type in ('closed', 'canvas', 'flatbed', 'dump', 'refrigerated', 'tank', 'container_chassis', 'other')),
  add column if not exists body_length_m numeric(5,2) check (body_length_m is null or body_length_m > 0),
  add column if not exists body_width_m numeric(5,2) check (body_width_m is null or body_width_m > 0),
  add column if not exists body_height_m numeric(5,2) check (body_height_m is null or body_height_m > 0),
  add column if not exists body_volume_m3 numeric(8,2) generated always as
    (round(body_length_m * body_width_m * body_height_m, 2)) stored,
  add column if not exists trailer_size text check (trailer_size is null or trailer_size in ('20', '40', '45', 'flex')),
  add column if not exists default_trailer_id uuid references public.vehicles (id) on delete set null;
comment on column public.vehicles.vehicle_kind is 'truck = xe tải, tractor = đầu kéo, trailer = rơ moóc; lấy theo loại xe nếu có';
comment on column public.vehicles.body_type is 'Kiểu thùng xe tải: closed kín, canvas mui bạt, flatbed lửng, dump ben, refrigerated đông lạnh, tank bồn';
comment on column public.vehicles.default_trailer_id is 'Rơ moóc thường kéo (chỉ cho đầu kéo)';
create index if not exists vehicles_kind_idx on public.vehicles (vehicle_kind);

-- Quy tắc: lấy loại phương tiện theo loại xe; rơ moóc không có tài xế; chỉ đầu kéo mới gắn rơ moóc
create or replace function private.vehicles_kind_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  if new.vehicle_type_id is not null then
    select vt.vehicle_kind into v_kind from public.vehicle_types vt where vt.id = new.vehicle_type_id;
    if v_kind is not null then new.vehicle_kind := v_kind; end if;
  end if;
  if new.vehicle_kind = 'trailer' and new.assigned_driver_id is not null then
    raise exception 'Rơ moóc không gắn tài xế' using errcode = '23514';
  end if;
  if new.default_trailer_id is not null then
    if new.vehicle_kind <> 'tractor' then
      raise exception 'Chỉ đầu kéo mới gắn rơ moóc' using errcode = '23514';
    end if;
    if not exists (select 1 from public.vehicles t where t.id = new.default_trailer_id and t.vehicle_kind = 'trailer') then
      raise exception 'Xe được gắn làm rơ moóc không phải rơ moóc' using errcode = '23514';
    end if;
  end if;
  if new.vehicle_kind <> 'truck' then
    new.body_type := case when new.vehicle_kind = 'trailer' then new.body_type else null end;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_vehicles_kind_guard on public.vehicles;
create trigger trg_vehicles_kind_guard before insert or update on public.vehicles
for each row execute function private.vehicles_kind_guard();

-- Đổi loại của "loại xe" thì cập nhật các xe thuộc loại đó
create or replace function private.vehicle_types_kind_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.vehicle_kind is distinct from old.vehicle_kind then
    update public.vehicles set vehicle_kind = new.vehicle_kind where vehicle_type_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_vehicle_types_kind_sync on public.vehicle_types;
create trigger trg_vehicle_types_kind_sync after update of vehicle_kind on public.vehicle_types
for each row execute function private.vehicle_types_kind_sync();

-- Chuyến: rơ moóc kéo theo + số container + seal
alter table public.shipments
  add column if not exists trailer_id uuid references public.vehicles (id),
  add column if not exists container_no text check (container_no is null or length(container_no) <= 30),
  add column if not exists seal_no text check (seal_no is null or length(seal_no) <= 50);
comment on column public.shipments.trailer_id is 'Rơ moóc của chuyến (chỉ khi xe chạy là đầu kéo)';
create index if not exists shipments_trailer_idx on public.shipments (trailer_id) where trailer_id is not null;

create or replace function private.shipments_vehicle_kind_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  if new.vehicle_id is not null then
    select v.vehicle_kind into v_kind from public.vehicles v where v.id = new.vehicle_id;
    if v_kind = 'trailer' then
      raise exception 'Xe chạy chuyến không được là rơ moóc; chọn đầu kéo hoặc xe tải' using errcode = '23514';
    end if;
  end if;
  if new.trailer_id is not null then
    if coalesce(v_kind, 'tractor') <> 'tractor' then
      raise exception 'Chỉ chuyến chạy bằng đầu kéo mới có rơ moóc' using errcode = '23514';
    end if;
    if not exists (select 1 from public.vehicles t where t.id = new.trailer_id and t.vehicle_kind = 'trailer') then
      raise exception 'Xe được chọn làm rơ moóc không phải rơ moóc' using errcode = '23514';
    end if;
  elsif v_kind = 'tractor' and (tg_op = 'INSERT' or new.vehicle_id is distinct from old.vehicle_id) then
    select v.default_trailer_id into new.trailer_id from public.vehicles v where v.id = new.vehicle_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_shipments_vehicle_kind_guard on public.shipments;
create trigger trg_shipments_vehicle_kind_guard before insert or update of vehicle_id, trailer_id on public.shipments
for each row execute function private.shipments_vehicle_kind_guard();

-- Loại xe mẫu (sửa/thêm được ở Danh mục → Loại xe)
insert into public.vehicle_types (code, name, payload_tons, vehicle_kind, sort_order) values
  ('XT1T5', 'Xe tải 1.5 tấn', 1.5, 'truck', 10),
  ('XT2T5', 'Xe tải 2.5 tấn', 2.5, 'truck', 11),
  ('XT5T', 'Xe tải 5 tấn', 5, 'truck', 12),
  ('XT10T', 'Xe tải 10 tấn', 10, 'truck', 14),
  ('XT15T', 'Xe tải 15 tấn', 15, 'truck', 15),
  ('XT', 'Xe tải (chưa rõ tải trọng)', null, 'truck', 19),
  ('DK', 'Đầu kéo', null, 'tractor', 20),
  ('RM20', 'Sơ mi rơ moóc 20''', null, 'trailer', 30),
  ('RM40', 'Sơ mi rơ moóc 40''', null, 'trailer', 31),
  ('RMSAN', 'Rơ moóc sàn / lửng', null, 'trailer', 32)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 2. DANH MỤC MÃ HÀNG
-- -----------------------------------------------------------------------------
insert into public.catalogs (code, name, description, is_system) values
  ('product_group', 'Nhóm hàng', 'Phân nhóm mã hàng (VD: PP, HDPE, LLDPE...)', true),
  ('product_unit', 'Đơn vị tính hàng hóa', 'KG, TẤN, BAO, PALLET, CONT...', true),
  ('product_packing', 'Quy cách đóng gói', 'Bao 25kg, Jumbo 1 tấn, Pallet...', true)
on conflict (code) do nothing;
insert into public.catalog_items (catalog_id, code, name, sort_order, metadata)
select c.id, v.code, v.name, v.sort, v.meta::jsonb
from public.catalogs c
join (values
  ('product_unit', 'KG', 'Kg', 1, '{"kg_per_unit": 1}'),
  ('product_unit', 'TAN', 'Tấn', 2, '{"kg_per_unit": 1000}'),
  ('product_unit', 'BAO', 'Bao', 3, '{}'),
  ('product_unit', 'PALLET', 'Pallet', 4, '{}'),
  ('product_unit', 'THUNG', 'Thùng', 5, '{}'),
  ('product_packing', 'BAO25', 'Bao 25 kg', 1, '{"kg_per_pack": 25}'),
  ('product_packing', 'JUMBO', 'Bao jumbo 1 tấn', 2, '{"kg_per_pack": 1000}')
) as v(cat, code, name, sort, meta) on v.cat = c.code
on conflict (catalog_id, code) do nothing;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(trim(code)) between 1 and 100),
  name text not null check (length(trim(name)) between 1 and 300),
  unit text not null default 'KG' check (length(unit) <= 30),
  group_id uuid references public.catalog_items (id),
  packing_id uuid references public.catalog_items (id),
  owner_customer_id uuid references public.customers (id),
  kg_per_unit numeric(14,4) check (kg_per_unit is null or kg_per_unit > 0),
  m3_per_unit numeric(14,6) check (m3_per_unit is null or m3_per_unit > 0),
  is_dangerous boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text check (notes is null or length(notes) <= 1000),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.products is 'Danh mục mã hàng (hàng hóa vận chuyển)';
comment on column public.products.owner_customer_id is 'Chủ hàng (VD: VAP, PLA); để trống nếu dùng chung';
comment on column public.products.kg_per_unit is 'Quy đổi 1 đơn vị tính ra kg (để tính tấn cho cước/bốc xếp). KG = 1';
create index if not exists products_search_idx on public.products using gin (to_tsvector('simple', code || ' ' || name));
select private.attach_standard_triggers('public.products');
create trigger trg_products_audit after insert or update or delete on public.products
  for each row execute function private.audit_row_change('id');
create trigger trg_products_code before insert on public.products
  for each row execute function private.fill_master_code('MH', '4');

alter table public.products enable row level security;
create policy products_select on public.products for select to authenticated
  using ((select private.is_active_user()));
create policy products_insert on public.products for insert to authenticated
  with check ((select private.has_perm('products.create')));
create policy products_update on public.products for update to authenticated
  using ((select private.has_perm('products.update'))) with check ((select private.has_perm('products.update')));
create policy products_delete on public.products for delete to authenticated
  using ((select private.has_perm('products.delete')));
revoke all on public.products from anon;
grant select, insert, update, delete on public.products to authenticated;

insert into public.permissions (code, module, action, name, sort_order) values
  ('products.view', 'products', 'view', 'Xem - Mã hàng', 2701),
  ('products.create', 'products', 'create', 'Thêm - Mã hàng', 2702),
  ('products.update', 'products', 'update', 'Sửa - Mã hàng', 2703),
  ('products.delete', 'products', 'delete', 'Xóa - Mã hàng', 2704),
  ('products.export', 'products', 'export', 'Xuất dữ liệu - Mã hàng', 2705)
on conflict (code) do nothing;
-- Ai có quyền với Địa điểm thì có quyền tương ứng với Mã hàng
insert into public.role_permissions (role_id, permission_code)
select rp.role_id, replace(rp.permission_code, 'locations.', 'products.')
from public.role_permissions rp
where rp.permission_code in ('locations.view', 'locations.create', 'locations.update', 'locations.delete', 'locations.export')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 3. ĐƠN CHA + DÒNG MÃ HÀNG CON
--    transport_orders = đơn cha (Ngày giao, Số shipment, Điểm nhận, Điểm giao, Tổng SL tự tính)
--    transport_order_items = mã hàng con (Mã, Tên, SL, đã xếp xe)
--    shipment_items.order_item_id = dòng hàng trên xe thuộc dòng nào của đơn
-- -----------------------------------------------------------------------------
alter table public.transport_orders
  add column if not exists delivery_date date,
  add column if not exists ref_no text check (ref_no is null or length(ref_no) <= 100),
  add column if not exists voucher_no text check (voucher_no is null or length(voucher_no) <= 100),
  add column if not exists pickup_location_id uuid references public.locations (id),
  add column if not exists delivery_location_id uuid references public.locations (id),
  add column if not exists destination_note text check (destination_note is null or length(destination_note) <= 500),
  add column if not exists carrier_supplier_id uuid references public.suppliers (id);
comment on column public.transport_orders.ref_no is 'Số đơn của khách / số đơn cũ (ORD-...)';
comment on column public.transport_orders.voucher_no is 'Số phiếu xuất kho (PXK)';

create table if not exists public.transport_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.transport_orders (id) on delete cascade,
  line_no smallint not null check (line_no between 1 and 500),
  product_id uuid references public.products (id),
  item_code text check (item_code is null or length(item_code) <= 100),
  item_name text check (item_name is null or length(item_name) <= 300),
  unit text check (unit is null or length(unit) <= 30),
  quantity numeric(16,3) not null check (quantity >= 0),
  note text check (note is null or length(note) <= 500),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (order_id, line_no)
);
comment on table public.transport_order_items is 'Mã hàng của đơn (dòng con của đơn cha)';
create index if not exists transport_order_items_product_idx on public.transport_order_items (product_id);
select private.attach_standard_triggers('public.transport_order_items');
create trigger trg_transport_order_items_audit after insert or update or delete on public.transport_order_items
  for each row execute function private.audit_row_change('id');

alter table public.shipment_items
  add column if not exists product_id uuid references public.products (id),
  add column if not exists order_item_id uuid references public.transport_order_items (id) on delete set null,
  add column if not exists weight_kg numeric(16,3) check (weight_kg is null or weight_kg >= 0);
create index if not exists shipment_items_order_item_idx on public.shipment_items (order_item_id) where order_item_id is not null;
create index if not exists shipment_items_product_idx on public.shipment_items (product_id) where product_id is not null;

-- Chọn mã hàng thì tự điền mã/tên/ĐVT và quy ra kg
create or replace function private.fill_item_from_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.products;
begin
  if new.product_id is not null then
    select * into p from public.products where id = new.product_id;
    new.item_code := coalesce(nullif(new.item_code, ''), p.code);
    new.item_name := coalesce(nullif(new.item_name, ''), p.name);
    new.unit := coalesce(nullif(new.unit, ''), p.unit);
    if tg_table_name = 'shipment_items' then
      if new.weight_kg is null and p.kg_per_unit is not null and new.quantity is not null then
        new.weight_kg := round(new.quantity * p.kg_per_unit, 3);
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_order_items_product before insert or update of product_id, quantity on public.transport_order_items
  for each row execute function private.fill_item_from_product();
create trigger trg_shipment_items_product before insert or update of product_id, quantity on public.shipment_items
  for each row execute function private.fill_item_from_product();

alter table public.transport_order_items enable row level security;
create policy transport_order_items_select on public.transport_order_items for select to authenticated
  using (exists (select 1 from public.transport_orders o where o.id = order_id));
create policy transport_order_items_write on public.transport_order_items for all to authenticated
  using ((select private.has_perm('dispatch.update')) or (select private.has_perm('dispatch.create')))
  with check ((select private.has_perm('dispatch.update')) or (select private.has_perm('dispatch.create')));
revoke all on public.transport_order_items from anon;
grant select, insert, update, delete on public.transport_order_items to authenticated;

-- Số lượng đã xếp xe / còn lại của từng dòng mã hàng (không tính chuyến hủy)
create or replace view public.order_item_balance with (security_invoker = true) as
select oi.id as order_item_id, oi.order_id, oi.line_no, oi.product_id, oi.item_code, oi.item_name, oi.unit,
       oi.quantity,
       coalesce(sum(si.quantity) filter (where s.status <> 'cancelled'), 0) as assigned_quantity,
       oi.quantity - coalesce(sum(si.quantity) filter (where s.status <> 'cancelled'), 0) as remaining_quantity
from public.transport_order_items oi
left join public.shipment_items si on si.order_item_id = oi.id
left join public.shipments s on s.id = si.shipment_id
group by oi.id;
grant select on public.order_item_balance to authenticated;

-- Tổng số lượng đơn cha (tự tính)
create or replace view public.order_totals with (security_invoker = true) as
select o.id as order_id, o.order_code,
       coalesce(sum(b.quantity), 0) as total_quantity,
       coalesce(sum(b.assigned_quantity), 0) as assigned_quantity,
       coalesce(sum(b.remaining_quantity), 0) as remaining_quantity,
       count(b.order_item_id) as item_count
from public.transport_orders o
left join public.order_item_balance b on b.order_id = o.id
group by o.id;
grant select on public.order_totals to authenticated;


-- -----------------------------------------------------------------------------
-- 4. ẨN 3-PL VỚI TÀI KHOẢN KHÁCH HÀNG
--    Quyền mới "carriers.view" (Xem nhà xe 3-PL và cước 3-PL). Chỉ vai trò nội bộ GHA có.
--    Không có quyền này: không thấy nhà xe 3-PL/đơn vị vận tải, cước 3-PL, công nợ trả 3-PL;
--    danh sách xe xem qua public.vehicles_for_customer (không có chủ xe, không có "thuê ngoài"),
--    nên khách chỉ biết đó là xe của GHA.
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, action, name, description, sort_order) values
  ('carriers.view', 'carriers', 'view', 'Xem nhà xe 3-PL và cước 3-PL', 'Không cấp cho tài khoản khách hàng', 2710),
  ('vehicles.view_basic', 'vehicles', 'view_basic', 'Xem biển số, loại xe (không thấy chủ xe)', 'Dùng cho tài khoản khách hàng', 2711)
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join (values ('carriers.view'), ('vehicles.view_basic')) p(code)
where r.code in ('super_admin', 'admin', 'director', 'accountant', 'dispatcher', 'ops_manager')
on conflict do nothing;

insert into public.roles (code, name, description, is_system, sort_order)
values ('customer_admin', 'Quản trị bên khách hàng', 'Tài khoản của khách (VD: VAP): xem đơn, chuyến, xe của GHA; không thấy 3-PL và cước 3-PL', true, 90)
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r
cross join (values ('dispatch.view'), ('vehicles.view_basic'), ('products.view'), ('locations.view')) p(code)
where r.code = 'customer_admin'
on conflict do nothing;

create or replace function private.can_view_3pl() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_perm('carriers.view')
$$;

drop policy if exists shipment_carrier_costs_select on public.shipment_carrier_costs;
create policy shipment_carrier_costs_select on public.shipment_carrier_costs for select to authenticated
  using ((select private.can_view_3pl()) and ((select private.has_perm('dispatch.view')) or (select private.has_perm('receivables.view'))
         or (select private.has_perm('reports.view')) or (select private.has_perm('expenses.view'))));

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers for select to authenticated
  using ((select private.has_perm('customers.view'))
         and (coalesce(custom_fields ->> 'supplier_kind', '') not in ('3pl', 'carrier', 'internal_fleet', 'self_pickup')
              or (select private.can_view_3pl())));

drop policy if exists payables_select on public.payables;
create policy payables_select on public.payables for select to authenticated
  using ((select private.has_perm('receivables.view')) and (kind <> 'carrier' or (select private.can_view_3pl())));

-- Danh sách xe cho khách: không có chủ xe, kiểu sở hữu, tài chính
create or replace view public.vehicles_for_customer as
select v.id, v.code, v.plate_number, v.vehicle_kind, vt.name as vehicle_type_name, coalesce(v.payload_tons, vt.payload_tons) as payload_tons,
       v.body_type, v.body_length_m, v.body_width_m, v.body_height_m, v.body_volume_m3, v.trailer_size, v.status
from public.vehicles v
left join public.vehicle_types vt on vt.id = v.vehicle_type_id
where v.archived_at is null
  and ((select private.has_perm('vehicles.view_basic')) or (select private.has_perm('vehicles.view')));
revoke all on public.vehicles_for_customer from anon;
grant select on public.vehicles_for_customer to authenticated;

-- Cho phép thêm trường riêng (cột bổ sung) cho Mã hàng và dòng mã hàng của đơn
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
  end;
$function$;

-- Xóa dữ liệu thử (GĐ Khánh Hà) phải xóa cả dòng mã hàng của đơn
CREATE OR REPLACE FUNCTION public.purge_test_data(p_password text, p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    public.transport_order_items,
    public.shipment_fees,
    public.shipment_carrier_costs,
    public.shipments,
    public.transport_orders,
    public.transport_plans,
    public.notifications,
    private.driver_upload_tickets;

  delete from public.code_sequences where scope in ('ORD', 'SHP', 'APR', 'ADV', 'PAY', 'AR', 'AP', 'BL', 'DN');
  delete from public.code_sequences where scope = 'master:transport_plans';
  return jsonb_build_object('ok', true, 'counts', v_before);
end;
$function$;

-- Thương hiệu GHA
update public.system_settings set value = '"CÔNG TY TNHH GHA LOGISTICS & SERVICE"'::jsonb where key = 'company.name';
