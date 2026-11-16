-- =============================================================================
-- GHA 9014: Số bao trên phiếu giao hàng (LE yêu cầu 16/11/2026)
--   * shipment_items.bag_count: số bao của từng dòng hàng (nhập tay, không bắt buộc).
--   * Để trống thì phiếu tự tính khi có đủ dữ liệu:
--       - ĐVT là BAO: số bao = số lượng;
--       - mã hàng có quy cách đóng gói (Bao 25 kg, Jumbo 1 tấn...): số bao = số lượng × kg/ĐVT ÷ kg/bao.
--   * set_shipment_items nhận thêm bag_count; delivery_note_json trả bag_count từng dòng.
-- Không xóa, không sửa dữ liệu có sẵn.
-- =============================================================================

alter table public.shipment_items
  add column if not exists bag_count numeric(14,2) check (bag_count is null or bag_count >= 0);
comment on column public.shipment_items.bag_count is 'Số bao của dòng hàng (in trên phiếu giao hàng). Trống thì tự tính theo quy cách mã hàng';

-- Thay toàn bộ danh sách hàng hóa của chuyến (dòng trống bị bỏ qua)
create or replace function public.set_shipment_items(p_shipment_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  it jsonb;
  n int := 0;
  v_code text; v_name text; v_qty numeric; v_unit text; v_note text; v_custom jsonb; v_bags numeric;
begin
  if not (private.has_perm('dispatch.create') or private.has_perm('dispatch.update')) then
    raise exception 'Bạn không có quyền nhập hàng hóa của chuyến' using errcode = '42501';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = '22023';
  end if;
  if s.status in ('closed', 'cancelled') then
    raise exception 'Chuyến đã đóng hoặc đã hủy, không sửa hàng hóa' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Danh sách hàng hóa không hợp lệ' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 500 then
    raise exception 'Mỗi chuyến tối đa 500 dòng hàng hóa' using errcode = '22023';
  end if;
  delete from public.shipment_items where shipment_id = s.id;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_code := nullif(trim(coalesce(it ->> 'item_code', '')), '');
    v_name := nullif(trim(coalesce(it ->> 'item_name', '')), '');
    v_qty := nullif(trim(coalesce(it ->> 'quantity', '')), '')::numeric;
    v_unit := nullif(trim(coalesce(it ->> 'unit', '')), '');
    v_note := nullif(trim(coalesce(it ->> 'note', '')), '');
    v_bags := nullif(trim(coalesce(it ->> 'bag_count', '')), '')::numeric;
    if v_bags < 0 then
      raise exception 'Số bao không được âm' using errcode = '22023';
    end if;
    v_custom := case when jsonb_typeof(it -> 'custom_fields') = 'object' then it -> 'custom_fields' else '{}'::jsonb end;
    continue when v_code is null and v_name is null and v_qty is null and v_note is null and v_bags is null and v_custom = '{}'::jsonb;
    n := n + 1;
    insert into public.shipment_items (shipment_id, line_no, item_code, item_name, quantity, unit, note, bag_count, custom_fields)
    values (s.id, n, v_code, v_name, v_qty, v_unit, v_note, v_bags, v_custom);
  end loop;
  return n;
exception
  when invalid_text_representation then
    raise exception 'Số lượng và số bao của hàng hóa phải là số' using errcode = '22023';
end;
$$;
revoke all on function public.set_shipment_items(uuid, jsonb) from public, anon;
grant execute on function public.set_shipment_items(uuid, jsonb) to authenticated;

-- Số bao tự tính của một dòng hàng (null khi không đủ dữ liệu)
create or replace function private.item_bag_count(p_item public.shipment_items)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_item.bag_count is not null then p_item.bag_count
    when p_item.quantity is null then null
    when upper(trim(coalesce(p_item.unit, ''))) in ('BAO', 'BAG', 'BAGS') then p_item.quantity
    else (
      select round(p_item.quantity
                   * coalesce(p.kg_per_unit, case when upper(trim(coalesce(p_item.unit, p.unit))) = 'KG' then 1 end)
                   / nullif((pk.metadata ->> 'kg_per_pack')::numeric, 0), 2)
      from public.products p
      join public.catalog_items pk on pk.id = p.packing_id
      where p.id = p_item.product_id
         or (p_item.product_id is null and p_item.item_code is not null and upper(p.code) = upper(p_item.item_code))
      order by (p.id = p_item.product_id) desc nulls last
      limit 1)
  end;
$$;
revoke all on function private.item_bag_count(public.shipment_items) from public, anon, authenticated;

-- Phiếu giao hàng: thêm bag_count từng dòng (giữ nguyên các trường khác của bản 9009)
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
               'unit', i.unit, 'quantity', i.quantity, 'note', i.note,
               'bag_count', private.item_bag_count(i)) order by i.line_no)
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
