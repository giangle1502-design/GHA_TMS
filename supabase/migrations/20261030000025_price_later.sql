-- =============================================================================
-- KHÁNH HÀ TMS - 0025: Cho tạo chuyến khi chưa biết giá (khách hàng yêu cầu 30/10/2026)
--   Không có bảng giá và chưa nhập đơn giá: chuyến vẫn tạo được, đơn giá 0, pricing_snapshot.price_source = 'pending'.
--   Giá và phụ phí nhập sau ở bảng Quản lý chuyến xe (sửa nhanh) hoặc chi tiết chuyến.
-- =============================================================================

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
      fuel_support_rate, fuel_support_base, fuel_support_amount, fuel_support_rule_id, pricing_snapshot, notes, custom_fields
    ) values (
      o.id, v_seq, v_pickup_at, nullif(item ->> 'expected_delivery_at', '')::timestamptz, v_pickup, v_delivery,
      v_route.id, v_vtype, v_vehicle, v_pl.id, v_unit_price, v_pricing_unit,
      coalesce(nullif(item ->> 'quantity', '')::numeric, 1), v_surcharge,
      v_rate, v_base, v_fuel_amount, v_rule_id, v_snapshot, nullif(trim(item ->> 'notes'), ''),
      case when jsonb_typeof(item -> 'custom_fields') = 'object' then item -> 'custom_fields' else '{}'::jsonb end
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
