-- =============================================================================
-- GHA TMS - 0004: Điều phối, đơn hàng, Shipment, phân công, lịch sử trạng thái
-- =============================================================================

create table public.transport_orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  order_date date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  company_entity_id uuid references public.company_entities (id),
  customer_id uuid not null references public.customers (id),
  payer_customer_id uuid not null references public.customers (id),
  dispatcher_id uuid references public.profiles (id),
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create index transport_orders_customer_idx on public.transport_orders (customer_id, order_date desc);

-- Trạng thái chính của Shipment (xem docs/06-trang-thai-shipment.md)
--   draft -> assigned -> accepted -> in_transit -> driver_completed -> closed
--   assigned -> rejected -> assigned (phân công lại)
--   draft/assigned/accepted/rejected/in_transit -> cancelled
create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_code text not null unique,
  order_id uuid not null references public.transport_orders (id) on delete restrict,
  sequence_in_order integer not null default 1,
  pickup_at timestamptz not null,
  expected_delivery_at timestamptz,
  pickup_location_id uuid not null references public.locations (id),
  delivery_location_id uuid not null references public.locations (id),
  route_id uuid references public.routes (id),
  vehicle_type_id uuid references public.vehicle_types (id),
  vehicle_id uuid references public.vehicles (id),
  driver_id uuid references public.drivers (id),

  -- Ảnh chụp giá tại thời điểm tạo chuyến: bảng giá đổi sau này không làm đổi chuyến cũ
  price_list_id uuid references public.transport_price_lists (id),
  unit_price numeric(18,2) not null default 0 check (unit_price >= 0),
  pricing_unit text not null default 'trip' check (pricing_unit in ('trip', 'km', 'ton', 'other')),
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  freight_amount numeric(18,2) generated always as (round(unit_price * quantity, 0)) stored,
  surcharge_amount numeric(18,2) not null default 0 check (surcharge_amount >= 0),
  fuel_support_rate numeric(6,3) check (fuel_support_rate between 0 and 100),
  fuel_support_base text check (fuel_support_base in ('freight_revenue', 'unit_price', 'total_revenue', 'fuel_norm', 'formula')),
  fuel_support_amount numeric(18,2) not null default 0 check (fuel_support_amount >= 0),
  fuel_support_rule_id uuid references public.fuel_support_rules (id),
  pricing_snapshot jsonb not null default '{}'::jsonb,

  status text not null default 'draft' check (status in ('draft', 'assigned', 'accepted', 'rejected', 'in_transit', 'driver_completed', 'closed', 'cancelled')),
  document_status text not null default 'missing' check (document_status in ('missing', 'submitted', 'verified', 'rejected')),
  settlement_status text not null default 'unsettled' check (settlement_status in ('unsettled', 'pending_approval', 'settled', 'reopened')),

  -- Hoàn thành chuyến (tài xế nhập)
  arrived_pickup_at timestamptz,
  departed_pickup_at timestamptz,
  arrived_delivery_at timestamptz,
  completed_at timestamptz,
  odometer_start integer check (odometer_start >= 0),
  odometer_end integer check (odometer_end >= 0),
  actual_km numeric(10,2) check (actual_km >= 0),
  delivery_result text check (delivery_result in ('full', 'partial', 'failed')),
  completion_note text,

  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  notes text,
  custom_fields jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (pickup_location_id <> delivery_location_id),
  check (odometer_end is null or odometer_start is null or odometer_end >= odometer_start),
  check (expected_delivery_at is null or expected_delivery_at >= pickup_at),
  check (status <> 'cancelled' or cancel_reason is not null),
  unique (order_id, sequence_in_order)
);
create index shipments_pickup_idx on public.shipments (pickup_at desc);
create index shipments_driver_idx on public.shipments (driver_id, pickup_at desc);
create index shipments_vehicle_idx on public.shipments (vehicle_id, pickup_at desc);
create index shipments_status_idx on public.shipments (status);
create index shipments_order_idx on public.shipments (order_id);

-- Phân công tài xế: tối đa một phân công còn hiệu lực (pending/accepted) cho mỗi chuyến
create table public.shipment_assignments (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete restrict,
  driver_id uuid not null references public.drivers (id),
  vehicle_id uuid references public.vehicles (id),
  assigned_by uuid references public.profiles (id),
  assigned_at timestamptz not null default now(),
  response text not null default 'pending' check (response in ('pending', 'accepted', 'rejected', 'superseded')),
  responded_at timestamptz,
  reject_reason text,
  check (response <> 'rejected' or (reject_reason is not null and length(trim(reject_reason)) > 0))
);
create unique index shipment_assignments_active_uq on public.shipment_assignments (shipment_id)
  where response in ('pending', 'accepted');
create index shipment_assignments_driver_idx on public.shipment_assignments (driver_id, assigned_at desc);

create table public.shipment_status_history (
  id bigint generated always as identity primary key,
  shipment_id uuid not null references public.shipments (id) on delete restrict,
  status_field text not null default 'status' check (status_field in ('status', 'document_status', 'settlement_status')),
  from_status text,
  to_status text not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  note text
);
create index shipment_status_history_idx on public.shipment_status_history (shipment_id, changed_at);

select private.attach_standard_triggers('public.transport_orders');
select private.attach_standard_triggers('public.shipments');

-- Sinh mã đơn hàng / Shipment khi tạo; không cho đổi sau đó
create or replace function private.shipments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.shipment_code is null or new.shipment_code = '' then
    new.shipment_code := private.next_code('SHP', now());
  end if;
  new.status := coalesce(new.status, 'draft');
  return new;
end;
$$;
create trigger trg_shipments_code before insert on public.shipments
for each row execute function private.shipments_before_insert();

create or replace function private.orders_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.order_code is null or new.order_code = '' then
    new.order_code := private.next_code('ORD', now());
  end if;
  return new;
end;
$$;
create trigger trg_orders_code before insert on public.transport_orders
for each row execute function private.orders_before_insert();

-- Ma trận chuyển trạng thái hợp lệ
create or replace function private.shipment_transition_allowed(from_s text, to_s text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select from_s = to_s or (from_s, to_s) in (
    ('draft', 'assigned'), ('draft', 'cancelled'),
    ('assigned', 'accepted'), ('assigned', 'rejected'), ('assigned', 'draft'), ('assigned', 'cancelled'),
    ('rejected', 'assigned'), ('rejected', 'draft'), ('rejected', 'cancelled'),
    ('accepted', 'in_transit'), ('accepted', 'assigned'), ('accepted', 'cancelled'),
    ('in_transit', 'driver_completed'), ('in_transit', 'cancelled'),
    ('driver_completed', 'in_transit'), ('driver_completed', 'closed'),
    ('closed', 'driver_completed')
  );
$$;

create or replace function private.shipments_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.shipment_code <> old.shipment_code then
    raise exception 'Mã Shipment không được thay đổi' using errcode = '42501';
  end if;
  if new.order_id <> old.order_id then
    raise exception 'Không được chuyển Shipment sang đơn hàng khác' using errcode = '42501';
  end if;
  if not private.shipment_transition_allowed(old.status, new.status) then
    raise exception 'Không thể chuyển trạng thái chuyến từ % sang %', old.status, new.status using errcode = '22023';
  end if;
  -- Chuyến đã đóng/hủy: khóa dữ liệu giá
  if old.status in ('closed', 'cancelled') and (
       new.unit_price, new.quantity, new.surcharge_amount, new.fuel_support_amount, new.price_list_id
     ) is distinct from (
       old.unit_price, old.quantity, old.surcharge_amount, old.fuel_support_amount, old.price_list_id
     ) then
    raise exception 'Chuyến đã đóng hoặc đã hủy, không được sửa giá' using errcode = '42501';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at := now();
    new.cancelled_by := auth.uid();
  end if;
  new.version := old.version + 1;
  return new;
end;
$$;
create trigger trg_shipments_guard before update on public.shipments
for each row execute function private.shipments_before_update();

create or replace function private.shipments_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.shipment_status_history (shipment_id, status_field, from_status, to_status, changed_by)
    values (new.id, 'status', null, new.status, auth.uid());
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.shipment_status_history (shipment_id, status_field, from_status, to_status, changed_by, note)
    values (new.id, 'status', old.status, new.status, auth.uid(), case when new.status = 'cancelled' then new.cancel_reason end);
  end if;
  if new.document_status is distinct from old.document_status then
    insert into public.shipment_status_history (shipment_id, status_field, from_status, to_status, changed_by)
    values (new.id, 'document_status', old.document_status, new.document_status, auth.uid());
  end if;
  if new.settlement_status is distinct from old.settlement_status then
    insert into public.shipment_status_history (shipment_id, status_field, from_status, to_status, changed_by)
    values (new.id, 'settlement_status', old.settlement_status, new.settlement_status, auth.uid());
  end if;
  return new;
end;
$$;
create trigger trg_shipments_history after insert or update on public.shipments
for each row execute function private.shipments_status_history();
