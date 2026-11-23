-- =============================================================================
-- Kiểm thử 9040: GHA nhận thay chuyến 3PL theo cờ nhà xe (Thành Cảnh, Thế Bùi: tài xế tự làm trên app)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

insert into public.suppliers (id, code, name) values
  ('b9400000-0000-0000-0000-000000000001', 'T940-NX1', 'Nhà xe Hải Quân 9040'),
  ('b9400000-0000-0000-0000-000000000002', 'T940-NX2', 'Vận tải Thành Cảnh 9040');
-- Cờ đặt theo tên khi chạy 9040: chạy lại phần cập nhật cho nhà xe vừa thêm
update public.suppliers set gha_acts_for_driver = false
 where id = 'b9400000-0000-0000-0000-000000000002' and (lower(name) like '%thành cảnh%' or lower(name) like '%thế bùi%');
select tests.assert((select gha_acts_for_driver from public.suppliers where id = 'b9400000-0000-0000-0000-000000000001'), 'Nhà xe khác mặc định GHA nhận thay');

insert into public.customers (id, code, name) values ('c9400000-0000-0000-0000-000000000001', 'T940-KH', 'Khách thử 9040');
insert into public.locations (id, code, name, full_address) values
  ('d9400000-0000-0000-0000-000000000001', 'T940-NHAN', 'Kho nhận 9040', 'KCN'),
  ('d9400000-0000-0000-0000-000000000002', 'T940-GIAO', 'Kho giao 9040', 'Q1');
insert into public.transport_orders (id, order_code, customer_id, payer_customer_id) values
  ('e9400000-0000-0000-0000-000000000001', 'T940-1', 'c9400000-0000-0000-0000-000000000001', 'c9400000-0000-0000-0000-000000000001'),
  ('e9400000-0000-0000-0000-000000000002', 'T940-2', 'c9400000-0000-0000-0000-000000000001', 'c9400000-0000-0000-0000-000000000001'),
  ('e9400000-0000-0000-0000-000000000003', 'T940-3', 'c9400000-0000-0000-0000-000000000001', 'c9400000-0000-0000-0000-000000000001');
insert into public.vehicles (id, code, plate_number, ownership_type, supplier_id) values
  ('a9400000-0000-0000-0000-000000000003', 'T940-X3', '51C94003', 'outsourced', 'b9400000-0000-0000-0000-000000000001');
insert into public.shipments (id, shipment_code, order_id, pickup_at, pickup_location_id, delivery_location_id, unit_price, pricing_unit, quantity, carrier_supplier_id, vehicle_id) values
  ('f9400000-0000-0000-0000-000000000001', 'T940-S1', 'e9400000-0000-0000-0000-000000000001', '2027-06-01 08:00+07', 'd9400000-0000-0000-0000-000000000001', 'd9400000-0000-0000-0000-000000000002', 1000000, 'trip', 1, 'b9400000-0000-0000-0000-000000000001', null),
  ('f9400000-0000-0000-0000-000000000002', 'T940-S2', 'e9400000-0000-0000-0000-000000000002', '2027-06-01 08:00+07', 'd9400000-0000-0000-0000-000000000001', 'd9400000-0000-0000-0000-000000000002', 1000000, 'trip', 1, 'b9400000-0000-0000-0000-000000000002', null),
  ('f9400000-0000-0000-0000-000000000003', 'T940-S3', 'e9400000-0000-0000-0000-000000000003', '2027-06-01 08:00+07', 'd9400000-0000-0000-0000-000000000001', 'd9400000-0000-0000-0000-000000000002', 1000000, 'trip', 1, 'b9400000-0000-0000-0000-000000000001', 'a9400000-0000-0000-0000-000000000003');

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000d940', 'dp.9040@gha.test', '{"full_name":"Điều phối 9040"}')
on conflict do nothing;
update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000d940';
insert into public.user_roles (user_id, role_id) select '00000000-0000-0000-0000-00000000d940', id from public.roles where code = 'dispatcher' on conflict do nothing;

select tests.login('00000000-0000-0000-0000-00000000d940');
set role authenticated;

-- Nhà xe thường: chỉ số xe, không tài xế → GHA nhận thay, bắt đầu, hoàn thành
select public.assign_shipment_3pl('f9400000-0000-0000-0000-000000000001', 'b9400000-0000-0000-0000-000000000001', '51C94001', null, null, null, null);
select public.dispatch_act_for_driver('f9400000-0000-0000-0000-000000000001', 'accept');
select public.dispatch_act_for_driver('f9400000-0000-0000-0000-000000000001', 'start');
select public.dispatch_act_for_driver('f9400000-0000-0000-0000-000000000001', 'complete', 'full', null, null, 'Chứng từ 3PL gửi sau');
reset role;
select tests.assert((select status from public.shipments where id = 'f9400000-0000-0000-0000-000000000001') = 'driver_completed', 'Nhà xe thường: chỉ số xe là GHA làm thay đến hoàn thành');

-- Chuyến 3PL có số xe nhưng chưa có tài xế (Nháp): Nhận thay tự gắn tài xế đại diện
select tests.login('00000000-0000-0000-0000-00000000d940');
set role authenticated;
select public.dispatch_act_for_driver('f9400000-0000-0000-0000-000000000003', 'accept');
reset role;
select tests.assert((select status = 'accepted' and driver_id is not null from public.shipments where id = 'f9400000-0000-0000-0000-000000000003'), 'Có số xe, chưa tài xế: nhận thay được');

-- Thành Cảnh: số xe không tài xế bị chặn; có tài xế thì giao được nhưng GHA không làm thay
select tests.login('00000000-0000-0000-0000-00000000d940');
set role authenticated;
select tests.assert_fails($$select public.assign_shipment_3pl('f9400000-0000-0000-0000-000000000002', 'b9400000-0000-0000-0000-000000000002', '51C94002', null, null, null, null)$$, 'Thành Cảnh: bắt buộc tài xế khi giao số xe');
select public.assign_shipment_3pl('f9400000-0000-0000-0000-000000000002', 'b9400000-0000-0000-0000-000000000002', '51C94002', 'Nguyễn Văn Tài', '0909940002', null, null);
select tests.assert_fails($$select public.dispatch_act_for_driver('f9400000-0000-0000-0000-000000000002', 'accept')$$, 'Thành Cảnh: GHA không nhận thay');
reset role;
select tests.assert((select status from public.shipments where id = 'f9400000-0000-0000-0000-000000000002') = 'assigned', 'Thành Cảnh: chờ tài xế tự nhận trên app');

\o
\echo 'TẤT CẢ KIỂM THỬ GHA NHẬN THAY 3PL ĐỀU ĐẠT'
