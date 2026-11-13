-- =============================================================================
-- KHÁNH HÀ TMS - 0013: Điều phối (Giai đoạn 4)
--   1. Bỏ khái niệm "tài xế từ chối chuyến" (Khánh Hà xác nhận 2026-10-21)
--   2. Tự tính tiền hỗ trợ dầu từ tham số đã chụp trên chuyến
--   3. Hàm nghiệp vụ: tạo đơn hàng nhiều chuyến, phân công, gỡ phân công, hủy chuyến
--   4. View danh sách chuyến cho bảng điều phối / bảng tổng hợp
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Bỏ trạng thái từ chối
-- -----------------------------------------------------------------------------
update public.shipments set status = 'assigned' where status = 'rejected';
update public.shipment_assignments set response = 'superseded' where response = 'rejected';

alter table public.shipments drop constraint shipments_status_check;
alter table public.shipments add constraint shipments_status_check
  check (status in ('draft', 'assigned', 'accepted', 'in_transit', 'driver_completed', 'closed', 'cancelled'));

alter table public.shipment_assignments drop constraint shipment_assignments_check;
alter table public.shipment_assignments drop constraint shipment_assignments_response_check;
alter table public.shipment_assignments add constraint shipment_assignments_response_check
  check (response in ('pending', 'accepted', 'superseded'));
alter table public.shipment_assignments drop column reject_reason;

create or replace function private.shipment_transition_allowed(from_s text, to_s text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select from_s = to_s or (from_s, to_s) in (
    ('draft', 'assigned'), ('draft', 'cancelled'),
    ('assigned', 'accepted'), ('assigned', 'draft'), ('assigned', 'cancelled'),
    ('accepted', 'in_transit'), ('accepted', 'assigned'), ('accepted', 'draft'), ('accepted', 'cancelled'),
    ('in_transit', 'driver_completed'), ('in_transit', 'cancelled'),
    ('driver_completed', 'in_transit'), ('driver_completed', 'closed'),
    ('closed', 'driver_completed')
  );
$$;

-- -----------------------------------------------------------------------------
-- 2. Tiền hỗ trợ dầu = tỷ lệ × cơ sở tính, tính lại mỗi khi giá/số lượng đổi.
--    Cơ sở 'fuel_norm' / 'formula' giữ nguyên số tiền đã tính lúc tạo chuyến.
-- -----------------------------------------------------------------------------
create or replace function private.shipments_fuel_amount()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fuel_support_rate is not null and new.fuel_support_base in ('freight_revenue', 'unit_price', 'total_revenue') then
    new.fuel_support_amount := round(
      case new.fuel_support_base
        when 'freight_revenue' then round(new.unit_price * new.quantity, 0)
        when 'unit_price' then new.unit_price
        else round(new.unit_price * new.quantity, 0) + new.surcharge_amount
      end * new.fuel_support_rate / 100, 0);
  end if;
  return new;
end;
$$;
create trigger trg_shipments_pricing before insert or update on public.shipments
for each row execute function private.shipments_fuel_amount();

-- -----------------------------------------------------------------------------
-- 3. Hàm nghiệp vụ
-- -----------------------------------------------------------------------------

-- Bảng giá ứng viên (đọc với quyền hệ thống: người tạo chuyến không cần quyền xem bảng giá)
create or replace function private.price_candidates(
  p_customer_id uuid, p_pickup uuid, p_delivery uuid, p_vehicle_type uuid, p_on date
)
returns table (
  id uuid, code text, unit_price numeric, pricing_unit text, pricing_unit_label text,
  fuel_support_rate numeric, surcharge_amount numeric, specificity integer, priority integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select pl.id, pl.code, pl.unit_price, pl.pricing_unit, pl.pricing_unit_label, pl.fuel_support_rate, pl.surcharge_amount,
         ((pl.customer_id is not null)::int * 8 + (pl.pickup_location_id is not null)::int * 2
          + (pl.delivery_location_id is not null)::int * 2 + (pl.vehicle_type_id is not null)::int * 4),
         pl.priority
  from public.transport_price_lists pl
  where pl.status = 'active'
    and p_on between pl.effective_from and coalesce(pl.effective_to, 'infinity'::date)
    and (pl.customer_id is null or pl.customer_id = p_customer_id)
    and (pl.pickup_location_id is null or pl.pickup_location_id = p_pickup)
    and (pl.delivery_location_id is null or pl.delivery_location_id = p_delivery)
    and (pl.vehicle_type_id is null or pl.vehicle_type_id = p_vehicle_type)
  order by 8 desc, pl.priority desc, pl.effective_from desc;
$$;
revoke all on function private.price_candidates(uuid, uuid, uuid, uuid, date) from public;
grant execute on function private.price_candidates(uuid, uuid, uuid, uuid, date) to authenticated;

-- Quy tắc hỗ trợ dầu theo thứ tự ưu tiên: khách hàng + tuyến > tuyến > khách hàng > loại xe > mặc định
create or replace function private.fuel_rule_for(p_customer_id uuid, p_route_id uuid, p_vehicle_type uuid, p_on date)
returns public.fuel_support_rules
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from public.fuel_support_rules r
  where r.is_active
    and p_on between r.effective_from and coalesce(r.effective_to, 'infinity'::date)
    and (
      (r.scope_type = 'customer_route' and r.customer_id = p_customer_id and r.route_id = p_route_id)
      or (r.scope_type = 'route' and r.route_id = p_route_id)
      or (r.scope_type = 'customer' and r.customer_id = p_customer_id)
      or (r.scope_type = 'vehicle_type' and r.vehicle_type_id = p_vehicle_type)
      or r.scope_type = 'default'
    )
  order by case r.scope_type when 'customer_route' then 1 when 'route' then 2 when 'customer' then 3 when 'vehicle_type' then 4 else 5 end
  limit 1;
$$;
revoke all on function private.fuel_rule_for(uuid, uuid, uuid, date) from public;
grant execute on function private.fuel_rule_for(uuid, uuid, uuid, date) to authenticated;

-- Báo giá cho một chuyến (dùng ở màn hình tạo đơn để hiển thị trước khi lưu)
create or replace function public.quote_shipment(
  p_customer_id uuid, p_pickup uuid, p_delivery uuid, p_vehicle_type uuid, p_on date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_route public.routes;
  v_rule public.fuel_support_rules;
  v_candidates jsonb;
begin
  if not (private.has_perm('dispatch.create') or private.has_perm('dispatch.update')) then
    raise exception 'Bạn không có quyền tạo chuyến' using errcode = '42501';
  end if;
  select * into v_route from public.routes r
  where r.pickup_location_id = p_pickup and r.delivery_location_id = p_delivery and r.is_active;
  v_rule := private.fuel_rule_for(p_customer_id, v_route.id, p_vehicle_type, p_on);
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_candidates
  from private.price_candidates(p_customer_id, p_pickup, p_delivery, p_vehicle_type, p_on) c;
  return jsonb_build_object(
    'route', case when v_route.id is null then null else jsonb_build_object('id', v_route.id, 'name', v_route.name, 'distance_km', v_route.distance_km) end,
    'candidates', v_candidates,
    'fuel_rule', case when v_rule.id is null then null else jsonb_build_object(
      'id', v_rule.id, 'scope_type', v_rule.scope_type, 'rate_percent', v_rule.rate_percent, 'calculation_base', v_rule.calculation_base) end
  );
end;
$$;
revoke all on function public.quote_shipment(uuid, uuid, uuid, uuid, date) from public, anon;
grant execute on function public.quote_shipment(uuid, uuid, uuid, uuid, date) to authenticated;

-- Phân công / đổi / gỡ phân công (p_driver_id null = gỡ, chuyến về Nháp)
create or replace function public.assign_shipment(p_shipment_id uuid, p_driver_id uuid, p_vehicle_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.shipments;
  a public.shipment_assignments;
  v_driver_status text;
begin
  if not private.has_perm('dispatch.update') then
    raise exception 'Bạn không có quyền phân công chuyến' using errcode = '42501';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = 'P0001';
  end if;
  if s.status not in ('draft', 'assigned', 'accepted') then
    raise exception 'Chỉ phân công được chuyến chưa chạy (Nháp, Chờ tài xế nhận, Tài xế đã nhận)' using errcode = '22023';
  end if;
  if p_driver_id is not null then
    select status into v_driver_status from public.drivers where id = p_driver_id and archived_at is null;
    if v_driver_status is null then
      raise exception 'Tài xế không tồn tại hoặc đã lưu trữ' using errcode = 'P0001';
    end if;
    if v_driver_status <> 'active' then
      raise exception 'Tài xế không ở trạng thái đang làm việc' using errcode = '22023';
    end if;
  end if;
  if p_vehicle_id is not null and not exists (
    select 1 from public.vehicles v where v.id = p_vehicle_id and v.archived_at is null and v.status in ('active', 'maintenance')
  ) then
    raise exception 'Xe không tồn tại hoặc đã ngừng hoạt động' using errcode = 'P0001';
  end if;

  select * into a from public.shipment_assignments where shipment_id = s.id and response in ('pending', 'accepted');

  -- Cùng tài xế: chỉ đổi xe, giữ phân công
  if p_driver_id is not null and a.id is not null and a.driver_id = p_driver_id then
    update public.shipment_assignments set vehicle_id = p_vehicle_id where id = a.id;
    update public.shipments set vehicle_id = p_vehicle_id, driver_id = p_driver_id,
      status = case when status = 'draft' then 'assigned' else status end
    where id = s.id;
    return;
  end if;

  if a.id is not null then
    update public.shipment_assignments set response = 'superseded', responded_at = now() where id = a.id;
  end if;

  if p_driver_id is null then
    update public.shipments set driver_id = null, vehicle_id = p_vehicle_id, status = 'draft' where id = s.id;
  else
    insert into public.shipment_assignments (shipment_id, driver_id, vehicle_id, assigned_by)
    values (s.id, p_driver_id, p_vehicle_id, auth.uid());
    update public.shipments set driver_id = p_driver_id, vehicle_id = p_vehicle_id, status = 'assigned' where id = s.id;
  end if;
end;
$$;
revoke all on function public.assign_shipment(uuid, uuid, uuid) from public, anon;
grant execute on function public.assign_shipment(uuid, uuid, uuid) to authenticated;

-- Hủy chuyến (bắt buộc lý do, không xóa)
create or replace function public.cancel_shipment(p_shipment_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  if not (private.has_perm('dispatch.delete') or private.has_perm('shipments.delete')) then
    raise exception 'Bạn không có quyền hủy chuyến' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Vui lòng nhập lý do hủy chuyến' using errcode = '22023';
  end if;
  select status into v_status from public.shipments where id = p_shipment_id for update;
  if v_status is null then
    raise exception 'Không tìm thấy chuyến' using errcode = 'P0001';
  end if;
  if v_status not in ('draft', 'assigned', 'accepted', 'in_transit') then
    raise exception 'Chuyến đã hoàn thành, đã đóng hoặc đã hủy, không hủy được' using errcode = '22023';
  end if;
  update public.shipment_assignments set response = 'superseded', responded_at = now()
  where shipment_id = p_shipment_id and response in ('pending', 'accepted');
  update public.shipments set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_shipment_id;
end;
$$;
revoke all on function public.cancel_shipment(uuid, text) from public, anon;
grant execute on function public.cancel_shipment(uuid, text) to authenticated;

-- Tạo đơn hàng gồm nhiều chuyến (hoặc thêm chuyến vào đơn đang mở khi p_order có "id").
-- Giá và hỗ trợ dầu được xác định ở máy chủ và chụp lại trên từng chuyến.
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
    insert into public.transport_orders (order_date, company_entity_id, customer_id, payer_customer_id, dispatcher_id, notes)
    values (
      coalesce((p_order ->> 'order_date')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date),
      nullif(p_order ->> 'company_entity_id', '')::uuid,
      (p_order ->> 'customer_id')::uuid,
      coalesce(nullif(p_order ->> 'payer_customer_id', '')::uuid, (p_order ->> 'customer_id')::uuid),
      auth.uid(),
      nullif(trim(p_order ->> 'notes'), '')
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
      v_unit_price := nullif(item ->> 'unit_price', '')::numeric;
      if v_unit_price is null then
        raise exception 'Chuyến %: không có bảng giá phù hợp, vui lòng nhập đơn giá', v_idx using errcode = '22023';
      end if;
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
      'price_source', case when v_pl.id is null then 'manual' else 'price_list' end,
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
      fuel_support_rate, fuel_support_base, fuel_support_amount, fuel_support_rule_id, pricing_snapshot, notes
    ) values (
      o.id, v_seq, v_pickup_at, nullif(item ->> 'expected_delivery_at', '')::timestamptz, v_pickup, v_delivery,
      v_route.id, v_vtype, v_vehicle, v_pl.id, v_unit_price, v_pricing_unit,
      coalesce(nullif(item ->> 'quantity', '')::numeric, 1), v_surcharge,
      v_rate, v_base, v_fuel_amount, v_rule_id, v_snapshot, nullif(trim(item ->> 'notes'), '')
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
revoke all on function public.create_transport_order(jsonb, jsonb) from public, anon;
grant execute on function public.create_transport_order(jsonb, jsonb) to authenticated;

-- Thông báo cho tài xế khi được phân công (bảng notifications không cho người dùng tự ghi)
create or replace function private.notify_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
  v_code text;
begin
  select d.profile_id into v_profile from public.drivers d where d.id = new.driver_id;
  if v_profile is null then
    return new;
  end if;
  select s.shipment_code into v_code from public.shipments s where s.id = new.shipment_id;
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
  values (v_profile, 'shipment_assigned', 'Bạn được phân công chuyến ' || v_code,
          'Mở ứng dụng tài xế để xem điểm nhận, điểm giao và giờ nhận hàng.', 'shipment', new.shipment_id, '/tx');
  return new;
end;
$$;
create trigger trg_assignment_notify after insert on public.shipment_assignments
for each row execute function private.notify_assignment();

-- -----------------------------------------------------------------------------
-- 4. View danh sách chuyến (security invoker: RLS của từng bảng vẫn áp dụng)
-- -----------------------------------------------------------------------------
create view public.shipment_list with (security_invoker = true) as
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
  s.freight_amount + s.surcharge_amount + s.fuel_support_amount as total_revenue,
  s.status, s.document_status, s.settlement_status,
  s.notes, s.version, s.created_at, s.updated_at
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.customer_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicle_types vt on vt.id = s.vehicle_type_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id;
revoke all on public.shipment_list from anon;
grant select on public.shipment_list to authenticated;

-- Tên hiển thị của người thao tác (lịch sử chuyến, người tạo đơn) cho người không có quyền xem danh sách người dùng.
-- Chỉ trả họ tên (hoặc phần trước @ của email), không trả email/điện thoại.
create or replace function public.user_display_names(p_ids uuid[])
returns table (id uuid, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1))
  from public.profiles p
  where private.is_active_user() and p.id = any (p_ids[1:200]);
$$;
revoke all on function public.user_display_names(uuid[]) from public, anon;
grant execute on function public.user_display_names(uuid[]) to authenticated;

-- Tổng hợp theo bộ lọc của bảng chuyến: số chuyến theo trạng thái và tổng tiền (không tính chuyến hủy).
-- security invoker: chỉ cộng các chuyến người gọi được xem.
create or replace function public.shipment_list_summary(p_from timestamptz, p_to timestamptz, p_customer_id uuid default null, p_q text default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (
    select l.* from public.shipment_list l
    where l.pickup_at >= p_from and l.pickup_at < p_to
      and (p_customer_id is null or l.customer_id = p_customer_id)
      and (coalesce(p_q, '') = '' or concat_ws(' ', l.shipment_code, l.order_code, l.customer_name, l.plate_number, l.driver_name, l.pickup_name, l.delivery_name) ilike '%' || p_q || '%')
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'by_status', (select coalesce(jsonb_object_agg(status, jsonb_build_object(
        'count', n, 'freight', freight, 'surcharge', surcharge, 'fuel', fuel, 'revenue', revenue)), '{}'::jsonb)
      from (select status, count(*) as n, sum(freight_amount) as freight, sum(surcharge_amount) as surcharge,
                   sum(fuel_support_amount) as fuel, sum(total_revenue) as revenue
            from f group by status) x)
  );
$$;
revoke all on function public.shipment_list_summary(timestamptz, timestamptz, uuid, text) from public, anon;
grant execute on function public.shipment_list_summary(timestamptz, timestamptz, uuid, text) to authenticated;

-- Lịch sử thay đổi các trường tiền/khối lượng của một chuyến (trích từ nhật ký hệ thống),
-- cho người xem được chuyến mà không cần quyền xem toàn bộ nhật ký.
create or replace function public.shipment_change_history(p_shipment_id uuid)
returns table (occurred_at timestamptz, actor_name text, field text, old_value text, new_value text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.occurred_at,
         coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)),
         f.field, a.old_data ->> f.field, a.new_data ->> f.field
  from public.audit_logs a
  cross join lateral unnest(a.changed_fields) as f(field)
  left join public.profiles p on p.id = a.actor_id
  where (private.has_perm('shipments.view') or private.has_perm('dispatch.view'))
    and a.entity_type = 'shipments' and a.entity_id = p_shipment_id::text and a.action = 'update'
    and f.field in ('unit_price', 'quantity', 'surcharge_amount', 'fuel_support_rate', 'fuel_support_amount', 'price_list_id',
                    'pricing_unit', 'vehicle_id', 'driver_id', 'pickup_at', 'expected_delivery_at', 'notes')
  order by a.occurred_at desc, f.field
  limit 300;
$$;
revoke all on function public.shipment_change_history(uuid) from public, anon;
grant execute on function public.shipment_change_history(uuid) to authenticated;
