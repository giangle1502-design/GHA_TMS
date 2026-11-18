-- =============================================================================
-- Kiểm thử 9025: Kho GHA tự lập phiếu khi chuyến hoàn thành, tồn theo công ty, nhà xe 3PL xem tồn vị trí được gán
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
create temp table t_k (k text primary key, v text);
grant all on t_k to anon, authenticated;

insert into public.customers (id, code, name) values
  ('c9250000-0000-0000-0000-000000000001', 'T25-VAP', 'Việt An Pha (thử 9025)'),
  ('c9250000-0000-0000-0000-000000000002', 'T25-KHAC', 'Công ty khác (thử 9025)');
insert into public.products (id, code, name, unit) values
  ('a9250000-0000-0000-0000-000000000001', 'T25-37MK', 'PP37MK10 (thử)', 'KG');
insert into public.locations (id, code, name, full_address) values
  ('d9250000-0000-0000-0000-000000000001', 'T25-GHA1', 'Bãi GHA1 (thử)', 'KCN'),
  ('d9250000-0000-0000-0000-000000000002', 'T25-CANG', 'Cảng (thử)', 'Cảng'),
  ('d9250000-0000-0000-0000-000000000003', 'T25-KHACH', 'Khách nhận (thử)', 'Q1');
update public.warehouse_bins set location_id = 'd9250000-0000-0000-0000-000000000001' where code = 'GHA1';
insert into public.suppliers (id, code, name) values ('60000000-0000-0000-0000-000000009251', 'T25-HQ', 'Hải Quân (thử)'),
  ('60000000-0000-0000-0000-000000009252', 'T25-NX2', 'Nhà xe khác (thử)');
insert into public.transport_orders (id, order_code, customer_id, payer_customer_id) values
  ('e9250000-0000-0000-0000-000000000001', 'T9025-1', 'c9250000-0000-0000-0000-000000000001', 'c9250000-0000-0000-0000-000000000001'),
  ('e9250000-0000-0000-0000-000000000002', 'T9025-2', 'c9250000-0000-0000-0000-000000000002', 'c9250000-0000-0000-0000-000000000002');
-- S1: cont 37MK về bãi GHA1 (đang chạy); S2: xuất từ GHA1 đi khách (đang chạy); S3: chuyến cũ đã xong trước khi bật tự động
insert into public.shipments (id, shipment_code, order_id, pickup_at, pickup_location_id, delivery_location_id, status, sequence_in_order) values
  ('f9250000-0000-0000-0000-000000000001', 'T9025-S1', 'e9250000-0000-0000-0000-000000000001', now(), 'd9250000-0000-0000-0000-000000000002', 'd9250000-0000-0000-0000-000000000001', 'in_transit', 1),
  ('f9250000-0000-0000-0000-000000000002', 'T9025-S2', 'e9250000-0000-0000-0000-000000000001', now(), 'd9250000-0000-0000-0000-000000000001', 'd9250000-0000-0000-0000-000000000003', 'in_transit', 2),
  ('f9250000-0000-0000-0000-000000000003', 'T9025-S3', 'e9250000-0000-0000-0000-000000000002', now() - interval '20 days', 'd9250000-0000-0000-0000-000000000002', 'd9250000-0000-0000-0000-000000000001', 'in_transit', 1);
insert into public.shipment_items (shipment_id, line_no, product_id, item_code, quantity, unit) values
  ('f9250000-0000-0000-0000-000000000001', 1, 'a9250000-0000-0000-0000-000000000001', 'T25-37MK', 24750, 'KG'),
  ('f9250000-0000-0000-0000-000000000002', 1, 'a9250000-0000-0000-0000-000000000001', 'T25-37MK', 10000, 'KG'),
  ('f9250000-0000-0000-0000-000000000003', 1, 'a9250000-0000-0000-0000-000000000001', 'T25-37MK', 5000, 'KG');

-- Tài khoản nhà xe 3PL
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e251', 'haiquan@gha.test'),
  ('00000000-0000-0000-0000-00000000e252', 'nhaxe2@gha.test') on conflict do nothing;
update public.profiles set status = 'active' where id in ('00000000-0000-0000-0000-00000000e251', '00000000-0000-0000-0000-00000000e252');
insert into public.user_roles (user_id, role_id)
select u, id from public.roles, unnest(array['00000000-0000-0000-0000-00000000e251', '00000000-0000-0000-0000-00000000e252']::uuid[]) u where code = 'carrier_3pl';
insert into public.user_suppliers (user_id, supplier_id) values
  ('00000000-0000-0000-0000-00000000e251', '60000000-0000-0000-0000-000000009251'),
  ('00000000-0000-0000-0000-00000000e252', '60000000-0000-0000-0000-000000009252');

select tests.assert(not exists (select 1 from public.stock_entries where shipment_id::text like 'f9250000%'), 'Chuyến chưa hoàn thành: chưa cộng / trừ tồn');

-- Hoàn thành S1: tự lập phiếu nhập GHA1, công ty = khách trên đơn
update public.shipments set status = 'driver_completed', completed_at = now() where id = 'f9250000-0000-0000-0000-000000000001';
select tests.assert((select count(*) = 1 and min(kind) = 'receipt' and min(source) = 'auto' and min(quantity) = 24750
  and min(owner_customer_id::text) = 'c9250000-0000-0000-0000-000000000001' and min(voucher_no) like 'PN-%'
  and min(bin_id::text) = (select id::text from public.warehouse_bins where code = 'GHA1')
  from public.stock_entries where shipment_id = 'f9250000-0000-0000-0000-000000000001'), 'Hoàn thành chuyến về bãi GHA: tự lập phiếu nhập, ghi công ty chủ hàng');
-- Sửa số lượng trên chuyến đã hoàn thành: phiếu tự cập nhật, giữ số phiếu
insert into t_k select 'NO', voucher_no from public.stock_entries where shipment_id = 'f9250000-0000-0000-0000-000000000001'
  on conflict (k) do update set v = excluded.v;
update public.shipment_items set quantity = 25000 where shipment_id = 'f9250000-0000-0000-0000-000000000001';
select tests.assert((select quantity = 25000 and voucher_no = (select v from t_k where k = 'NO') from public.stock_entries
  where shipment_id = 'f9250000-0000-0000-0000-000000000001'), 'Sửa số lượng chuyến đã xong: phiếu tự cập nhật, giữ số phiếu');
-- Mở lại chuyến: bỏ phiếu tự động; hoàn thành lại: lập lại
update public.shipments set status = 'in_transit' where id = 'f9250000-0000-0000-0000-000000000001';
select tests.assert(not exists (select 1 from public.stock_entries where shipment_id = 'f9250000-0000-0000-0000-000000000001'), 'Mở lại chuyến: bỏ phiếu tự động');
update public.shipments set status = 'driver_completed' where id = 'f9250000-0000-0000-0000-000000000001';

-- Hoàn thành S2: tự lập phiếu xuất từ GHA1
update public.shipments set status = 'driver_completed', completed_at = now() where id = 'f9250000-0000-0000-0000-000000000002';
select tests.assert((select kind = 'issue' and quantity = 10000 from public.stock_entries where shipment_id = 'f9250000-0000-0000-0000-000000000002'),
  'Hoàn thành chuyến lấy hàng ở bãi GHA: tự lập phiếu xuất');
-- S3 hoàn thành trước thời điểm bật tự động: không lập phiếu (đã nằm trong tồn đầu kỳ)
update public.shipments set status = 'driver_completed', completed_at = now() - interval '19 days' where id = 'f9250000-0000-0000-0000-000000000003';
select tests.assert(not exists (select 1 from public.stock_entries where shipment_id = 'f9250000-0000-0000-0000-000000000003'),
  'Chuyến hoàn thành trước khi bật tự động: không lập phiếu');

-- Báo cáo theo công ty
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert((select closing_qty = 15000 and owner_name = 'Việt An Pha (thử 9025)' from public.stock_balance_report(current_date - 1, current_date + 1)
  where bin_code = 'GHA1' and product_code = 'T25-37MK' and owner_customer_id = 'c9250000-0000-0000-0000-000000000001'),
  'Tồn GHA1 của Việt An Pha: 25,000 − 10,000 = 15,000');
select tests.assert((select count(*) = 0 from public.stock_balance_report(current_date - 1, current_date + 1, null, null, true, 'c9250000-0000-0000-0000-000000000002')
  where product_code = 'T25-37MK'), 'Lọc công ty khác: không có tồn');
-- Lập phiếu tay cho chuyến đã có phiếu tự động: bỏ phiếu tự động
select public.create_stock_voucher(jsonb_build_object('kind', 'issue', 'bin_id', (select id from public.warehouse_bins where code = 'GHA1'),
  'shipment_id', 'f9250000-0000-0000-0000-000000000002', 'owner_customer_id', 'c9250000-0000-0000-0000-000000000001'),
  jsonb_build_array(jsonb_build_object('product_id', 'a9250000-0000-0000-0000-000000000001', 'quantity', 9000)));
select tests.assert((select count(*) = 1 and min(source) = 'manual' and min(quantity) = 9000 from public.stock_entries
  where shipment_id = 'f9250000-0000-0000-0000-000000000002'), 'Lập phiếu tay cho chuyến: thay phiếu tự động, không tính hai lần');
-- Gán vị trí GHA1 cho nhà xe Hải Quân (người có quyền sửa kho)
reset role;
insert into public.warehouse_bin_suppliers (bin_id, supplier_id)
select id, '60000000-0000-0000-0000-000000009251' from public.warehouse_bins where code = 'GHA1';
insert into public.stock_entries (kind, bin_id, product_id, quantity, owner_customer_id)
select 'opening', id, 'a9250000-0000-0000-0000-000000000001', 777, 'c9250000-0000-0000-0000-000000000001' from public.warehouse_bins where code = 'GHA2';

select tests.login('00000000-0000-0000-0000-00000000e251');
set role authenticated;
select tests.assert((select count(*) = 1 and min(code) = 'GHA1' from public.warehouse_bins), 'Hải Quân chỉ thấy vị trí GHA1');
select tests.assert(not exists (select 1 from public.stock_balance_report('2000-01-01', current_date + 1) where bin_code <> 'GHA1')
  and exists (select 1 from public.stock_balance_report('2000-01-01', current_date + 1) where bin_code = 'GHA1' and product_code = 'T25-37MK'),
  'Hải Quân xem được tồn GHA1, không thấy GHA2');
select tests.assert(not exists (select 1 from public.stock_entries e join public.warehouse_bins b on b.id = e.bin_id where b.code <> 'GHA1')
  and (select count(*) from public.stock_entries where bin_id not in (select id from public.warehouse_bins)) = 0, 'Hải Quân không đọc được phiếu của vị trí khác');
select tests.assert((select count(*) from public.warehouse_bin_suppliers) = 0, 'Nhà xe 3PL không xem bảng gán vị trí');
select tests.assert((select count(*) from public.shipment_fees) = 0 and (select count(*) from public.customers) = 0, 'Nhà xe 3PL không thấy cước, khách hàng');
select tests.assert_fails($$insert into public.stock_entries (kind, bin_id, product_id, quantity) select 'receipt', id, 'a9250000-0000-0000-0000-000000000001', 1 from public.warehouse_bins limit 1$$,
  'Nhà xe 3PL không lập được phiếu');
reset role;
select tests.login('00000000-0000-0000-0000-00000000e252');
set role authenticated;
select tests.assert((select count(*) from public.warehouse_bins) = 0 and (select count(*) from public.stock_balance_report('2000-01-01', current_date + 1)) = 0,
  'Nhà xe chưa được gán vị trí: không thấy tồn');
reset role;

-- Dọn dữ liệu thử
delete from public.stock_entries where product_id = 'a9250000-0000-0000-0000-000000000001';
delete from public.warehouse_bin_suppliers where supplier_id::text like '60000000-0000-0000-0000-00000000925%';
update public.warehouse_bins set location_id = null where location_id = 'd9250000-0000-0000-0000-000000000001';
