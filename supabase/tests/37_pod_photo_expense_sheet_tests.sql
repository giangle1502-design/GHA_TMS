-- =============================================================================
-- Kiểm thử 0054: chụp chứng từ theo đơn; phiếu chi phí thay cho nhập từng khoản
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
update public.system_settings set value = 'true' where key = 'driver.expense_sheet_photo';
insert into public.vehicles (id, code, plate_number, vehicle_type_id) values
  ('50000000-0000-0000-0000-0000000000e8', 'XEE8', '61K99008', '30000000-0000-0000-0000-000000000001');
insert into public.drivers (id, code, full_name) values ('40000000-0000-0000-0000-0000000000e8', 'TXE8', 'Tài xế E8');
create temp table t_ps (k text primary key, v text);
grant all on t_ps to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from t_ps where k = key $$;

-- Đơn mới lấy mặc định từ tham số: tắt mặc định thì đơn mới không yêu cầu chụp chứng từ
update public.system_settings set value = 'false' where key = 'shipment.require_delivery_photo';
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into public.transport_plans (customer_id, container_qty, pickup_location_id, delivery_location_id, delivery_date)
values ('10000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2026-12-21'),
       ('10000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2026-12-22'),
       ('10000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2026-12-23');
insert into t_ps select 'P' || extract(day from delivery_date)::int, id::text from public.transport_plans where delivery_date between '2026-12-21' and '2026-12-23';
select public.plan_create_orders(pg_temp.v('P21')::uuid);
select public.plan_create_orders(pg_temp.v('P22')::uuid);
select public.plan_create_orders(pg_temp.v('P23')::uuid);
insert into t_ps select 's1', id::text from public.shipments where plan_id = pg_temp.v('P21')::uuid;
insert into t_ps select 's2', id::text from public.shipments where plan_id = pg_temp.v('P22')::uuid;
insert into t_ps select 's3', id::text from public.shipments where plan_id = pg_temp.v('P23')::uuid;
select tests.assert((select not pod_photo_required from public.shipments where id = pg_temp.v('s1')::uuid), 'Mặc định tắt: đơn mới không yêu cầu chụp chứng từ');
-- Điều phối tích yêu cầu chụp chứng từ cho chuyến 2
update public.shipments set pod_photo_required = true where id = pg_temp.v('s2')::uuid;
select public.assign_shipment(pg_temp.v('s1')::uuid, '40000000-0000-0000-0000-0000000000e8', '50000000-0000-0000-0000-0000000000e8');
reset role;

set role anon;
insert into t_ps select 'tok', public.driver_link_login('61K99008') ->> 'token';
select tests.assert((select not pod_photo_required and sheet_count = 0 from public.driver_link_trip_flags(pg_temp.v('tok')) where shipment_id = pg_temp.v('s1')::uuid),
  'Màn hình tài xế biết chuyến không yêu cầu chụp chứng từ');
select public.driver_link_accept(pg_temp.v('tok'), pg_temp.v('s1')::uuid);
select public.driver_link_start(pg_temp.v('tok'), pg_temp.v('s1')::uuid);
select tests.assert((public.driver_link_complete(pg_temp.v('tok'), pg_temp.v('s1')::uuid, null, 'full', null, false) ->> 'error') like 'Vui lòng chụp hình chứng từ chuyến có chi phí%',
  'Có chi phí mà không chụp phiếu chi phí: báo "Vui lòng chụp hình chứng từ chuyến có chi phí"');
select tests.assert((public.driver_link_complete(pg_temp.v('tok'), pg_temp.v('s1')::uuid, null, 'full', null, true) ->> 'ok')::boolean,
  'Chọn Không có chi phí: hoàn thành, không cần ảnh giao hàng (đơn không yêu cầu)');
reset role;
select tests.assert((select document_status = 'missing' and expense_declaration = 'none' from public.shipments where id = pg_temp.v('s1')::uuid),
  'Không ảnh: chứng từ vẫn Thiếu; khai không có chi phí');

-- Chuyến 2: đơn yêu cầu chụp chứng từ, có chi phí, chụp phiếu chi phí
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.assign_shipment(pg_temp.v('s2')::uuid, '40000000-0000-0000-0000-0000000000e8', '50000000-0000-0000-0000-0000000000e8');
reset role;
set role anon;
select public.driver_link_accept(pg_temp.v('tok'), pg_temp.v('s2')::uuid);
select public.driver_link_start(pg_temp.v('tok'), pg_temp.v('s2')::uuid);
insert into t_ps select 'tk1', public.driver_link_upload_ticket(pg_temp.v('tok'), pg_temp.v('s2')::uuid, 'delivery') ->> 'ticket';
insert into storage.objects (bucket_id, name, metadata)
values ('documents', 'tx/' || pg_temp.v('tk1') || '/receipt-' || gen_random_uuid() || '.jpg', '{"mimetype":"image/jpeg","size":120000}');
select tests.assert((public.driver_link_complete(pg_temp.v('tok'), pg_temp.v('s2')::uuid, pg_temp.v('tk1')::uuid, 'full', null, false) ->> 'error') like 'Đơn này yêu cầu chụp chứng từ%',
  'Đơn yêu cầu chụp chứng từ: chỉ có phiếu chi phí, thiếu ảnh giao hàng thì không qua');
insert into t_ps select 'tk2', public.driver_link_upload_ticket(pg_temp.v('tok'), pg_temp.v('s2')::uuid, 'delivery') ->> 'ticket';
insert into storage.objects (bucket_id, name, metadata) values
  ('documents', 'tx/' || pg_temp.v('tk2') || '/receipt-' || gen_random_uuid() || '.jpg', '{"mimetype":"image/jpeg","size":120000}'),
  ('documents', 'tx/' || pg_temp.v('tk2') || '/photo-' || gen_random_uuid() || '.jpg', '{"mimetype":"image/jpeg","size":120000}');
select tests.assert((public.driver_link_complete(pg_temp.v('tok'), pg_temp.v('s2')::uuid, pg_temp.v('tk2')::uuid, 'full', null, false) ->> 'sheets')::int = 1,
  'Ảnh giao hàng + phiếu chi phí: hoàn thành');
select tests.assert((select sheet_count = 1 and pod_photo_required from public.driver_link_trip_flags(pg_temp.v('tok')) where shipment_id = pg_temp.v('s2')::uuid),
  'Thẻ chuyến đếm 1 ảnh phiếu chi phí');
-- Gửi thêm phiếu chi phí
insert into t_ps select 'tk3', public.driver_link_upload_ticket(pg_temp.v('tok'), pg_temp.v('s2')::uuid, 'expense') ->> 'ticket';
select tests.assert((public.driver_link_add_sheet(pg_temp.v('tok'), pg_temp.v('s2')::uuid, pg_temp.v('tk3')::uuid) ->> 'ok')::boolean = false, 'Gửi thêm phải có ảnh');
insert into t_ps select 'tk4', public.driver_link_upload_ticket(pg_temp.v('tok'), pg_temp.v('s2')::uuid, 'expense') ->> 'ticket';
insert into storage.objects (bucket_id, name, metadata)
values ('documents', 'tx/' || pg_temp.v('tk4') || '/receipt-' || gen_random_uuid() || '.jpg', '{"mimetype":"image/jpeg","size":120000}');
select tests.assert((public.driver_link_add_sheet(pg_temp.v('tok'), pg_temp.v('s2')::uuid, pg_temp.v('tk4')::uuid) ->> 'ok')::boolean, 'Gửi thêm phiếu chi phí');
select tests.assert((select sheet_count = 2 from public.driver_link_trip_flags(pg_temp.v('tok')) where shipment_id = pg_temp.v('s2')::uuid), 'Còn 2 ảnh phiếu chi phí');
reset role;
select tests.assert((select document_status = 'submitted' and expense_declaration = 'has' from public.shipments where id = pg_temp.v('s2')::uuid),
  'Có ảnh: chứng từ Đã nộp; khai có chi phí');

-- Tắt chế độ phiếu chi phí: có chi phí không cần phiếu (tài xế nhập từng khoản như trước)
update public.system_settings set value = 'false' where key = 'driver.expense_sheet_photo';
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.assign_shipment(pg_temp.v('s3')::uuid, '40000000-0000-0000-0000-0000000000e8', '50000000-0000-0000-0000-0000000000e8');
reset role;
set role anon;
select tests.assert((public.driver_app_settings() ->> 'expense_sheet_photo')::boolean = false, 'Tham số tắt phiếu chi phí');
select public.driver_link_accept(pg_temp.v('tok'), pg_temp.v('s3')::uuid);
select public.driver_link_start(pg_temp.v('tok'), pg_temp.v('s3')::uuid);
select tests.assert((public.driver_link_complete(pg_temp.v('tok'), pg_temp.v('s3')::uuid, null, 'full', null, false) ->> 'ok')::boolean,
  'Tắt phiếu chi phí: có chi phí hoàn thành không cần phiếu');
reset role;

update public.system_settings set value = 'true' where key = 'shipment.require_delivery_photo';
update public.system_settings set value = 'false' where key = 'driver.expense_sheet_photo';
\o
\echo '37_pod_photo_expense_sheet_tests: OK'
