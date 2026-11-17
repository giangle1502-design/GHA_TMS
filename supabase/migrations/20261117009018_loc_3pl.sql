-- =============================================================================
-- GHA 9018: NHÀ XE 3PL TRÊN DANH SÁCH CHUYẾN (lọc, sắp xếp, gom chuyến gửi 3PL)
--   * View shipment_list (Điều phối, Quản lý chuyến) thêm 2 cột cuối:
--       carrier_supplier_id, carrier_name = nhà xe 3PL của chuyến
--       (nhà xe ghi ở chuyến; chưa ghi thì lấy theo xe 3PL / tài xế 3PL đang gắn).
--   * Tài khoản không có quyền xem 3PL (carriers.view, VD tài khoản khách) luôn thấy 2 cột này TRỐNG.
--   * Chỉ thêm cột vào cuối view, các cột cũ giữ nguyên. Chạy lại nhiều lần không sao.
-- =============================================================================

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
  private.shipment_work_days(s.pickup_at, s.expected_delivery_at, s.delivery_days) as work_days,
  case when (select private.can_view_3pl()) then cr.id end as carrier_supplier_id,
  case when (select private.can_view_3pl()) then cr.name end as carrier_name
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
left join lateral (select * from public.shipment_fee_role_totals t where t.shipment_id = s.id) ft on true
left join public.suppliers cr on cr.id = coalesce(
  s.carrier_supplier_id,
  case when v.ownership_type = 'outsourced' or v.supplier_id is not null then v.supplier_id end,
  case when d.is_outsourced then d.supplier_id end);

comment on view public.shipment_list is 'Danh sách chuyến (Điều phối, Quản lý chuyến); carrier_* chỉ có giá trị với người có quyền xem 3PL';

-- Lọc chuyến theo nhà xe 3PL nhanh hơn
create index if not exists shipments_carrier_supplier_idx on public.shipments (carrier_supplier_id) where carrier_supplier_id is not null;

-- Kiểm tra nhanh (chạy riêng nếu muốn xem):
-- select shipment_code, carrier_name, plate_number from public.shipment_list where carrier_supplier_id is not null order by pickup_at desc limit 20;
