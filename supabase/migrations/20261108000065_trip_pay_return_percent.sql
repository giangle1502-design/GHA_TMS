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
