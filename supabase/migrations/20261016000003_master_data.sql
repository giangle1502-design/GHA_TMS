-- =============================================================================
-- GHA TMS - 0003: Danh mục quản lý
-- (đơn vị nội bộ, danh mục chung, ngân hàng, phương tiện, tài xế, khách hàng,
--  nhà cung cấp, địa điểm, tuyến, bảng giá, chi phí, hỗ trợ dầu, lương)
-- =============================================================================

-- Danh mục chung có thể cấu hình (tỉnh/thành, hãng xe, loại hợp đồng, nhóm chi phí...)
create table public.catalogs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.catalogs (id) on delete restrict,
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (catalog_id, code)
);

-- Đơn vị nội bộ (pháp nhân của doanh nghiệp, dùng cho "Công ty áp dụng" bảng giá, tài khoản)
create table public.company_entities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  tax_code text,
  address text,
  phone text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- Ngân hàng, phương thức thanh toán
create table public.banks (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  short_name text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  requires_bank_account boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- Loại xe
create table public.vehicle_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  payload_tons numeric(8,2),
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- Quy tắc tính lương tài xế
create table public.salary_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  method text not null check (method in ('fixed', 'per_trip', 'per_km', 'revenue_percent', 'formula')),
  rate numeric(18,4),
  formula text,
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (effective_to is null or effective_to >= effective_from),
  check (method <> 'formula' or formula is not null)
);

-- Tài xế
create table public.drivers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  full_name text not null,
  date_of_birth date,
  phone text,
  email text,
  address text,
  contract_signed_date date,
  contract_type text,
  start_date date,
  contract_end_date date,
  base_salary numeric(18,2) check (base_salary >= 0),
  per_trip_salary numeric(18,2) check (per_trip_salary >= 0),
  meal_allowance numeric(18,2) check (meal_allowance >= 0),
  other_allowance numeric(18,2) check (other_allowance >= 0),
  salary_rule_id uuid references public.salary_rules (id),
  status text not null default 'active' check (status in ('active', 'on_leave', 'terminated')),
  profile_id uuid unique references public.profiles (id) on delete set null,
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on column public.drivers.profile_id is 'Tài khoản đăng nhập (Google) của tài xế';

-- Thông tin nhạy cảm của tài xế tách bảng riêng để RLS chặn theo quyền view_sensitive
create table public.driver_sensitive (
  driver_id uuid primary key references public.drivers (id) on delete cascade,
  national_id text,
  national_id_issued_date date,
  national_id_issued_place text,
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

alter table public.user_invitations
  add constraint user_invitations_driver_fk foreign key (driver_id) references public.drivers (id) on delete set null;

-- Nhà cung cấp (sửa chữa, nhiên liệu, thuê ngoài...)
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  tax_code text,
  address text,
  contact_name text,
  phone text,
  email text,
  payment_term_days integer check (payment_term_days >= 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- Khách hàng / đơn vị thuê vận chuyển / đơn vị thanh toán - xuất hóa đơn
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  tax_code text,
  billing_address text,
  contact_name text,
  phone text,
  invoice_email text,
  payment_term_days integer check (payment_term_days >= 0),
  credit_limit numeric(18,2) check (credit_limit >= 0),
  is_shipper boolean not null default true,
  is_payer boolean not null default true,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create unique index customers_tax_code_uq on public.customers (tax_code) where tax_code is not null and tax_code <> '';

-- Tài khoản ngân hàng (công ty, tài xế, nhà cung cấp, khách hàng). Không lưu mật khẩu/đăng nhập ngân hàng.
create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('company', 'driver', 'supplier', 'customer')),
  company_entity_id uuid references public.company_entities (id),
  driver_id uuid references public.drivers (id),
  supplier_id uuid references public.suppliers (id),
  customer_id uuid references public.customers (id),
  bank_id uuid not null references public.banks (id),
  account_number text not null,
  account_name text not null,
  branch text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (
    (owner_type = 'company' and company_entity_id is not null and driver_id is null and supplier_id is null and customer_id is null)
    or (owner_type = 'driver' and driver_id is not null and company_entity_id is null and supplier_id is null and customer_id is null)
    or (owner_type = 'supplier' and supplier_id is not null and company_entity_id is null and driver_id is null and customer_id is null)
    or (owner_type = 'customer' and customer_id is not null and company_entity_id is null and driver_id is null and supplier_id is null)
  ),
  unique (bank_id, account_number)
);

-- Phương tiện
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  plate_number text not null,
  vehicle_type_id uuid references public.vehicle_types (id),
  brand text,
  model_year integer check (model_year between 1950 and 2100),
  ownership_type text not null default 'owned' check (ownership_type in ('owned', 'leased', 'lease_purchase')),
  registration_expiry date,
  insurance_expiry date,
  fuel_norm_l_per_100km numeric(6,2) check (fuel_norm_l_per_100km >= 0),
  status text not null default 'active' check (status in ('active', 'maintenance', 'inactive', 'sold')),
  assigned_driver_id uuid references public.drivers (id) on delete set null,
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on column public.vehicles.assigned_driver_id is 'Nguồn duy nhất cho phân công xe-tài xế mặc định; biển số của tài xế lấy qua view driver_vehicle_view';
create unique index vehicles_plate_uq on public.vehicles (upper(regexp_replace(plate_number, '[^A-Za-z0-9]', '', 'g')));
create unique index vehicles_assigned_driver_uq on public.vehicles (assigned_driver_id) where assigned_driver_id is not null and archived_at is null;

-- Thông tin tài chính của xe (giá mua, khấu hao, khoản vay) tách bảng để RLS chặn theo vehicles.view_sensitive
create table public.vehicle_financials (
  vehicle_id uuid primary key references public.vehicles (id) on delete cascade,
  purchase_date date,
  purchase_price numeric(18,2) check (purchase_price >= 0),
  residual_value numeric(18,2) check (residual_value >= 0),
  depreciation_method text not null default 'straight_line' check (depreciation_method in ('straight_line', 'none')),
  depreciation_months integer check (depreciation_months > 0),
  monthly_depreciation numeric(18,2) generated always as (
    case
      when depreciation_method = 'straight_line' and depreciation_months > 0 and purchase_price is not null
        then round((purchase_price - coalesce(residual_value, 0)) / depreciation_months, 0)
      else null
    end
  ) stored,
  lender_bank_id uuid references public.banks (id),
  loan_principal numeric(18,2) check (loan_principal >= 0),
  loan_interest_rate numeric(7,4) check (loan_interest_rate >= 0),
  loan_start_date date,
  loan_end_date date,
  monthly_installment numeric(18,2) check (monthly_installment >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (residual_value is null or purchase_price is null or residual_value <= purchase_price),
  check (loan_end_date is null or loan_start_date is null or loan_end_date >= loan_start_date)
);
comment on column public.vehicle_financials.loan_interest_rate is 'Lãi suất năm (%)';

-- Lịch trả nợ vay xe: dư nợ chỉ được tính từ lịch này, không suy đoán
create table public.loan_schedules (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  installment_no integer not null check (installment_no > 0),
  due_date date not null,
  principal_due numeric(18,2) not null check (principal_due >= 0),
  interest_due numeric(18,2) not null default 0 check (interest_due >= 0),
  paid_principal numeric(18,2) not null default 0 check (paid_principal >= 0),
  paid_interest numeric(18,2) not null default 0 check (paid_interest >= 0),
  paid_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (vehicle_id, installment_no)
);

-- Sửa chữa, bảo dưỡng, thay lốp, thay nhớt...
create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete restrict,
  record_type text not null check (record_type in ('repair', 'maintenance', 'tire', 'oil', 'inspection', 'other')),
  performed_at date not null,
  odometer_km integer check (odometer_km >= 0),
  description text not null,
  supplier_id uuid references public.suppliers (id),
  amount numeric(18,2) not null default 0 check (amount >= 0),
  next_due_date date,
  next_due_km integer,
  status text not null default 'recorded' check (status in ('recorded', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index maintenance_records_vehicle_idx on public.maintenance_records (vehicle_id, performed_at desc);

-- Địa điểm dùng chung cho nơi nhận / nơi giao
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  company_name text,
  full_address text not null,
  province text,
  billing_address text,
  tax_code text,
  contact_name text,
  phone text,
  email text,
  latitude numeric(9,6) check (latitude between -90 and 90),
  longitude numeric(9,6) check (longitude between -180 and 180),
  google_maps_url text,
  operating_hours text,
  gate_instructions text,
  delivery_notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index locations_search_idx on public.locations using gin (to_tsvector('simple', coalesce(code, '') || ' ' || name || ' ' || coalesce(company_name, '') || ' ' || full_address));

-- Tuyến đường
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  pickup_location_id uuid not null references public.locations (id),
  delivery_location_id uuid not null references public.locations (id),
  distance_km numeric(10,2) check (distance_km >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (pickup_location_id, delivery_location_id)
);

-- Bảng giá vận chuyển
create table public.transport_price_lists (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  company_entity_id uuid references public.company_entities (id),
  customer_id uuid references public.customers (id),
  pickup_location_id uuid references public.locations (id),
  delivery_location_id uuid references public.locations (id),
  vehicle_type_id uuid references public.vehicle_types (id),
  unit_price numeric(18,2) not null check (unit_price >= 0),
  pricing_unit text not null default 'trip' check (pricing_unit in ('trip', 'km', 'ton', 'other')),
  pricing_unit_label text,
  fuel_support_rate numeric(6,3) check (fuel_support_rate between 0 and 100),
  reference_distance_km numeric(10,2) check (reference_distance_km >= 0),
  surcharge_amount numeric(18,2) not null default 0 check (surcharge_amount >= 0),
  effective_from date not null,
  effective_to date,
  conditions text,
  priority integer not null default 0,
  status text not null default 'active' check (status in ('draft', 'active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (effective_to is null or effective_to >= effective_from),
  check (pricing_unit <> 'other' or pricing_unit_label is not null),
  -- Không cho hai bảng giá đang hiệu lực có cùng phạm vi, cùng độ ưu tiên và chồng lấn thời gian
  constraint price_list_no_overlap exclude using gist (
    (coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(pickup_location_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(delivery_location_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(vehicle_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(company_entity_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    pricing_unit with =,
    priority with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  ) where (status = 'active')
);
create index price_lists_lookup_idx on public.transport_price_lists (customer_id, pickup_location_id, delivery_location_id, vehicle_type_id) where status = 'active';

-- Danh mục chi phí dùng chung
create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  group_name text not null,
  report_bucket text not null default 'other' check (report_bucket in (
    'fuel', 'toll', 'loading_yard', 'repair', 'driver', 'outsourcing', 'allocated_overhead', 'depreciation', 'interest', 'other')),
  cost_class text not null default 'direct' check (cost_class in ('direct', 'allocated')),
  allowed_role_codes text[] not null default array['admin', 'accountant', 'dispatcher', 'driver'],
  requires_amount boolean not null default true,
  requires_invoice boolean not null default false,
  requires_image boolean not null default false,
  requires_approval boolean not null default true,
  counts_to_trip_cost boolean not null default true,
  formula text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

-- Quy tắc hỗ trợ dầu (ưu tiên: chuyến > tuyến/khách hàng > loại xe > mặc định)
create table public.fuel_support_rules (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('default', 'customer', 'route', 'customer_route', 'vehicle_type')),
  customer_id uuid references public.customers (id),
  route_id uuid references public.routes (id),
  vehicle_type_id uuid references public.vehicle_types (id),
  rate_percent numeric(6,3) check (rate_percent between 0 and 100),
  calculation_base text not null default 'freight_revenue' check (calculation_base in ('freight_revenue', 'unit_price', 'total_revenue', 'fuel_norm', 'formula')),
  fuel_norm_l_per_100km numeric(6,2) check (fuel_norm_l_per_100km >= 0),
  reference_fuel_price numeric(18,2) check (reference_fuel_price >= 0),
  formula text,
  effective_from date not null,
  effective_to date,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (effective_to is null or effective_to >= effective_from),
  check (
    (scope_type = 'default' and customer_id is null and route_id is null and vehicle_type_id is null)
    or (scope_type = 'customer' and customer_id is not null and route_id is null and vehicle_type_id is null)
    or (scope_type = 'route' and route_id is not null and customer_id is null and vehicle_type_id is null)
    or (scope_type = 'customer_route' and customer_id is not null and route_id is not null and vehicle_type_id is null)
    or (scope_type = 'vehicle_type' and vehicle_type_id is not null and customer_id is null and route_id is null)
  ),
  check (calculation_base <> 'formula' or formula is not null),
  check (calculation_base = 'fuel_norm' or calculation_base = 'formula' or rate_percent is not null),
  constraint fuel_rule_no_overlap exclude using gist (
    scope_type with =,
    (coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(route_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (coalesce(vehicle_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&
  ) where (is_active)
);

do $$
declare t text;
begin
  foreach t in array array[
    'catalogs', 'catalog_items', 'company_entities', 'banks', 'payment_methods', 'vehicle_types', 'salary_rules',
    'drivers', 'suppliers', 'customers', 'bank_accounts', 'vehicles', 'vehicle_financials', 'loan_schedules', 'maintenance_records',
    'locations', 'routes', 'transport_price_lists', 'expense_categories', 'fuel_support_rules'
  ] loop
    perform private.attach_standard_triggers(('public.' || t)::regclass);
  end loop;
end $$;

create trigger trg_driver_sensitive_updated_at before update on public.driver_sensitive
for each row execute function private.set_updated_at();
create trigger trg_driver_sensitive_actor before insert or update on public.driver_sensitive
for each row execute function private.set_actor_columns();

-- Dư nợ vay xe (chỉ từ lịch trả nợ đã nhập)
create view public.vehicle_loan_summary with (security_invoker = true) as
select
  vf.vehicle_id,
  vf.loan_principal,
  count(ls.id) as installments,
  sum(ls.principal_due) as scheduled_principal,
  sum(ls.paid_principal) as paid_principal,
  -- Chỉ tính dư nợ khi đã có lịch trả nợ; không suy đoán từ lãi suất/thời hạn
  case when count(ls.id) = 0 then null
       else coalesce(vf.loan_principal, sum(ls.principal_due)) - coalesce(sum(ls.paid_principal), 0)
  end as outstanding_principal,
  min(ls.due_date) filter (where ls.paid_principal < ls.principal_due) as next_due_date
from public.vehicle_financials vf
left join public.loan_schedules ls on ls.vehicle_id = vf.vehicle_id
group by vf.vehicle_id, vf.loan_principal;

-- Biển số xe được phân công cho tài xế (suy ra từ vehicles.assigned_driver_id)
create view public.driver_vehicle_view with (security_invoker = true) as
select d.id as driver_id, v.id as vehicle_id, v.plate_number
from public.drivers d
join public.vehicles v on v.assigned_driver_id = d.id and v.archived_at is null;

-- Hàm tiện ích: id tài xế gắn với người dùng hiện tại
create or replace function private.my_driver_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id from public.drivers d where d.profile_id = auth.uid() and private.is_active_user();
$$;
grant execute on function private.my_driver_id() to authenticated, service_role;

-- Tìm bảng giá phù hợp: trả về các ứng viên, xếp theo độ cụ thể rồi độ ưu tiên.
-- Nếu hai dòng đầu bằng nhau cả hai tiêu chí, giao diện phải bắt người dùng chọn.
create or replace function public.find_price_lists(
  p_customer_id uuid,
  p_pickup_location_id uuid,
  p_delivery_location_id uuid,
  p_vehicle_type_id uuid,
  p_on_date date default (now() at time zone 'Asia/Ho_Chi_Minh')::date
)
returns table (
  id uuid, code text, unit_price numeric, pricing_unit text, pricing_unit_label text,
  fuel_support_rate numeric, surcharge_amount numeric, reference_distance_km numeric,
  specificity integer, priority integer, effective_from date, effective_to date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select pl.id, pl.code, pl.unit_price, pl.pricing_unit, pl.pricing_unit_label,
         pl.fuel_support_rate, pl.surcharge_amount, pl.reference_distance_km,
         ((pl.customer_id is not null)::int * 8 + (pl.pickup_location_id is not null)::int * 2
          + (pl.delivery_location_id is not null)::int * 2 + (pl.vehicle_type_id is not null)::int * 4) as specificity,
         pl.priority, pl.effective_from, pl.effective_to
  from public.transport_price_lists pl
  where pl.status = 'active'
    and p_on_date between pl.effective_from and coalesce(pl.effective_to, 'infinity'::date)
    and (pl.customer_id is null or pl.customer_id = p_customer_id)
    and (pl.pickup_location_id is null or pl.pickup_location_id = p_pickup_location_id)
    and (pl.delivery_location_id is null or pl.delivery_location_id = p_delivery_location_id)
    and (pl.vehicle_type_id is null or pl.vehicle_type_id = p_vehicle_type_id)
  order by specificity desc, pl.priority desc, pl.effective_from desc;
$$;
