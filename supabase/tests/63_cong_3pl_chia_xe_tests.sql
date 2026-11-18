-- =============================================================================
-- Kiểm thử 9030: cổng nhà xe 3PL – 3PL tự đăng ký xe, chia đơn lớn thành nhiều xe
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

insert into public.suppliers (id, code, name, custom_fields) values
  ('a9300000-0000-0000-0000-000000000001', 'T-HQ', 'Hải Quân (thử)', '{"supplier_kind":"3pl"}'),
  ('a9300000-0000-0000-0000-000000000002', 'T-3PLB', 'Nhà xe B (thử)', '{"supplier_kind":"3pl"}');
insert into public.customers (id, code, name) values ('c9300000-0000-0000-0000-000000000001', 'T930-KH', 'Khách thử 9030');
insert into public.locations (id, code, name, full_address) values
  ('d9300000-0000-0000-0000-000000000001', 'T930-NHAN', 'Kho nhận 9030', 'KCN'),
  ('d9300000-0000-0000-0000-000000000002', 'T930-GIAO', 'Điểm giao 9030', 'Q1');
insert into public.transport_orders (id, order_code, customer_id, payer_customer_id) values
  ('e9300000-0000-0000-0000-000000000001', 'T930-1', 'c9300000-0000-0000-0000-000000000001', 'c9300000-0000-0000-0000-000000000001'),
  ('e9300000-0000-0000-0000-000000000002', 'T930-2', 'c9300000-0000-0000-0000-000000000001', 'c9300000-0000-0000-0000-000000000001');
-- Chuyến 10 tấn (10,000 kg) tính cước theo tấn, giao Hải Quân; chuyến 2 giao nhà xe B
insert into public.shipments (id, shipment_code, order_id, pickup_at, pickup_location_id, delivery_location_id, unit_price, pricing_unit, quantity, carrier_supplier_id) values
  ('f9300000-0000-0000-0000-000000000001', 'T930-S1', 'e9300000-0000-0000-0000-000000000001', '2027-03-01', 'd9300000-0000-0000-0000-000000000001', 'd9300000-0000-0000-0000-000000000002', 200000, 'ton', 10, 'a9300000-0000-0000-0000-000000000001'),
  ('f9300000-0000-0000-0000-000000000002', 'T930-S2', 'e9300000-0000-0000-0000-000000000002', '2027-03-01', 'd9300000-0000-0000-0000-000000000001', 'd9300000-0000-0000-0000-000000000002', 900000, 'trip', 1, 'a9300000-0000-0000-0000-000000000002');
insert into public.shipment_items (id, shipment_id, line_no, item_code, item_name, quantity, unit, bag_count) values
  ('b9300000-0000-0000-0000-000000000001', 'f9300000-0000-0000-0000-000000000001', 1, 'T930-HAT', 'Hạt nhựa thử', 10000, 'KG', 400),
  ('b9300000-0000-0000-0000-000000000002', 'f9300000-0000-0000-0000-000000000002', 1, 'T930-HAT', 'Hạt nhựa thử', 5000, 'KG', null);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000c930', 'hai.quan@gha.test', '{"full_name":"Nhà xe Hải Quân"}')
on conflict do nothing;
update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000c930';
insert into public.user_roles (user_id, role_id) select '00000000-0000-0000-0000-00000000c930', id from public.roles where code = 'carrier_3pl';
insert into public.user_suppliers (user_id, supplier_id) values ('00000000-0000-0000-0000-00000000c930', 'a9300000-0000-0000-0000-000000000001');

select tests.login('00000000-0000-0000-0000-00000000c930');
set role authenticated;
select tests.assert(private.is_supplier_scoped(), 'Tài khoản 3PL bị giới hạn theo nhà xe');
select tests.assert((select count(*) from public.shipments) = 0, '3PL không đọc trực tiếp bảng chuyến');
select tests.assert((select count(*) from public.carrier_portal_suppliers()) = 1, '3PL chỉ thấy nhà xe của mình');
select tests.assert((select count(*) from jsonb_array_elements(public.carrier_portal_shipments(null, '2027-03-01', '2027-03-01'))) = 1, '3PL chỉ thấy chuyến của nhà xe mình');
select tests.assert(not (public.carrier_portal_shipments(null, '2027-03-01', '2027-03-01') -> 0 ?| array['unit_price', 'freight_amount', 'customer_name']), 'Không có cước, đơn giá, khách hàng');
select tests.assert(public.carrier_portal_shipments('a9300000-0000-0000-0000-000000000002', '2027-03-01', '2027-03-01') = '[]'::jsonb, 'Chọn nhà xe khác cũng không thấy gì');
select tests.assert_fails($$select public.carrier_register_vehicles('f9300000-0000-0000-0000-000000000002', '[{"plate":"61K11111","quantity":1}]')$$, 'Không đăng ký xe cho chuyến của nhà xe khác');
select tests.assert_fails($$select public.carrier_register_vehicles('f9300000-0000-0000-0000-000000000001',
  '[{"plate":"61K11111","quantities":{"b9300000-0000-0000-0000-000000000001":6000}},{"plate":"61K22222","quantities":{"b9300000-0000-0000-0000-000000000001":5000}}]')$$,
  'Tổng các xe vượt số lượng chuyến bị chặn');
select tests.assert_fails($$select public.carrier_register_vehicles('f9300000-0000-0000-0000-000000000001', '[{"plate":"","quantities":{"b9300000-0000-0000-0000-000000000001":1000}}]')$$, 'Bắt buộc nhập số xe');

-- Đăng ký 2 xe, mỗi xe 3,000 kg: còn 4,000 kg chưa có xe ở chuyến gốc
select public.carrier_register_vehicles('f9300000-0000-0000-0000-000000000001',
  '[{"plate":"61K11111","driver_name":"Nguyễn Văn A","driver_phone":"0901000001","quantities":{"b9300000-0000-0000-0000-000000000001":3000}},
    {"plate":"61K22222","quantities":{"b9300000-0000-0000-0000-000000000001":3000}}]');
select tests.assert((select count(*) from jsonb_array_elements(public.carrier_portal_shipments(null, '2027-03-01', '2027-03-01'))) = 3, 'Chia thành 3 chuyến (2 xe + phần còn lại)');
select tests.assert((select count(*) from jsonb_array_elements(public.carrier_portal_shipments(null, '2027-03-01', '2027-03-01')) x where x ->> 'driver_name' = 'Tài xế & 3PL') = 1, 'Không nhập tài xế: ghi Tài xế & 3PL');
reset role;
select tests.assert((select quantity from public.shipments where id = 'f9300000-0000-0000-0000-000000000001') = 4, 'Chuyến gốc còn 4 tấn, chưa có xe');
select tests.assert((select status from public.shipments where id = 'f9300000-0000-0000-0000-000000000001') = 'draft', 'Chuyến gốc về Nháp');
select tests.assert((select sum(quantity) from public.shipments where order_id = 'e9300000-0000-0000-0000-000000000001') = 10, 'Tổng số tấn vẫn 10');
select tests.assert((select sum(i.quantity) from public.shipment_items i join public.shipments s on s.id = i.shipment_id where s.order_id = 'e9300000-0000-0000-0000-000000000001') = 10000, 'Tổng kg vẫn 10,000');
select tests.assert((select sum(i.bag_count) from public.shipment_items i join public.shipments s on s.id = i.shipment_id where s.order_id = 'e9300000-0000-0000-0000-000000000001') = 400, 'Tổng số bao vẫn 400');
select tests.assert((select count(*) from public.shipments where split_from_id = 'f9300000-0000-0000-0000-000000000001' and carrier_supplier_id = 'a9300000-0000-0000-0000-000000000001' and unit_price = 200000) = 2, 'Chuyến mới ghi chuyến gốc, nhà xe, đơn giá');
select tests.assert((select s.status from public.shipments s join public.vehicles v on v.id = s.vehicle_id where v.plate_number = '61K11111') = 'assigned', 'Xe đã đăng ký được phân công');
select tests.assert(exists (select 1 from public.notifications where type = 'carrier_split'), 'Điều phối được báo khi 3PL chia xe');

-- Phần còn lại 4,000 kg: đăng ký đủ bằng 1 xe → ghi vào chính chuyến gốc
select tests.login('00000000-0000-0000-0000-00000000c930');
set role authenticated;
select public.carrier_register_vehicles('f9300000-0000-0000-0000-000000000001', '[{"plate":"61K33333","quantities":{"b9300000-0000-0000-0000-000000000001":4000}}]');
reset role;
select tests.assert((select count(*) from public.shipments where order_id = 'e9300000-0000-0000-0000-000000000001') = 3, 'Đủ số lượng: không thêm chuyến');
select tests.assert((select v.plate_number from public.shipments s join public.vehicles v on v.id = s.vehicle_id where s.id = 'f9300000-0000-0000-0000-000000000001') = '61K33333', 'Chuyến gốc nhận xe thứ 3');

-- Điều phối GHA dùng được cổng (chọn nhà xe)
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert((select count(*) from jsonb_array_elements(public.carrier_portal_shipments('a9300000-0000-0000-0000-000000000002', '2027-03-01', '2027-03-01'))) = 1, 'Điều phối xem chuyến của nhà xe B');
select tests.assert(public.carrier_portal_shipments(null, '2027-03-01', '2027-03-01') = '[]'::jsonb, 'Điều phối chưa chọn nhà xe: trống');
reset role;

-- Phân công cũ vẫn chặn người không có quyền
select tests.login('00000000-0000-0000-0000-00000000c930');
set role authenticated;
select tests.assert_fails($$select public.assign_shipment('f9300000-0000-0000-0000-000000000002', null, null)$$, '3PL không gọi được phân công của điều phối');
select tests.assert_fails($$select public.assign_shipment_3pl('f9300000-0000-0000-0000-000000000002', 'a9300000-0000-0000-0000-000000000001', '61K44444')$$, '3PL không gọi được giao chuyến 3PL của điều phối');
reset role;

delete from public.user_suppliers where user_id = '00000000-0000-0000-0000-00000000c930';

\o
\echo 'TẤT CẢ KIỂM THỬ CỔNG NHÀ XE 3PL ĐỀU ĐẠT'
