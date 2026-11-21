-- =============================================================================
-- Kiểm thử 9037: Kho GHA không cập nhật ngược – chỉ chuyến hoàn thành sau thời điểm đặt tồn đầu kỳ
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
create temp table t_old as select value from public.system_settings where key = 'inventory.auto_from';
update public.system_settings set value = to_jsonb(now() - interval '1 minute') where key = 'inventory.auto_from';

insert into public.customers (id, code, name) values ('c9370000-0000-0000-0000-000000000001', 'T37-VAP', 'Việt An Pha (thử 9037)');
insert into public.products (id, code, name, unit) values ('a9370000-0000-0000-0000-000000000001', 'T37-HDPE', 'HDPE (thử 9037)', 'KG');
insert into public.locations (id, code, name, full_address) values
  ('d9370000-0000-0000-0000-000000000001', 'T37-CANG', 'Cảng (thử 9037)', 'Cảng'),
  ('d9370000-0000-0000-0000-000000000002', 'T37-BAI', 'Bãi xe GHA (thử 9037)', 'KCN');
insert into public.transport_orders (id, order_code, customer_id, payer_customer_id, stock_kind, stock_bin_id) values
  ('e9370000-0000-0000-0000-000000000001', 'T9037-1', 'c9370000-0000-0000-0000-000000000001', 'c9370000-0000-0000-0000-000000000001',
   'receipt', (select id from public.warehouse_bins where code = 'GHA1'));
insert into public.shipments (id, shipment_code, order_id, pickup_at, pickup_location_id, delivery_location_id, status, sequence_in_order) values
  ('f9370000-0000-0000-0000-000000000001', 'T9037-S1', 'e9370000-0000-0000-0000-000000000001', now() - interval '3 days', 'd9370000-0000-0000-0000-000000000001', 'd9370000-0000-0000-0000-000000000002', 'in_transit', 1),
  ('f9370000-0000-0000-0000-000000000002', 'T9037-S2', 'e9370000-0000-0000-0000-000000000001', now() - interval '3 days', 'd9370000-0000-0000-0000-000000000001', 'd9370000-0000-0000-0000-000000000002', 'in_transit', 2);
insert into public.shipment_items (shipment_id, line_no, product_id, item_code, quantity, unit)
select id, 1, 'a9370000-0000-0000-0000-000000000001', 'T37-HDPE', 24750, 'KG' from public.shipments where id::text like 'f9370000%';

-- S1 hoàn thành trước thời điểm đặt tồn (đã nằm trong tồn đầu kỳ): không cộng ngược
update public.shipments set status = 'driver_completed', completed_at = now() - interval '2 days' where id = 'f9370000-0000-0000-0000-000000000001';
select tests.assert(not exists (select 1 from public.stock_entries where shipment_id = 'f9370000-0000-0000-0000-000000000001'),
  'Chuyến chọn kho nhưng hoàn thành trước thời điểm đặt tồn: không cập nhật ngược');
-- Sửa hàng của chuyến cũ: vẫn không lập phiếu
update public.shipment_items set quantity = 25000 where shipment_id = 'f9370000-0000-0000-0000-000000000001';
select tests.assert(not exists (select 1 from public.stock_entries where shipment_id = 'f9370000-0000-0000-0000-000000000001'),
  'Sửa hàng chuyến cũ: vẫn không cập nhật ngược');
-- S2 hoàn thành bây giờ: lập phiếu nhập theo ngày hoàn thành (dù ngày nhận hàng là 3 ngày trước)
update public.shipments set status = 'driver_completed', completed_at = now() where id = 'f9370000-0000-0000-0000-000000000002';
select tests.assert((select kind = 'receipt' and quantity = 24750 and entry_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date
  from public.stock_entries where shipment_id = 'f9370000-0000-0000-0000-000000000002'), 'Chuyến hoàn thành sau thời điểm đặt tồn: phiếu theo ngày hoàn thành');

delete from public.stock_entries where product_id = 'a9370000-0000-0000-0000-000000000001';
update public.system_settings s set value = t.value from t_old t where s.key = 'inventory.auto_from';
