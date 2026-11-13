-- =============================================================================
-- Kiểm thử 0024 + 0025: khách thanh toán mặc định, tạo chuyến khi chưa có giá.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
create temp table t_pl (k text primary key, v jsonb);
grant all on t_pl to authenticated;
-- Khách riêng, chưa có bảng giá nào
insert into public.customers (id, code, name) values ('10000000-0000-0000-0000-0000000000f4', 'KHGIASAU', 'Khách chưa có bảng giá');

-- Khách thanh toán mặc định: lưu được, xóa khách thanh toán thì tự bỏ liên kết
update public.customers set default_payer_customer_id = '10000000-0000-0000-0000-000000000002'
 where id = '10000000-0000-0000-0000-000000000001';
select tests.assert((select default_payer_customer_id from public.customers where id = '10000000-0000-0000-0000-000000000001') = '10000000-0000-0000-0000-000000000002',
  'Lưu được khách thanh toán mặc định trên hồ sơ khách hàng');

select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối
set role authenticated;

-- Không có bảng giá, không nhập đơn giá -> vẫn tạo, ghi "chưa có giá"
insert into t_pl values ('o', public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-0000000000f4"}',
  '[{"pickup_at":"2026-10-25T00:00:00+07:00","expected_delivery_at":"2026-10-26T23:59:59+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002"},
    {"pickup_at":"2026-10-25T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":""}]'));
select tests.assert((select bool_and(unit_price = 0 and freight_amount = 0 and fuel_support_amount = 0 and pricing_snapshot ->> 'price_source' = 'pending')
  from public.shipments where order_id = (select (v ->> 'order_id')::uuid from t_pl where k = 'o')),
  'Chưa có bảng giá và để trống đơn giá: tạo được chuyến, đơn giá 0, nguồn giá "pending"');

-- Nhập giá sau ở chi tiết chuyến: tiền cước và hỗ trợ dầu tự tính lại
update public.shipments set unit_price = 2000000 where id = (select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_pl where k = 'o');
select tests.assert((select freight_amount = 2000000 and fuel_support_amount = 780000 from public.shipments where id = (select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_pl where k = 'o')),
  'Nhập giá sau: doanh thu cước và hỗ trợ dầu (39%) tự tính');

-- Có nhập giá tay vẫn ghi nguồn "manual"; có bảng giá vẫn ghi "price_list"
insert into t_pl values ('m', public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-0000000000f4"}',
  '[{"pickup_at":"2026-10-25T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1500000"}]'));
select tests.assert((select unit_price = 1500000 and pricing_snapshot ->> 'price_source' = 'manual' from public.shipments where id = (select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_pl where k = 'm')),
  'Nhập giá tay: nguồn giá "manual"');
select tests.assert_fails($$select public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-0000000000f4"}',
  '[{"pickup_at":"2026-10-25T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"-5"}]')$$,
  'Đơn giá âm vẫn bị chặn');
reset role;

set role anon;
select tests.assert_fails($$select public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-0000000000f4"}',
  '[{"pickup_at":"2026-10-25T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002"}]')$$,
  'Người ngoài không tạo được chuyến');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ KHÁCH THANH TOÁN MẶC ĐỊNH / GIÁ SAU ĐỀU ĐẠT'
