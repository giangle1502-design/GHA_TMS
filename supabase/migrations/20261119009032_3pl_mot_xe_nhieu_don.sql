-- =============================================================================
-- GHA 9032: MỘT XE 3PL CHỞ NHIỀU ĐƠN (GỘP ĐƠN) – mở rộng cổng nhà xe 3PL (9030)
--   LE 19/11/2026: giao 3PL 2 đơn mỗi đơn 25 tấn, chia 3 xe: xe 1 lấy 18 tấn đơn 1, xe 2 lấy phần còn lại
--   của đơn 1 + một phần đơn 2, xe 3 đi phần còn lại của đơn 2.
--   * Mô hình giữ nguyên "1 chuyến = 1 xe của 1 đơn": xe chở 2 đơn = 2 chuyến (mỗi đơn 1 chuyến) cùng số xe,
--     cùng tài xế, đánh dấu chung một nhóm xe (shipments.load_group_id). Cước, bảng kê, phiếu giao hàng
--     theo từng đơn vẫn đúng như cũ.
--   * carrier_register_vehicles_multi(các chuyến, các xe): mỗi xe nhập số lượng lấy của từng chuyến;
--     tổng từng mã hàng không vượt số lượng chuyến (kiểm như 9030). Chuyến nào chưa chia hết giữ phần còn lại.
--   * carrier_portal_shipments trả thêm load_group_id, load_with (các chuyến đi chung xe).
-- =============================================================================

alter table public.shipments add column if not exists load_group_id uuid;
comment on column public.shipments.load_group_id is 'Các chuyến (của nhiều đơn) đi chung một xe: cùng giá trị = cùng xe, cùng lượt';
create index if not exists shipments_load_group_idx on public.shipments (load_group_id) where load_group_id is not null;

create or replace function public.carrier_portal_shipments(
  p_supplier_id uuid default null, p_from date default null, p_to date default null, p_open_only boolean default true
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_sup uuid[] := private.portal_supplier_ids(p_supplier_id);
begin
  if cardinality(v_sup) = 0 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.pickup_at, t.order_code, t.sequence_in_order)
    from (
      select s.id, s.shipment_code, s.sequence_in_order, o.order_code, o.ref_no, o.voucher_no,
             s.pickup_at, s.expected_delivery_at, s.status,
             sp.id as supplier_id, sp.name as supplier_name,
             pl.name as pickup_name, pl.full_address as pickup_address,
             dl.name as delivery_name, dl.full_address as delivery_address,
             er.name as empty_return_name,
             vt.name as vehicle_type_name, s.container_no,
             v.plate_number, d.full_name as driver_name, d.phone as driver_phone,
             s.delivery_method, s.notes,
             sf.shipment_code as split_from_code,
             s.load_group_id,
             (select coalesce(jsonb_agg(g.shipment_code order by g.shipment_code), '[]'::jsonb)
                from public.shipments g
               where s.load_group_id is not null and g.load_group_id = s.load_group_id and g.id <> s.id and g.status <> 'cancelled') as load_with,
             coalesce((select jsonb_agg(jsonb_build_object(
                        'id', i.id, 'line_no', i.line_no, 'item_code', i.item_code, 'item_name', i.item_name,
                        'quantity', i.quantity, 'unit', i.unit, 'weight_kg', i.weight_kg, 'bag_count', i.bag_count)
                        order by i.line_no)
                       from public.shipment_items i where i.shipment_id = s.id), '[]'::jsonb) as items,
             case when s.pricing_unit = 'ton' then s.quantity end as tons
      from public.shipments s
      join public.transport_orders o on o.id = s.order_id
      join public.suppliers sp on sp.id = private.shipment_portal_supplier(s)
      left join public.locations pl on pl.id = s.pickup_location_id
      left join public.locations dl on dl.id = s.delivery_location_id
      left join public.locations er on er.id = s.empty_return_location_id
      left join public.vehicle_types vt on vt.id = s.vehicle_type_id
      left join public.vehicles v on v.id = s.vehicle_id
      left join public.drivers d on d.id = s.driver_id
      left join public.shipments sf on sf.id = s.split_from_id
      where private.shipment_portal_supplier(s) = any(v_sup)
        and s.status <> 'cancelled'
        and (not p_open_only or s.status in ('draft', 'assigned', 'accepted', 'in_transit'))
        and (p_from is null or (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date >= p_from)
        and (p_to is null or (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date <= p_to)
      limit 2000
    ) t
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.carrier_portal_shipments(uuid, date, date, boolean) from public, anon;
grant execute on function public.carrier_portal_shipments(uuid, date, date, boolean) to authenticated;

create or replace function public.carrier_register_vehicles(p_shipment_id uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  v_sup uuid;
  v_allowed uuid[];
  v_n int;
  v_items jsonb;           -- [{id, quantity, weight_kg, bag_count}]
  v_has_items boolean;
  it record;
  ln jsonb;
  k int;
  v_q numeric;
  v_sum numeric;
  v_full boolean := true;  -- mọi mã hàng đã chia hết
  v_line_total numeric[] := '{}';
  v_line_kg numeric[] := '{}';
  v_total_qty numeric := 0;
  v_total_kg numeric := 0;
  v_kg_known boolean := true;
  v_target uuid;
  v_seq int;
  v_new public.shipments;
  v_created text[] := '{}';
  v_plate text;
  v_frac numeric;
  v_rest_kg numeric;
  v_line_no int;
  v_codes text;
begin
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = 'P0001';
  end if;
  v_sup := private.shipment_portal_supplier(s);
  if private.is_supplier_scoped() then
    v_allowed := private.portal_supplier_ids(null);
    if v_sup is null or not (v_sup = any(v_allowed)) then
      raise exception 'Chuyến này không được chỉ định cho nhà xe của bạn' using errcode = '42501';
    end if;
    if not private.has_perm('carrier_portal.use') then
      raise exception 'Bạn không có quyền đăng ký xe' using errcode = '42501';
    end if;
  elsif not private.has_perm('dispatch.update') then
    raise exception 'Bạn không có quyền đăng ký xe' using errcode = '42501';
  end if;
  if v_sup is null then
    raise exception 'Chuyến % chưa chỉ định nhà xe 3PL', s.shipment_code using errcode = '22023';
  end if;
  if s.status not in ('draft', 'assigned', 'accepted') then
    raise exception 'Chuyến % đã chạy hoặc đã xong, không đăng ký lại xe được', s.shipment_code using errcode = '22023';
  end if;
  if s.receivable_id is not null then
    raise exception 'Chuyến % đã lập công nợ, nhờ GHA chia chuyến', s.shipment_code using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nhập ít nhất một xe' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_lines);
  if v_n > 60 then
    raise exception 'Mỗi lần đăng ký tối đa 60 xe' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'quantity', coalesce(i.quantity, 0), 'unit', i.unit,
                                               'weight_kg', i.weight_kg, 'bag_count', i.bag_count) order by i.line_no), '[]'::jsonb)
    into v_items
  from public.shipment_items i where i.shipment_id = s.id and coalesce(i.quantity, 0) > 0;
  v_has_items := jsonb_array_length(v_items) > 0;

  -- Kiểm số lượng: từng xe > 0, tổng từng mã hàng không vượt số lượng của chuyến
  for k in 0 .. v_n - 1 loop
    ln := p_lines -> k;
    v_plate := upper(regexp_replace(coalesce(ln ->> 'plate', ''), '[^A-Za-z0-9]', '', 'g'));
    if length(v_plate) < 4 then
      raise exception 'Xe %: nhập số xe (ví dụ 61K31295)', k + 1 using errcode = '22023';
    end if;
    v_line_total := v_line_total || 0::numeric;
    v_line_kg := v_line_kg || 0::numeric;
  end loop;
  if (select count(distinct upper(regexp_replace(coalesce(x ->> 'plate', ''), '[^A-Za-z0-9]', '', 'g'))) from jsonb_array_elements(p_lines) x) < v_n then
    raise exception 'Mỗi xe chỉ nhập một dòng (đang trùng số xe)' using errcode = '22023';
  end if;

  if v_has_items then
    for it in select * from jsonb_to_recordset(v_items) as x(id uuid, quantity numeric, unit text, weight_kg numeric, bag_count numeric) loop
      v_sum := 0;
      for k in 0 .. v_n - 1 loop
        v_q := coalesce(nullif(trim(p_lines -> k -> 'quantities' ->> it.id::text), '')::numeric, 0);
        if v_q < 0 then
          raise exception 'Xe %: số lượng không được âm', k + 1 using errcode = '22023';
        end if;
        v_sum := v_sum + v_q;
        v_line_total[k + 1] := v_line_total[k + 1] + v_q;
        if it.weight_kg is not null and it.quantity > 0 then
          v_line_kg[k + 1] := v_line_kg[k + 1] + it.weight_kg * v_q / it.quantity;
        elsif upper(coalesce(it.unit, '')) = 'KG' then
          v_line_kg[k + 1] := v_line_kg[k + 1] + v_q;
        else
          v_kg_known := false;
        end if;
      end loop;
      if v_sum > it.quantity + 0.0005 then
        raise exception 'Tổng số lượng các xe (%) vượt số lượng của chuyến (%)',
          to_char(v_sum, 'FM999G999G990D999'), to_char(it.quantity, 'FM999G999G990D999') using errcode = '22023';
      end if;
      if v_sum < it.quantity - 0.0005 then v_full := false; end if;
      v_total_qty := v_total_qty + it.quantity;
      v_total_kg := v_total_kg + coalesce(it.weight_kg, case when upper(coalesce(it.unit, '')) = 'KG' then it.quantity end, 0);
    end loop;
  else
    -- Chuyến không có dòng mã hàng: tính theo tấn thì chia số tấn, còn lại cả chuyến = 1 xe
    v_sum := 0;
    for k in 0 .. v_n - 1 loop
      v_q := coalesce(nullif(trim(p_lines -> k ->> 'quantity'), '')::numeric, 0);
      if v_q < 0 then
        raise exception 'Xe %: số lượng không được âm', k + 1 using errcode = '22023';
      end if;
      v_sum := v_sum + v_q;
      v_line_total[k + 1] := v_q;
    end loop;
    v_total_qty := case when s.pricing_unit = 'ton' then s.quantity else 1 end;
    if v_sum > v_total_qty + 0.0005 then
      raise exception 'Tổng số lượng các xe (%) vượt số lượng của chuyến (%)',
        to_char(v_sum, 'FM999G999G990D999'), to_char(v_total_qty, 'FM999G999G990D999') using errcode = '22023';
    end if;
    v_full := v_sum >= v_total_qty - 0.0005;
    v_kg_known := false;
  end if;
  for k in 1 .. v_n loop
    if v_line_total[k] <= 0 then
      raise exception 'Xe %: nhập số lượng lớn hơn 0', k using errcode = '22023';
    end if;
  end loop;

  select coalesce(max(sequence_in_order), 0) into v_seq from public.shipments where order_id = s.order_id;

  -- Từng xe: xe 1 ghi vào chính chuyến nếu chia đủ; còn lại thành chuyến mới cùng đơn
  for k in 0 .. v_n - 1 loop
    ln := p_lines -> k;
    -- Phần của xe này so với cả chuyến (để chia số tấn khi tính cước theo tấn)
    v_frac := case
      when v_kg_known and v_total_kg > 0 then v_line_kg[k + 1] / v_total_kg
      when v_total_qty > 0 then v_line_total[k + 1] / v_total_qty
      else 1 end;
    if k = 0 and v_full then
      v_target := s.id;
    else
      v_seq := v_seq + 1;
      insert into public.shipments (
        order_id, sequence_in_order, pickup_at, expected_delivery_at, pickup_location_id, delivery_location_id,
        route_id, vehicle_type_id, price_list_id, unit_price, pricing_unit, quantity,
        fuel_support_rate, fuel_support_base, fuel_support_rule_id, pricing_snapshot,
        notes, custom_fields, carrier_supplier_id, plan_id, trip_order, empty_return_location_id, offroute_return_location_id,
        pickup_phone, delivery_phone, pod_photo_required, delivery_days, delivery_method, split_from_id,
        created_by, updated_by)
      values (
        s.order_id, v_seq, s.pickup_at, s.expected_delivery_at, s.pickup_location_id, s.delivery_location_id,
        s.route_id, s.vehicle_type_id, s.price_list_id, s.unit_price, s.pricing_unit,
        case when s.pricing_unit = 'ton' then greatest(round(s.quantity * v_frac, 3), 0.001) else s.quantity end,
        s.fuel_support_rate, s.fuel_support_base, s.fuel_support_rule_id, s.pricing_snapshot,
        s.notes, s.custom_fields, v_sup, s.plan_id, s.trip_order, s.empty_return_location_id, s.offroute_return_location_id,
        s.pickup_phone, s.delivery_phone, s.pod_photo_required, s.delivery_days, s.delivery_method, s.id,
        auth.uid(), auth.uid())
      returning * into v_new;
      v_target := v_new.id;
      v_created := v_created || v_new.shipment_code;
      if v_has_items then
        v_line_no := 0;
        for it in select i.* from public.shipment_items i where i.shipment_id = s.id and coalesce(i.quantity, 0) > 0 order by i.line_no loop
          v_q := coalesce(nullif(trim(ln -> 'quantities' ->> it.id::text), '')::numeric, 0);
          continue when v_q <= 0;
          v_line_no := v_line_no + 1;
          insert into public.shipment_items (shipment_id, line_no, item_code, item_name, quantity, unit, note, custom_fields,
                                             product_id, order_item_id, weight_kg, bag_count)
          values (v_target, v_line_no, it.item_code, it.item_name, v_q, it.unit, it.note, it.custom_fields,
                  it.product_id, it.order_item_id,
                  case when it.weight_kg is not null then round(it.weight_kg * v_q / it.quantity, 3) end,
                  case when it.bag_count is not null then round(it.bag_count * v_q / it.quantity, 2) end);
        end loop;
      end if;
    end if;
    perform private.assign_shipment_3pl_core(v_target, v_sup, ln ->> 'plate', ln ->> 'driver_name', ln ->> 'driver_phone',
                                             ln ->> 'national_id', null, 'Tài xế & 3PL');
    -- Xe chở chung nhiều đơn: đánh dấu cùng nhóm (đăng ký lại riêng một chuyến thì bỏ nhóm)
    update public.shipments set load_group_id = nullif(ln ->> 'load_group_id', '')::uuid
    where id = v_target and load_group_id is distinct from nullif(ln ->> 'load_group_id', '')::uuid;
  end loop;

  -- Chuyến gốc: chia đủ thì giữ phần của xe 1; chưa đủ thì giữ phần còn lại, chưa có xe
  if v_has_items then
    for it in select i.* from public.shipment_items i where i.shipment_id = s.id and coalesce(i.quantity, 0) > 0 loop
      if v_full then
        v_q := coalesce(nullif(trim(p_lines -> 0 -> 'quantities' ->> it.id::text), '')::numeric, 0);
      else
        select it.quantity - coalesce(sum(coalesce(nullif(trim(x -> 'quantities' ->> it.id::text), '')::numeric, 0)), 0)
          into v_q from jsonb_array_elements(p_lines) x;
      end if;
      if v_q <= 0.0005 then
        delete from public.shipment_items where id = it.id;
      elsif abs(v_q - it.quantity) > 0.0005 then
        update public.shipment_items
        set quantity = v_q,
            weight_kg = case when it.weight_kg is not null then round(it.weight_kg * v_q / it.quantity, 3) end,
            bag_count = case when it.bag_count is not null then round(it.bag_count * v_q / it.quantity, 2) end
        where id = it.id;
      end if;
    end loop;
  end if;
  if v_full then
    v_frac := case when v_kg_known and v_total_kg > 0 then v_line_kg[1] / v_total_kg
                   when v_total_qty > 0 then v_line_total[1] / v_total_qty else 1 end;
  else
    v_rest_kg := v_total_kg - (select coalesce(sum(x), 0) from unnest(v_line_kg) x);
    v_frac := case when v_kg_known and v_total_kg > 0 then v_rest_kg / v_total_kg
                   when v_total_qty > 0 then (v_total_qty - (select coalesce(sum(x), 0) from unnest(v_line_total) x)) / v_total_qty else 1 end;
    perform private.assign_shipment_core(s.id, null, null);
    update public.shipments set load_group_id = null where id = s.id and load_group_id is not null;
  end if;
  if s.pricing_unit = 'ton' and v_n > (case when v_full then 1 else 0 end) then
    update public.shipments set quantity = greatest(round(s.quantity * v_frac, 3), 0.001) where id = s.id;
  end if;

  -- Báo điều phối khi 3PL tự chia xe
  if v_created <> '{}' then
    v_codes := array_to_string(v_created, ', ');
    perform private.notify_permission_holders('dispatch.update', 'carrier_split',
      'Nhà xe ' || (select name from public.suppliers where id = v_sup) || ' chia chuyến ' || s.shipment_code,
      'Thêm ' || cardinality(v_created) || ' chuyến: ' || v_codes || '. Kiểm lại cước, phụ thu của các chuyến mới.',
      'shipment', s.id, '/dieu-phoi/don-hang/' || s.order_id);
  end if;

  return jsonb_build_object('updated', s.shipment_code, 'created', to_jsonb(v_created), 'full', v_full);
exception
  when invalid_text_representation then
    raise exception 'Số lượng phải là số' using errcode = '22023';
end;
$$;
revoke all on function public.carrier_register_vehicles(uuid, jsonb) from public, anon;
grant execute on function public.carrier_register_vehicles(uuid, jsonb) to authenticated;

-- Đăng ký xe cho nhiều chuyến cùng lúc: một xe lấy hàng của nhiều đơn
--   p_lines: [{plate, driver_name, driver_phone, national_id, quantities: {<shipment_item_id> | <shipment_id nếu chuyến không có mã hàng>: số}}]
create or replace function public.carrier_register_vehicles_multi(p_shipment_ids uuid[], p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_n int;
  v_lines jsonb := '[]'::jsonb;
  ln jsonb;
  k int;
  v_keys text[];
  v_bad text;
  s record;
  v_sub jsonb;
  v_q jsonb;
  v_has_items boolean;
  v_res jsonb;
  v_created jsonb := '[]'::jsonb;
  v_updated jsonb := '[]'::jsonb;
  v_touch int;
begin
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_shipment_ids, '{}')) x where x is not null;
  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'Chọn ít nhất một chuyến' using errcode = '22023';
  end if;
  if cardinality(v_ids) > 30 then
    raise exception 'Mỗi lần gộp tối đa 30 chuyến' using errcode = '22023';
  end if;
  if (select count(*) from public.shipments where id = any(v_ids)) <> cardinality(v_ids) then
    raise exception 'Không tìm thấy chuyến' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nhập ít nhất một xe' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_lines);
  if v_n > 60 then
    raise exception 'Mỗi lần đăng ký tối đa 60 xe' using errcode = '22023';
  end if;
  if (select count(distinct upper(regexp_replace(coalesce(x ->> 'plate', ''), '[^A-Za-z0-9]', '', 'g'))) from jsonb_array_elements(p_lines) x) < v_n then
    raise exception 'Mỗi xe chỉ nhập một dòng (đang trùng số xe)' using errcode = '22023';
  end if;

  -- Khóa số lượng chỉ được là mã hàng của các chuyến đã chọn (hoặc chính chuyến không có mã hàng)
  select array_agg(i.id::text) into v_keys from public.shipment_items i where i.shipment_id = any(v_ids) and coalesce(i.quantity, 0) > 0;
  v_keys := coalesce(v_keys, '{}') || (select coalesce(array_agg(sh.id::text), '{}') from public.shipments sh
                                        where sh.id = any(v_ids)
                                          and not exists (select 1 from public.shipment_items i where i.shipment_id = sh.id and coalesce(i.quantity, 0) > 0));
  select key into v_bad from jsonb_array_elements(p_lines) x, jsonb_each(coalesce(x -> 'quantities', '{}'::jsonb))
  where not (key = any(v_keys)) limit 1;
  if v_bad is not null then
    raise exception 'Số lượng nhập cho hàng không thuộc các chuyến đã chọn' using errcode = '22023';
  end if;

  -- Mỗi xe: tổng > 0; xe lấy hàng của từ 2 chuyến trở lên thì gắn một nhóm xe
  for k in 0 .. v_n - 1 loop
    ln := p_lines -> k;
    if coalesce((select sum(nullif(trim(value #>> '{}'), '')::numeric) from jsonb_each(coalesce(ln -> 'quantities', '{}'::jsonb))), 0) <= 0 then
      raise exception 'Xe %: nhập số lượng lớn hơn 0', k + 1 using errcode = '22023';
    end if;
    select count(distinct coalesce(i.shipment_id::text, q.key)) into v_touch
    from jsonb_each(coalesce(ln -> 'quantities', '{}'::jsonb)) q
    left join public.shipment_items i on i.id::text = q.key
    where nullif(trim(q.value #>> '{}'), '')::numeric > 0;
    v_lines := v_lines || jsonb_build_array(ln || jsonb_build_object('load_group_id', case when v_touch > 1 then gen_random_uuid()::text end));
  end loop;

  -- Từng chuyến theo ngày nhận, mã chuyến: chỉ các xe có lấy hàng của chuyến đó
  for s in select sh.id, sh.shipment_code from public.shipments sh where sh.id = any(v_ids) order by sh.pickup_at, sh.shipment_code loop
    v_has_items := exists (select 1 from public.shipment_items i where i.shipment_id = s.id and coalesce(i.quantity, 0) > 0);
    v_sub := '[]'::jsonb;
    for ln in select value from jsonb_array_elements(v_lines) loop
      if v_has_items then
        select coalesce(jsonb_object_agg(q.key, q.value), '{}'::jsonb) into v_q
        from jsonb_each(coalesce(ln -> 'quantities', '{}'::jsonb)) q
        join public.shipment_items i on i.id::text = q.key and i.shipment_id = s.id
        where nullif(trim(q.value #>> '{}'), '')::numeric > 0;
        continue when v_q = '{}'::jsonb;
        v_sub := v_sub || jsonb_build_array((ln - 'quantities') || jsonb_build_object('quantities', v_q));
      else
        continue when coalesce(nullif(trim(ln -> 'quantities' ->> s.id::text), '')::numeric, 0) <= 0;
        v_sub := v_sub || jsonb_build_array((ln - 'quantities') || jsonb_build_object('quantity', ln -> 'quantities' ->> s.id::text));
      end if;
    end loop;
    continue when jsonb_array_length(v_sub) = 0;
    v_res := public.carrier_register_vehicles(s.id, v_sub);
    v_updated := v_updated || to_jsonb(s.shipment_code);
    v_created := v_created || coalesce(v_res -> 'created', '[]'::jsonb);
  end loop;

  return jsonb_build_object('updated', v_updated, 'created', v_created);
exception
  when invalid_text_representation then
    raise exception 'Số lượng phải là số' using errcode = '22023';
end;
$$;
revoke all on function public.carrier_register_vehicles_multi(uuid[], jsonb) from public, anon;
grant execute on function public.carrier_register_vehicles_multi(uuid[], jsonb) to authenticated;

