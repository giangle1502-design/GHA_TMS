-- =============================================================================
-- 0039: Lời/lỗ từng chuyến (yêu cầu người dùng 01/11/2026)
-- - Doanh thu chuyến = cước + phụ phí + hỗ trợ dầu + phí "Tính doanh thu" (giống cột Tổng doanh thu; chi hộ không tính).
-- - Chi phí chuyến = các khoản chi phí chuyến ĐÃ DUYỆT (tài xế khai hoặc văn phòng nhập).
-- - Chi phí xe chia về chuyến: tổng bảo trì, sửa chữa, kiểm định, bảo hiểm... của xe trong tháng (Phương tiện →
--   Bảo dưỡng, sửa chữa) chia đều cho các chuyến của xe trong tháng đó (tháng theo ngày hoàn thành, chưa có thì ngày nhận).
-- - Lời/lỗ = doanh thu − chi phí chuyến − chi phí xe chia về.
-- - Thêm hạng mục chi "Bồi dưỡng bốc xếp" (tiền công ty trả người bốc xếp) và "Thuê xe ngoài (3-PL)".
-- =============================================================================

insert into public.expense_categories (code, name, group_name, report_bucket, allowed_role_codes, requires_invoice, requires_image, requires_approval, sort_order)
values
  ('LOADING_TIP', 'Bồi dưỡng bốc xếp', 'Bốc xếp, nâng hạ', 'loading_yard', array['admin', 'accountant', 'dispatcher', 'driver'], false, false, true, 8),
  ('OUTSOURCE', 'Thuê xe ngoài (3-PL)', 'Thuê xe ngoài', 'outsourcing', array['admin', 'accountant', 'dispatcher'], false, false, true, 20)
on conflict (code) do nothing;

-- Chuyến tính lời lỗ và tháng của chuyến
create or replace view public.shipment_profit as
with trips as (
  select s.id, s.vehicle_id,
         date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as trip_month,
         s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as revenue
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
       t.revenue - coalesce(e.approved, 0) as profit_before_vehicle,
       t.revenue - coalesce(e.approved, 0) - coalesce(round(vc.amount / nullif(vt.trip_count, 0), 0), 0) as profit,
       case when t.revenue > 0 then round((t.revenue - coalesce(e.approved, 0)
              - coalesce(round(vc.amount / nullif(vt.trip_count, 0), 0), 0)) * 100 / t.revenue, 1) end as margin_percent
from trips t
left join vm_trips vt on vt.vehicle_id = t.vehicle_id and vt.trip_month = t.trip_month
left join vm_cost vc on vc.vehicle_id = t.vehicle_id and vc.cost_month = t.trip_month
left join lateral (
  select sum(x.amount) filter (where x.status = 'approved') as approved,
         sum(x.amount) filter (where x.status = 'pending') as pending
  from public.shipment_expenses x where x.shipment_id = t.id
) e on true
where private.has_perm('expenses.view') or private.has_perm('reports.view');

revoke all on public.shipment_profit from anon;
grant select on public.shipment_profit to authenticated;

-- Báo cáo Lợi nhuận từng chuyến: thêm chi phí xe chia về và lời/lỗ sau khi chia (cột mới cuối view)
create or replace view public.report_shipment_profit as
select s.id, s.shipment_code, o.order_code,
       (coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_date,
       date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_month,
       o.payer_customer_id as customer_id, c.name as customer_name,
       s.vehicle_id, v.plate_number, s.driver_id, d.full_name as driver_name,
       pl.name as pickup_name, dl.name as delivery_name, s.status,
       s.freight_amount, s.surcharge_amount, s.fuel_support_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as revenue,
       coalesce(x.cost, 0) as cost,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(x.cost, 0) as profit,
       case when s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount > 0
            then round((s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(x.cost, 0)) * 100
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
       coalesce(p.profit, s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(x.cost, 0)) as net_profit
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.payer_customer_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicle_types vt on vt.id = s.vehicle_type_id
left join lateral (select sum(e.amount) as cost from public.shipment_expenses e where e.shipment_id = s.id and e.status = 'approved') x on true
left join lateral (
  select sum(sf.amount) as amount
  from public.shipment_fees sf
  join public.fee_types ft on ft.id = sf.fee_type_id
  join public.fee_groups g on g.id = ft.fee_group_id
  where sf.shipment_id = s.id and g.report_role = 'freight'
) ff on true
left join public.shipment_profit p on p.shipment_id = s.id
where s.status in ('in_transit', 'driver_completed', 'closed') and private.has_perm('reports.view');

revoke all on public.report_shipment_profit from anon;
grant select on public.report_shipment_profit to authenticated;
