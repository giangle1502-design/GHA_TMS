-- =============================================================================
-- Kiểm thử 0052: Cấu hình bật / tắt chụp ảnh và nhập chi phí trên ứng dụng tài xế
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
insert into public.vehicles (id, code, plate_number, vehicle_type_id) values
  ('50000000-0000-0000-0000-0000000000d7', 'XED7', '61K99007', '30000000-0000-0000-0000-000000000001');
insert into public.drivers (id, code, full_name) values ('40000000-0000-0000-0000-0000000000d7', 'TXD7', 'Tài xế D7');
create temp table t_tg (k text primary key, v text);
grant all on t_tg to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from t_tg where k = key $$;
insert into t_tg select 'cat', id::text from public.expense_categories where code = 'MEAL';
update public.expense_categories set requires_image = true where code = 'MEAL';

-- Mặc định: bật cả ba
set role anon;
select tests.assert(public.driver_app_settings() @> '{"photos_enabled": true, "delivery_photo_required": true, "expense_enabled": true}'::jsonb,
  'Mặc định: cho chụp ảnh, bắt buộc ảnh giao hàng, cho nhập chi phí');
reset role;

-- Hai chuyến cho xe 61K99007 (ngày khác nhau)
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into public.transport_plans (customer_id, container_qty, pickup_location_id, delivery_location_id, delivery_date)
values ('10000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2026-12-27'),
       ('10000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2026-12-28');
insert into t_tg select 'P1', id::text from public.transport_plans where delivery_date = '2026-12-27' order by created_at desc limit 1;
insert into t_tg select 'P2', id::text from public.transport_plans where delivery_date = '2026-12-28' order by created_at desc limit 1;
select public.plan_create_orders(pg_temp.v('P1')::uuid);
select public.plan_create_orders(pg_temp.v('P2')::uuid);
insert into t_tg select 's1', id::text from public.shipments where plan_id = pg_temp.v('P1')::uuid;
insert into t_tg select 's2', id::text from public.shipments where plan_id = pg_temp.v('P2')::uuid;
select public.assign_shipment(pg_temp.v('s1')::uuid, '40000000-0000-0000-0000-0000000000d7', '50000000-0000-0000-0000-0000000000d7');
reset role;

set role anon;
insert into t_tg select 'tok', public.driver_link_login('61K99007') ->> 'token';
select tests.assert((public.driver_link_accept(pg_temp.v('tok'), pg_temp.v('s1')::uuid) ->> 'ok')::boolean, 'Nhận chuyến 1');
select tests.assert((public.driver_link_start(pg_temp.v('tok'), pg_temp.v('s1')::uuid) ->> 'ok')::boolean, 'Chạy chuyến 1');
select tests.assert((public.driver_link_complete(pg_temp.v('tok'), pg_temp.v('s1')::uuid, null, 'full', null, true) ->> 'error') like '%ít nhất 1 ảnh%',
  'Bật bắt buộc ảnh: không ảnh thì không hoàn thành được');
reset role;

-- Đơn không yêu cầu chụp chứng từ (0054: thay cho tham số chung): hoàn thành không cần ảnh
update public.system_settings set value = 'false' where key = 'shipment.require_delivery_photo';
update public.shipments set pod_photo_required = false where id = pg_temp.v('s1')::uuid;
set role anon;
select tests.assert((public.driver_app_settings() ->> 'delivery_photo_required')::boolean = false
                    and (public.driver_app_settings() ->> 'photos_enabled')::boolean, 'Tắt bắt buộc ảnh: vẫn cho chụp');
select tests.assert((public.driver_link_complete(pg_temp.v('tok'), pg_temp.v('s1')::uuid, null, 'full', null, true) ->> 'ok')::boolean,
  'Tắt bắt buộc ảnh: hoàn thành không cần ảnh');
-- Hạng mục bắt buộc ảnh hóa đơn vẫn bắt buộc khi còn cho chụp ảnh
select tests.assert((public.driver_link_add_expense(pg_temp.v('tok'), pg_temp.v('s1')::uuid, pg_temp.v('cat')::uuid, 50000) ->> 'error') like '%cần ảnh%',
  'Còn cho chụp ảnh: hạng mục bắt buộc hóa đơn vẫn phải chụp');
reset role;

-- Tắt hẳn chụp ảnh: hạng mục bắt buộc hóa đơn cũng không cần ảnh; bật lại bắt buộc ảnh giao hàng cũng không có tác dụng
update public.system_settings set value = 'false' where key = 'driver.photos_enabled';
update public.system_settings set value = 'true' where key = 'shipment.require_delivery_photo';
set role anon;
select tests.assert((public.driver_app_settings() ->> 'photos_enabled')::boolean = false
                    and (public.driver_app_settings() ->> 'delivery_photo_required')::boolean = false, 'Tắt chụp ảnh: không bắt buộc ảnh');
select tests.assert((public.driver_link_add_expense(pg_temp.v('tok'), pg_temp.v('s1')::uuid, pg_temp.v('cat')::uuid, 50000) ->> 'ok')::boolean,
  'Tắt chụp ảnh: nhập chi phí không cần hóa đơn');
reset role;

-- Tắt nhập chi phí: hoàn thành không hỏi chi phí, không bổ sung được
update public.system_settings set value = 'false' where key = 'driver.expense_enabled';
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.assign_shipment(pg_temp.v('s2')::uuid, '40000000-0000-0000-0000-0000000000d7', '50000000-0000-0000-0000-0000000000d7');
reset role;
set role anon;
select tests.assert((public.driver_app_settings() ->> 'expense_enabled')::boolean = false, 'Tham số tắt nhập chi phí');
select tests.assert((public.driver_link_accept(pg_temp.v('tok'), pg_temp.v('s2')::uuid) ->> 'ok')::boolean, 'Nhận chuyến 2');
select tests.assert((public.driver_link_start(pg_temp.v('tok'), pg_temp.v('s2')::uuid) ->> 'ok')::boolean, 'Chạy chuyến 2');
select tests.assert((public.driver_link_complete(pg_temp.v('tok'), pg_temp.v('s2')::uuid, null, 'full', null, null) ->> 'ok')::boolean,
  'Tắt nhập chi phí: hoàn thành không cần chọn Có / Không chi phí, không cần ảnh');
select tests.assert((select expense_declaration is null and status = 'driver_completed' from public.driver_link_trips(pg_temp.v('tok'))
  where shipment_id = pg_temp.v('s2')::uuid), 'Chuyến hoàn thành, không ghi khai chi phí');
select tests.assert((public.driver_link_add_expense(pg_temp.v('tok'), pg_temp.v('s2')::uuid, pg_temp.v('cat')::uuid, 50000) ->> 'error') like '%tắt nhập chi phí%',
  'Tắt nhập chi phí: không bổ sung chi phí được');
reset role;

-- Trả lại mặc định cho các kiểm thử sau
update public.system_settings set value = 'true' where key in ('driver.photos_enabled', 'driver.expense_enabled', 'shipment.require_delivery_photo');
update public.expense_categories set requires_image = false where code = 'MEAL';
\o
\echo '36_driver_app_toggles_tests: OK'
