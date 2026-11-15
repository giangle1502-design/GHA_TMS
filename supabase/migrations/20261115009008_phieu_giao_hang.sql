-- Phiếu giao hàng (in A4 / tải PDF) cho từng chuyến.
-- Dữ liệu phiếu KHÔNG có cước, KHÔNG có tên nhà xe 3PL: xe nào cũng chỉ hiện biển số như xe của GHA.
-- Hai cửa vào:
--   public.delivery_note(shipment_id)                 : người dùng đăng nhập (cùng điều kiện xem chuyến như RLS shipments)
--   public.driver_link_delivery_note(token, shipment_id): app tài xế (/tx), chỉ chuyến của xe đang đăng nhập

-- Địa chỉ công ty GHA dùng trên chứng từ (LE chốt 15/11/2026); chỉ điền khi đang trống
update public.company_entities
   set address = 'Số nhà 67N2 KDC PTĐT Tân Bình, Tân Phước, Tân Đông Hiệp, TP. Hồ Chí Minh'
 where (tax_code = '3703489735' or code = 'GHA') and coalesce(btrim(address), '') = '';

create or replace function private.delivery_note_json(p_shipment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shipment_code', s.shipment_code,
    'order_code', o.order_code,
    'voucher_no', o.voucher_no,
    'ref_no', o.ref_no,
    'note_date', coalesce(o.delivery_date, (s.expected_delivery_at at time zone 'Asia/Ho_Chi_Minh')::date,
                          (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date),
    'company', case when ce.id is null then null else jsonb_build_object(
      'name', ce.name, 'tax_code', ce.tax_code, 'address', ce.address, 'phone', ce.phone) end,
    'shipper_name', c.name,
    'pickup_name', pl.name,
    'pickup_address', pl.full_address,
    'pickup_phone', coalesce(s.pickup_phone, pl.phone),
    'delivery_name', dl.name,
    'delivery_company', dl.company_name,
    'delivery_address', dl.full_address,
    'delivery_phone', coalesce(s.delivery_phone, dl.phone),
    'plate_number', v.plate_number,
    'trailer_plate', t.plate_number,
    'container_no', s.container_no,
    'driver_name', d.full_name,
    'driver_phone', d.phone,
    'quantity', s.quantity,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'line_no', i.line_no, 'item_code', i.item_code, 'item_name', i.item_name,
               'unit', i.unit, 'quantity', i.quantity, 'note', i.note) order by i.line_no)
      from public.shipment_items i where i.shipment_id = s.id), '[]'::jsonb)
  )
  from public.shipments s
  join public.transport_orders o on o.id = s.order_id
  left join public.company_entities ce on ce.id = o.company_entity_id
  left join public.customers c on c.id = o.customer_id
  left join public.locations pl on pl.id = s.pickup_location_id
  left join public.locations dl on dl.id = s.delivery_location_id
  left join public.vehicles v on v.id = s.vehicle_id
  left join public.vehicles t on t.id = s.trailer_id
  left join public.drivers d on d.id = s.driver_id
  where s.id = p_shipment_id;
$$;
revoke all on function private.delivery_note_json(uuid) from public, anon, authenticated;

create or replace function public.delivery_note(p_shipment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.delivery_note_json(s.id)
  from public.shipments s
  where s.id = p_shipment_id
    and (private.has_perm('shipments.view') or private.has_perm('dispatch.view')
         or (s.driver_id is not null and s.driver_id = private.my_driver_id() and private.has_perm('driver_app.use')));
$$;
revoke all on function public.delivery_note(uuid) from public;
grant execute on function public.delivery_note(uuid) to authenticated;

create or replace function public.driver_link_delivery_note(p_token text, p_shipment_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.delivery_note_json(s.id)
  from private.driver_link_session(p_token) me
  join public.shipments s on s.id = p_shipment_id and private.driver_link_visible(me.vehicle_id, s)
  where s.status not in ('draft', 'cancelled');
$$;
revoke all on function public.driver_link_delivery_note(text, uuid) from public;
grant execute on function public.driver_link_delivery_note(text, uuid) to anon, authenticated;
