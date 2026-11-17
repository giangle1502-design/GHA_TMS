-- =============================================================================
-- Kiểm thử 9017: hai cont cùng điểm nhận / giao, chống nhập nhầm cont khi trả rỗng / cược
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
select tests.assert(private.container_no_valid('CSQU3054383') and private.container_no_valid('csqu 305438-3'), 'Số cont đúng chuẩn ISO 6346');
select tests.assert(not private.container_no_valid('CSQU3054384') and not private.container_no_valid('CSQ3054383'), 'Sai số kiểm tra / sai dạng: không hợp lệ');

insert into public.vehicles (id, code, plate_number, vehicle_type_id) values
  ('50000000-0000-0000-0000-0000000000ea', 'XEEA', '61K99010', '30000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-0000000000eb', 'XEEB', '61K99011', '30000000-0000-0000-0000-000000000001');
insert into public.drivers (id, code, full_name) values
  ('40000000-0000-0000-0000-0000000000ea', 'TXEA', 'Tài xế EA'),
  ('40000000-0000-0000-0000-0000000000eb', 'TXEB', 'Tài xế EB');
create temp table t_sc (k text primary key, v text);
grant all on t_sc to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from t_sc where k = key $$;

-- Hai cont cùng điểm nhận, điểm giao, cùng ngày
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into public.transport_plans (customer_id, container_qty, pickup_location_id, delivery_location_id, delivery_date)
values ('10000000-0000-0000-0000-000000000001', 2, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2027-01-21');
insert into t_sc select 'P', id::text from public.transport_plans where delivery_date = '2027-01-21' and container_qty = 2;
select public.plan_create_orders(pg_temp.v('P')::uuid);
insert into t_sc select 'a', id::text from public.shipments where plan_id = pg_temp.v('P')::uuid order by shipment_code limit 1;
insert into t_sc select 'b', id::text from public.shipments where plan_id = pg_temp.v('P')::uuid order by shipment_code offset 1 limit 1;
update public.shipments set pod_photo_required = false, empty_return_location_id = '20000000-0000-0000-0000-000000000001'
 where id in (pg_temp.v('a')::uuid, pg_temp.v('b')::uuid);
select public.assign_shipment(pg_temp.v('a')::uuid, '40000000-0000-0000-0000-0000000000ea', '50000000-0000-0000-0000-0000000000ea');
select public.assign_shipment(pg_temp.v('b')::uuid, '40000000-0000-0000-0000-0000000000eb', '50000000-0000-0000-0000-0000000000eb');
reset role;

set role anon;
insert into t_sc select 'ta', public.driver_link_login('61K99010') ->> 'token';
insert into t_sc select 'tb', public.driver_link_login('61K99011') ->> 'token';
select public.driver_link_accept(pg_temp.v('ta'), pg_temp.v('a')::uuid);
select public.driver_link_accept(pg_temp.v('tb'), pg_temp.v('b')::uuid);
select tests.assert((select container_no is null from public.driver_link_containers(pg_temp.v('ta')) where shipment_id = pg_temp.v('a')::uuid), 'Chuyến chưa có số cont');
select tests.assert((public.driver_link_set_container(pg_temp.v('ta'), pg_temp.v('a')::uuid, 300000, 'HD-TR-1', null, null, null, null) ->> 'error') like 'Nhập số cont%',
  'Chưa có số cont: bắt nhập số cont');
select tests.assert((public.driver_link_set_container(pg_temp.v('ta'), pg_temp.v('a')::uuid, 300000, 'HD-TR-1', null, null, null, 'CSQU3054384') ->> 'error') like '%không đúng%',
  'Số cont sai số kiểm tra: báo lỗi');
select tests.assert((public.driver_link_set_container(pg_temp.v('ta'), pg_temp.v('a')::uuid, 300000, 'HD-TR-1', null, null, null, 'csqu 305438-3') ->> 'container_no') = 'CSQU3054383',
  'Nhập số cont đúng: lưu chuyến, chuẩn hóa chữ hoa');
select tests.assert((select container_no = 'CSQU3054383' from public.driver_link_containers(pg_temp.v('ta')) where shipment_id = pg_temp.v('a')::uuid), 'Thẻ chuyến hiện số cont');
select tests.assert((public.driver_link_set_container(pg_temp.v('ta'), pg_temp.v('a')::uuid, 300000, 'HD-TR-1', null, null, null, 'MSCU1234566') ->> 'error') like '%khác số cont của chuyến%',
  'Gõ số cont khác số cont của chuyến: báo lỗi');
select tests.assert((public.driver_link_set_container(pg_temp.v('ta'), pg_temp.v('a')::uuid, 320000, 'HD-TR-1', null, null, null, null) ->> 'ok')::boolean,
  'Đã có số cont: sửa tiền không cần gõ lại');
-- Tài xế xe B nhập nhầm hóa đơn của cont A
select tests.assert((public.driver_link_set_container(pg_temp.v('tb'), pg_temp.v('b')::uuid, 300000, 'hd-tr-1', null, null, null, 'MSCU1234566') ->> 'error') like 'Hóa đơn trả rỗng hd-tr-1 đã nhập ở chuyến%CSQU3054383%',
  'Trùng số HĐ trả rỗng ở cont khác: báo lỗi, nêu chuyến và cont');
reset role;
select tests.assert((select container_no is null from public.shipments where id = pg_temp.v('b')::uuid), 'Lỗi thì không ghi số cont cho chuyến B');

\o
\echo '57_so_cont_tra_rong_tests: OK'
