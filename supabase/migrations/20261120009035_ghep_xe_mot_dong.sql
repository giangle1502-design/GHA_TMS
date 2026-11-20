-- =============================================================================
-- GHA 9035: HAI ĐƠN GHÉP CHUNG MỘT XE HIỆN MỘT DÒNG (Điều phối, Quản lý chuyến, bảng kê)
--   LE 20/11/2026: 2 đơn ghép vào 1 xe thì Điều phối, Quản lý chuyến và bảng kê chỉ hiện 1 dòng.
--   * Mô hình giữ như 9032: mỗi đơn vẫn là 1 chuyến; các chuyến đi chung một xe, cùng lượt có chung
--     shipments.load_group_id. Màn hình gộp các chuyến cùng nhóm thành 1 dòng (cước, phí cộng lại).
--   * View shipment_list và statement_shipment_list thêm cột cuối load_group_id (cột cũ giữ nguyên).
--   * set_shipment_load_group(các chuyến): điều phối ghép các chuyến cùng số xe, cùng ngày nhận thành
--     một nhóm (cùng thứ tự xe trong ngày để tài xế thấy cả hai cùng lúc).
--   * clear_shipment_load_group(nhóm): tách nhóm, các chuyến lại hiện riêng từng dòng.
--   Chạy lại nhiều lần không sao.
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
  case when (select private.can_view_3pl()) then cr.name end as carrier_name,
  s.load_group_id
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

create or replace view public.statement_shipment_list with (security_barrier = true) as
select s.id,
       s.shipment_code,
       s.order_id,
       o.order_code,
       o.customer_id,
       c.code as customer_code,
       c.name as customer_name,
       s.pickup_at,
       s.expected_delivery_at,
       s.pickup_location_id,
       pl.name as pickup_name,
       pl.billing_address as pickup_billing_address,
       s.delivery_location_id,
       dl.name as delivery_name,
       dl.billing_address as delivery_billing_address,
       (pl.name || ' → ') || dl.name as route_label,
       er.name as empty_return_name,
       orl.name as offroute_return_name,
       vt.name as vehicle_type_name,
       v.plate_number,
       d.full_name as driver_name,
       s.quantity,
       s.pricing_unit,
       s.unit_price,
       s.freight_amount,
       s.surcharge_amount,
       s.fuel_support_rate,
       s.fuel_support_amount,
       s.extra_fee_amount,
       s.pass_through_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as total_revenue,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount + s.pass_through_amount as amount_due,
       coalesce(ft.transport_fee, s.freight_amount + s.surcharge_amount + s.fuel_support_amount) as transport_fee,
       coalesce(ft.pass_through_fee, 0::numeric) as pass_through_fee,
       coalesce(ft.declaration_fee, 0::numeric) as declaration_fee,
       coalesce(ft.loading_fee, 0::numeric) as loading_fee,
       coalesce(ft.other_fee, 0::numeric) as other_fee,
       s.status,
       s.notes,
       s.custom_fields,
       o.custom_fields as order_custom_fields,
       s.load_group_id
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.customer_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.locations er on er.id = s.empty_return_location_id
left join public.locations orl on orl.id = s.offroute_return_location_id
left join public.vehicle_types vt on vt.id = s.vehicle_type_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
left join lateral (
  select t.transport_fee, t.pass_through_fee, t.declaration_fee, t.loading_fee, t.other_fee
  from public.shipment_fee_role_totals t where t.shipment_id = s.id
) ft on true
where s.status <> 'cancelled'
  and (select private.has_perm('statements.view'))
  and o.customer_id = any((select private.my_customer_ids())::uuid[]);
comment on view public.statement_shipment_list is 'Chuyến cho bảng kê của tài khoản khách: chỉ cột của bảng kê, chỉ khách hàng được gán';


-- -----------------------------------------------------------------------------
-- Ghép các chuyến đi chung một xe (cùng lượt)
-- -----------------------------------------------------------------------------
create or replace function public.set_shipment_load_group(p_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_n int;
  v_found int;
  v_vehicles int;
  v_days int;
  v_group uuid;
  v_order smallint;
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('dispatch.create')) then
    raise exception 'Bạn không có quyền điều phối chuyến' using errcode = '42501';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_ids, '{}'::uuid[])) x where x is not null;
  v_n := coalesce(cardinality(v_ids), 0);
  if v_n < 2 then
    raise exception 'Chọn ít nhất 2 chuyến để ghép chung xe' using errcode = '22023';
  end if;
  if v_n > 20 then
    raise exception 'Mỗi lần ghép tối đa 20 chuyến' using errcode = '22023';
  end if;
  perform 1 from public.shipments where id = any(v_ids) order by id for update;
  select count(*), count(distinct vehicle_id), count(distinct (pickup_at at time zone 'Asia/Ho_Chi_Minh')::date)
    into v_found, v_vehicles, v_days
  from public.shipments where id = any(v_ids) and status <> 'cancelled';
  if v_found <> v_n then
    raise exception 'Có chuyến không tồn tại hoặc đã hủy' using errcode = '22023';
  end if;
  if exists (select 1 from public.shipments where id = any(v_ids) and vehicle_id is null) then
    raise exception 'Chọn số xe cho các chuyến trước khi ghép chung xe' using errcode = '22023';
  end if;
  if v_vehicles <> 1 then
    raise exception 'Các chuyến ghép phải cùng một số xe' using errcode = '22023';
  end if;
  if v_days <> 1 then
    raise exception 'Các chuyến ghép phải cùng ngày nhận hàng' using errcode = '22023';
  end if;

  -- Giữ nhóm đã có (VD nhóm 3PL tạo ở cổng nhà xe); nhiều nhóm thì gộp về một
  select load_group_id into v_group from public.shipments
  where id = any(v_ids) and load_group_id is not null order by pickup_at, shipment_code limit 1;
  v_group := coalesce(v_group, gen_random_uuid());
  select min(vehicle_day_order) into v_order from public.shipments where id = any(v_ids);

  update public.shipments s
     set load_group_id = v_group,
         vehicle_day_order = coalesce(v_order, s.vehicle_day_order)
   where (s.id = any(v_ids)
          or s.load_group_id in (select g.load_group_id from public.shipments g where g.id = any(v_ids) and g.load_group_id is not null))
     and s.status <> 'cancelled'
     and (s.load_group_id, s.vehicle_day_order) is distinct from (v_group, coalesce(v_order, s.vehicle_day_order));
  return v_group;
end;
$$;
revoke all on function public.set_shipment_load_group(uuid[]) from public, anon;
grant execute on function public.set_shipment_load_group(uuid[]) to authenticated;

-- Tách nhóm: các chuyến lại là chuyến riêng (giữ nguyên số xe, cước)
create or replace function public.clear_shipment_load_group(p_group_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('dispatch.create')) then
    raise exception 'Bạn không có quyền điều phối chuyến' using errcode = '42501';
  end if;
  if p_group_id is null then
    return 0;
  end if;
  update public.shipments set load_group_id = null where load_group_id = p_group_id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.clear_shipment_load_group(uuid) from public, anon;
grant execute on function public.clear_shipment_load_group(uuid) to authenticated;
