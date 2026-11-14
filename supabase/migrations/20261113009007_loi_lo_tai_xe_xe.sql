-- =============================================================================
-- 9007: Lời/lỗ chuyến không tính phí bốc xếp đã thu lại của khách theo kiểu CHI HỘ
--  Ví dụ: trả đơn vị bốc xếp 720,000; khách trả lại 720,000 dưới dạng "Phí bốc xếp (chi hộ)"
--  (chi hộ không nằm trong doanh thu) -> trước đây vẫn trừ 720,000 vào lời/lỗ nên chuyến bị lỗ oan.
--  Nay: chi phí 3PL tính lời/lỗ = khoản không phải chi hộ − phần bốc xếp đã thu lại của khách (chi hộ),
--  phần trừ tối đa bằng chi phí bốc xếp 3PL của chuyến.
-- =============================================================================
create or replace function private.shipment_carrier_profit_cost(p_shipment_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with k as (
    select coalesce(sum(c.amount), 0) as cost,
           coalesce(sum(c.amount) filter (where ft.is_loading), 0) as loading
    from public.shipment_carrier_costs c
    left join public.fee_types ft on ft.id = c.fee_type_id
    where c.shipment_id = p_shipment_id and c.cost_kind <> 'pass_through'
  ), f as (
    select coalesce(sum(sf.amount), 0) as recovered
    from public.shipment_fees sf
    join public.fee_types ft on ft.id = sf.fee_type_id
    where sf.shipment_id = p_shipment_id and ft.is_loading and sf.fee_kind = 'pass_through'
  )
  select k.cost - least(k.loading, f.recovered) from k, f;
$$;
revoke all on function private.shipment_carrier_profit_cost(uuid) from public, anon;
grant execute on function private.shipment_carrier_profit_cost(uuid) to authenticated;

create or replace view public.shipment_profit as
with trips as (
  select s.id, s.vehicle_id,
         date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as trip_month,
         s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as revenue,
         private.shipment_carrier_profit_cost(s.id) as carrier_cost
  from public.shipments s
  where s.status in ('in_transit', 'driver_completed', 'closed')
),
vm_trips as (
  select vehicle_id, trip_month, count(*) as trip_count from trips where vehicle_id is not null group by 1, 2
),
vm_cost as (
  select m.vehicle_id, date_trunc('month', m.performed_at)::date as cost_month, sum(m.amount) as amount
  from public.maintenance_records m
  where m.status = 'recorded' and m.amount > 0
  group by 1, 2
)
select t.id as shipment_id, t.trip_month, t.revenue,
       coalesce(e.approved, 0) as trip_cost,
       coalesce(e.pending, 0) as pending_cost,
       coalesce(round(vc.amount / nullif(vt.trip_count, 0), 0), 0) as vehicle_cost,
       coalesce(vc.amount, 0) as vehicle_month_cost,
       coalesce(vt.trip_count, 0) as vehicle_month_trips,
       t.revenue - coalesce(e.approved, 0) - t.carrier_cost as profit_before_vehicle,
       t.revenue - coalesce(e.approved, 0) - t.carrier_cost - coalesce(round(vc.amount / nullif(vt.trip_count, 0), 0), 0) as profit,
       case when t.revenue > 0 then round((t.revenue - coalesce(e.approved, 0) - t.carrier_cost
              - coalesce(round(vc.amount / nullif(vt.trip_count, 0), 0), 0)) * 100 / t.revenue, 1) end as margin_percent,
       t.carrier_cost
from trips t
left join vm_trips vt on vt.vehicle_id = t.vehicle_id and vt.trip_month = t.trip_month
left join vm_cost vc on vc.vehicle_id = t.vehicle_id and vc.cost_month = t.trip_month
left join lateral (
  select sum(x.amount) filter (where x.status = 'approved') as approved,
         sum(x.amount) filter (where x.status = 'pending') as pending
  from public.shipment_expenses x where x.shipment_id = t.id
) e on true
where private.has_perm('expenses.view') or private.has_perm('reports.view');

create or replace view public.report_shipment_profit as
select s.id, s.shipment_code, o.order_code,
       (coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_date,
       date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_month,
       o.payer_customer_id as customer_id, c.name as customer_name,
       s.vehicle_id, v.plate_number, s.driver_id, d.full_name as driver_name,
       pl.name as pickup_name, dl.name as delivery_name, s.status,
       s.freight_amount, s.surcharge_amount, s.fuel_support_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as revenue,
       coalesce(x.cost, 0) + coalesce(cc.cost, 0) as cost,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(x.cost, 0) - coalesce(cc.cost, 0) as profit,
       case when s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount > 0
            then round((s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(x.cost, 0) - coalesce(cc.cost, 0)) * 100
                       / (s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount), 1) end as margin_percent,
       (s.receivable_id is not null) as billed,
       s.extra_fee_amount, s.pass_through_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount + s.pass_through_amount as amount_due,
       s.quantity, s.pricing_unit, s.unit_price,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + coalesce(ff.amount, 0) as freight_total,
       vt.name as vehicle_type_name, to_char(date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh'), 'MM/YYYY') as month_label,
       c.code as customer_code,
       coalesce(ff.amount, 0) as freight_fee_amount,
       coalesce(p.vehicle_cost, 0) as vehicle_cost,
       coalesce(p.profit, s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(x.cost, 0) - coalesce(cc.cost, 0)) as net_profit,
       coalesce(cc.cost, 0) as carrier_cost
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.payer_customer_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicle_types vt on vt.id = s.vehicle_type_id
left join lateral (select sum(e.amount) as cost from public.shipment_expenses e where e.shipment_id = s.id and e.status = 'approved') x on true
left join lateral (select private.shipment_carrier_profit_cost(s.id) as cost) cc on true
left join lateral (
  select sum(sf.amount) as amount
  from public.shipment_fees sf
  join public.fee_types ft on ft.id = sf.fee_type_id
  join public.fee_groups g on g.id = ft.fee_group_id
  where sf.shipment_id = s.id and g.report_role = 'freight'
) ff on true
left join public.shipment_profit p on p.shipment_id = s.id
where s.status in ('in_transit', 'driver_completed', 'closed') and private.has_perm('reports.view');

-- -----------------------------------------------------------------------------
-- Xe chưa gắn tài xế (xe 3PL chuyển từ app cũ): gắn tài xế của chuyến gần nhất chạy xe đó,
-- để khi chọn số xe thì tài xế tự điền. Không đụng xe đã có tài xế.
-- -----------------------------------------------------------------------------
-- Mỗi tài xế chỉ gắn được một xe: tài xế chạy nhiều xe thì gắn vào xe chạy gần nhất.
update public.vehicles v
set assigned_driver_id = t.driver_id
from (
  select distinct on (x.driver_id) x.vehicle_id, x.driver_id
  from (
    select distinct on (s.vehicle_id) s.vehicle_id, s.driver_id, s.pickup_at
    from public.shipments s
    where s.vehicle_id is not null and s.driver_id is not null and s.status <> 'cancelled'
    order by s.vehicle_id, s.pickup_at desc
  ) x
  where not exists (select 1 from public.vehicles a where a.assigned_driver_id = x.driver_id)
  order by x.driver_id, x.pickup_at desc
) t
where v.id = t.vehicle_id and v.assigned_driver_id is null;

-- -----------------------------------------------------------------------------
-- Điểm hạ rỗng chỉ là DEPOT
--  - locations.is_depot: ô "Điểm hạ rỗng" khi tạo đơn chỉ hiện điểm có đánh dấu này
--  - Tự đánh dấu depot theo tên (DEPOT, ICD, CẢNG, BÃI CONT, TERMINAL) và các điểm đã dùng làm điểm hạ rỗng
--  - Điểm lấy từ Khánh Hà (mã HR-...) mà không phải depot và chưa dùng ở đâu: chuyển Ngừng hoạt động
--    (không xóa hẳn; muốn dùng lại thì vào Danh mục địa điểm bật lại + tích Depot)
-- -----------------------------------------------------------------------------
alter table public.locations add column if not exists is_depot boolean not null default false;
comment on column public.locations.is_depot is 'Depot / bãi hạ rỗng: hiện trong ô Điểm hạ rỗng';
create index if not exists locations_depot_idx on public.locations (name) where is_depot;

update public.locations l set is_depot = true
where not l.is_depot and (
  l.name ~* '(depot|depo\M|\micd\M|cảng|\mcang\M|bãi cont|bai cont|bãi container|terminal)'
  or l.id in (select empty_return_location_id from public.shipments where empty_return_location_id is not null
              union select offroute_return_location_id from public.shipments where offroute_return_location_id is not null)
);

update public.locations l set status = 'inactive'
where l.code like 'HR-%' and not l.is_depot and l.status = 'active'
  and not exists (select 1 from public.shipments s where l.id in (s.pickup_location_id, s.delivery_location_id, s.empty_return_location_id, s.offroute_return_location_id));

-- Kết quả: danh sách depot đang hiện trong ô Điểm hạ rỗng
select code as "Mã", name as "Tên depot", full_address as "Địa chỉ"
from public.locations where is_depot and status = 'active' order by name;
