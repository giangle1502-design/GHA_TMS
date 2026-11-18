-- =============================================================================
-- Kiểm thử 9026: chọn vị trí kho GHA1 / GHA2 trên đơn hàng, chuyến; hỏi vị trí khi hoàn thành
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

insert into public.customers (id, code, name) values ('c9260000-0000-0000-0000-000000000001', 'T26-VAP', 'Việt An Pha (thử 9026)');
insert into public.products (id, code, name, unit) values ('a9260000-0000-0000-0000-000000000001', 'T26-HDPE', 'HDPE6006L (thử)', 'KG');
insert into public.locations (id, code, name, full_address) values
  ('d9260000-0000-0000-0000-000000000001', 'T26-CANG', 'Cảng (thử 9026)', 'Cảng'),
  ('d9260000-0000-0000-0000-000000000002', 'T26-BAI', 'Bãi GHA chưa gắn kho (thử)', 'KCN'),
  ('d9260000-0000-0000-0000-000000000003', 'T26-KHACH', 'Khách (thử 9026)', 'Q1');
insert into public.transport_orders (id, order_code, customer_id, payer_customer_id) values
  ('e9260000-0000-0000-0000-000000000001', 'T9026-1', 'c9260000-0000-0000-0000-000000000001', 'c9260000-0000-0000-0000-000000000001'),
  ('e9260000-0000-0000-0000-000000000002', 'T9026-2', 'c9260000-0000-0000-0000-000000000001', 'c9260000-0000-0000-0000-000000000001'),
  ('e9260000-0000-0000-0000-000000000003', 'T9026-3', 'c9260000-0000-0000-0000-000000000001', 'c9260000-0000-0000-0000-000000000001');
-- S1: đơn 1 chọn nhập GHA2; S2: đơn 2 chọn xuất nhưng chưa chọn vị trí; S3: đơn 2 riêng chuyến "không qua kho";
-- S4: đơn 3 không chọn gì, địa điểm không gắn kho; S5: đơn 1 nhưng chuyến hoàn thành trước ngày tồn đầu kỳ
insert into public.shipments (id, shipment_code, order_id, pickup_at, pickup_location_id, delivery_location_id, status, sequence_in_order) values
  ('f9260000-0000-0000-0000-000000000001', 'T9026-S1', 'e9260000-0000-0000-0000-000000000001', now(), 'd9260000-0000-0000-0000-000000000001', 'd9260000-0000-0000-0000-000000000002', 'in_transit', 1),
  ('f9260000-0000-0000-0000-000000000002', 'T9026-S2', 'e9260000-0000-0000-0000-000000000002', now(), 'd9260000-0000-0000-0000-000000000002', 'd9260000-0000-0000-0000-000000000003', 'in_transit', 1),
  ('f9260000-0000-0000-0000-000000000003', 'T9026-S3', 'e9260000-0000-0000-0000-000000000002', now(), 'd9260000-0000-0000-0000-000000000002', 'd9260000-0000-0000-0000-000000000003', 'in_transit', 2),
  ('f9260000-0000-0000-0000-000000000004', 'T9026-S4', 'e9260000-0000-0000-0000-000000000003', now(), 'd9260000-0000-0000-0000-000000000001', 'd9260000-0000-0000-0000-000000000002', 'in_transit', 1),
  ('f9260000-0000-0000-0000-000000000005', 'T9026-S5', 'e9260000-0000-0000-0000-000000000001', now() - interval '30 days', 'd9260000-0000-0000-0000-000000000001', 'd9260000-0000-0000-0000-000000000002', 'in_transit', 2);
insert into public.shipment_items (shipment_id, line_no, product_id, item_code, quantity, unit)
select id, 1, 'a9260000-0000-0000-0000-000000000001', 'T26-HDPE', 24750, 'KG' from public.shipments where id::text like 'f9260000%';
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000e261', 'nokho9026@gha.test') on conflict do nothing;
update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000e261';
-- Tồn đầu kỳ GHA2 ngày hôm qua
insert into public.stock_entries (kind, entry_date, bin_id, product_id, quantity, owner_customer_id)
select 'opening', current_date - 1, id, 'a9260000-0000-0000-0000-000000000001', 1000, 'c9260000-0000-0000-0000-000000000001' from public.warehouse_bins where code = 'GHA2';

-- Chọn kho cho đơn: người không có quyền kho không chọn được
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.set_stock_target('e9260000-0000-0000-0000-000000000001', null, 'receipt', (select id from public.warehouse_bins where code = 'GHA2'));
select public.set_stock_target('e9260000-0000-0000-0000-000000000002', null, 'issue', null);
select public.set_stock_target('e9260000-0000-0000-0000-000000000002', 'f9260000-0000-0000-0000-000000000003', 'none', (select id from public.warehouse_bins where code = 'GHA1'));
select tests.assert_fails($$select public.set_stock_target('e9260000-0000-0000-0000-000000000001', null, 'bogus', null)$$, 'Kiểu kho sai bị từ chối');
reset role;
select tests.assert((select stock_kind = 'none' and stock_bin_id is null from public.shipments where id = 'f9260000-0000-0000-0000-000000000003'),
  'Chọn "Không qua kho" thì bỏ vị trí');

-- Gợi ý: S1 (nhập GHA2), S2 (xuất, chưa chọn vị trí); không có S3 ("không qua kho"), S4 (không qua kho GHA)
select tests.assert((select kind = 'receipt' and to_bin_id = (select id from public.warehouse_bins where code = 'GHA2') and not needs_bin
  from public.stock_shipment_suggestions where shipment_id = 'f9260000-0000-0000-0000-000000000001'), 'Gợi ý: chuyến của đơn chọn nhập GHA2');
select tests.assert((select kind = 'issue' and needs_bin from public.stock_shipment_suggestions where shipment_id = 'f9260000-0000-0000-0000-000000000002'),
  'Gợi ý: đơn chọn xuất chưa có vị trí thì báo "chưa chọn vị trí"');
select tests.assert(not exists (select 1 from public.stock_shipment_suggestions where shipment_id in ('f9260000-0000-0000-0000-000000000003', 'f9260000-0000-0000-0000-000000000004')),
  'Gợi ý: không có chuyến "không qua kho" và chuyến không liên quan kho');

-- Hoàn thành S1: tự lập phiếu nhập vào GHA2 dù địa điểm chưa gắn kho
update public.shipments set status = 'driver_completed', completed_at = now() where id = 'f9260000-0000-0000-0000-000000000001';
select tests.assert((select count(*) = 1 and min(kind) = 'receipt' and min(source) = 'auto' and min(quantity) = 24750
  and min(bin_id::text) = (select id::text from public.warehouse_bins where code = 'GHA2')
  from public.stock_entries where shipment_id = 'f9260000-0000-0000-0000-000000000001'), 'Hoàn thành chuyến của đơn chọn GHA2: tự lập phiếu nhập GHA2');
-- Hoàn thành S2 chưa có vị trí: chưa lập phiếu
update public.shipments set status = 'driver_completed', completed_at = now() where id = 'f9260000-0000-0000-0000-000000000002';
select tests.assert(not exists (select 1 from public.stock_entries where shipment_id = 'f9260000-0000-0000-0000-000000000002'),
  'Chưa chọn vị trí: hoàn thành chưa lập phiếu');
-- S3 "không qua kho", S4 không liên quan: không lập phiếu
update public.shipments set status = 'driver_completed', completed_at = now() where id in ('f9260000-0000-0000-0000-000000000003', 'f9260000-0000-0000-0000-000000000004');
select tests.assert(not exists (select 1 from public.stock_entries where shipment_id in ('f9260000-0000-0000-0000-000000000003', 'f9260000-0000-0000-0000-000000000004')),
  'Chuyến không qua kho: không lập phiếu');
-- Chọn vị trí GHA1 cho riêng S2 sau khi đã hoàn thành (hỏi lúc hoàn thành / chọn sau): tự lập phiếu xuất GHA1
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.set_stock_target(null, 'f9260000-0000-0000-0000-000000000002', 'issue', (select id from public.warehouse_bins where code = 'GHA1'));
reset role;
select tests.assert((select kind = 'issue' and source = 'auto' and bin_id = (select id from public.warehouse_bins where code = 'GHA1')
  from public.stock_entries where shipment_id = 'f9260000-0000-0000-0000-000000000002'), 'Chọn vị trí sau khi hoàn thành: tự lập phiếu xuất');
-- Đổi vị trí của đơn 1 sang GHA1: phiếu của chuyến đã xong chuyển theo
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.set_stock_target('e9260000-0000-0000-0000-000000000001', null, 'receipt', (select id from public.warehouse_bins where code = 'GHA1'));
reset role;
select tests.assert((select bin_id = (select id from public.warehouse_bins where code = 'GHA1') from public.stock_entries
  where shipment_id = 'f9260000-0000-0000-0000-000000000001'), 'Đổi vị trí trên đơn: phiếu tự động đổi theo');
-- Đơn chuyển "không qua kho": bỏ phiếu tự động
update public.transport_orders set stock_kind = 'none' where id = 'e9260000-0000-0000-0000-000000000001';
select tests.assert(not exists (select 1 from public.stock_entries where shipment_id = 'f9260000-0000-0000-0000-000000000001'), 'Đơn đổi sang "không qua kho": bỏ phiếu tự động');
-- S5 hoàn thành trước ngày tồn đầu kỳ của GHA2: không lập phiếu (đã nằm trong tồn đầu kỳ)
update public.transport_orders set stock_kind = 'receipt', stock_bin_id = (select id from public.warehouse_bins where code = 'GHA2') where id = 'e9260000-0000-0000-0000-000000000001';
update public.shipments set status = 'driver_completed', completed_at = now() - interval '29 days' where id = 'f9260000-0000-0000-0000-000000000005';
select tests.assert(not exists (select 1 from public.stock_entries where shipment_id = 'f9260000-0000-0000-0000-000000000005')
  and exists (select 1 from public.stock_entries where shipment_id = 'f9260000-0000-0000-0000-000000000001'),
  'Chuyến hoàn thành trước ngày tồn đầu kỳ: không lập phiếu; chuyến sau đó lập lại');

-- Người không có quyền kho không chọn được
select tests.login('00000000-0000-0000-0000-00000000e261');
set role authenticated;
select tests.assert_fails($$select public.set_stock_target('e9260000-0000-0000-0000-000000000001', null, 'none', null)$$, 'Không có quyền kho: không chọn được vị trí');
reset role;

-- Dọn dữ liệu thử
delete from public.stock_entries where product_id = 'a9260000-0000-0000-0000-000000000001';
