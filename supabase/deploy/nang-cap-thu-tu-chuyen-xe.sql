-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Thứ tự chuyến của xe trong ngày (Điều phối)
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shipments' and column_name = 'vehicle_day_order') then
    raise exception 'CSDL đã được nâng cấp Thứ tự chuyến của xe trong ngày (Điều phối) trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261029000023_vehicle_day_order.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0023: Thứ tự chuyến của xe trong ngày (khách hàng yêu cầu 29/10/2026)
--   Một xe có thể chạy nhiều chuyến cùng ngày (giao xong điểm A rồi sang điểm B nhận hàng).
--   Khi giao xe đã có chuyến cùng ngày, điều phối xác nhận và nhập thứ tự 1, 2, 3...
--   Ứng dụng tài xế xếp chuyến trong ngày theo thứ tự này.
-- =============================================================================

alter table public.shipments
  add column vehicle_day_order smallint check (vehicle_day_order between 1 and 99);
comment on column public.shipments.vehicle_day_order is
  'Thứ tự chuyến của xe trong ngày nhận hàng (1, 2...) khi một xe chạy nhiều chuyến cùng ngày; điều phối nhập khi giao xe';

-- Ghi thứ tự chuyến của xe (null = bỏ thứ tự)
create or replace function public.set_vehicle_day_order(p_shipment_id uuid, p_order smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('dispatch.create')) then
    raise exception 'Bạn không có quyền điều phối chuyến' using errcode = '42501';
  end if;
  if p_order is not null and (p_order < 1 or p_order > 99) then
    raise exception 'Thứ tự chuyến của xe phải từ 1 đến 99' using errcode = '22023';
  end if;
  update public.shipments set vehicle_day_order = p_order
  where id = p_shipment_id and status <> 'cancelled';
  if not found then
    raise exception 'Không tìm thấy chuyến hoặc chuyến đã hủy' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.set_vehicle_day_order(uuid, smallint) from public, anon;
grant execute on function public.set_vehicle_day_order(uuid, smallint) to authenticated;

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
  s.freight_amount + s.surcharge_amount + s.fuel_support_amount as total_revenue,
  s.status, s.document_status, s.settlement_status,
  s.notes, s.version, s.created_at, s.updated_at,
  s.custom_fields, o.custom_fields as order_custom_fields,
  s.vehicle_day_order
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.customer_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicle_types vt on vt.id = s.vehicle_type_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id;

drop function public.driver_link_trips(text);
create function public.driver_link_trips(p_token text)
returns table (
  shipment_id uuid,
  shipment_code text,
  status text,
  pickup_at timestamptz,
  expected_delivery_at timestamptz,
  plate_number text,
  vehicle_type_name text,
  quantity numeric,
  notes text,
  pickup_name text,
  pickup_address text,
  pickup_contact text,
  pickup_phone text,
  pickup_maps_url text,
  pickup_gate_instructions text,
  delivery_name text,
  delivery_address text,
  delivery_contact text,
  delivery_phone text,
  delivery_maps_url text,
  delivery_gate_instructions text,
  driver_name text,
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  delivery_result text,
  photo_count bigint,
  expense_declaration text,
  expense_count bigint,
  expense_total numeric,
  outsourced boolean,
  vehicle_day_order smallint
)
language sql
security definer
set search_path = ''
as $$
  select s.id, s.shipment_code, s.status, s.pickup_at, s.expected_delivery_at,
         v.plate_number, vt.name, s.quantity, s.notes,
         pl.name, pl.full_address, pl.contact_name, pl.phone,
         coalesce(pl.google_maps_url, case when pl.latitude is not null then
           'https://www.google.com/maps/search/?api=1&query=' || pl.latitude || ',' || pl.longitude end),
         pl.gate_instructions,
         dl.name, dl.full_address, dl.contact_name, dl.phone,
         coalesce(dl.google_maps_url, case when dl.latitude is not null then
           'https://www.google.com/maps/search/?api=1&query=' || dl.latitude || ',' || dl.longitude end),
         dl.gate_instructions,
         d.full_name, a.responded_at, s.departed_pickup_at, s.completed_at, s.delivery_result,
         (select count(*) from public.documents doc
           where doc.entity_type = 'shipment' and doc.entity_id = s.id and doc.archived_at is null),
         s.expense_declaration,
         (select count(*) from public.shipment_expenses e where e.shipment_id = s.id and e.source = 'driver' and e.status in ('pending', 'approved')),
         (select coalesce(sum(e.amount), 0) from public.shipment_expenses e where e.shipment_id = s.id and e.source = 'driver' and e.status in ('pending', 'approved')),
         coalesce(v.ownership_type = 'outsourced', false),
         s.vehicle_day_order
  from private.driver_link_session(p_token) me
  join public.shipments s on private.driver_link_visible(me.vehicle_id, s)
  join public.drivers d on d.id = s.driver_id
  join public.locations pl on pl.id = s.pickup_location_id
  join public.locations dl on dl.id = s.delivery_location_id
  left join public.vehicles v on v.id = s.vehicle_id
  left join public.vehicle_types vt on vt.id = s.vehicle_type_id
  left join public.shipment_assignments a
    on a.shipment_id = s.id and a.driver_id = s.driver_id and a.response = 'accepted'
  where (s.status in ('assigned', 'accepted', 'in_transit')
     or (s.status in ('driver_completed', 'closed') and s.pickup_at > now() - interval '3 days'))
  order by (s.status = 'assigned') desc, (s.status = 'in_transit') desc,
           (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date, s.vehicle_day_order nulls last, s.pickup_at
  limit 100;
$$;
revoke all on function public.driver_link_trips(text) from public;
grant execute on function public.driver_link_trips(text) to anon, authenticated;

commit;
