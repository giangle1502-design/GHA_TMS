-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Chấm công theo ngày nhận của điều phối, Số ngày giao, bỏ xe 3PL; lương chuyến chiều về theo phần trăm
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shipments' and column_name = 'delivery_days') then
    raise exception 'CSDL đã được nâng cấp Chấm công theo ngày nhận của điều phối, Số ngày giao, bỏ xe 3PL; lương chuyến chiều về theo phần trăm trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261108000065_trip_pay_return_percent.sql
-- =============================================================================
-- 0065 Lương chuyến chiều về tính theo %
--   * Thiết lập chung payroll.return_trip_percent (mặc định 100 = chiều về như chiều đi).
--   * trip_pay_rates.return_percent: % riêng cho dòng đơn giá, để trống = theo thiết lập chung.
--   * Chiều về: tuyến Điểm 2 → Điểm 1; giá theo địa điểm: lấy hàng tại địa điểm đó;
--     giá theo vùng: lấy hàng trong vùng, giao ra ngoài vùng. Giá mặc định không phân chiều.
--   * Chỉ chuyến có đơn chở hàng (shipments) mới tính lương, như cũ.
-- =============================================================================

alter table public.trip_pay_rates add column if not exists return_percent numeric(5, 2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trip_pay_rates_return_percent') then
    alter table public.trip_pay_rates add constraint trip_pay_rates_return_percent
      check (return_percent is null or (return_percent >= 0 and return_percent <= 200));
  end if;
end $$;

insert into public.system_settings (key, value, description, is_public) values
  ('payroll.return_trip_percent', '100'::jsonb, 'Lương tài xế: chuyến chiều về tính bằng bao nhiêu % đơn giá chiều đi', false)
on conflict (key) do nothing;

-- Mức % chiều về chung (đọc được từ hàm chạy với quyền người gọi)
create or replace function private.payroll_return_percent()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select case when jsonb_typeof(value) = 'number' then value::text::numeric end
                   from public.system_settings where key = 'payroll.return_trip_percent'), 100);
$$;
revoke all on function private.payroll_return_percent() from public, anon;
grant execute on function private.payroll_return_percent() to authenticated;

-- Chuyến có phải chiều về so với dòng đơn giá không
create or replace function private.trip_pay_is_return(p_rate_id uuid, p_pickup uuid, p_delivery uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select case
             when r.location_b_id is not null then r.location_b_id = p_pickup and r.location_a_id = p_delivery
                                                   and r.location_a_id <> r.location_b_id
             when r.location_a_id is not null then r.location_a_id = p_pickup and r.location_a_id is distinct from p_delivery
             when r.zone_id is not null then lp.pay_zone_id = r.zone_id and ld.pay_zone_id is distinct from r.zone_id
             else false end
    from public.trip_pay_rates r
    left join public.locations lp on lp.id = p_pickup
    left join public.locations ld on ld.id = p_delivery
    where r.id = p_rate_id), false);
$$;
revoke all on function private.trip_pay_is_return(uuid, uuid, uuid) from public, anon;
grant execute on function private.trip_pay_is_return(uuid, uuid, uuid) to authenticated;

-- Đơn giá đã áp % chiều về (cùng chữ ký cũ nên bảng lương, bảng kê dùng luôn)
create or replace function private.trip_pay_rate_for(
  p_driver_id uuid, p_pickup uuid, p_delivery uuid, p_vehicle_type uuid, p_date date,
  out rate_id uuid, out amount numeric, out scope text
)
language sql
stable
set search_path = ''
as $$
  with best as (
    select r.id, r.amount, r.return_percent,
           case when r.location_b_id is not null then 'route'
                when r.location_a_id is not null then 'place'
                when r.zone_id is not null then 'zone'
                else 'default' end as scope
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
    limit 1
  )
  select b.id,
         case when private.trip_pay_is_return(b.id, p_pickup, p_delivery)
              then round(b.amount * coalesce(b.return_percent, private.payroll_return_percent()) / 100)
              else b.amount end,
         b.scope
  from best b;
$$;

-- Bảng kê: thêm Chiều, % chiều về, Đơn giá gốc (cột mới ở cuối)
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
       s.status,
       case when r.rate_id is null then null
            when private.trip_pay_is_return(r.rate_id, s.pickup_location_id, s.delivery_location_id) then 'return'
            when r.scope = 'default' then null
            else 'outbound' end as trip_direction,
       case when private.trip_pay_is_return(r.rate_id, s.pickup_location_id, s.delivery_location_id)
            then coalesce(tr.return_percent, private.payroll_return_percent()) end as return_percent,
       tr.amount as rate_amount
from public.shipments s
join public.drivers d on d.id = s.driver_id and not coalesce(d.is_outsourced, false)
left join lateral private.trip_pay_rate_for(s.driver_id, s.pickup_location_id, s.delivery_location_id, s.vehicle_type_id,
  (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date) r on true
left join public.trip_pay_rates tr on tr.id = r.rate_id
where s.status in ('driver_completed', 'closed') and s.completed_at is not null
  and ((select private.has_perm('settlements.view')) or (select private.has_perm('settlements.update')));
grant select on public.trip_pay_lines to authenticated;
revoke all on public.trip_pay_lines from anon;

-- Thiết lập chung: thêm % chiều về
create or replace function public.payroll_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.has_perm('settlements.view') or private.has_perm('settlements.update')) then
    raise exception 'Bạn không có quyền xem thiết lập lương' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'offset_advance', private.payroll_setting_bool('payroll.offset_advance', true),
    'deduct_base_unpaid', private.payroll_setting_bool('payroll.deduct_base_unpaid', true),
    'return_trip_percent', private.payroll_return_percent(),
    'weekly_off_days', coalesce((select value from public.system_settings where key = 'payroll.weekly_off_days'), '[0]'::jsonb),
    'can_edit', private.has_perm('settlements.update'));
end;
$$;

create or replace function public.set_payroll_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Bạn không có quyền đổi thiết lập lương' using errcode = '42501';
  end if;
  if p_key in ('payroll.offset_advance', 'payroll.deduct_base_unpaid') then
    if jsonb_typeof(p_value) <> 'boolean' then
      raise exception 'Giá trị phải là bật hoặc tắt' using errcode = '22023';
    end if;
  elsif p_key = 'payroll.return_trip_percent' then
    if jsonb_typeof(p_value) <> 'number' or p_value::text::numeric < 0 or p_value::text::numeric > 200 then
      raise exception '%% chiều về phải từ 0 đến 200' using errcode = '22023';
    end if;
  elsif p_key = 'payroll.weekly_off_days' then
    if jsonb_typeof(p_value) <> 'array' or exists (
      select 1 from jsonb_array_elements(p_value) e
      where jsonb_typeof(e) <> 'number' or e::text not in ('0', '1', '2', '3', '4', '5', '6')) then
      raise exception 'Ngày nghỉ trong tuần không hợp lệ' using errcode = '22023';
    end if;
  else
    raise exception 'Không có thiết lập lương %', p_key using errcode = '22023';
  end if;
  update public.system_settings set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key;
end;
$$;

-- >>> 20261111000071_attendance_by_pickup.sql
-- =============================================================================
-- 0071 Chấm công theo ngày nhận của điều phối + Số ngày giao; bỏ xe 3PL
--   * Ngày công = ngày nhận hàng (pickup_at) của chuyến điều phối đã chỉ định cho tài xế.
--     Chuyến hủy không tính; đổi tài xế thì người cũ trả về như lúc đầu (theo shipments.driver_id).
--   * shipments.delivery_days "Số ngày giao": để trống = 1 ngày (hoặc tự tính từ Ngày giao dự kiến nếu
--     khác ngày nhận). Chuyến N ngày tính công từ ngày nhận tới ngày nhận + N - 1; ngày trùng nhiều chuyến = 1 công.
--   * Chuyến chạy xe 3PL (thuê ngoài) không tính công, không tính lương chuyến; tài xế 3PL không hiện.
--   * Ngày chưa tới có chuyến: hiện "đã lên lịch", chưa tính công.
-- =============================================================================

alter table public.shipments add column if not exists delivery_days smallint;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shipments_delivery_days_range') then
    alter table public.shipments add constraint shipments_delivery_days_range check (delivery_days is null or delivery_days between 1 and 60);
  end if;
end $$;
comment on column public.shipments.delivery_days is 'Số ngày giao (chuyến dài ngày). Trống = 1 ngày hoặc theo ngày giao dự kiến';

-- Số ngày công của một chuyến
create or replace function private.shipment_work_days(p_pickup timestamptz, p_expected timestamptz, p_days smallint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_days::int,
                  greatest(((p_expected at time zone 'Asia/Ho_Chi_Minh')::date - (p_pickup at time zone 'Asia/Ho_Chi_Minh')::date) + 1, 1),
                  1);
$$;
grant execute on function private.shipment_work_days(timestamptz, timestamptz, smallint) to authenticated;

-- Xe thuê ngoài 3PL
create or replace function private.shipment_is_3pl(p_vehicle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select v.ownership_type = 'outsourced' or v.supplier_id is not null from public.vehicles v where v.id = p_vehicle_id), false);
$$;
revoke all on function private.shipment_is_3pl(uuid) from public, anon;
grant execute on function private.shipment_is_3pl(uuid) to authenticated;

-- Tài xế chỉ chạy xe 3PL, chưa từng chạy xe nội bộ, không có tài khoản → đánh dấu tài xế 3PL (như 0057)
update public.drivers d
set is_outsourced = true,
    supplier_id = coalesce(d.supplier_id, v.supplier_id)
from public.vehicles v
where v.assigned_driver_id = d.id
  and (v.ownership_type = 'outsourced' or v.supplier_id is not null)
  and d.profile_id is null
  and not d.is_outsourced
  and not exists (
    select 1 from public.shipments s
    join public.vehicles v2 on v2.id = s.vehicle_id
    where s.driver_id = d.id and v2.ownership_type <> 'outsourced' and v2.supplier_id is null
  );

-- Điều phối nhập Số ngày giao (trống = tự động)
create or replace function public.set_shipment_delivery_days(p_shipment_id uuid, p_days integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('dispatch.create')) then
    raise exception 'Bạn không có quyền sửa chuyến' using errcode = '42501';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 60) then
    raise exception 'Số ngày giao từ 1 đến 60' using errcode = '22023';
  end if;
  update public.shipments set delivery_days = p_days, updated_by = auth.uid(), updated_at = now()
  where id = p_shipment_id and status <> 'cancelled';
  if not found then
    raise exception 'Không tìm thấy chuyến hoặc chuyến đã hủy' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.set_shipment_delivery_days(uuid, integer) from public, anon;
grant execute on function public.set_shipment_delivery_days(uuid, integer) to authenticated;

-- Trạng thái từng ngày của tài xế
create or replace function private.attendance_rows(p_from date, p_to date, p_driver_id uuid default null)
returns table (driver_id uuid, work_date date, status text, source text, trips integer, note text)
language sql
stable
security definer
set search_path = ''
as $$
  with today as (select (now() at time zone 'Asia/Ho_Chi_Minh')::date as d),
  trips as (
    -- Chuyến điều phối đã chỉ định (chưa hủy), xe nội bộ, và các ngày công của chuyến
    select s.driver_id, s.id, (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date as d0,
           private.shipment_work_days(s.pickup_at, s.expected_delivery_at, s.delivery_days) as n
    from public.shipments s
    where s.driver_id is not null and s.status not in ('cancelled', 'draft')
      and (p_driver_id is null or s.driver_id = p_driver_id)
      and (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from - 60 and p_to
      and not private.shipment_is_3pl(s.vehicle_id)
  ),
  drv as (
    select dr.id, dr.profile_id, dr.start_date
    from public.drivers dr
    where not coalesce(dr.is_outsourced, false) and dr.supplier_id is null
      and (p_driver_id is null or dr.id = p_driver_id)
      and (p_driver_id is not null or (dr.archived_at is null and dr.status <> 'terminated')
           or exists (select 1 from trips t where t.driver_id = dr.id and t.d0 between p_from and p_to))
      -- Tài xế chưa đánh dấu 3PL nhưng trong tháng chỉ chạy xe 3PL thì không hiện
      and (p_driver_id is not null
           or exists (select 1 from trips t where t.driver_id = dr.id and t.d0 between p_from and p_to)
           or not exists (select 1 from public.shipments s3 where s3.driver_id = dr.id and s3.status <> 'cancelled'
                            and (s3.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to))
  ),
  days as (select g::date as d from generate_series(p_from, p_to, interval '1 day') g),
  trip_days as (
    select t.driver_id, (t.d0 + k)::date as d,
           count(distinct t.id) filter (where k = 0)::int as n_start,
           count(distinct t.id)::int as n_active
    from trips t
    cross join lateral generate_series(0, t.n - 1) k
    where (t.d0 + k) between p_from and p_to
    group by t.driver_id, (t.d0 + k)::date
  )
  select drv.id, days.d,
    case
      when m.status is not null then m.status
      when coalesce(t.n_active, 0) > 0 and days.d <= (select d from today) then 'work'
      when coalesce(t.n_active, 0) > 0 then 'upcoming'
      when lv.leave_type is not null then case lv.leave_type when 'sick' then 'sick' when 'unpaid' then 'leave_unpaid' else 'leave_paid' end
      when private.is_pay_offday(days.d) then 'off'
      when days.d < (select d from today) then 'pending'
      else 'upcoming'
    end,
    case
      when m.status is not null then 'manual'
      when coalesce(t.n_start, 0) > 0 then 'trip'
      when coalesce(t.n_active, 0) > 0 then 'trip_long'
      when lv.leave_type is not null then 'leave_request'
      else 'auto'
    end,
    coalesce(t.n_start, 0), m.note
  from drv
  cross join days
  left join trip_days t on t.driver_id = drv.id and t.d = days.d
  left join public.driver_attendance m on m.driver_id = drv.id and m.work_date = days.d
  left join lateral (
    select l.leave_type from public.leave_requests l
    where drv.profile_id is not null and l.requester_id = drv.profile_id and l.status = 'approved'
      and days.d between l.start_date and l.end_date
    order by l.created_at desc limit 1
  ) lv on true
  where days.d >= coalesce(drv.start_date, p_from);
$$;
revoke all on function private.attendance_rows(date, date, uuid) from public, anon, authenticated;

-- Bảng lương: lương chuyến chỉ tính chuyến xe nội bộ
create or replace function private.payroll_compute(p_driver_id uuid, p_month date, p_bonus numeric, p_deduction numeric, p_manual jsonb default '{}'::jsonb,
  p_offset_advance boolean default null)
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
  v_offday_trips int;
  v_do_offset boolean := coalesce(p_offset_advance, private.payroll_setting_bool('payroll.offset_advance', true));
  v_exp_lines jsonb;
  v_att record;
  v_standard int;
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
  select count(*), count(distinct trip_date), coalesce(sum(pay_amount), 0), count(*) filter (where missing_rate),
         count(*) filter (where private.is_pay_offday(trip_date))
    into v_trips, v_workdays, v_trip_salary, v_missing, v_offday_trips
  from (
    select (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date as trip_date,
           case when d.pay_type = 'monthly_only' then 0 else coalesce(r.amount, d.per_trip_salary, 0) end as pay_amount,
           (d.pay_type <> 'monthly_only' and r.rate_id is null and coalesce(d.per_trip_salary, 0) = 0) as missing_rate
    from public.shipments s
    left join lateral private.trip_pay_rate_for(s.driver_id, s.pickup_location_id, s.delivery_location_id, s.vehicle_type_id,
      (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date) r on true
    where s.driver_id = d.id and s.status in ('driver_completed', 'closed')
      and not private.shipment_is_3pl(s.vehicle_id)
      and (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date between v_from and v_to
  ) t;
  select count(*), coalesce(sum(e.amount), 0) into v_exp_count, v_exp from public.shipment_expenses e
  where e.driver_id = d.id and e.paid_by = 'driver' and e.status = 'approved' and e.payroll_id is null
    and (e.incurred_at at time zone 'Asia/Ho_Chi_Minh')::date <= v_to;
  -- Ngày công theo bảng chấm công
  select count(*) filter (where a.status = 'work') as work,
         count(*) filter (where a.status = 'leave_paid') as leave_paid,
         count(*) filter (where a.status = 'sick') as sick,
         count(*) filter (where a.status = 'leave_unpaid') as leave_unpaid,
         count(*) filter (where a.status = 'absent') as absent,
         count(*) filter (where a.status = 'pending') as pending,
         count(*) filter (where a.status <> 'off' and not private.is_pay_offday(a.work_date)) as standard
    into v_att
  from private.attendance_rows(v_from, v_to, d.id) a;
  v_workdays := coalesce(v_att.work, 0);
  -- Công chuẩn = số ngày trong tháng trừ ngày nghỉ tuần, ngày lễ
  select count(*) into v_standard from generate_series(v_from, v_to, interval '1 day') g where not private.is_pay_offday(g::date);
  -- Hoàn chi phí tài xế tự trả, chia theo danh mục phí (bốc xếp, vá vỏ, vệ sinh cont...)
  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'count', x.n, 'amount', x.amount) order by x.amount desc), '[]'::jsonb)
    into v_exp_lines
  from (
    select coalesce(ec.name, 'Khác') as name, count(*) as n, sum(e.amount) as amount
    from public.shipment_expenses e
    left join public.expense_categories ec on ec.id = e.category_id
    where e.driver_id = d.id and e.paid_by = 'driver' and e.status = 'approved' and e.payroll_id is null
      and (e.incurred_at at time zone 'Asia/Ho_Chi_Minh')::date <= v_to
    group by coalesce(ec.name, 'Khác')
  ) x;
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
      elsif c.code = 'LCB' and private.payroll_setting_bool('payroll.deduct_base_unpaid', true) and v_standard > 0
            and coalesce(v_att.leave_unpaid, 0) + coalesce(v_att.absent, 0) > 0 then
        -- Trừ lương cơ bản theo ngày nghỉ không lương / không báo: mức × (1 − ngày nghỉ / công chuẩn)
        v_qty := greatest(v_standard - v_att.leave_unpaid - v_att.absent, 0)::numeric / v_standard;
        v_amt := v_rate * v_qty;
      elsif c.method = 'monthly' then
        v_amt := v_rate;
      elsif c.method = 'per_workday' then
        v_qty := v_workdays; v_amt := v_rate * v_workdays;
      elsif c.method = 'per_trip' then
        v_qty := v_trips; v_amt := v_rate * v_trips;
      elsif c.method = 'per_trip_offday' then
        v_qty := v_offday_trips; v_amt := v_rate * v_offday_trips;
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
  -- Cấn trừ tối đa bằng số được nhận; phần còn lại chuyển sang tháng sau.
  -- Thiết lập "Không trừ tiền ứng vào lương": trả đủ lương, tạm ứng giữ nguyên để tài xế hoàn riêng
  v_offset := case when v_do_offset then least(v_balance, greatest(v_gross, 0)) else 0 end;
  return jsonb_build_object(
    'driver_id', d.id, 'driver_name', d.full_name, 'period_month', v_from, 'period_from', v_from, 'period_to', v_to,
    'pay_type', d.pay_type, 'setup', v_setup,
    'trip_count', v_trips, 'workdays', v_workdays, 'standard_days', v_standard,
    'attendance', jsonb_build_object('work', v_att.work, 'leave_paid', v_att.leave_paid, 'sick', v_att.sick,
      'leave_unpaid', v_att.leave_unpaid, 'absent', v_att.absent, 'pending', v_att.pending), 'trips_missing_rate', v_missing,
    'base_salary', v_base, 'per_trip_salary', coalesce(d.per_trip_salary, 0),
    'trip_salary', v_trip_salary, 'meal_allowance', v_meal, 'other_allowance', v_other,
    'bonus', coalesce(p_bonus, 0), 'deduction', coalesce(p_deduction, 0) + v_comp_deduct,
    'components', v_lines,
    'expense_count', v_exp_count, 'expense_reimbursement', v_exp, 'expense_lines', v_exp_lines,
    'offset_advance', v_do_offset, 'offday_trips', v_offday_trips,
    'advance_balance', v_balance, 'advance_offset', v_offset,
    'gross_amount', v_gross, 'net_amount', greatest(v_gross - v_offset, 0),
    'advance_carry', v_balance - v_offset,
    'existing', (select p.code from public.driver_payrolls p where p.driver_id = d.id and p.period_month = v_from
                   and p.status not in ('cancelled', 'rejected') limit 1));
end;
$$;
revoke all on function private.payroll_compute(uuid, date, numeric, numeric, jsonb, boolean) from public, anon, authenticated;

-- Bảng kê lương chuyến: bỏ chuyến xe 3PL
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
       s.status,
       case when r.rate_id is null then null
            when private.trip_pay_is_return(r.rate_id, s.pickup_location_id, s.delivery_location_id) then 'return'
            when r.scope = 'default' then null
            else 'outbound' end as trip_direction,
       case when private.trip_pay_is_return(r.rate_id, s.pickup_location_id, s.delivery_location_id)
            then coalesce(tr.return_percent, private.payroll_return_percent()) end as return_percent,
       tr.amount as rate_amount
from public.shipments s
join public.drivers d on d.id = s.driver_id and not coalesce(d.is_outsourced, false)
left join lateral private.trip_pay_rate_for(s.driver_id, s.pickup_location_id, s.delivery_location_id, s.vehicle_type_id,
  (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date) r on true
left join public.trip_pay_rates tr on tr.id = r.rate_id
where s.status in ('driver_completed', 'closed') and s.completed_at is not null
  and not private.shipment_is_3pl(s.vehicle_id)
  and ((select private.has_perm('settlements.view')) or (select private.has_perm('settlements.update')));
grant select on public.trip_pay_lines to authenticated;
revoke all on public.trip_pay_lines from anon;

-- Danh sách chuyến (Điều phối, Quản lý chuyến): thêm Số ngày giao
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
  coalesce(s.delivery_phone, dl.phone) as delivery_phone,
  s.delivery_days,
  private.shipment_work_days(s.pickup_at, s.expected_delivery_at, s.delivery_days) as work_days
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

commit;
