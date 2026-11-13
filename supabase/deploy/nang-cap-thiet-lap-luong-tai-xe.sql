-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Thiết lập lương tài xế: đơn giá lương chuyến, vùng lương, khoản lương, hình thức lương
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.trip_pay_rates') is not null then
    raise exception 'CSDL đã được nâng cấp Thiết lập lương tài xế: đơn giá lương chuyến, vùng lương, khoản lương, hình thức lương trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261108000062_driver_pay_setup.sql
-- =============================================================================
-- 0062: Thiết lập lương tài xế (đợt 1)
-- Người dùng 08/11/2026 gửi bảng lương tài xế cont T9/2026: lương chuyến theo
-- tuyến (điểm lấy cont ↔ điểm giao), lương cơ bản, nhiều phụ cấp, thưởng vượt chuyến.
--   * pay_zones: Vùng lương (Long An, Bến Tre...), gán cho từng Địa điểm.
--   * trip_pay_rates: Đơn giá lương chuyến. App tra theo thứ tự cụ thể nhất:
--     tài xế riêng > tuyến (2 điểm, tính cả chiều ngược lại) > một địa điểm
--     > vùng > mặc định; loại cont (20/40) là điều kiện thêm; hiệu lực theo ngày.
--   * pay_components: Danh mục khoản lương (cách tính: cố định tháng, theo
--     ngày công, theo chuyến, thưởng vượt chuyến, nhập tay), cộng hoặc trừ.
--   * driver_pay_components: mức của từng khoản cho từng tài xế, có hiệu lực.
--   * drivers.pay_type: Hình thức lương (cơ bản + chuyến / chỉ chuyến / chỉ tháng).
--   * payroll_compute: tính theo các thiết lập trên. Tài xế chưa có dòng mức
--     lương nào vẫn tính như cũ (4 ô lương trong hồ sơ tài xế); chuyến không
--     khớp đơn giá nào dùng "Lương theo chuyến" cũ trong hồ sơ, không có thì báo
--     "chưa có đơn giá".
-- Ngày công đợt này = số ngày có chuyến hoàn thành; đợt 2 thay bằng bảng chấm công.
-- Chạy lại nhiều lần không lỗi (kiểm thử chạy lại tệp này).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Vùng lương
-- -----------------------------------------------------------------------------
create table if not exists public.pay_zones (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  name text not null check (length(trim(name)) between 1 and 150),
  description text check (description is null or length(description) <= 500),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.pay_zones is 'Vùng lương: nhóm địa điểm cùng đơn giá lương chuyến (Long An, Bến Tre, Bà Rịa Vũng Tàu...)';

alter table public.locations add column if not exists pay_zone_id uuid references public.pay_zones (id);
comment on column public.locations.pay_zone_id is 'Vùng lương của địa điểm: dùng tra đơn giá lương chuyến khi không có giá riêng cho tuyến';
create index if not exists locations_pay_zone_idx on public.locations (pay_zone_id) where pay_zone_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Đơn giá lương chuyến
-- -----------------------------------------------------------------------------
create table if not exists public.trip_pay_rates (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  name text check (name is null or length(name) <= 250),
  driver_id uuid references public.drivers (id),
  location_a_id uuid references public.locations (id),
  location_b_id uuid references public.locations (id),
  zone_id uuid references public.pay_zones (id),
  vehicle_type_id uuid references public.vehicle_types (id),
  amount numeric(18,2) not null check (amount >= 0),
  effective_from date not null default date '2020-01-01',
  effective_to date,
  is_active boolean not null default true,
  notes text check (notes is null or length(notes) <= 1000),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  constraint trip_pay_rates_dates check (effective_to is null or effective_to >= effective_from),
  constraint trip_pay_rates_b_needs_a check (location_b_id is null or location_a_id is not null),
  constraint trip_pay_rates_zone_or_place check (zone_id is null or location_a_id is null)
);
comment on table public.trip_pay_rates is 'Đơn giá lương chuyến: theo tuyến (Điểm 1 ↔ Điểm 2), một địa điểm, vùng hoặc mặc định; tùy chọn theo tài xế, loại cont';
create index if not exists trip_pay_rates_lookup_idx on public.trip_pay_rates (location_a_id, location_b_id, zone_id) where is_active;

-- -----------------------------------------------------------------------------
-- 3. Danh mục khoản lương + mức theo tài xế
-- -----------------------------------------------------------------------------
create table if not exists public.pay_components (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  name text not null check (length(trim(name)) between 1 and 150),
  kind text not null default 'income' check (kind in ('income', 'deduction')),
  method text not null default 'monthly'
    check (method in ('monthly', 'per_workday', 'per_trip', 'trip_rate', 'over_trips', 'manual')),
  threshold integer check (threshold is null or threshold >= 0),
  default_amount numeric(18,2) check (default_amount is null or default_amount >= 0),
  is_system boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  description text check (description is null or length(description) <= 500),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.pay_components is 'Khoản lương tài xế: lương cơ bản, lương chuyến, các phụ cấp, thưởng, khấu trừ; mỗi khoản một cách tính';
comment on column public.pay_components.method is 'monthly: cố định tháng; per_workday: mức × ngày công; per_trip: mức × số chuyến; trip_rate: tổng đơn giá lương chuyến; over_trips: mức × (số chuyến − mốc); manual: nhập tay khi lập bảng lương';
comment on column public.pay_components.default_amount is 'Mức mặc định cho mọi tài xế chưa có mức riêng (để trống = 0)';

create table if not exists public.driver_pay_components (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers (id) on delete cascade,
  component_id uuid not null references public.pay_components (id),
  amount numeric(18,2) not null check (amount >= 0),
  effective_from date not null default date '2020-01-01',
  notes text check (notes is null or length(notes) <= 500),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (driver_id, component_id, effective_from)
);
comment on table public.driver_pay_components is 'Mức của từng khoản lương cho từng tài xế; tăng lương thì thêm dòng mới với ngày hiệu lực mới';
create index if not exists driver_pay_components_driver_idx on public.driver_pay_components (driver_id, component_id, effective_from desc);

alter table public.drivers add column if not exists pay_type text not null default 'base_and_trip';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'drivers_pay_type_check') then
    alter table public.drivers add constraint drivers_pay_type_check check (pay_type in ('base_and_trip', 'trip_only', 'monthly_only'));
  end if;
end $$;
comment on column public.drivers.pay_type is 'Hình thức lương: base_and_trip lương cơ bản + chuyến; trip_only chỉ lương chuyến; monthly_only chỉ lương tháng';

alter table public.driver_payrolls
  add column if not exists components jsonb not null default '[]'::jsonb,
  add column if not exists workdays integer not null default 0,
  add column if not exists trips_missing_rate integer not null default 0;
comment on column public.driver_payrolls.components is 'Chi tiết từng khoản lương lúc lập: [{code, name, kind, method, qty, rate, amount}]';

-- -----------------------------------------------------------------------------
-- 4. Trigger, nhật ký, phân quyền
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select * from (values ('pay_zones', 'VL'), ('trip_pay_rates', 'DGL'), ('pay_components', 'KL'), ('driver_pay_components', null)) as v(tbl, prefix) loop
    if not exists (select 1 from pg_trigger where tgname = 'trg_' || r.tbl || '_updated_at') then
      perform private.attach_standard_triggers(('public.' || r.tbl)::regclass);
    end if;
    if r.prefix is not null and not exists (select 1 from pg_trigger where tgname = 'trg_' || r.tbl || '_code') then
      execute format('create trigger %I before insert on public.%I for each row execute function private.fill_master_code(%L)',
        'trg_' || r.tbl || '_code', r.tbl, r.prefix);
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'trg_' || r.tbl || '_audit') then
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row_change(%L)',
        'trg_' || r.tbl || '_audit', r.tbl, 'id');
    end if;
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_select', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_insert', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_update', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_delete', r.tbl);
    -- Vùng lương: ai đang hoạt động cũng thấy (ô chọn trong Địa điểm); đơn giá, mức lương: người xem quyết toán
    execute format('create policy %I on public.%I for select to authenticated using (%s)', r.tbl || '_select', r.tbl,
      case when r.tbl = 'pay_zones' then '(select private.is_active_user())'
           else '(select private.has_perm(''settlements.view'')) or (select private.has_perm(''settlements.update''))' end);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', r.tbl || '_insert', r.tbl,
      case when r.tbl = 'pay_zones' then '(select private.has_perm(''settlements.update'')) or (select private.has_perm(''locations.update'')) or (select private.has_perm(''catalogs.create''))'
           else '(select private.has_perm(''settlements.update''))' end);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.has_perm(''settlements.update''))) with check ((select private.has_perm(''settlements.update'')))',
      r.tbl || '_update', r.tbl);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.has_perm(''settlements.update'')))',
      r.tbl || '_delete', r.tbl);
    execute format('revoke all on public.%I from anon', r.tbl);
    execute format('grant select, insert, update, delete on public.%I to authenticated', r.tbl);
  end loop;
end $$;

-- Để trống "Áp dụng từ ngày" = từ trước tới nay
create or replace function private.pay_effective_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.effective_from := coalesce(new.effective_from, date '2020-01-01');
  return new;
end;
$$;
drop trigger if exists trg_trip_pay_rates_effective on public.trip_pay_rates;
create trigger trg_trip_pay_rates_effective before insert or update on public.trip_pay_rates
for each row execute function private.pay_effective_default();
drop trigger if exists trg_driver_pay_components_effective on public.driver_pay_components;
create trigger trg_driver_pay_components_effective before insert or update on public.driver_pay_components
for each row execute function private.pay_effective_default();

-- Khoản hệ thống không xóa, không đổi cách tính
create or replace function private.pay_components_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'Khoản "%" là khoản hệ thống, không xóa được (có thể tắt Đang dùng)', old.name using errcode = '22023';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.is_system and (new.method <> old.method or new.kind <> old.kind or new.code <> old.code or not new.is_system) then
    raise exception 'Khoản "%" là khoản hệ thống: chỉ đổi tên, mức mặc định, thứ tự, mô tả', old.name using errcode = '22023';
  end if;
  if new.method = 'trip_rate' and not new.is_system then
    raise exception 'Cách tính "Theo đơn giá lương chuyến" chỉ dành cho khoản Lương chuyến có sẵn' using errcode = '22023';
  end if;
  if new.method = 'over_trips' and new.threshold is null then
    raise exception 'Nhập Mốc số chuyến cho khoản thưởng vượt chuyến' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_pay_components_guard on public.pay_components;
create trigger trg_pay_components_guard before insert or update or delete on public.pay_components
for each row execute function private.pay_components_guard();

-- Khoản lương có sẵn theo bảng lương tài xế cont của công ty
insert into public.pay_components (code, name, kind, method, threshold, is_system, sort_order, description)
select v.code, v.name, v.kind, v.method, v.threshold, v.sys, v.ord, v.descr
from (values
  ('LCB', 'Lương cơ bản', 'income', 'monthly', null::int, true, 10, 'Cố định theo tháng. Tài xế hình thức "Chỉ lương chuyến" không có khoản này.'),
  ('LCHUYEN', 'Lương chuyến', 'income', 'trip_rate', null, true, 20, 'Tổng đơn giá lương của các chuyến hoàn thành trong tháng (đã gồm xe nâng, vé cổng).'),
  ('PCAN', 'Phụ cấp tiền ăn', 'income', 'per_workday', null, false, 30, 'Mức mỗi ngày × số ngày công. Ngày nghỉ không tính.'),
  ('PCDL', 'Phụ cấp tiền đi lại', 'income', 'monthly', null, false, 40, null),
  ('PCTRO', 'Phụ cấp tiền ở trọ', 'income', 'monthly', null, false, 50, 'Chỉ nhập mức cho tài xế ở trọ.'),
  ('PCLOXE', 'Phụ cấp lơ xe', 'income', 'monthly', null, false, 60, null),
  ('PCDT', 'Phụ cấp điện thoại', 'income', 'monthly', null, false, 70, null),
  ('PCBX', 'Phụ cấp bốc xếp', 'income', 'manual', null, false, 80, 'Nhập khi lập bảng lương nếu có.'),
  ('PCVV', 'Phụ cấp vá vỏ, bơm hơi', 'income', 'manual', null, false, 90, 'Nhập khi lập bảng lương nếu có.'),
  ('PCVS', 'Phụ cấp vệ sinh cont, gửi xe', 'income', 'manual', null, false, 100, 'Nhập khi lập bảng lương nếu có.'),
  ('THUONGVUOT', 'Thưởng vượt chuyến', 'income', 'over_trips', 41, false, 110, 'Mức × số chuyến vượt mốc (mặc định trên 41 chuyến). Nhập mức thưởng mỗi chuyến vượt.'),
  ('BHXH', 'Trừ bảo hiểm xã hội', 'deduction', 'monthly', null, false, 200, 'Khoản trừ cố định hằng tháng (nếu có).')
) as v(code, name, kind, method, threshold, sys, ord, descr)
where not exists (select 1 from public.pay_components c where c.code = v.code);

-- -----------------------------------------------------------------------------
-- 5. Tra đơn giá lương chuyến
-- -----------------------------------------------------------------------------
-- Trả về đơn giá khớp cụ thể nhất cho một chuyến (null nếu không có dòng nào khớp)
create or replace function private.trip_pay_rate_for(
  p_driver_id uuid, p_pickup uuid, p_delivery uuid, p_vehicle_type uuid, p_date date,
  out rate_id uuid, out amount numeric, out scope text
)
language sql
stable
set search_path = ''
as $$
  select r.id, r.amount,
         case when r.location_b_id is not null then 'route'
              when r.location_a_id is not null then 'place'
              when r.zone_id is not null then 'zone'
              else 'default' end
  from public.trip_pay_rates r
  left join public.locations lp on lp.id = p_pickup
  left join public.locations ld on ld.id = p_delivery
  where r.is_active
    and r.effective_from <= coalesce(p_date, current_date)
    and (r.effective_to is null or r.effective_to >= coalesce(p_date, current_date))
    and (r.driver_id is null or r.driver_id = p_driver_id)
    and (r.vehicle_type_id is null or r.vehicle_type_id = p_vehicle_type)
    and (
      (r.location_b_id is not null and ((r.location_a_id = p_pickup and r.location_b_id = p_delivery)
                                     or (r.location_a_id = p_delivery and r.location_b_id = p_pickup)))
      or (r.location_b_id is null and r.location_a_id is not null and r.location_a_id in (p_pickup, p_delivery))
      or (r.location_a_id is null and r.zone_id is not null and r.zone_id in (lp.pay_zone_id, ld.pay_zone_id))
      or (r.location_a_id is null and r.zone_id is null)
    )
  order by (r.driver_id is not null)::int * 16
         + case when r.location_b_id is not null then 8 when r.location_a_id is not null then 6 when r.zone_id is not null then 4 else 0 end
         + (r.vehicle_type_id is not null)::int desc,
           r.amount desc, r.effective_from desc
  limit 1;
$$;
revoke all on function private.trip_pay_rate_for(uuid, uuid, uuid, uuid, date) from public, anon;
-- Bảng kê chuyến (view quyền người xem) gọi hàm này; hàm chạy với quyền người gọi nên RLS đơn giá vẫn áp dụng
grant execute on function private.trip_pay_rate_for(uuid, uuid, uuid, uuid, date) to authenticated;

-- Bảng kê chuyến tính lương: mỗi chuyến tài xế công ty đã hoàn thành, kèm đơn giá tìm được
create or replace view public.trip_pay_lines with (security_invoker = true) as
select s.id, s.shipment_code, s.driver_id, d.full_name as driver_name, d.code as driver_code, d.pay_type,
       (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date as trip_date,
       date_trunc('month', (s.completed_at at time zone 'Asia/Ho_Chi_Minh'))::date as period_month,
       to_char((s.completed_at at time zone 'Asia/Ho_Chi_Minh'), 'MM/YYYY') as period_label,
       s.pickup_location_id, s.delivery_location_id, s.empty_return_location_id, s.vehicle_type_id, s.vehicle_id,
       r.rate_id, r.scope as rate_scope,
       case when d.pay_type = 'monthly_only' then 0
            else coalesce(r.amount, nullif(d.per_trip_salary, 0)) end as pay_amount,
       case when d.pay_type = 'monthly_only' then 'monthly_only'
            when r.rate_id is not null then r.scope
            when coalesce(d.per_trip_salary, 0) > 0 then 'driver_legacy'
            else 'missing' end as pay_source,
       (d.pay_type <> 'monthly_only' and r.rate_id is null and coalesce(d.per_trip_salary, 0) = 0) as missing_rate,
       s.status
from public.shipments s
join public.drivers d on d.id = s.driver_id and not coalesce(d.is_outsourced, false)
left join lateral private.trip_pay_rate_for(s.driver_id, s.pickup_location_id, s.delivery_location_id, s.vehicle_type_id,
  (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date) r on true
where s.status in ('driver_completed', 'closed') and s.completed_at is not null
  and ((select private.has_perm('settlements.view')) or (select private.has_perm('settlements.update')));
grant select on public.trip_pay_lines to authenticated;
revoke all on public.trip_pay_lines from anon;

-- Ô xem trước đơn giá cho một chuyến (màn hình chuyến, thử đơn giá)
create or replace function public.trip_pay_rate_preview(p_shipment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.trip_pay_lines;
begin
  if not (private.has_perm('settlements.view') or private.has_perm('settlements.update')) then
    raise exception 'Bạn không có quyền xem lương' using errcode = '42501';
  end if;
  select * into l from public.trip_pay_lines where id = p_shipment_id;
  return to_jsonb(l);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. Tính bảng lương theo thiết lập
-- -----------------------------------------------------------------------------
-- Mức của một khoản cho tài xế tại ngày (mức riêng mới nhất đã hiệu lực, không có thì mức mặc định)
create or replace function private.driver_component_amount(p_driver_id uuid, p_component_id uuid, p_date date)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select dpc.amount from public.driver_pay_components dpc
     where dpc.driver_id = p_driver_id and dpc.component_id = p_component_id and dpc.effective_from <= p_date
     order by dpc.effective_from desc limit 1),
    (select c.default_amount from public.pay_components c where c.id = p_component_id),
    0);
$$;
revoke all on function private.driver_component_amount(uuid, uuid, date) from public, anon, authenticated;

drop function if exists private.payroll_compute(uuid, date, numeric, numeric);
create or replace function private.payroll_compute(p_driver_id uuid, p_month date, p_bonus numeric, p_deduction numeric, p_manual jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.drivers;
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_trips int;
  v_workdays int;
  v_missing int;
  v_exp_count int;
  v_exp numeric;
  v_balance numeric;
  v_trip_salary numeric;
  v_base numeric := 0;
  v_meal numeric := 0;
  v_other numeric := 0;
  v_comp_deduct numeric := 0;
  v_gross numeric;
  v_offset numeric;
  v_setup boolean;
  v_lines jsonb := '[]'::jsonb;
  c record;
  v_rate numeric;
  v_qty numeric;
  v_amt numeric;
begin
  select * into d from public.drivers where id = p_driver_id;
  if d.id is null then
    raise exception 'Không tìm thấy tài xế' using errcode = 'P0001';
  end if;
  if coalesce(p_bonus, 0) < 0 or coalesce(p_deduction, 0) < 0 then
    raise exception 'Thưởng và khấu trừ không được âm' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_manual, '{}'::jsonb)) <> 'object' then
    raise exception 'Khoản nhập tay không hợp lệ' using errcode = '22023';
  end if;
  -- Chuyến hoàn thành trong tháng và đơn giá lương của từng chuyến
  select count(*), count(distinct trip_date), coalesce(sum(pay_amount), 0), count(*) filter (where missing_rate)
    into v_trips, v_workdays, v_trip_salary, v_missing
  from (
    select (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date as trip_date,
           case when d.pay_type = 'monthly_only' then 0 else coalesce(r.amount, d.per_trip_salary, 0) end as pay_amount,
           (d.pay_type <> 'monthly_only' and r.rate_id is null and coalesce(d.per_trip_salary, 0) = 0) as missing_rate
    from public.shipments s
    left join lateral private.trip_pay_rate_for(s.driver_id, s.pickup_location_id, s.delivery_location_id, s.vehicle_type_id,
      (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date) r on true
    where s.driver_id = d.id and s.status in ('driver_completed', 'closed')
      and (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date between v_from and v_to
  ) t;
  select count(*), coalesce(sum(e.amount), 0) into v_exp_count, v_exp from public.shipment_expenses e
  where e.driver_id = d.id and e.paid_by = 'driver' and e.status = 'approved' and e.payroll_id is null
    and (e.incurred_at at time zone 'Asia/Ho_Chi_Minh')::date <= v_to;
  v_balance := greatest(private.driver_advance_balance(d.id), 0);

  -- Đã thiết lập lương theo khoản (có mức riêng hoặc khoản có mức mặc định) thì tính theo khoản; chưa thì như cũ
  v_setup := exists (select 1 from public.driver_pay_components x where x.driver_id = d.id and x.effective_from <= v_to)
          or exists (select 1 from public.pay_components x where x.is_active and coalesce(x.default_amount, 0) > 0);

  if not v_setup then
    v_base := case when d.pay_type = 'trip_only' then 0 else coalesce(d.base_salary, 0) end;
    v_meal := coalesce(d.meal_allowance, 0);
    v_other := coalesce(d.other_allowance, 0);
    v_lines := jsonb_build_array(
      jsonb_build_object('code', 'LCB', 'name', 'Lương cơ bản', 'kind', 'income', 'method', 'monthly', 'qty', 1, 'rate', v_base, 'amount', v_base),
      jsonb_build_object('code', 'LCHUYEN', 'name', 'Lương chuyến', 'kind', 'income', 'method', 'trip_rate', 'qty', v_trips, 'rate', null, 'amount', v_trip_salary),
      jsonb_build_object('code', 'PCAN', 'name', 'Phụ cấp ăn uống', 'kind', 'income', 'method', 'monthly', 'qty', 1, 'rate', v_meal, 'amount', v_meal),
      jsonb_build_object('code', 'PCKHAC', 'name', 'Phụ cấp khác', 'kind', 'income', 'method', 'monthly', 'qty', 1, 'rate', v_other, 'amount', v_other));
  else
    for c in select * from public.pay_components where is_active order by sort_order, code loop
      v_rate := private.driver_component_amount(d.id, c.id, v_to);
      v_qty := 1;
      if c.method = 'trip_rate' then
        v_rate := null; v_qty := v_trips; v_amt := v_trip_salary;
      elsif c.code = 'LCB' and d.pay_type = 'trip_only' then
        v_amt := 0;
      elsif c.method = 'monthly' then
        v_amt := v_rate;
      elsif c.method = 'per_workday' then
        v_qty := v_workdays; v_amt := v_rate * v_workdays;
      elsif c.method = 'per_trip' then
        v_qty := v_trips; v_amt := v_rate * v_trips;
      elsif c.method = 'over_trips' then
        v_qty := greatest(v_trips - coalesce(c.threshold, 0), 0); v_amt := v_rate * v_qty;
      else -- nhập tay khi lập bảng lương
        v_amt := coalesce(nullif(p_manual ->> c.code, '')::numeric, 0);
        if v_amt < 0 then
          raise exception 'Số tiền "%" không được âm', c.name using errcode = '22023';
        end if;
        v_rate := null;
      end if;
      v_amt := round(coalesce(v_amt, 0), 0);
      continue when v_amt = 0 and c.method not in ('trip_rate') and c.code <> 'LCB';
      v_lines := v_lines || jsonb_build_object('code', c.code, 'name', c.name, 'kind', c.kind, 'method', c.method,
        'qty', v_qty, 'rate', v_rate, 'amount', v_amt);
      if c.kind = 'deduction' then
        v_comp_deduct := v_comp_deduct + v_amt;
      elsif c.code = 'LCB' then
        v_base := v_amt;
      elsif c.method = 'trip_rate' then
        null; -- đã nằm trong v_trip_salary
      elsif c.code = 'PCAN' then
        v_meal := v_meal + v_amt;
      else
        v_other := v_other + v_amt;
      end if;
    end loop;
  end if;

  v_gross := v_base + v_trip_salary + v_meal + v_other + coalesce(p_bonus, 0) - coalesce(p_deduction, 0) - v_comp_deduct + v_exp;
  -- Cấn trừ tối đa bằng số được nhận; phần tạm ứng còn lại chuyển sang tháng sau
  v_offset := least(v_balance, greatest(v_gross, 0));
  return jsonb_build_object(
    'driver_id', d.id, 'driver_name', d.full_name, 'period_month', v_from, 'period_from', v_from, 'period_to', v_to,
    'pay_type', d.pay_type, 'setup', v_setup,
    'trip_count', v_trips, 'workdays', v_workdays, 'trips_missing_rate', v_missing,
    'base_salary', v_base, 'per_trip_salary', coalesce(d.per_trip_salary, 0),
    'trip_salary', v_trip_salary, 'meal_allowance', v_meal, 'other_allowance', v_other,
    'bonus', coalesce(p_bonus, 0), 'deduction', coalesce(p_deduction, 0) + v_comp_deduct,
    'components', v_lines,
    'expense_count', v_exp_count, 'expense_reimbursement', v_exp,
    'advance_balance', v_balance, 'advance_offset', v_offset,
    'gross_amount', v_gross, 'net_amount', greatest(v_gross - v_offset, 0),
    'advance_carry', v_balance - v_offset,
    'existing', (select p.code from public.driver_payrolls p where p.driver_id = d.id and p.period_month = v_from
                   and p.status not in ('cancelled', 'rejected') limit 1));
end;
$$;
revoke all on function private.payroll_compute(uuid, date, numeric, numeric, jsonb) from public, anon, authenticated;

drop function if exists public.driver_payroll_preview(uuid, date, numeric, numeric);
create or replace function public.driver_payroll_preview(p_driver_id uuid, p_month date, p_bonus numeric default 0, p_deduction numeric default 0,
  p_manual jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Bạn không có quyền lập bảng lương' using errcode = '42501';
  end if;
  return private.payroll_compute(p_driver_id, p_month, p_bonus, p_deduction, p_manual);
end;
$$;

drop function if exists private.payroll_insert(uuid, date, numeric, numeric, text, jsonb);
create or replace function private.payroll_insert(p_driver_id uuid, p_month date, p_bonus numeric, p_deduction numeric, p_note text, p_custom_fields jsonb,
  p_manual jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb;
  v_id uuid;
  v_to date;
begin
  -- Khóa theo tài xế để hai người lập cùng lúc không trùng
  perform 1 from public.drivers where id = p_driver_id for update;
  c := private.payroll_compute(p_driver_id, p_month, p_bonus, p_deduction, p_manual);
  if c ->> 'existing' is not null then
    raise exception 'Tài xế đã có bảng lương tháng này (%). Hủy bảng cũ nếu muốn lập lại.', c ->> 'existing' using errcode = '23505';
  end if;
  if (c ->> 'gross_amount')::numeric < 0 then
    raise exception 'Khấu trừ lớn hơn tổng lương, kiểm tra lại số tiền' using errcode = '22023';
  end if;
  v_to := (c ->> 'period_to')::date;
  insert into public.driver_payrolls (driver_id, period_month, trip_count, base_salary, per_trip_salary, trip_salary,
    meal_allowance, other_allowance, bonus, deduction, expense_count, expense_reimbursement, advance_balance, advance_offset,
    gross_amount, net_amount, note, custom_fields, components, workdays, trips_missing_rate)
  values (p_driver_id, (c ->> 'period_month')::date, (c ->> 'trip_count')::int, (c ->> 'base_salary')::numeric,
    (c ->> 'per_trip_salary')::numeric, (c ->> 'trip_salary')::numeric, (c ->> 'meal_allowance')::numeric,
    (c ->> 'other_allowance')::numeric, (c ->> 'bonus')::numeric, (c ->> 'deduction')::numeric, (c ->> 'expense_count')::int,
    (c ->> 'expense_reimbursement')::numeric, (c ->> 'advance_balance')::numeric, (c ->> 'advance_offset')::numeric,
    (c ->> 'gross_amount')::numeric, (c ->> 'net_amount')::numeric, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_custom_fields, '{}'),
    c -> 'components', (c ->> 'workdays')::int, (c ->> 'trips_missing_rate')::int)
  returning id into v_id;
  update public.shipment_expenses set payroll_id = v_id
  where driver_id = p_driver_id and paid_by = 'driver' and status = 'approved' and payroll_id is null
    and (incurred_at at time zone 'Asia/Ho_Chi_Minh')::date <= v_to;
  update public.driver_payrolls set approval_request_id = private.submit_approval(
      'driver_payroll', 'driver_payroll', v_id, null, (c ->> 'net_amount')::numeric,
      'Lương tháng ' || to_char((c ->> 'period_month')::date, 'MM/YYYY') || ' - ' || (c ->> 'driver_name'),
      auth.uid(), p_driver_id, null)
  where id = v_id;
  return v_id;
end;
$$;
revoke all on function private.payroll_insert(uuid, date, numeric, numeric, text, jsonb, jsonb) from public, anon, authenticated;

drop function if exists public.create_driver_payroll(uuid, date, numeric, numeric, text, jsonb);
create or replace function public.create_driver_payroll(
  p_driver_id uuid, p_month date, p_bonus numeric default 0, p_deduction numeric default 0,
  p_note text default null, p_custom_fields jsonb default '{}', p_manual jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Bạn không có quyền lập bảng lương' using errcode = '42501';
  end if;
  v_id := private.payroll_insert(p_driver_id, p_month, p_bonus, p_deduction, p_note, p_custom_fields, p_manual);
  return (select code from public.driver_payrolls where id = v_id);
end;
$$;

-- Lập cho cả tháng: bỏ tài xế 3PL, giữ nguyên các quy tắc cũ
create or replace function public.create_driver_payrolls_for_month(p_month date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
  n int := 0;
  skipped int := 0;
  missing int := 0;
  c jsonb;
  v_from date := date_trunc('month', p_month)::date;
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Bạn không có quyền lập bảng lương' using errcode = '42501';
  end if;
  for d in
    select dr.id from public.drivers dr
    where dr.archived_at is null and not coalesce(dr.is_outsourced, false) and (dr.status <> 'terminated'
      or exists (select 1 from public.shipments s where s.driver_id = dr.id
                   and (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date >= v_from))
    order by dr.full_name
  loop
    if exists (select 1 from public.driver_payrolls p where p.driver_id = d.id and p.period_month = v_from and p.status not in ('cancelled', 'rejected')) then
      skipped := skipped + 1;
      continue;
    end if;
    c := private.payroll_compute(d.id, v_from, 0, 0, '{}'::jsonb);
    -- Bỏ qua tài xế không có lương, không chuyến, không chi phí, không tạm ứng
    if (c ->> 'gross_amount')::numeric = 0 and private.driver_advance_balance(d.id) = 0 then
      continue;
    end if;
    perform private.payroll_insert(d.id, v_from, 0, 0, null, '{}', '{}'::jsonb);
    n := n + 1;
    missing := missing + (c ->> 'trips_missing_rate')::int;
  end loop;
  return jsonb_build_object('created', n, 'skipped', skipped, 'trips_missing_rate', missing);
end;
$$;

-- Danh sách bảng lương: thêm số ngày công, chuyến chưa có đơn giá, chi tiết khoản
create or replace view public.payroll_list with (security_invoker = true) as
select p.id, p.code, p.driver_id, d.full_name as driver_name, d.code as driver_code,
       p.period_month, to_char(p.period_month, 'MM/YYYY') as period_label,
       p.trip_count, p.base_salary, p.per_trip_salary, p.trip_salary, p.meal_allowance, p.other_allowance,
       p.meal_allowance + p.other_allowance as allowance_total,
       p.bonus, p.deduction, p.expense_count, p.expense_reimbursement, p.advance_balance, p.advance_offset,
       p.advance_balance - p.advance_offset as advance_carry,
       p.gross_amount, p.net_amount, p.status, p.note, p.cancel_reason, ar.reject_reason,
       p.created_at, ar.decided_at, p.paid_at, pay.code as payment_code, pay.reference_no,
       (p.status = 'approved' and private.has_perm('settlements.update')) as can_pay,
       (p.status in ('pending', 'approved') and private.has_perm('settlements.update')) as can_cancel,
       p.approval_request_id, p.custom_fields,
       p.workdays, p.trips_missing_rate, p.components, d.pay_type
from public.driver_payrolls p
join public.drivers d on d.id = p.driver_id
left join public.approval_requests ar on ar.id = p.approval_request_id
left join public.payments pay on pay.id = p.payment_id;

-- -----------------------------------------------------------------------------
-- 7. Trường bổ sung cho các danh mục mới
-- -----------------------------------------------------------------------------
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
  end;
$$;

commit;
