-- =============================================================================
-- GHA 9037: Kho GHA không cập nhật ngược (LE 21/11/2026)
--   Mọi chuyến (chọn kho trên đơn / chuyến hoặc theo địa điểm) chỉ cộng / trừ tồn khi HOÀN THÀNH SAU thời điểm
--   đặt tồn đầu kỳ (system_settings 'inventory.auto_from'); phiếu ghi theo ngày hoàn thành.
--   Trước đây chuyến chọn kho trên đơn được tính cả khi hoàn thành trước lúc chạy 9025 → bỏ.
-- Không xóa, không sửa dữ liệu nghiệp vụ có sẵn.
-- =============================================================================
create or replace function private.stock_sync_shipment(p_shipment_id uuid, p_completed_now boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  t record;
  v_owner uuid;
  v_from uuid;
  v_to uuid;
  v_kind text;
  v_bin uuid;
  v_to_bin uuid;
  v_done timestamptz;
  v_since timestamptz;
  v_opening date;
  v_no text;
  v_date date;
begin
  select voucher_no into v_no from public.stock_entries where shipment_id = p_shipment_id and source = 'auto' limit 1;
  delete from public.stock_entries where shipment_id = p_shipment_id and source = 'auto';
  select * into s from public.shipments where id = p_shipment_id;
  if not found or s.status not in ('driver_completed', 'closed') then return; end if;
  if exists (select 1 from public.stock_entries where shipment_id = p_shipment_id and source = 'manual') then return; end if;
  -- Giờ hoàn thành; chuyến cũ không ghi giờ hoàn thành thì lấy giờ nhận hàng
  v_done := coalesce(s.completed_at, case when p_completed_now then now() end, s.pickup_at);
  v_date := (v_done at time zone 'Asia/Ho_Chi_Minh')::date;
  select * into t from private.stock_target(p_shipment_id);
  -- Không ghi ngược: chỉ chuyến hoàn thành từ thời điểm đặt tồn đầu kỳ (inventory.auto_from) mới cộng / trừ tồn
  select (value #>> '{}')::timestamptz into v_since from public.system_settings where key = 'inventory.auto_from';
  if v_since is not null and v_done < v_since then return; end if;

  if t.kind = 'none' then
    return;
  elsif t.kind in ('receipt', 'issue') then
    -- Đã chọn trên đơn / chuyến: vị trí đã chọn, nếu chưa chọn thì vị trí gắn trực tiếp với điểm giao (nhập) / điểm nhận (xuất)
    v_kind := t.kind;
    v_bin := coalesce(t.bin_id, (select b.id from public.warehouse_bins b
                                 where b.is_active and b.location_id = case when t.kind = 'receipt' then s.delivery_location_id else s.pickup_location_id end
                                 order by b.sort_order, b.code limit 1));
    if v_bin is null then return; end if;  -- chờ chọn vị trí
    -- Chuyến hoàn thành trước ngày nhập tồn đầu kỳ của vị trí đã nằm trong số tồn đầu kỳ
    select min(e.entry_date) into v_opening from public.stock_entries e where e.kind = 'opening' and e.bin_id = v_bin;
    if v_opening is not null and v_date < v_opening then return; end if;
  else
    -- Không chọn: theo địa điểm gắn với kho, chỉ chuyến hoàn thành từ lúc chạy 9025
    v_from := private.stock_bin_for_location(s.pickup_location_id);
    v_to := private.stock_bin_for_location(s.delivery_location_id);
    if v_from is null and v_to is null then return; end if;
    if v_from is not null and v_to is not null then
      if v_from = v_to then return; end if;
      v_kind := 'transfer'; v_bin := v_from; v_to_bin := v_to;
    elsif v_to is not null then
      v_kind := 'receipt'; v_bin := v_to;
    else
      v_kind := 'issue'; v_bin := v_from;
    end if;
  end if;

  if not exists (select 1 from public.shipment_items i where i.shipment_id = p_shipment_id and i.product_id is not null and coalesce(i.quantity, 0) > 0) then
    return;
  end if;
  if v_no is null or v_no !~ ('^' || case v_kind when 'receipt' then 'PN' when 'issue' then 'PX' else 'CK' end || '-') then
    v_no := private.stock_voucher_no(v_kind, v_date);
  end if;
  select o.customer_id into v_owner from public.transport_orders o where o.id = s.order_id;
  insert into public.stock_entries (voucher_no, entry_date, kind, bin_id, to_bin_id, product_id, quantity, unit,
                                    owner_customer_id, shipment_id, ref_no, partner, notes, source)
  select v_no, v_date, v_kind, v_bin, v_to_bin, i.product_id, i.quantity, null,
         coalesce(v_owner, p.owner_customer_id), s.id, s.shipment_code,
         nullif(concat_ws(' · ', v.plate_number, s.container_no), ''),
         'Tự lập khi chuyến hoàn thành', 'auto'
  from public.shipment_items i
  join public.products p on p.id = i.product_id
  left join public.vehicles v on v.id = s.vehicle_id
  where i.shipment_id = p_shipment_id and coalesce(i.quantity, 0) > 0
  order by i.line_no;
end;
$$;
revoke all on function private.stock_sync_shipment(uuid, boolean) from public, anon, authenticated;
