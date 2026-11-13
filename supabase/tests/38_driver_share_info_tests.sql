-- =============================================================================
-- Kiểm thử 0055: Thông tin tài xế gửi khách (tên, biển số, CCCD, GPLX)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
insert into public.vehicles (id, code, plate_number, vehicle_type_id) values
  ('50000000-0000-0000-0000-0000000000f8', 'XEF8', '50H25688', '30000000-0000-0000-0000-000000000001');
insert into public.drivers (id, code, full_name) values ('40000000-0000-0000-0000-0000000000f8', 'TXF8', 'Lê Văn Dạng');
insert into public.driver_sensitive (driver_id, national_id) values ('40000000-0000-0000-0000-0000000000f8', '084091007921');
create temp table t_di (k text primary key, v text);
grant all on t_di to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from t_di where k = key $$;

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into public.transport_plans (customer_id, container_qty, pickup_location_id, delivery_location_id, delivery_date)
values ('10000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2026-12-25');
insert into t_di select 'P', id::text from public.transport_plans where delivery_date = '2026-12-25' and container_qty = 1 order by created_at desc limit 1;
select public.plan_create_orders(pg_temp.v('P')::uuid);
insert into t_di select 's', id::text from public.shipments where plan_id = pg_temp.v('P')::uuid;
select tests.assert((select driver_name is null from public.shipment_driver_info(array[pg_temp.v('s')::uuid])), 'Chuyến chưa phân công: chưa có tài xế');
select public.assign_shipment(pg_temp.v('s')::uuid, '40000000-0000-0000-0000-0000000000f8', '50000000-0000-0000-0000-0000000000f8');
-- Điều phối không có quyền xem giấy tờ trong hồ sơ, nhưng xem được thông tin gửi khách
select tests.assert(not exists (select 1 from public.driver_sensitive where driver_id = '40000000-0000-0000-0000-0000000000f8'),
  'Điều phối vẫn không đọc trực tiếp được bảng giấy tờ tùy thân');
select tests.assert((select driver_name = 'Lê Văn Dạng' and plate_number = '50H25688' and national_id = '084091007921' and license_no is null
  from public.shipment_driver_info(array[pg_temp.v('s')::uuid])), 'Điều phối xem tên, biển số, CCCD của chuyến; GPLX chưa có');
-- Điều phối điền GPLX còn thiếu, không sửa được CCCD đã có
select public.set_driver_share_info('40000000-0000-0000-0000-0000000000f8', '999', ' 790168005497 ');
select tests.assert((select national_id = '084091007921' and license_no = '790168005497'
  from public.shipment_driver_info(array[pg_temp.v('s')::uuid])), 'Điều phối chỉ điền ô trống (GPLX), CCCD đã có giữ nguyên');
reset role;

-- Người không có quyền điều phối / chuyến xe: bị chặn
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert_fails($$select * from public.shipment_driver_info(array['00000000-0000-0000-0000-000000000000'::uuid])$$, 'Tài xế không gọi được shipment_driver_info');
select tests.assert_fails($$select public.set_driver_share_info('40000000-0000-0000-0000-0000000000f8', null, '1')$$, 'Tài xế không sửa được giấy tờ qua hàm điền nhanh');
reset role;
set role anon;
select tests.assert_fails($$select * from public.shipment_driver_info(array['00000000-0000-0000-0000-000000000000'::uuid])$$, 'Khách vãng lai không gọi được');
reset role;

-- Quản trị (sửa được giấy tờ) sửa được giá trị đã có
select tests.login('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select public.set_driver_share_info('40000000-0000-0000-0000-0000000000f8', '084091007922', null);
select tests.assert((select national_id = '084091007922' and license_no = '790168005497' from public.driver_sensitive where driver_id = '40000000-0000-0000-0000-0000000000f8'),
  'Quản trị sửa được CCCD; ô để trống giữ GPLX cũ');
reset role;
\o
\echo '38_driver_share_info_tests: OK'
