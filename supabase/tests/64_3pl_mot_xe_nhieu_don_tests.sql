-- =============================================================================
-- Kiểm thử 9032: một xe 3PL chở nhiều đơn (gộp đơn)
--   2 đơn, mỗi đơn 25 tấn, chia 3 xe: xe 1 18 tấn đơn 1; xe 2 7 tấn đơn 1 + 11 tấn đơn 2; xe 3 14 tấn đơn 2
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

insert into public.suppliers (id, code, name, custom_fields) values
  ('a9310000-0000-0000-0000-000000000001', 'T-HQ31', 'Hải Quân 9031 (thử)', '{"supplier_kind":"3pl"}'),
  ('a9310000-0000-0000-0000-000000000002', 'T-B31', 'Nhà xe B 9031 (thử)', '{"supplier_kind":"3pl"}');
insert into public.customers (id, code, name) values ('c9310000-0000-0000-0000-000000000001', 'T931-KH', 'Khách thử 9031');
insert into public.locations (id, code, name, full_address) values
  ('d9310000-0000-0000-0000-000000000001', 'T931-NHAN', 'Kho ngoại quan 9031', 'KCN'),
  ('d9310000-0000-0000-0000-000000000002', 'T931-GIAO', 'Bãi xe 9031', 'Q1');
insert into public.transport_orders (id, order_code, customer_id, payer_customer_id) values
  ('e9310000-0000-0000-0000-000000000001', 'T931-1', 'c9310000-0000-0000-0000-000000000001', 'c9310000-0000-0000-0000-000000000001'),
  ('e9310000-0000-0000-0000-000000000002', 'T931-2', 'c9310000-0000-0000-0000-000000000001', 'c9310000-0000-0000-0000-000000000001'),
  ('e9310000-0000-0000-0000-000000000003', 'T931-3', 'c9310000-0000-0000-0000-000000000001', 'c9310000-0000-0000-0000-000000000001');
insert into public.shipments (id, shipment_code, order_id, pickup_at, pickup_location_id, delivery_location_id, unit_price, pricing_unit, quantity, carrier_supplier_id) values
  ('f9310000-0000-0000-0000-000000000001', 'T931-S1', 'e9310000-0000-0000-0000-000000000001', '2027-04-01 08:00+07', 'd9310000-0000-0000-0000-000000000001', 'd9310000-0000-0000-0000-000000000002', 100000, 'ton', 25, 'a9310000-0000-0000-0000-000000000001'),
  ('f9310000-0000-0000-0000-000000000002', 'T931-S2', 'e9310000-0000-0000-0000-000000000002', '2027-04-01 09:00+07', 'd9310000-0000-0000-0000-000000000001', 'd9310000-0000-0000-0000-000000000002', 100000, 'ton', 25, 'a9310000-0000-0000-0000-000000000001'),
  ('f9310000-0000-0000-0000-000000000003', 'T931-S3', 'e9310000-0000-0000-0000-000000000003', '2027-04-01 09:00+07', 'd9310000-0000-0000-0000-000000000001', 'd9310000-0000-0000-0000-000000000002', 100000, 'ton', 5, 'a9310000-0000-0000-0000-000000000002');
insert into public.shipment_items (id, shipment_id, line_no, item_code, item_name, quantity, unit) values
  ('b9310000-0000-0000-0000-000000000001', 'f9310000-0000-0000-0000-000000000001', 1, 'T931-HAT', 'Hạt nhựa', 25000, 'KG'),
  ('b9310000-0000-0000-0000-000000000002', 'f9310000-0000-0000-0000-000000000002', 1, 'T931-HAT', 'Hạt nhựa', 25000, 'KG'),
  ('b9310000-0000-0000-0000-000000000003', 'f9310000-0000-0000-0000-000000000003', 1, 'T931-HAT', 'Hạt nhựa', 5000, 'KG');

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000c931', 'hq.9031@gha.test', '{"full_name":"Nhà xe Hải Quân 9031"}')
on conflict do nothing;
update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000c931';
insert into public.user_roles (user_id, role_id) select '00000000-0000-0000-0000-00000000c931', id from public.roles where code = 'carrier_3pl';
insert into public.user_suppliers (user_id, supplier_id) values ('00000000-0000-0000-0000-00000000c931', 'a9310000-0000-0000-0000-000000000001');

select tests.login('00000000-0000-0000-0000-00000000c931');
set role authenticated;
-- 18 + 18 + 15 tấn = 51 tấn > 50 tấn của 2 đơn: chặn
select tests.assert_fails($$select public.carrier_register_vehicles_multi(array['f9310000-0000-0000-0000-000000000001', 'f9310000-0000-0000-0000-000000000002']::uuid[],
  '[{"plate":"61K31001","quantities":{"b9310000-0000-0000-0000-000000000001":18000}},
    {"plate":"61K31002","quantities":{"b9310000-0000-0000-0000-000000000001":7000,"b9310000-0000-0000-0000-000000000002":11000}},
    {"plate":"61K31003","quantities":{"b9310000-0000-0000-0000-000000000002":15000}}]')$$, 'Tổng các xe vượt số lượng đơn bị chặn');
select tests.assert_fails($$select public.carrier_register_vehicles_multi(array['f9310000-0000-0000-0000-000000000001', 'f9310000-0000-0000-0000-000000000003']::uuid[],
  '[{"plate":"61K31001","quantities":{"b9310000-0000-0000-0000-000000000001":1000,"b9310000-0000-0000-0000-000000000003":1000}}]')$$, 'Không gộp chuyến của nhà xe khác');
select tests.assert_fails($$select public.carrier_register_vehicles_multi(array['f9310000-0000-0000-0000-000000000001']::uuid[],
  '[{"plate":"61K31001","quantities":{"b9310000-0000-0000-0000-000000000003":1000}}]')$$, 'Không nhập số lượng cho hàng của chuyến không chọn');

select public.carrier_register_vehicles_multi(array['f9310000-0000-0000-0000-000000000001', 'f9310000-0000-0000-0000-000000000002']::uuid[],
  '[{"plate":"61K31001","quantities":{"b9310000-0000-0000-0000-000000000001":18000}},
    {"plate":"61K31002","driver_name":"Trần Văn B","quantities":{"b9310000-0000-0000-0000-000000000001":7000,"b9310000-0000-0000-0000-000000000002":11000}},
    {"plate":"61K31003","quantities":{"b9310000-0000-0000-0000-000000000002":14000}}]');
select tests.assert((select count(*) from jsonb_array_elements(public.carrier_portal_shipments(null, '2027-04-01', '2027-04-01'))) = 4, '2 đơn chia 3 xe thành 4 chuyến (xe 2 có 2 chuyến)');
select tests.assert((select count(*) from jsonb_array_elements(public.carrier_portal_shipments(null, '2027-04-01', '2027-04-01')) x where x ->> 'plate_number' = '61K31002' and jsonb_array_length(x -> 'load_with') = 1) = 2,
  'Xe 2 thấy đi chung với chuyến của đơn kia');
reset role;
select tests.assert((select count(distinct load_group_id) from public.shipments s join public.vehicles v on v.id = s.vehicle_id where v.plate_number = '61K31002') = 1
  and (select count(*) from public.shipments s join public.vehicles v on v.id = s.vehicle_id where v.plate_number = '61K31002' and s.load_group_id is not null) = 2, 'Hai chuyến của xe 2 cùng nhóm xe');
select tests.assert((select count(*) from public.shipments where load_group_id is not null and order_id in ('e9310000-0000-0000-0000-000000000001', 'e9310000-0000-0000-0000-000000000002')) = 2, 'Xe 1, xe 3 không thuộc nhóm');
select tests.assert((select sum(quantity) from public.shipments where order_id = 'e9310000-0000-0000-0000-000000000001') = 25
  and (select sum(quantity) from public.shipments where order_id = 'e9310000-0000-0000-0000-000000000002') = 25, 'Mỗi đơn vẫn đủ 25 tấn');
select tests.assert((select sum(i.quantity) from public.shipment_items i join public.shipments s on s.id = i.shipment_id join public.vehicles v on v.id = s.vehicle_id where v.plate_number = '61K31002') = 18000, 'Xe 2 chở 18 tấn của 2 đơn');
select tests.assert((select v.plate_number from public.shipments s join public.vehicles v on v.id = s.vehicle_id where s.id = 'f9310000-0000-0000-0000-000000000001') = '61K31001'
  and (select v.plate_number from public.shipments s join public.vehicles v on v.id = s.vehicle_id where s.id = 'f9310000-0000-0000-0000-000000000002') = '61K31002', 'Chuyến gốc nhận xe đầu tiên lấy hàng của đơn đó');
select tests.assert((select count(distinct s.driver_id) from public.shipments s join public.vehicles v on v.id = s.vehicle_id where v.plate_number = '61K31002') = 1, 'Hai chuyến của xe 2 cùng tài xế');

-- Gợi ý xe, tài xế đã nhập (9031)
select tests.login('00000000-0000-0000-0000-00000000c931');
set role authenticated;
select tests.assert(jsonb_array_length(public.carrier_portal_fleet() -> 'vehicles') = 3, 'Gợi ý 3 xe nhà xe đã nhập');
select tests.assert((public.carrier_portal_fleet() -> 'drivers' -> 0 ->> 'name') = 'Trần Văn B' and jsonb_array_length(public.carrier_portal_fleet() -> 'drivers') = 1, 'Gợi ý tài xế đã nhập (không có tài xế đại diện)');
select tests.assert((public.carrier_portal_fleet() -> 'drivers' -> 0 ->> 'last_plate') = '61K31002', 'Tài xế nhớ xe lần trước');
select tests.assert(public.carrier_portal_fleet('a9310000-0000-0000-0000-000000000002') -> 'vehicles' = '[]'::jsonb, 'Không thấy xe nhà xe khác');
reset role;

delete from public.user_suppliers where user_id = '00000000-0000-0000-0000-00000000c931';

\o
\echo 'TẤT CẢ KIỂM THỬ MỘT XE CHỞ NHIỀU ĐƠN ĐỀU ĐẠT'
