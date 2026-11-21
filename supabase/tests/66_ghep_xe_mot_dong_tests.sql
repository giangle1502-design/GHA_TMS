-- =============================================================================
-- Kiểm thử 9035: hai đơn ghép chung một xe hiện 1 dòng (nhóm xe load_group_id)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

insert into public.customers (id, code, name) values ('c9350000-0000-0000-0000-000000000001', 'T935-KH', 'Khách thử 9035');
insert into public.locations (id, code, name, full_address) values
  ('d9350000-0000-0000-0000-000000000001', 'T935-NHAN', 'Kho ngoại quan 9035', 'KCN'),
  ('d9350000-0000-0000-0000-000000000002', 'T935-GIAO', 'Bãi xe 9035', 'Q1');
insert into public.vehicles (id, code, plate_number) values
  ('a9350000-0000-0000-0000-000000000001', 'T935-X1', '61H93501'),
  ('a9350000-0000-0000-0000-000000000002', 'T935-X2', '61H93502');
insert into public.transport_orders (id, order_code, customer_id, payer_customer_id) values
  ('e9350000-0000-0000-0000-000000000001', 'T935-1', 'c9350000-0000-0000-0000-000000000001', 'c9350000-0000-0000-0000-000000000001'),
  ('e9350000-0000-0000-0000-000000000002', 'T935-2', 'c9350000-0000-0000-0000-000000000001', 'c9350000-0000-0000-0000-000000000001'),
  ('e9350000-0000-0000-0000-000000000003', 'T935-3', 'c9350000-0000-0000-0000-000000000001', 'c9350000-0000-0000-0000-000000000001');
insert into public.shipments (id, shipment_code, order_id, pickup_at, pickup_location_id, delivery_location_id, unit_price, pricing_unit, quantity, vehicle_id, vehicle_day_order) values
  ('f9350000-0000-0000-0000-000000000001', 'T935-S1', 'e9350000-0000-0000-0000-000000000001', '2027-05-01 08:00+07', 'd9350000-0000-0000-0000-000000000001', 'd9350000-0000-0000-0000-000000000002', 2200000, 'trip', 1, 'a9350000-0000-0000-0000-000000000001', 1),
  ('f9350000-0000-0000-0000-000000000002', 'T935-S2', 'e9350000-0000-0000-0000-000000000002', '2027-05-01 09:00+07', 'd9350000-0000-0000-0000-000000000001', 'd9350000-0000-0000-0000-000000000002', 2500000, 'trip', 1, 'a9350000-0000-0000-0000-000000000001', 2),
  ('f9350000-0000-0000-0000-000000000003', 'T935-S3', 'e9350000-0000-0000-0000-000000000003', '2027-05-01 09:00+07', 'd9350000-0000-0000-0000-000000000001', 'd9350000-0000-0000-0000-000000000002', 1000000, 'trip', 1, 'a9350000-0000-0000-0000-000000000002', null);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000d935', 'dp.9035@gha.test', '{"full_name":"Điều phối 9035"}'),
  ('00000000-0000-0000-0000-00000000e935', 'kt.9035@gha.test', '{"full_name":"Không quyền 9035"}')
on conflict do nothing;
update public.profiles set status = 'active' where id in ('00000000-0000-0000-0000-00000000d935', '00000000-0000-0000-0000-00000000e935');
insert into public.user_roles (user_id, role_id) select '00000000-0000-0000-0000-00000000d935', id from public.roles where code = 'dispatcher' on conflict do nothing;

-- Người không có quyền điều phối: chặn
select tests.login('00000000-0000-0000-0000-00000000e935');
set role authenticated;
select tests.assert_fails($$select public.set_shipment_load_group(array['f9350000-0000-0000-0000-000000000001', 'f9350000-0000-0000-0000-000000000002']::uuid[])$$, 'Không có quyền điều phối thì không ghép được');
reset role;

select tests.login('00000000-0000-0000-0000-00000000d935');
set role authenticated;
select tests.assert_fails($$select public.set_shipment_load_group(array['f9350000-0000-0000-0000-000000000001']::uuid[])$$, 'Ghép phải ít nhất 2 chuyến');
select tests.assert_fails($$select public.set_shipment_load_group(array['f9350000-0000-0000-0000-000000000001', 'f9350000-0000-0000-0000-000000000003']::uuid[])$$, 'Khác số xe thì không ghép');
select public.set_shipment_load_group(array['f9350000-0000-0000-0000-000000000001', 'f9350000-0000-0000-0000-000000000002']::uuid[]);
select tests.assert((select count(distinct load_group_id) from public.shipment_list where id in ('f9350000-0000-0000-0000-000000000001', 'f9350000-0000-0000-0000-000000000002') and load_group_id is not null) = 1
  and (select count(*) from public.shipment_list where load_group_id is not null and order_id in ('e9350000-0000-0000-0000-000000000001', 'e9350000-0000-0000-0000-000000000002')) = 2,
  'Hai chuyến cùng nhóm xe, view shipment_list có load_group_id');
select tests.assert((select count(distinct vehicle_day_order) from public.shipments where id in ('f9350000-0000-0000-0000-000000000001', 'f9350000-0000-0000-0000-000000000002')) = 1
  and (select min(vehicle_day_order) from public.shipments where id = 'f9350000-0000-0000-0000-000000000002') = 1, 'Cùng lượt: thứ tự xe về 1 cho cả hai');
select tests.assert((select sum(freight_amount) from public.shipments where id in ('f9350000-0000-0000-0000-000000000001', 'f9350000-0000-0000-0000-000000000002')) = 4700000, 'Cước từng chuyến giữ nguyên');
-- Ghép lại lần nữa không tạo nhóm mới
select public.set_shipment_load_group(array['f9350000-0000-0000-0000-000000000002', 'f9350000-0000-0000-0000-000000000001']::uuid[]);
select tests.assert((select count(distinct load_group_id) from public.shipments where order_id in ('e9350000-0000-0000-0000-000000000001', 'e9350000-0000-0000-0000-000000000002')) = 1, 'Ghép lại giữ nhóm cũ');
select tests.assert(public.clear_shipment_load_group((select load_group_id from public.shipments where id = 'f9350000-0000-0000-0000-000000000001')) = 2, 'Tách nhóm');
select tests.assert(not exists (select 1 from public.shipments where order_id in ('e9350000-0000-0000-0000-000000000001', 'e9350000-0000-0000-0000-000000000002') and load_group_id is not null), 'Tách xong không còn nhóm');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ GHÉP XE MỘT DÒNG ĐỀU ĐẠT'
