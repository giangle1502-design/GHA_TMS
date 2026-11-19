-- =============================================================================
-- GHA 9033: KHÔNG QUÊN PHÍ BỐC XẾP + BÁO CÁO CÓ TUYẾN ĐƯỜNG (LE 19/11/2026)
--   1. shipments.requires_loading: ô tick "Có chi phí bốc xếp" khi tạo/sửa đơn ở Điều phối.
--      Chuyến có tick mà chưa nhập khoản trả bốc xếp → hiện ở trang Bốc xếp 3PL (mục "Chuyến cần nhập phí bốc xếp").
--   2. report_loading_trips: thêm chuyến có tick (kể cả chưa có thu/chi bốc xếp), cột requires_loading, tuyến đường.
--   3. report_shipment_profit (tab Lợi nhuận từng chuyến, Cước vận chuyển) và report_carrier_trips (Chuyến 3PL):
--      thêm Điểm hạ rỗng, Tuyến đường "Điểm nhận → Điểm giao → Điểm hạ rỗng", % hỗ trợ dầu, Đã nhập cước, Có bốc xếp.
--      Chỉ THÊM cột vào cuối view (create or replace), không đổi cột cũ.
-- Chạy lại nhiều lần được.
-- =============================================================================

alter table public.shipments add column if not exists requires_loading boolean not null default false;
comment on column public.shipments.requires_loading is 'Có chi phí bốc xếp (tick ở Điều phối): chưa nhập khoản trả bốc xếp thì hiện ở trang Bốc xếp để không quên';
create index if not exists shipments_requires_loading_idx on public.shipments (id) where requires_loading;

-- Tuyến đường dùng chung: Điểm nhận → Điểm giao (→ Điểm hạ rỗng nếu có)
create or replace function private.route_label(p_pickup text, p_delivery text, p_empty text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(p_pickup, '-') || ' → ' || coalesce(p_delivery, '-') || coalesce(' → ' || nullif(p_empty, ''), '');
$$;

-- -----------------------------------------------------------------------------
-- 1. Lợi nhuận từng chuyến / Cước vận chuyển (giữ nguyên định nghĩa 9007, thêm cột cuối)
-- -----------------------------------------------------------------------------
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
       coalesce(cc.cost, 0) as carrier_cost,
       -- 9033
       el.name as empty_return_name,
       private.route_label(pl.name, dl.name, el.name) as route_label,
       s.fuel_support_rate,
       (s.freight_amount > 0) as freight_entered,
       s.requires_loading
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.payer_customer_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.locations el on el.id = s.empty_return_location_id
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
-- 2. Chuyến 3PL (giữ nguyên định nghĩa 0042, thêm cột cuối)
-- -----------------------------------------------------------------------------
create or replace view public.report_carrier_trips as
select s.id, s.shipment_code, o.order_code,
       (coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_date,
       date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_month,
       to_char(date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh'), 'MM/YYYY') as month_label,
       s.status,
       coalesce(s.carrier_supplier_id, v.supplier_id) as supplier_id,
       coalesce(sp.name, vsp.name, '(chưa chọn nhà xe)') as supplier_name,
       coalesce(sp.code, vsp.code) as supplier_code,
       o.payer_customer_id as customer_id, c.code as customer_code, c.name as customer_name,
       s.vehicle_id, v.plate_number, d.full_name as driver_name,
       pl.name as pickup_name, dl.name as delivery_name,
       coalesce(k.freight, 0) as carrier_freight,
       coalesce(k.pass_through, 0) as carrier_pass_through,
       coalesce(k.other, 0) as carrier_other,
       coalesce(k.total, 0) as carrier_total,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as revenue,
       s.pass_through_amount as customer_pass_through,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(k.cost, 0) as margin,
       ap.id as payable_id, ap.code as payable_code, ap.invoice_no, ap.issued_date, ap.due_date,
       coalesce(ap.paid_amount, 0) as paid_amount,
       coalesce(ap.amount - ap.paid_amount, 0) as remaining_amount,
       case when coalesce(k.total, 0) = 0 then 'no_cost'
            when ap.id is null then 'no_payable'
            when ap.status = 'open' then 'unpaid'
            else ap.status end as pay_status,
       case when ap.status in ('open', 'partial') then greatest((now() at time zone 'Asia/Ho_Chi_Minh')::date - ap.due_date, 0) else 0 end as overdue_days,
       (select max(p.paid_at) from public.payments p where p.payable_id = ap.id and p.status = 'posted') as last_paid_at,
       (ap.status in ('open', 'partial') and private.has_perm('receivables.pay')) as can_pay,
       false as can_cancel,
       ap.amount, ap.code, coalesce(sp.name, vsp.name) as partner_name,
       -- 9033
       el.name as empty_return_name,
       private.route_label(pl.name, dl.name, el.name) as route_label,
       s.requires_loading
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.suppliers sp on sp.id = s.carrier_supplier_id
left join public.suppliers vsp on vsp.id = v.supplier_id
left join public.customers c on c.id = o.payer_customer_id
left join public.drivers d on d.id = s.driver_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.locations el on el.id = s.empty_return_location_id
left join public.shipment_carrier_totals k on k.shipment_id = s.id
left join public.payables ap on ap.shipment_id = s.id and ap.kind = 'carrier' and ap.status <> 'cancelled'
where s.status <> 'cancelled'
  and (s.carrier_supplier_id is not null or v.ownership_type = 'outsourced' or k.total > 0)
  and (private.has_perm('reports.view') or private.has_perm('receivables.view'));

-- -----------------------------------------------------------------------------
-- 3. Bốc xếp từng chuyến: thêm chuyến có tick "Có chi phí bốc xếp" (giữ nguyên 9005, thêm cột cuối)
-- -----------------------------------------------------------------------------
create or replace view public.report_loading_trips with (security_invoker = true) as
select s.id, s.shipment_code, o.order_code,
       (coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_date,
       o.payer_customer_id as customer_id, c.code as customer_code, c.name as customer_name,
       v.plate_number, pl.name as pickup_name, dl.name as delivery_name, s.status,
       round(coalesce(w.kg, 0) / 1000, 3) as tons,
       coalesce(fl.amount, 0) as loading_revenue,
       coalesce(lc.amount, 0) as loading_cost,
       coalesce(lc.unpaid, 0) as loading_unpaid,
       coalesce(lc.n, 0) as loading_lines,
       lc.vendors,
       -- 9033
       s.requires_loading,
       el.name as empty_return_name,
       private.route_label(pl.name, dl.name, el.name) as route_label
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.payer_customer_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.locations el on el.id = s.empty_return_location_id
left join lateral (select sum(si.weight_kg) as kg from public.shipment_items si where si.shipment_id = s.id) w on true
left join lateral (
  select sum(sf.amount) as amount from public.shipment_fees sf join public.fee_types ft on ft.id = sf.fee_type_id
  where sf.shipment_id = s.id and ft.is_loading
) fl on true
left join lateral (
  select count(*) as n, sum(x.amount) as amount, sum(x.amount) filter (where not x.paid) as unpaid,
         string_agg(distinct x.vendor_name, ', ') as vendors
  from public.report_loading_3pl x where x.shipment_id = s.id
) lc on true
where s.status <> 'cancelled' and (s.requires_loading or coalesce(fl.amount, 0) > 0 or coalesce(lc.n, 0) > 0)
  and private.can_view_3pl() and (private.has_perm('reports.view') or private.has_perm('receivables.view'));

revoke all on public.report_shipment_profit, public.report_carrier_trips, public.report_loading_trips from anon;
grant select on public.report_shipment_profit, public.report_carrier_trips, public.report_loading_trips to authenticated;

-- Kết quả: số chuyến có tick bốc xếp mà chưa nhập khoản trả bốc xếp
select count(*) as "Chuyến có bốc xếp chưa nhập phí"
from public.shipments s
where s.requires_loading and s.status <> 'cancelled'
  and not exists (select 1 from public.shipment_carrier_costs c join public.fee_types ft on ft.id = c.fee_type_id and ft.is_loading where c.shipment_id = s.id);
