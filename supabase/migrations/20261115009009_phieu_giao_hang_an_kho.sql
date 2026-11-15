-- Phiếu giao hàng: bên giao chỉ ghi tên + địa chỉ công ty khách (VAP/PLA...), không ghi kho/điểm nhận (LE 15/11/2026)
-- Thêm shipper_address (customers.billing_address); bỏ hẳn tên/địa chỉ/SĐT kho nhận khỏi dữ liệu phiếu
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
    'shipper_address', c.billing_address,
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
  left join public.locations dl on dl.id = s.delivery_location_id
  left join public.vehicles v on v.id = s.vehicle_id
  left join public.vehicles t on t.id = s.trailer_id
  left join public.drivers d on d.id = s.driver_id
  where s.id = p_shipment_id;
$$;
revoke all on function private.delivery_note_json(uuid) from public, anon, authenticated;
