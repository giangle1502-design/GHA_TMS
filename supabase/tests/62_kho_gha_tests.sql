-- =============================================================================
-- Kiểm thử 9024: Kho GHA – tồn đầu kỳ, nhập, xuất, chuyển vị trí, báo cáo xuất nhập tồn, gợi ý từ chuyến
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

insert into public.products (id, code, name, unit) values
  ('a9240000-0000-0000-0000-000000000001', 'T-HDPE', 'Hạt nhựa HDPE (thử)', 'KG'),
  ('a9240000-0000-0000-0000-000000000002', 'T-PP', 'Hạt nhựa PP (thử)', 'KG');
insert into public.locations (id, code, name, full_address) values
  ('d9240000-0000-0000-0000-000000000001', 'T-GHA1', 'Kho GHA vị trí 1 (thử)', 'KCN thử'),
  ('d9240000-0000-0000-0000-000000000002', 'T-VAP', 'Kho VAP (thử)', 'KCN thử 2'),
  ('d9240000-0000-0000-0000-000000000003', 'T-KHACH', 'Khách nhận (thử)', 'Q1');
update public.warehouse_bins set location_id = 'd9240000-0000-0000-0000-000000000001' where code = 'GHA1';
insert into public.transport_orders (id, order_code, customer_id, payer_customer_id)
select 'e9240000-0000-0000-0000-000000000001', 'T9024-1', id, id from public.customers order by created_at limit 1;
insert into public.shipments (id, shipment_code, order_id, pickup_at, pickup_location_id, delivery_location_id, status, sequence_in_order) values
  ('f9240000-0000-0000-0000-000000000001', 'T9024-S1', 'e9240000-0000-0000-0000-000000000001', '2026-11-05', 'd9240000-0000-0000-0000-000000000002', 'd9240000-0000-0000-0000-000000000001', 'driver_completed', 1),
  ('f9240000-0000-0000-0000-000000000002', 'T9024-S2', 'e9240000-0000-0000-0000-000000000001', '2026-11-06', 'd9240000-0000-0000-0000-000000000001', 'd9240000-0000-0000-0000-000000000003', 'in_transit', 2);
insert into public.shipment_items (shipment_id, line_no, product_id, item_code, quantity, unit) values
  ('f9240000-0000-0000-0000-000000000001', 1, 'a9240000-0000-0000-0000-000000000001', 'T-HDPE', 25000, 'KG'),
  ('f9240000-0000-0000-0000-000000000002', 1, 'a9240000-0000-0000-0000-000000000001', 'T-HDPE', 5000, 'KG');

create temp table t_k (k text primary key, v text);
grant all on t_k to anon, authenticated;
insert into t_k select 'B1', id::text from public.warehouse_bins where code = 'GHA1';
insert into t_k select 'B2', id::text from public.warehouse_bins where code = 'GHA2';
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from t_k where k = key $$;

-- Điều phối: lập phiếu
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert((select count(*) from public.warehouse_bins where code in ('GHA1', 'GHA2')) = 2, 'Có sẵn Kho GHA với vị trí GHA1, GHA2');

-- Tồn đầu kỳ 31/10: GHA1 HDPE 10,000; GHA2 PP 3,000 (cùng một số phiếu theo ngày)
insert into public.stock_entries (entry_date, kind, bin_id, product_id, quantity) values
  ('2026-10-31', 'opening', pg_temp.v('B1')::uuid, 'a9240000-0000-0000-0000-000000000001', 10000),
  ('2026-10-31', 'opening', pg_temp.v('B2')::uuid, 'a9240000-0000-0000-0000-000000000002', 3000);
select tests.assert((select count(distinct voucher_no) = 1 and min(voucher_no) = 'DK-261031' and min(unit) = 'KG' from public.stock_entries where kind = 'opening'),
  'Tồn đầu kỳ: chung số phiếu DK-261031, đơn vị lấy theo mã hàng');

-- Gợi ý: chuyến giao tới GHA1 = nhập; chuyến nhận từ GHA1 = xuất
select tests.assert((select kind = 'receipt' and to_bin_id = pg_temp.v('B1')::uuid and jsonb_array_length(items) = 1
  from public.stock_shipment_suggestions where shipment_code = 'T9024-S1'), 'Gợi ý: chuyến giao tới kho GHA là phiếu nhập, đúng vị trí');
select tests.assert((select kind = 'issue' and from_bin_id = pg_temp.v('B1')::uuid from public.stock_shipment_suggestions where shipment_code = 'T9024-S2'),
  'Gợi ý: chuyến nhận từ kho GHA là phiếu xuất');

-- Phiếu nhập nhiều dòng từ chuyến
insert into t_k select 'PN', public.create_stock_voucher(
  jsonb_build_object('kind', 'receipt', 'entry_date', '2026-11-05', 'bin_id', pg_temp.v('B1'), 'shipment_id', 'f9240000-0000-0000-0000-000000000001', 'ref_no', 'PCK261103004'),
  jsonb_build_array(jsonb_build_object('product_id', 'a9240000-0000-0000-0000-000000000001', 'quantity', 25000),
                    jsonb_build_object('product_id', 'a9240000-0000-0000-0000-000000000002', 'quantity', 1000)));
select tests.assert(pg_temp.v('PN') ~ '^PN-2611-[0-9]{3}$', 'Số phiếu nhập tự sinh PN-2611-xxx');
select tests.assert((select count(*) = 2 from public.stock_entries where voucher_no = pg_temp.v('PN')), 'Phiếu nhập có 2 dòng chung số phiếu');
select tests.assert(not exists (select 1 from public.stock_shipment_suggestions where shipment_code = 'T9024-S1'), 'Chuyến đã lập phiếu thì hết gợi ý');

-- Xuất 5,000 HDPE từ GHA1; chuyển 2,000 HDPE GHA1 -> GHA2
select public.create_stock_voucher(jsonb_build_object('kind', 'issue', 'entry_date', '2026-11-06', 'bin_id', pg_temp.v('B1')),
  jsonb_build_array(jsonb_build_object('product_id', 'a9240000-0000-0000-0000-000000000001', 'quantity', 5000)));
select public.create_stock_voucher(jsonb_build_object('kind', 'transfer', 'entry_date', '2026-11-07', 'bin_id', pg_temp.v('B1'), 'to_bin_id', pg_temp.v('B2')),
  jsonb_build_array(jsonb_build_object('product_id', 'a9240000-0000-0000-0000-000000000001', 'quantity', 2000)));
select tests.assert_fails($$insert into public.stock_entries (kind, bin_id, product_id, quantity) values ('transfer', (select id from public.warehouse_bins where code = 'GHA1'), 'a9240000-0000-0000-0000-000000000001', 1)$$,
  'Chuyển vị trí phải chọn vị trí nhận');
select tests.assert_fails($$insert into public.stock_entries (kind, bin_id, product_id, quantity) values ('issue', (select id from public.warehouse_bins where code = 'GHA1'), 'a9240000-0000-0000-0000-000000000001', 0)$$,
  'Số lượng phải lớn hơn 0');

-- Báo cáo tháng 11 theo vị trí
select tests.assert((select opening_qty = 10000 and in_qty = 25000 and out_qty = 7000 and closing_qty = 28000
  from public.stock_balance_report('2026-11-01', '2026-11-30') where bin_code = 'GHA1' and product_code = 'T-HDPE'), 'GHA1 HDPE: 10,000 + 25,000 − 7,000 = 28,000');
select tests.assert((select opening_qty = 0 and in_qty = 2000 and out_qty = 0 and closing_qty = 2000
  from public.stock_balance_report('2026-11-01', '2026-11-30') where bin_code = 'GHA2' and product_code = 'T-HDPE'), 'GHA2 HDPE: nhận chuyển 2,000');
select tests.assert((select opening_qty = 3000 and in_qty = 0 and closing_qty = 3000
  from public.stock_balance_report('2026-11-01', '2026-11-30') r where r.bin_code = 'GHA2' and r.product_code = 'T-PP'), 'GHA2 PP: tồn 3,000');
select tests.assert((select opening_qty = 0 and in_qty = 1000 and closing_qty = 1000
  from public.stock_balance_report('2026-11-01', '2026-11-30') r where r.bin_code = 'GHA1' and r.product_code = 'T-PP'), 'GHA1 PP: nhập 1,000');
-- Gộp cả kho: chuyển vị trí không tính nhập/xuất
select tests.assert((select opening_qty = 10000 and in_qty = 25000 and out_qty = 5000 and closing_qty = 30000
  from public.stock_balance_report('2026-11-01', '2026-11-30', null, null, false) where product_code = 'T-HDPE'), 'Gộp cả kho HDPE: 10,000 + 25,000 − 5,000 = 30,000');
-- Kỳ sau: tồn đầu = tồn cuối kỳ trước
select tests.assert((select opening_qty = 28000 and in_qty = 0 and out_qty = 0
  from public.stock_balance_report('2026-12-01', '2026-12-31') where bin_code = 'GHA1' and product_code = 'T-HDPE'), 'Tháng 12: tồn đầu = tồn cuối tháng 11');
reset role;

-- Tài khoản khách hàng: không thấy kho
select tests.login('00000000-0000-0000-0000-00000000c918');
set role authenticated;
select tests.assert((select count(*) from public.stock_entries) = 0 and (select count(*) from public.warehouse_bins) = 0,
  'Tài khoản khách không thấy phiếu kho, vị trí kho');
select tests.assert((select count(*) from public.stock_balance_report('2026-01-01', '2026-12-31')) = 0, 'Tài khoản khách không xem được báo cáo tồn');
select tests.assert_fails($$select public.create_stock_voucher('{"kind":"receipt"}', '[{"quantity":1}]')$$, 'Tài khoản khách không lập được phiếu');
reset role;

-- Dọn dữ liệu thử
delete from public.stock_entries where product_id in ('a9240000-0000-0000-0000-000000000001', 'a9240000-0000-0000-0000-000000000002');
update public.warehouse_bins set location_id = null where location_id = 'd9240000-0000-0000-0000-000000000001';
