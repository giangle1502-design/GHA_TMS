-- =============================================================================
-- Kiểm thử 0057: Giao chuyến cho nhà xe 3PL (số xe, tài xế không bắt buộc)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
insert into public.suppliers (id, code, name) values ('60000000-0000-0000-0000-0000000000a7', 'NCCA7', 'LINH TRƯƠNG');
insert into public.vehicles (id, code, plate_number, vehicle_type_id) values
  ('50000000-0000-0000-0000-0000000000a7', 'XEA7', '51C99901', '30000000-0000-0000-0000-000000000001');
create temp table t_3 (k text primary key, v text);
grant all on t_3 to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from t_3 where k = key $$;

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into public.transport_plans (customer_id, container_qty, pickup_location_id, delivery_location_id, delivery_date, supplier_id)
values ('10000000-0000-0000-0000-000000000001', 3, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2026-12-27',
        '60000000-0000-0000-0000-0000000000a7');
insert into t_3 select 'P', id::text from public.transport_plans where delivery_date = '2026-12-27' order by created_at desc limit 1;
select public.plan_create_orders(pg_temp.v('P')::uuid);
insert into t_3 select 's' || row_number() over (order by id), id::text from public.shipments where plan_id = pg_temp.v('P')::uuid;

-- Chuyến từ kế hoạch có NCC: tự biết nhà xe 3PL
select tests.assert((select (r->>'supplier_name') = 'LINH TRƯƠNG' and (r->>'from_plan')::boolean and not (r->>'is_3pl')::boolean
  from public.shipment_3pl_info(pg_temp.v('s1')::uuid) r), 'Chuyến từ kế hoạch: lấy nhà xe 3PL từ NCC');

-- Đủ thông tin: tạo xe 3PL, tài xế 3PL, giấy tờ
select public.assign_shipment_3pl(pg_temp.v('s1')::uuid, '60000000-0000-0000-0000-0000000000a7', '61k-777.01', ' Nguyễn  Văn Tư ', '0909 123 456', '084091000001', '790168000001');
select tests.assert((select status = 'assigned' and carrier_supplier_id = '60000000-0000-0000-0000-0000000000a7' from public.shipments where id = pg_temp.v('s1')::uuid),
  'Giao 3PL: chuyến chờ tài xế nhận, ghi nhà xe');
select tests.assert((select v.plate_number = '61K77701' and v.ownership_type = 'outsourced' and v.supplier_id = '60000000-0000-0000-0000-0000000000a7'
  from public.shipments s join public.vehicles v on v.id = s.vehicle_id where s.id = pg_temp.v('s1')::uuid), 'Tự thêm xe Thuê ngoài 3PL của nhà xe');
select tests.assert((select (r->>'driver_name') = 'Nguyễn Văn Tư' and (r->>'driver_phone') = '0909123456' and (r->>'national_id') = '084091000001'
  and (r->>'license_no') = '790168000001' and (r->>'is_3pl')::boolean and (r->>'plate') = '61K77701'
  from public.shipment_3pl_info(pg_temp.v('s1')::uuid) r), 'Mở lại thấy đủ thông tin 3PL đã nhập');
reset role;
select tests.assert((select is_outsourced and supplier_id = '60000000-0000-0000-0000-0000000000a7' from public.drivers where full_name = 'Nguyễn Văn Tư'),
  'Tài xế được đánh dấu tài xế 3PL của nhà xe');
select tests.assert((select assigned_driver_id is not null from public.vehicles where plate_number = '61K77701'), 'Xe 3PL nhớ tài xế để lần sau tự điền');
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;

-- Chuyến 2: cùng xe, cùng SĐT → dùng lại, không tạo trùng
select public.assign_shipment_3pl(pg_temp.v('s2')::uuid, '60000000-0000-0000-0000-0000000000a7', '61K77701', null, '0909123456', null, null);
reset role;
select tests.assert((select count(*) = 1 from public.drivers where is_outsourced and phone = '0909123456'), 'Không tạo trùng tài xế 3PL cùng SĐT');
select tests.assert((select count(*) = 1 from public.vehicles where plate_number = '61K77701'), 'Không tạo trùng xe 3PL');
select tests.assert((select national_id = '084091000001' from public.driver_sensitive ds join public.drivers d on d.id = ds.driver_id where d.phone = '0909123456'),
  'Để trống CCCD thì giữ CCCD cũ');
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;

-- Chuyến 3: không nhập gì → tài xế đại diện của nhà xe, không xe
select public.assign_shipment_3pl(pg_temp.v('s3')::uuid, '60000000-0000-0000-0000-0000000000a7');
select tests.assert((select s.status = 'assigned' and s.vehicle_id is null and d.full_name = 'Tài xế 3PL LINH TRƯƠNG' and d.is_outsourced
  from public.shipments s join public.drivers d on d.id = s.driver_id where s.id = pg_temp.v('s3')::uuid), 'Không nhập tài xế: dùng tài xế đại diện của nhà xe');
select tests.assert((select (r->>'driver_name') is null from public.shipment_3pl_info(pg_temp.v('s3')::uuid) r), 'Tài xế đại diện không hiện thành tên tài xế');

-- Xe nội bộ không được giao như xe 3PL
select tests.assert_fails($$select public.assign_shipment_3pl(pg_temp.v('s3')::uuid, '60000000-0000-0000-0000-0000000000a7', '51C99901')$$, 'Số xe nội bộ bị chặn ở Giao 3PL');
reset role;

-- Không có quyền điều phối: bị chặn
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert_fails($$select public.assign_shipment_3pl(pg_temp.v('s3')::uuid, '60000000-0000-0000-0000-0000000000a7')$$, 'Tài xế không giao chuyến 3PL được');
select tests.assert_fails($$select public.shipment_3pl_info(pg_temp.v('s3')::uuid)$$, 'Tài xế không xem thông tin 3PL được');
reset role;
set role anon;
select tests.assert_fails($$select public.assign_shipment_3pl('00000000-0000-0000-0000-000000000000', '60000000-0000-0000-0000-0000000000a7')$$, 'Khách vãng lai bị chặn');
reset role;
\o
\echo '40_assign_3pl_tests: OK'
