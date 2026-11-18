-- =============================================================================
-- GHA TMS - 9022: Bảng giá xe tải (ma trận km × tấn) và bảng giá xe cont lấy từ chuyến đã chạy
--   LE yêu cầu 18/11/2026.
--   1. truck_rate_cards: bảng giá xe tải theo mẫu file BANG_GIA_NOI_BO.xlsx
--        - Bảng cước: khoảng km (dòng) × trọng tải (cột); giá trong file ĐÃ cộng hỗ trợ dầu (vd 20%)
--        - Phí bốc xếp theo trọng tải
--        - Hệ số hỗ trợ dầu theo giá dầu (VNĐ/lít)
--      Đơn giá chưa dầu = Giá trong bảng / (1 + % dầu đã cộng / 100); Cước = Đơn giá × (1 + % dầu / 100).
--   2. container_price_lists: bảng giá xe cont theo Khách hàng + Điểm nhận + Điểm giao + Điểm hạ rỗng + cỡ cont,
--      đơn giá CHƯA hỗ trợ dầu. Tạo/cập nhật từ các chuyến cont đã chạy (container_prices_from_trips + upsert_container_prices).
--   Giá nội bộ: chỉ người có quyền price_lists.view; tài khoản khách hàng (customer scoped) không đọc được.
--   Chạy lại nhiều lần được.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Bảng giá xe tải
-- -----------------------------------------------------------------------------
create table if not exists public.truck_rate_cards (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  name text not null check (length(trim(name)) between 1 and 200),
  customer_id uuid references public.customers (id),
  fuel_pct_included numeric(6, 2) not null default 0 check (fuel_pct_included between 0 and 100),
  -- [{"from_km":0,"to_km":15,"label":"Từ 0 - 15 KM"}, ...] (tăng dần)
  distance_bands jsonb not null default '[]'::jsonb check (jsonb_typeof(distance_bands) = 'array'),
  -- [{"from_ton":0,"to_ton":2.5,"label":"Dưới 2.5 tấn","loading_fee":150000}, ...] (tăng dần)
  weight_bands jsonb not null default '[]'::jsonb check (jsonb_typeof(weight_bands) = 'array'),
  -- prices[i][j] = giá của khoảng km i, trọng tải j (null = chưa có giá)
  prices jsonb not null default '[]'::jsonb check (jsonb_typeof(prices) = 'array'),
  -- [{"from_price":19250,"to_price":21999,"factor":1}, ...]
  fuel_bands jsonb not null default '[]'::jsonb check (jsonb_typeof(fuel_bands) = 'array'),
  effective_from date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  effective_to date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text check (notes is null or length(notes) <= 2000),
  source_file text check (source_file is null or length(source_file) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check (effective_to is null or effective_to >= effective_from),
  check (jsonb_array_length(prices) = jsonb_array_length(distance_bands))
);
comment on table public.truck_rate_cards is 'Bảng giá xe tải (nội bộ): cước theo khoảng km × trọng tải, phí bốc xếp theo trọng tải, hệ số hỗ trợ dầu theo giá dầu';
comment on column public.truck_rate_cards.fuel_pct_included is '% hỗ trợ dầu đã cộng sẵn trong giá của bảng cước (đơn giá chưa dầu = giá / (1 + %/100))';
comment on column public.truck_rate_cards.customer_id is 'Trống = bảng giá nội bộ dùng chung';

drop trigger if exists trg_truck_rate_cards_updated_at on public.truck_rate_cards;
drop trigger if exists trg_truck_rate_cards_actor on public.truck_rate_cards;
select private.attach_standard_triggers('public.truck_rate_cards');
drop trigger if exists trg_truck_rate_cards_code on public.truck_rate_cards;
create trigger trg_truck_rate_cards_code before insert on public.truck_rate_cards
  for each row execute function private.fill_master_code('BGXT');
drop trigger if exists trg_truck_rate_cards_audit on public.truck_rate_cards;
create trigger trg_truck_rate_cards_audit after insert or update or delete on public.truck_rate_cards
  for each row execute function private.audit_row_change('id');

-- -----------------------------------------------------------------------------
-- 2. Bảng giá xe cont
-- -----------------------------------------------------------------------------
create table if not exists public.container_price_lists (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  pickup_location_id uuid not null references public.locations (id),
  delivery_location_id uuid not null references public.locations (id),
  empty_return_location_id uuid references public.locations (id),
  container_size text check (container_size is null or container_size in ('20', '40', '45')),
  unit_price numeric(18, 2) not null check (unit_price >= 0),
  fuel_support_rate numeric(6, 3) check (fuel_support_rate is null or fuel_support_rate between 0 and 100),
  carrier_unit_price numeric(18, 2) check (carrier_unit_price is null or carrier_unit_price >= 0),
  source text not null default 'manual' check (source in ('trips', 'manual')),
  trip_count integer not null default 0 check (trip_count >= 0),
  price_min numeric(18, 2),
  price_max numeric(18, 2),
  last_trip_date date,
  last_shipment_code text,
  effective_from date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.container_price_lists is 'Bảng giá xe cont (nội bộ): đơn giá CHƯA hỗ trợ dầu theo khách hàng + tuyến + điểm hạ rỗng + cỡ cont';
comment on column public.container_price_lists.unit_price is 'Đơn giá cước GHA thu khách, chưa hỗ trợ dầu (Cước = Đơn giá × (1 + % dầu/100))';
comment on column public.container_price_lists.fuel_support_rate is '% hỗ trợ dầu của chuyến gần nhất (tham khảo)';
comment on column public.container_price_lists.carrier_unit_price is 'Đơn giá cước 3PL chưa dầu của chuyến gần nhất (chỉ nội bộ)';
create unique index if not exists container_price_lists_key_uq on public.container_price_lists (
  customer_id, pickup_location_id, delivery_location_id,
  coalesce(empty_return_location_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(container_size, '')
);

drop trigger if exists trg_container_price_lists_updated_at on public.container_price_lists;
drop trigger if exists trg_container_price_lists_actor on public.container_price_lists;
select private.attach_standard_triggers('public.container_price_lists');
drop trigger if exists trg_container_price_lists_audit on public.container_price_lists;
create trigger trg_container_price_lists_audit after insert or update or delete on public.container_price_lists
  for each row execute function private.audit_row_change('id');

-- -----------------------------------------------------------------------------
-- 3. Quyền: theo module price_lists; tài khoản khách hàng không xem được giá nội bộ
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['truck_rate_cards', 'container_price_lists'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('drop policy if exists %I on public.%I', t || '_customer_scope', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.has_perm(''price_lists.view'')))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.has_perm(''price_lists.create'')))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.has_perm(''price_lists.update''))) with check ((select private.has_perm(''price_lists.update'')))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.has_perm(''price_lists.delete'')))', t || '_delete', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated using (not (select private.is_customer_scoped()))', t || '_customer_scope', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Lấy giá xe cont từ các chuyến đã chạy
--    Chuyến cont = có số cont hoặc xe là đầu kéo. Đã chạy = đang chạy / tài xế hoàn thành / đã đóng, đơn giá > 0.
--    Mỗi nhóm (khách hàng, điểm nhận, điểm giao, điểm hạ rỗng, cỡ cont) lấy đơn giá của chuyến gần nhất
--    và đơn giá xuất hiện nhiều nhất; kèm giá đang có trong bảng giá để so.
-- -----------------------------------------------------------------------------
create or replace function public.container_prices_from_trips(
  p_from date,
  p_to date,
  p_customer_id uuid default null
)
returns table (
  customer_id uuid, customer_name text,
  pickup_location_id uuid, pickup_name text,
  delivery_location_id uuid, delivery_name text,
  empty_return_location_id uuid, empty_return_name text,
  container_size text,
  trip_count integer,
  last_unit_price numeric, common_unit_price numeric,
  price_min numeric, price_max numeric,
  last_fuel_rate numeric,
  last_carrier_unit_price numeric,
  last_trip_date date, last_shipment_code text,
  current_id uuid, current_unit_price numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.has_perm('price_lists.view') or private.is_customer_scoped() then
    raise exception 'Bạn không có quyền xem bảng giá';
  end if;
  return query
  with t as (
    select s.id, s.shipment_code, s.unit_price, s.fuel_support_rate,
           (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date as trip_date, s.pickup_at,
           o.customer_id, s.pickup_location_id, s.delivery_location_id, s.empty_return_location_id,
           coalesce(tr.trailer_size, case when vt.code ilike '%20%' then '20' when vt.code ilike '%40%' then '40' end) as size_raw,
           (select cc.unit_price from public.shipment_carrier_costs cc
             where cc.shipment_id = s.id and cc.cost_kind = 'freight' and cc.unit_price is not null
             order by cc.line_no limit 1) as carrier_price
    from public.shipments s
    join public.transport_orders o on o.id = s.order_id
    left join public.vehicles v on v.id = s.vehicle_id
    left join public.vehicles tr on tr.id = s.trailer_id
    left join public.vehicle_types vt on vt.id = tr.vehicle_type_id
    where s.status in ('in_transit', 'driver_completed', 'closed')
      and s.unit_price > 0
      and (nullif(btrim(coalesce(s.container_no, '')), '') is not null or v.vehicle_kind = 'tractor')
      and (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
      and (p_customer_id is null or o.customer_id = p_customer_id)
  ), t2 as (
    select t.*, case when t.size_raw in ('20', '40', '45') then t.size_raw end as csize from t
  ), g as (
    select t2.customer_id as g_customer, t2.pickup_location_id as g_pickup, t2.delivery_location_id as g_delivery,
           t2.empty_return_location_id as g_empty, t2.csize as g_size,
           count(*)::integer as n, min(t2.unit_price) as pmin, max(t2.unit_price) as pmax,
           (array_agg(t2.unit_price order by t2.pickup_at desc, t2.shipment_code desc))[1] as last_price,
           (array_agg(t2.fuel_support_rate order by t2.pickup_at desc, t2.shipment_code desc))[1] as last_fuel,
           (array_agg(t2.carrier_price order by t2.pickup_at desc, t2.shipment_code desc) filter (where t2.carrier_price is not null))[1] as last_carrier,
           max(t2.trip_date) as last_date,
           (array_agg(t2.shipment_code order by t2.pickup_at desc, t2.shipment_code desc))[1] as last_code,
           mode() within group (order by t2.unit_price) as common_price
    from t2
    group by 1, 2, 3, 4, 5
  )
  select g.g_customer, c.name::text, g.g_pickup, lp.name::text, g.g_delivery, ld.name::text, g.g_empty, le.name::text, g.g_size,
         g.n, g.last_price, g.common_price, g.pmin, g.pmax, g.last_fuel, g.last_carrier, g.last_date, g.last_code,
         cp.id, cp.unit_price
  from g
  join public.customers c on c.id = g.g_customer
  join public.locations lp on lp.id = g.g_pickup
  join public.locations ld on ld.id = g.g_delivery
  left join public.locations le on le.id = g.g_empty
  left join public.container_price_lists cp
    on cp.customer_id = g.g_customer and cp.pickup_location_id = g.g_pickup and cp.delivery_location_id = g.g_delivery
   and coalesce(cp.empty_return_location_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(g.g_empty, '00000000-0000-0000-0000-000000000000'::uuid)
   and coalesce(cp.container_size, '') = coalesce(g.g_size, '')
  order by c.name, lp.name, ld.name, le.name nulls first, g.g_size nulls first;
end;
$$;
revoke all on function public.container_prices_from_trips(date, date, uuid) from public, anon;
grant execute on function public.container_prices_from_trips(date, date, uuid) to authenticated;

-- Tạo / cập nhật bảng giá xe cont (mỗi phần tử p_rows là một dòng giá; trùng khóa thì cập nhật)
create or replace function public.upsert_container_prices(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r jsonb;
  v_id uuid;
  v_size text;
  v_empty uuid;
  v_ins integer := 0;
  v_upd integer := 0;
begin
  if not private.has_perm('price_lists.update') or not private.has_perm('price_lists.create') then
    raise exception 'Bạn không có quyền cập nhật bảng giá';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Dữ liệu không hợp lệ'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_size := nullif(r ->> 'container_size', '');
    v_empty := nullif(r ->> 'empty_return_location_id', '')::uuid;
    if coalesce((r ->> 'unit_price')::numeric, -1) < 0 then raise exception 'Đơn giá không hợp lệ'; end if;
    select cp.id into v_id from public.container_price_lists cp
     where cp.customer_id = (r ->> 'customer_id')::uuid
       and cp.pickup_location_id = (r ->> 'pickup_location_id')::uuid
       and cp.delivery_location_id = (r ->> 'delivery_location_id')::uuid
       and coalesce(cp.empty_return_location_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_empty, '00000000-0000-0000-0000-000000000000'::uuid)
       and coalesce(cp.container_size, '') = coalesce(v_size, '');
    if v_id is null then
      insert into public.container_price_lists (customer_id, pickup_location_id, delivery_location_id, empty_return_location_id,
        container_size, unit_price, fuel_support_rate, carrier_unit_price, source, trip_count, price_min, price_max,
        last_trip_date, last_shipment_code, effective_from, notes)
      values ((r ->> 'customer_id')::uuid, (r ->> 'pickup_location_id')::uuid, (r ->> 'delivery_location_id')::uuid, v_empty,
        v_size, (r ->> 'unit_price')::numeric, nullif(r ->> 'fuel_support_rate', '')::numeric, nullif(r ->> 'carrier_unit_price', '')::numeric,
        coalesce(nullif(r ->> 'source', ''), 'trips'), coalesce(nullif(r ->> 'trip_count', '')::integer, 0),
        nullif(r ->> 'price_min', '')::numeric, nullif(r ->> 'price_max', '')::numeric,
        nullif(r ->> 'last_trip_date', '')::date, nullif(r ->> 'last_shipment_code', ''),
        coalesce(nullif(r ->> 'effective_from', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date), nullif(r ->> 'notes', ''));
      v_ins := v_ins + 1;
    else
      update public.container_price_lists cp set
        unit_price = (r ->> 'unit_price')::numeric,
        fuel_support_rate = coalesce(nullif(r ->> 'fuel_support_rate', '')::numeric, cp.fuel_support_rate),
        carrier_unit_price = coalesce(nullif(r ->> 'carrier_unit_price', '')::numeric, cp.carrier_unit_price),
        source = coalesce(nullif(r ->> 'source', ''), 'trips'),
        trip_count = coalesce(nullif(r ->> 'trip_count', '')::integer, cp.trip_count),
        price_min = coalesce(nullif(r ->> 'price_min', '')::numeric, cp.price_min),
        price_max = coalesce(nullif(r ->> 'price_max', '')::numeric, cp.price_max),
        last_trip_date = coalesce(nullif(r ->> 'last_trip_date', '')::date, cp.last_trip_date),
        last_shipment_code = coalesce(nullif(r ->> 'last_shipment_code', ''), cp.last_shipment_code),
        effective_from = case when cp.unit_price is distinct from (r ->> 'unit_price')::numeric
                              then coalesce(nullif(r ->> 'effective_from', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date)
                              else cp.effective_from end,
        status = 'active'
      where cp.id = v_id;
      v_upd := v_upd + 1;
    end if;
    v_id := null;
  end loop;
  return jsonb_build_object('inserted', v_ins, 'updated', v_upd);
end;
$$;
revoke all on function public.upsert_container_prices(jsonb) from public, anon;
grant execute on function public.upsert_container_prices(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Dữ liệu mẫu: bảng giá nội bộ xe tải từ file BANG_GIA_NOI_BO.xlsx (chỉ thêm khi chưa có bảng nào)
-- -----------------------------------------------------------------------------
insert into public.truck_rate_cards (name, fuel_pct_included, distance_bands, weight_bands, prices, fuel_bands, effective_from, notes, source_file)
select 'Bảng giá vận chuyển xe tải nội bộ (đã gồm hỗ trợ dầu 20%)', 20,
  '[{"from_km":0,"to_km":15,"label":"Từ 0 - 15 KM"},
    {"from_km":15.001,"to_km":25,"label":"Từ 15 - 25 KM"},
    {"from_km":25.001,"to_km":35,"label":"Từ 25 - 35 KM"},
    {"from_km":35.001,"to_km":45,"label":"Từ 35 - 45 KM"},
    {"from_km":45.001,"to_km":55,"label":"Từ 45 - 55 KM"},
    {"from_km":55.001,"to_km":65,"label":"Từ 55 - 65 KM"},
    {"from_km":65.001,"to_km":75,"label":"Từ 65 - 75 KM"},
    {"from_km":75.001,"to_km":85,"label":"Từ 75 - 85 KM"},
    {"from_km":85.001,"to_km":95,"label":"Từ 85 - 95 KM"},
    {"from_km":95.001,"to_km":105,"label":"Từ 95 - 105 KM"},
    {"from_km":105.001,"to_km":120,"label":"Từ 105 - 120 KM"}]'::jsonb,
  '[{"from_ton":0,"to_ton":2.5,"label":"Dưới 2.5 tấn","loading_fee":150000},
    {"from_ton":2.501,"to_ton":3.5,"label":"2.5 - 3.5 tấn","loading_fee":150000},
    {"from_ton":3.501,"to_ton":5,"label":"3.5 - 5.0 tấn","loading_fee":250000},
    {"from_ton":5.001,"to_ton":6,"label":"5.0 tấn - 6.0 tấn","loading_fee":300000},
    {"from_ton":6.001,"to_ton":8,"label":"6.0 tấn - 8.0 tấn","loading_fee":350000},
    {"from_ton":8.001,"to_ton":10,"label":"8.0 tấn - 10 tấn","loading_fee":400000},
    {"from_ton":10.001,"to_ton":15,"label":"10 tấn - 15 tấn","loading_fee":450000},
    {"from_ton":15.001,"to_ton":20,"label":"15 tấn - 20 tấn","loading_fee":700000}]'::jsonb,
  '[[750000,950000,1000000,1150000,1250000,1650000,1950000,2400000],
    [850000,1050000,1150000,1350000,1450000,1850000,2150000,2600000],
    [950000,1150000,1390000,1600000,1900000,2150000,2450000,2900000],
    [1050000,1250000,1450000,1850000,1950000,2350000,2650000,3100000],
    [1150000,1350000,1600000,1950000,2050000,2550000,2850000,3300000],
    [1250000,1450000,1750000,2150000,2250000,2750000,3050000,3500000],
    [1350000,1550000,1900000,2350000,2450000,3150000,3450000,3900000],
    [1500000,1700000,2100000,2550000,2750000,3550000,3850000,4300000],
    [1700000,1900000,2300000,2850000,3050000,3850000,4150000,4600000],
    [1900000,2100000,2500000,3150000,3350000,4250000,4550000,5000000],
    [2100000,2300000,2650000,3350000,3650000,4550000,4850000,5300000]]'::jsonb,
  '[{"from_price":19250,"to_price":21999,"factor":1},
    {"from_price":22000,"to_price":25999,"factor":1.08},
    {"from_price":26000,"to_price":30999,"factor":1.12},
    {"from_price":31000,"to_price":34999,"factor":1.2},
    {"from_price":35000,"to_price":38999,"factor":1.25},
    {"from_price":39000,"to_price":42999,"factor":1.3},
    {"from_price":43000,"to_price":46999,"factor":1.35},
    {"from_price":47000,"to_price":50999,"factor":1.4}]'::jsonb,
  date '2026-11-01',
  'Nhập từ file BANG_GIA_NOI_BO.xlsx (sheet BẢNG GIÁ XE TẢI (2)). Giá trong bảng đã gồm hỗ trợ dầu 20%, tương ứng giá dầu 31,000 - 34,999 đ/lít.',
  'BANG_GIA_NOI_BO.xlsx'
where not exists (select 1 from public.truck_rate_cards);
