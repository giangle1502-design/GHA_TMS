-- =============================================================================
-- GHA TMS - 0010: Hàm đọc dữ liệu cho ứng dụng tài xế
-- Tài xế không có quyền đọc bảng địa điểm/xe/khách hàng; hàm này chỉ trả về
-- thông tin cần thiết của các chuyến được phân công cho chính tài xế đang đăng nhập.
-- =============================================================================
create or replace function public.driver_list_my_shipments(p_include_finished boolean default false)
returns table (
  shipment_id uuid,
  shipment_code text,
  status text,
  pickup_at timestamptz,
  expected_delivery_at timestamptz,
  plate_number text,
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
  assignment_id uuid,
  assignment_response text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.shipment_code, s.status, s.pickup_at, s.expected_delivery_at,
         v.plate_number, s.notes,
         pl.name, pl.full_address, pl.contact_name, pl.phone,
         coalesce(pl.google_maps_url, case when pl.latitude is not null then
           'https://www.google.com/maps/search/?api=1&query=' || pl.latitude || ',' || pl.longitude end),
         pl.gate_instructions,
         dl.name, dl.full_address, dl.contact_name, dl.phone,
         coalesce(dl.google_maps_url, case when dl.latitude is not null then
           'https://www.google.com/maps/search/?api=1&query=' || dl.latitude || ',' || dl.longitude end),
         dl.gate_instructions,
         a.id, a.response
  from public.shipments s
  join public.locations pl on pl.id = s.pickup_location_id
  join public.locations dl on dl.id = s.delivery_location_id
  left join public.vehicles v on v.id = s.vehicle_id
  left join public.shipment_assignments a
    on a.shipment_id = s.id and a.driver_id = s.driver_id and a.response in ('pending', 'accepted')
  where private.has_perm('driver_app.use')
    and s.driver_id = private.my_driver_id()
    and s.status not in ('draft', 'cancelled')
    and (p_include_finished or s.status not in ('closed'))
  order by s.pickup_at desc
  limit 200;
$$;
revoke all on function public.driver_list_my_shipments(boolean) from public, anon;
grant execute on function public.driver_list_my_shipments(boolean) to authenticated;
