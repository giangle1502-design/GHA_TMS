-- =============================================================================
-- KHÁNH HÀ TMS - 0045: Lập kế hoạch (khách hàng yêu cầu 02/11/2026)
--   * Bảng transport_plans: nhận thông tin từ khách rồi nhập thành kế hoạch (khách hàng, ngày giao, loại cont,
--     khách thanh toán, điểm hạ rỗng, NCC, điểm hạ rỗng trái tuyến, số lượng cont, điểm nhận, điểm giao,
--     tuyến đường, thứ tự chuyến, SĐT điểm nhận/giao).
--   * plan_create_orders: tích chọn kế hoạch → tạo đúng số lượng cont đơn hàng trong Điều phối (mỗi cont một đơn).
--   * Chuyến (shipments) thêm: kế hoạch gốc, thứ tự chuyến, điểm hạ rỗng, điểm hạ rỗng trái tuyến, SĐT điểm nhận/giao.
--     Hiện ở Điều phối, Quản lý chuyến xe và ứng dụng tài xế.
--   * Tài xế phải nhận chuyến đúng thứ tự: không nhận được chuyến thứ 2 khi chuyến thứ 1 cùng ngày của xe còn chờ nhận.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Bảng kế hoạch
-- -----------------------------------------------------------------------------
create table if not exists public.transport_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  plan_date date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  customer_id uuid not null references public.customers (id),
  delivery_date date,
  vehicle_type_id uuid references public.vehicle_types (id),
  payer_customer_id uuid references public.customers (id),
  empty_return_location_id uuid references public.locations (id),
  supplier_id uuid references public.suppliers (id),
  offroute_return_location_id uuid references public.locations (id),
  container_qty integer not null check (container_qty between 1 and 100),
  pickup_location_id uuid not null references public.locations (id),
  delivery_location_id uuid not null references public.locations (id),
  route_name text check (route_name is null or length(route_name) <= 300),
  trip_order smallint check (trip_order between 1 and 99),
  pickup_phone text check (pickup_phone is null or length(pickup_phone) <= 30),
  delivery_phone text check (delivery_phone is null or length(delivery_phone) <= 30),
  notes text check (notes is null or length(notes) <= 1000),
  status text not null default 'planned' check (status in ('planned', 'ordered')),
  ordered_at timestamptz,
  ordered_by uuid,
  order_count integer not null default 0,
  order_codes text,
  order_pickup_date date,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint transport_plans_points_differ check (pickup_location_id <> delivery_location_id)
);
comment on table public.transport_plans is 'Kế hoạch vận chuyển nhận từ khách; tích chọn để tạo đơn trong Điều phối (mỗi cont một đơn)';
create index if not exists transport_plans_customer_idx on public.transport_plans (customer_id);
create index if not exists transport_plans_status_idx on public.transport_plans (status, delivery_date);
select private.attach_standard_triggers('public.transport_plans');
create trigger trg_transport_plans_code before insert on public.transport_plans
for each row execute function private.fill_master_code('KP');
create trigger trg_transport_plans_audit after insert or update or delete on public.transport_plans
for each row execute function private.audit_row_change('id');

-- Khách thanh toán để trống = khách thanh toán mặc định của khách (nếu có) hoặc chính khách hàng;
-- tuyến đường để trống = "Điểm nhận → Điểm giao"; kế hoạch đã tạo đơn thì khóa các thông tin đã đưa sang Điều phối
create or replace function private.transport_plans_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payer_customer_id is null then
    select coalesce(c.default_payer_customer_id, c.id) into new.payer_customer_id from public.customers c where c.id = new.customer_id;
  end if;
  if new.route_name is null or btrim(new.route_name) = '' then
    select pl.name || ' → ' || dl.name into new.route_name
    from public.locations pl, public.locations dl
    where pl.id = new.pickup_location_id and dl.id = new.delivery_location_id;
  end if;
  new.pickup_phone := nullif(btrim(new.pickup_phone), '');
  new.delivery_phone := nullif(btrim(new.delivery_phone), '');
  if tg_op = 'UPDATE' and old.status = 'ordered' then
    if (new.customer_id, new.payer_customer_id, new.container_qty, new.pickup_location_id, new.delivery_location_id, new.delivery_date,
        new.vehicle_type_id, new.empty_return_location_id, new.offroute_return_location_id, new.trip_order, new.pickup_phone, new.delivery_phone)
       is distinct from
       (old.customer_id, old.payer_customer_id, old.container_qty, old.pickup_location_id, old.delivery_location_id, old.delivery_date,
        old.vehicle_type_id, old.empty_return_location_id, old.offroute_return_location_id, old.trip_order, old.pickup_phone, old.delivery_phone)
       and coalesce(current_setting('app.plan_ordering', true), '') <> 'on' then
      raise exception 'Kế hoạch % đã tạo đơn (%): sửa thông tin chuyến ở Điều phối. Ở đây chỉ sửa ghi chú, NCC và trường bổ sung.', old.code, old.order_codes
        using errcode = '22023';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and coalesce(current_setting('app.plan_ordering', true), '') <> 'on' then
    raise exception 'Không đổi trạng thái kế hoạch bằng tay: tích chọn ở cột đầu để tạo đơn' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'planned';
    new.ordered_at := null;
    new.ordered_by := null;
    new.order_count := 0;
    new.order_codes := null;
    new.order_pickup_date := null;
  end if;
  return new;
end;
$$;
create trigger trg_transport_plans_before_write before insert or update on public.transport_plans
for each row execute function private.transport_plans_before_write();

alter table public.transport_plans enable row level security;
select private.apply_module_policies('transport_plans', 'dispatch');
revoke all on public.transport_plans from anon;
grant select, insert, update, delete on public.transport_plans to authenticated;

-- Trường bổ sung cho kế hoạch (module "transport_plans")
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
    when 'leaves' then 'leave_requests'
    when 'purchase_requests' then 'purchase_requests'
    when 'purchase_request_types' then 'purchase_request_types'
    when 'tasks' then 'tasks'
    when 'transport_plans' then 'transport_plans'
  end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Chuyến: thông tin mang từ kế hoạch (cũng nhập được khi tạo/sửa đơn ở Điều phối)
-- -----------------------------------------------------------------------------
alter table public.shipments
  add column if not exists plan_id uuid references public.transport_plans (id),
  add column if not exists trip_order smallint check (trip_order between 1 and 99),
  add column if not exists empty_return_location_id uuid references public.locations (id),
  add column if not exists offroute_return_location_id uuid references public.locations (id),
  add column if not exists pickup_phone text check (pickup_phone is null or length(pickup_phone) <= 30),
  add column if not exists delivery_phone text check (delivery_phone is null or length(delivery_phone) <= 30);
comment on column public.shipments.trip_order is 'Thứ tự chuyến (từ kế hoạch hoặc điều phối nhập): tài xế phải nhận chuyến theo đúng thứ tự trong ngày';
comment on column public.shipments.offroute_return_location_id is 'Điểm hạ rỗng trái tuyến';
comment on column public.shipments.pickup_phone is 'SĐT điểm nhận riêng cho chuyến (trống = SĐT của địa điểm)';
create index if not exists shipments_plan_idx on public.shipments (plan_id) where plan_id is not null;

create or replace function public.create_transport_order(p_order jsonb, p_shipments jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  o public.transport_orders;
  item jsonb;
  v_seq integer;
  v_pickup_at timestamptz;
  v_on date;
  v_pickup uuid;
  v_delivery uuid;
  v_vtype uuid;
  v_route public.routes;
  v_pl record;
  v_top record;
  v_n integer;
  v_tied boolean;
  v_unit_price numeric;
  v_pricing_unit text;
  v_surcharge numeric;
  v_rate numeric;
  v_base text;
  v_fuel_amount numeric;
  v_rule public.fuel_support_rules;
  v_rule_id uuid;
  v_fuel_source text;
  v_norm numeric;
  v_snapshot jsonb;
  v_new public.shipments;
  v_driver uuid;
  v_vehicle uuid;
  v_out jsonb := '[]'::jsonb;
  v_idx integer := 0;
begin
  if not private.has_perm('dispatch.create') then
    raise exception 'Bạn không có quyền tạo đơn hàng' using errcode = '42501';
  end if;
  if jsonb_typeof(p_shipments) <> 'array' or jsonb_array_length(p_shipments) = 0 then
    raise exception 'Đơn hàng phải có ít nhất một chuyến' using errcode = '22023';
  end if;
  if jsonb_array_length(p_shipments) > 100 then
    raise exception 'Mỗi lần chỉ tạo tối đa 100 chuyến' using errcode = '22023';
  end if;

  if p_order ? 'id' then
    select * into o from public.transport_orders where id = (p_order ->> 'id')::uuid for update;
    if o.id is null then
      raise exception 'Không tìm thấy đơn hàng' using errcode = 'P0001';
    end if;
    if o.status <> 'open' then
      raise exception 'Đơn hàng đã hoàn thành hoặc đã hủy, không thêm chuyến được' using errcode = '22023';
    end if;
  else
    insert into public.transport_orders (order_date, company_entity_id, customer_id, payer_customer_id, dispatcher_id, notes, custom_fields)
    values (
      coalesce((p_order ->> 'order_date')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
      nullif(p_order ->> 'company_entity_id', '')::uuid,
      (p_order ->> 'customer_id')::uuid,
      coalesce(nullif(p_order ->> 'payer_customer_id', '')::uuid, (p_order ->> 'customer_id')::uuid),
      auth.uid(),
      nullif(trim(p_order ->> 'notes'), ''),
      case when jsonb_typeof(p_order -> 'custom_fields') = 'object' then p_order -> 'custom_fields' else '{}'::jsonb end
    )
    returning * into o;
  end if;

  select coalesce(max(sequence_in_order), 0) into v_seq from public.shipments where order_id = o.id;

  for item in select * from jsonb_array_elements(p_shipments) loop
    v_idx := v_idx + 1;
    v_seq := v_seq + 1;
    v_pickup_at := (item ->> 'pickup_at')::timestamptz;
    if v_pickup_at is null then
      raise exception 'Chuyến %: chưa nhập thời gian nhận hàng', v_idx using errcode = '22023';
    end if;
    v_on := (v_pickup_at at time zone 'Asia/Ho_Chi_Minh')::date;
    v_pickup := nullif(item ->> 'pickup_location_id', '')::uuid;
    v_delivery := nullif(item ->> 'delivery_location_id', '')::uuid;
    v_vtype := nullif(item ->> 'vehicle_type_id', '')::uuid;
    if v_pickup is null or v_delivery is null then
      raise exception 'Chuyến %: chưa chọn điểm nhận hoặc điểm giao', v_idx using errcode = '22023';
    end if;
    select * into v_route from public.routes r
    where r.pickup_location_id = v_pickup and r.delivery_location_id = v_delivery and r.is_active;

    -- Bảng giá: ứng viên tốt nhất; nếu hai dòng đầu ngang nhau thì người dùng phải chọn
    select count(*) into v_n from private.price_candidates(o.customer_id, v_pickup, v_delivery, v_vtype, v_on);
    select * into v_top from private.price_candidates(o.customer_id, v_pickup, v_delivery, v_vtype, v_on) limit 1;
    select count(*) > 1 into v_tied from private.price_candidates(o.customer_id, v_pickup, v_delivery, v_vtype, v_on) c
    where c.specificity = v_top.specificity and c.priority = v_top.priority;

    select * into v_pl from private.price_candidates(o.customer_id, v_pickup, v_delivery, v_vtype, v_on) c where false;
    if nullif(item ->> 'price_list_id', '') is not null then
      select * into v_pl from private.price_candidates(o.customer_id, v_pickup, v_delivery, v_vtype, v_on) c
      where c.id = (item ->> 'price_list_id')::uuid;
      if v_pl.id is null then
        raise exception 'Chuyến %: bảng giá đã chọn không áp dụng cho chuyến này', v_idx using errcode = '22023';
      end if;
    elsif v_n > 0 then
      if v_tied then
        raise exception 'Chuyến %: có nhiều bảng giá ngang nhau, vui lòng chọn một bảng giá', v_idx using errcode = '22023';
      end if;
      v_pl := v_top;
    end if;

    if v_pl.id is not null then
      v_unit_price := v_pl.unit_price;
      v_pricing_unit := v_pl.pricing_unit;
      v_surcharge := coalesce(nullif(item ->> 'surcharge_amount', '')::numeric, v_pl.surcharge_amount, 0);
    else
      -- Không có bảng giá: điều phối nhập giá thủ công
      -- Chưa biết giá (chạy trước, tính giá sau): lưu 0 và đánh dấu chưa có giá, nhập sau ở bảng chuyến
      v_unit_price := coalesce(nullif(item ->> 'unit_price', '')::numeric, 0);
      v_pricing_unit := coalesce(nullif(item ->> 'pricing_unit', ''), 'trip');
      v_surcharge := coalesce(nullif(item ->> 'surcharge_amount', '')::numeric, 0);
    end if;

    -- Hỗ trợ dầu: nhập tay trên chuyến > bảng giá > quy tắc
    v_rule_id := null;
    v_fuel_amount := 0;
    if nullif(item ->> 'fuel_support_rate', '') is not null then
      v_rate := (item ->> 'fuel_support_rate')::numeric;
      v_base := 'freight_revenue';
      v_fuel_source := 'manual';
    elsif v_pl.id is not null and v_pl.fuel_support_rate is not null then
      v_rate := v_pl.fuel_support_rate;
      v_base := 'freight_revenue';
      v_fuel_source := 'price_list';
    else
      v_rule := private.fuel_rule_for(o.customer_id, v_route.id, v_vtype, v_on);
      if v_rule.id is null then
        v_rate := null;
        v_base := null;
        v_fuel_source := 'none';
      else
        v_rule_id := v_rule.id;
        v_rate := v_rule.rate_percent;
        v_base := v_rule.calculation_base;
        v_fuel_source := 'rule:' || v_rule.scope_type;
        if v_base = 'fuel_norm' then
          -- Định mức xe (nếu đã chọn xe) hoặc của quy tắc × quãng đường tuyến × giá dầu tham chiếu
          select coalesce(v.fuel_norm_l_per_100km, v_rule.fuel_norm_l_per_100km) into v_norm
          from (select 1) x left join public.vehicles v on v.id = nullif(item ->> 'vehicle_id', '')::uuid;
          v_fuel_amount := coalesce(round(v_route.distance_km * v_norm / 100 * v_rule.reference_fuel_price, 0), 0);
        end if;
      end if;
    end if;

    v_snapshot := jsonb_build_object(
      'quoted_at', now(),
      'price_source', case when v_pl.id is not null then 'price_list' when nullif(item ->> 'unit_price', '') is null then 'pending' else 'manual' end,
      'price_list_code', v_pl.code,
      'price_specificity', v_pl.specificity,
      'price_priority', v_pl.priority,
      'route_name', v_route.name,
      'route_distance_km', v_route.distance_km,
      'fuel_source', v_fuel_source,
      'fuel_rate', v_rate,
      'fuel_base', v_base
    );

    v_driver := nullif(item ->> 'driver_id', '')::uuid;
    v_vehicle := nullif(item ->> 'vehicle_id', '')::uuid;

    insert into public.shipments (
      order_id, sequence_in_order, pickup_at, expected_delivery_at, pickup_location_id, delivery_location_id,
      route_id, vehicle_type_id, vehicle_id, price_list_id, unit_price, pricing_unit, quantity, surcharge_amount,
      fuel_support_rate, fuel_support_base, fuel_support_amount, fuel_support_rule_id, pricing_snapshot, notes, custom_fields,
      plan_id, trip_order, empty_return_location_id, offroute_return_location_id, pickup_phone, delivery_phone
    ) values (
      o.id, v_seq, v_pickup_at, nullif(item ->> 'expected_delivery_at', '')::timestamptz, v_pickup, v_delivery,
      v_route.id, v_vtype, v_vehicle, v_pl.id, v_unit_price, v_pricing_unit,
      coalesce(nullif(item ->> 'quantity', '')::numeric, 1), v_surcharge,
      v_rate, v_base, v_fuel_amount, v_rule_id, v_snapshot, nullif(trim(item ->> 'notes'), ''),
      case when jsonb_typeof(item -> 'custom_fields') = 'object' then item -> 'custom_fields' else '{}'::jsonb end,
      nullif(item ->> 'plan_id', '')::uuid,
      nullif(item ->> 'trip_order', '')::smallint,
      nullif(item ->> 'empty_return_location_id', '')::uuid,
      nullif(item ->> 'offroute_return_location_id', '')::uuid,
      nullif(trim(item ->> 'pickup_phone'), ''),
      nullif(trim(item ->> 'delivery_phone'), '')
    )
    returning * into v_new;

    if v_driver is not null then
      perform public.assign_shipment(v_new.id, v_driver, v_vehicle);
    end if;

    v_out := v_out || jsonb_build_object('id', v_new.id, 'shipment_code', v_new.shipment_code);
  end loop;

  return jsonb_build_object('order_id', o.id, 'order_code', o.order_code, 'shipments', v_out);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Tích chọn kế hoạch → tạo đơn trong Điều phối: mỗi cont một đơn hàng (một chuyến)
-- -----------------------------------------------------------------------------
create or replace function public.plan_create_orders(p_plan_id uuid, p_pickup_date date default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  p public.transport_plans;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_day date;
  v_res jsonb;
  v_codes text[] := '{}';
  v_ids uuid[] := '{}';
  i integer;
begin
  if not private.has_perm('dispatch.create') then
    raise exception 'Bạn không có quyền tạo đơn hàng' using errcode = '42501';
  end if;
  select * into p from public.transport_plans where id = p_plan_id for update;
  if p.id is null then
    raise exception 'Không tìm thấy kế hoạch' using errcode = 'P0001';
  end if;
  if p.status = 'ordered' then
    raise exception 'Kế hoạch % đã tạo đơn: %', p.code, p.order_codes using errcode = '22023';
  end if;
  v_day := coalesce(p_pickup_date, p.delivery_date, v_today);
  for i in 1 .. p.container_qty loop
    v_res := public.create_transport_order(
      jsonb_build_object(
        'customer_id', p.customer_id,
        'payer_customer_id', coalesce(p.payer_customer_id, p.customer_id),
        'order_date', v_today,
        'notes', concat_ws(' · ', 'Từ kế hoạch ' || p.code || case when p.container_qty > 1 then ' (cont ' || i || '/' || p.container_qty || ')' else '' end, p.notes),
        'custom_fields', '{}'::jsonb
      ),
      jsonb_build_array(jsonb_build_object(
        'pickup_at', (v_day::timestamp at time zone 'Asia/Ho_Chi_Minh'),
        'expected_delivery_at', case when p.delivery_date >= v_day
          then ((p.delivery_date::timestamp + interval '23 hours 59 minutes 59 seconds') at time zone 'Asia/Ho_Chi_Minh') end,
        'pickup_location_id', p.pickup_location_id,
        'delivery_location_id', p.delivery_location_id,
        'vehicle_type_id', p.vehicle_type_id,
        'quantity', 1,
        'notes', p.notes,
        'plan_id', p.id,
        'trip_order', p.trip_order,
        'empty_return_location_id', p.empty_return_location_id,
        'offroute_return_location_id', p.offroute_return_location_id,
        'pickup_phone', p.pickup_phone,
        'delivery_phone', p.delivery_phone
      ))
    );
    v_codes := v_codes || (v_res ->> 'order_code');
    v_ids := v_ids || (v_res ->> 'order_id')::uuid;
  end loop;

  perform set_config('app.plan_ordering', 'on', true);
  update public.transport_plans
     set status = 'ordered', ordered_at = now(), ordered_by = auth.uid(),
         order_count = p.container_qty, order_codes = array_to_string(v_codes, ', '), order_pickup_date = v_day
   where id = p.id;
  perform set_config('app.plan_ordering', 'off', true);

  return jsonb_build_object('plan_code', p.code, 'count', p.container_qty, 'order_codes', to_jsonb(v_codes), 'order_ids', to_jsonb(v_ids));
end;
$$;
revoke all on function public.plan_create_orders(uuid, date) from public, anon;
grant execute on function public.plan_create_orders(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Danh sách chuyến: thêm thứ tự chuyến, hạ rỗng, hạ rỗng trái tuyến, kế hoạch (cột mới ở cuối view)
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
     and private.can_approve(s.dispatch_approval_request_id)) as can_approve_dispatch,
  coalesce(ft.transport_fee, s.freight_amount + s.surcharge_amount + s.fuel_support_amount) as transport_fee,
  coalesce(ft.pass_through_fee, 0) as pass_through_fee,
  coalesce(ft.declaration_fee, 0) as declaration_fee,
  coalesce(ft.loading_fee, 0) as loading_fee,
  coalesce(ft.other_fee, 0) as other_fee,
  pl.name || ' → ' || dl.name as route_label,
  s.trip_order,
  s.empty_return_location_id, er.name as empty_return_name,
  s.offroute_return_location_id, orl.name as offroute_return_name,
  s.plan_id, tp.code as plan_code,
  coalesce(s.pickup_phone, pl.phone) as pickup_phone,
  coalesce(s.delivery_phone, dl.phone) as delivery_phone
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.customer_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicle_types vt on vt.id = s.vehicle_type_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
left join public.locations er on er.id = s.empty_return_location_id
left join public.locations orl on orl.id = s.offroute_return_location_id
left join public.transport_plans tp on tp.id = s.plan_id
left join lateral (select * from public.shipment_fee_role_totals t where t.shipment_id = s.id) ft on true;

-- -----------------------------------------------------------------------------
-- 5. Ứng dụng tài xế: SĐT điểm nhận/giao, hạ rỗng, thứ tự chuyến và chặn nhận sai thứ tự
-- -----------------------------------------------------------------------------
-- Thứ tự chuyến dùng cho tài xế: thứ tự của xe trong ngày (điều phối nhập) hoặc thứ tự từ kế hoạch
create or replace function private.trip_rank(p public.shipments)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select coalesce(p.vehicle_day_order, p.trip_order);
$$;

-- Chuyến cùng xe, cùng ngày nhận, còn chờ nhận và có thứ tự nhỏ hơn: tài xế phải nhận chuyến đó trước
create or replace function private.trip_waiting_before(p_vehicle_id uuid, p public.shipments)
returns table (shipment_code text, rank smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select s2.shipment_code, private.trip_rank(s2)
  from public.shipments s2
  where private.trip_rank(p) is not null
    and s2.id <> p.id
    and s2.status = 'assigned'
    and private.driver_link_visible(p_vehicle_id, s2)
    and (s2.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date = (p.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date
    and private.trip_rank(s2) < private.trip_rank(p)
  order by private.trip_rank(s2), s2.pickup_at
  limit 1;
$$;
revoke all on function private.trip_waiting_before(uuid, public.shipments) from public, anon, authenticated;

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
  expense_total numeric,
  outsourced boolean,
  vehicle_day_order smallint,
  trip_rank smallint,
  wait_for_code text,
  wait_for_rank smallint,
  empty_return_name text,
  empty_return_address text,
  offroute_return_name text,
  offroute_return_address text
)
language sql
security definer
set search_path = ''
as $$
  select s.id, s.shipment_code, s.status, s.pickup_at, s.expected_delivery_at,
         v.plate_number, vt.name, s.quantity, s.notes,
         pl.name, pl.full_address, pl.contact_name, coalesce(s.pickup_phone, pl.phone),
         coalesce(pl.google_maps_url, case when pl.latitude is not null then
           'https://www.google.com/maps/search/?api=1&query=' || pl.latitude || ',' || pl.longitude end),
         pl.gate_instructions,
         dl.name, dl.full_address, dl.contact_name, coalesce(s.delivery_phone, dl.phone),
         coalesce(dl.google_maps_url, case when dl.latitude is not null then
           'https://www.google.com/maps/search/?api=1&query=' || dl.latitude || ',' || dl.longitude end),
         dl.gate_instructions,
         d.full_name, a.responded_at, s.departed_pickup_at, s.completed_at, s.delivery_result,
         (select count(*) from public.documents doc
           where doc.entity_type = 'shipment' and doc.entity_id = s.id and doc.archived_at is null),
         s.expense_declaration,
         (select count(*) from public.shipment_expenses e where e.shipment_id = s.id and e.source = 'driver' and e.status in ('pending', 'approved')),
         (select coalesce(sum(e.amount), 0) from public.shipment_expenses e where e.shipment_id = s.id and e.source = 'driver' and e.status in ('pending', 'approved')),
         coalesce(v.ownership_type = 'outsourced', false),
         s.vehicle_day_order,
         private.trip_rank(s),
         w.shipment_code, w.rank,
         er.name, er.full_address,
         orl.name, orl.full_address
  from private.driver_link_session(p_token) me
  join public.shipments s on private.driver_link_visible(me.vehicle_id, s)
  join public.drivers d on d.id = s.driver_id
  join public.locations pl on pl.id = s.pickup_location_id
  join public.locations dl on dl.id = s.delivery_location_id
  left join public.locations er on er.id = s.empty_return_location_id
  left join public.locations orl on orl.id = s.offroute_return_location_id
  left join public.vehicles v on v.id = s.vehicle_id
  left join public.vehicle_types vt on vt.id = s.vehicle_type_id
  left join public.shipment_assignments a
    on a.shipment_id = s.id and a.driver_id = s.driver_id and a.response = 'accepted'
  left join lateral (select * from private.trip_waiting_before(me.vehicle_id, s) where s.status = 'assigned') w on true
  where (s.status in ('assigned', 'accepted', 'in_transit')
     or (s.status in ('driver_completed', 'closed') and s.pickup_at > now() - interval '3 days'))
  order by (s.status in ('driver_completed', 'closed')), (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date,
           private.trip_rank(s) nulls last, (s.status = 'in_transit') desc, s.pickup_at
  limit 100;
$$;
revoke all on function public.driver_link_trips(text) from public;
grant execute on function public.driver_link_trips(text) to anon, authenticated;

create or replace function public.driver_link_accept(p_token text, p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_s public.shipments;
  v_a public.shipment_assignments;
  v_name text;
  v_wait record;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  select * into v_s from public.shipments where id = p_shipment_id for update;
  if v_s.id is null or not private.driver_link_visible(v_me.vehicle_id, v_s) then
    return jsonb_build_object('ok', false, 'error', 'Chuyến này không còn được phân công cho xe của bạn. Tải lại trang để xem.');
  end if;
  if v_s.status = 'accepted' then
    return jsonb_build_object('ok', true);
  end if;
  if v_s.status <> 'assigned' then
    return jsonb_build_object('ok', false, 'error', 'Chuyến không còn ở trạng thái chờ nhận.');
  end if;
  -- Nhận đúng thứ tự chuyến trong ngày
  select * into v_wait from private.trip_waiting_before(v_me.vehicle_id, v_s);
  if v_wait.shipment_code is not null then
    return jsonb_build_object('ok', false, 'error',
      'Phải nhận chuyến thứ ' || v_wait.rank || ' (' || v_wait.shipment_code || ') trước, rồi mới nhận chuyến thứ ' || private.trip_rank(v_s) || '.');
  end if;
  select * into v_a from public.shipment_assignments
   where shipment_id = v_s.id and driver_id = v_s.driver_id and response = 'pending' for update;
  if v_a.id is null then
    return jsonb_build_object('ok', false, 'error', 'Chuyến không còn ở trạng thái chờ nhận.');
  end if;

  update public.shipment_assignments set response = 'accepted', responded_at = now() where id = v_a.id;
  update public.shipments set status = 'accepted' where id = v_s.id;

  select full_name into v_name from public.drivers where id = v_s.driver_id;
  update public.shipment_status_history h
     set note = v_name || ' nhận chuyến trên điện thoại'
   where h.id = (select max(id) from public.shipment_status_history
                  where shipment_id = v_s.id and status_field = 'status' and to_status = 'accepted');

  if v_a.assigned_by is not null then
    insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
    values (v_a.assigned_by, 'shipment_accepted', 'Tài xế ' || v_name || ' đã nhận chuyến ' || v_s.shipment_code,
            null, 'shipment', v_s.id, '/chuyen-xe/' || v_s.id);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.driver_link_accept(text, uuid) from public;
grant execute on function public.driver_link_accept(text, uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Xóa dữ liệu thử: xóa cả kế hoạch
-- -----------------------------------------------------------------------------
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
$$;

revoke all on function public.purge_test_data(text, text) from public, anon;
grant execute on function public.purge_test_data(text, text) to authenticated;
