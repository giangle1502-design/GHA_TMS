-- =============================================================================
-- Kiểm thử 0049: hủy nhận xe để đổi xe khác; sửa số xe / tài xế cả khi chuyến đã hoàn thành
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
insert into public.vehicles (id, code, plate_number, vehicle_type_id) values
  ('50000000-0000-0000-0000-0000000000c2', 'XEC2', '61K31295', '30000000-0000-0000-0000-000000000001');
insert into public.drivers (id, code, full_name) values
  ('40000000-0000-0000-0000-0000000000c1', 'TXC1', 'Tài xế C'), ('40000000-0000-0000-0000-0000000000c3', 'TXC3', 'Tài xế D');
create temp table t_vc (k text primary key, v text);
grant all on t_vc to anon, authenticated;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from t_vc where k = key $$;

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into public.transport_plans (customer_id, container_qty, pickup_location_id, delivery_location_id, delivery_date)
values ('10000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '2026-12-20');
insert into t_vc select 'P', id::text from public.transport_plans where delivery_date = '2026-12-20' order by created_at desc limit 1;
select public.plan_create_orders(pg_temp.v('P')::uuid);
insert into t_vc select 's', id::text from public.shipments where plan_id = pg_temp.v('P')::uuid;
select public.assign_shipment(pg_temp.v('s')::uuid, '40000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-000000000001');
reset role;

-- Tài xế nhận và bắt đầu chạy trên xe 51C12345
set role anon;
insert into t_vc select 'tok', public.driver_link_login('51C12345') ->> 'token';
select tests.assert((public.driver_link_accept(pg_temp.v('tok'), pg_temp.v('s')::uuid) ->> 'ok')::boolean, 'Tài xế nhận chuyến');
select tests.assert((public.driver_link_start(pg_temp.v('tok'), pg_temp.v('s')::uuid) ->> 'ok')::boolean, 'Tài xế bắt đầu chạy');
select tests.assert_fails($$select public.unaccept_shipment(pg_temp.v('s')::uuid, null, null, 'Xe hư')$$, 'Người ngoài không hủy nhận xe được');
reset role;

-- Bật Giám đốc duyệt: hủy nhận giữ tài xế thì không phải duyệt lại
update public.system_settings set value = 'true' where key = 'dispatch.require_director_approval';
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.unaccept_shipment(pg_temp.v('s')::uuid, '50000000-0000-0000-0000-0000000000c2', null, 'x')$$, 'Bắt buộc lý do hủy nhận xe');
select public.unaccept_shipment(pg_temp.v('s')::uuid, '50000000-0000-0000-0000-0000000000c2', null, 'Xe hư giữa đường');
select tests.assert((select status = 'assigned' and vehicle_id = '50000000-0000-0000-0000-0000000000c2' and departed_pickup_at is null
                       and driver_id = '40000000-0000-0000-0000-0000000000c1' and dispatch_approval = 'not_required'
                     from public.shipments where id = pg_temp.v('s')::uuid), 'Đang chạy → Chờ tài xế nhận trên xe mới, giữ tài xế, không phải duyệt lại');
select tests.assert((select count(*) = 1 from public.shipment_assignments where shipment_id = pg_temp.v('s')::uuid and response = 'pending'
                       and vehicle_id = '50000000-0000-0000-0000-0000000000c2'), 'Phân công mới chờ nhận trên xe mới');
reset role;
select tests.assert(exists (select 1 from public.shipment_status_history where shipment_id = pg_temp.v('s')::uuid and note = 'Hủy nhận xe: Xe hư giữa đường'), 'Lịch sử ghi lý do hủy nhận xe');
select tests.assert(exists (select 1 from public.audit_logs where entity_id = pg_temp.v('s') and reason = 'Hủy nhận xe: Xe hư giữa đường' and 'vehicle_id' = any (changed_fields)), 'Nhật ký ghi đổi xe kèm lý do');

-- Xe cũ không còn thấy chuyến, xe mới thấy chuyến chờ nhận
set role anon;
select tests.assert(not exists (select 1 from public.driver_link_trips(pg_temp.v('tok')) where shipment_id = pg_temp.v('s')::uuid), 'Xe cũ không còn thấy chuyến');
insert into t_vc select 'tok2', public.driver_link_login('61K31295') ->> 'token';
select tests.assert((select status = 'assigned' from public.driver_link_trips(pg_temp.v('tok2')) where shipment_id = pg_temp.v('s')::uuid), 'Xe mới thấy chuyến chờ nhận');
select tests.assert((public.driver_link_accept(pg_temp.v('tok2'), pg_temp.v('s')::uuid) ->> 'ok')::boolean, 'Nhận lại trên xe mới');
reset role;

-- Hủy nhận và đổi tài xế: phải gửi Giám đốc duyệt lại
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.unaccept_shipment(pg_temp.v('s')::uuid, null, '40000000-0000-0000-0000-0000000000c3', 'Tài xế ốm');
select tests.assert((select status = 'assigned' and dispatch_approval = 'pending' and driver_id = '40000000-0000-0000-0000-0000000000c3'
                     from public.shipments where id = pg_temp.v('s')::uuid), 'Đổi tài xế khi hủy nhận: chờ Giám đốc duyệt lại');
select tests.assert_fails($$select public.unaccept_shipment(pg_temp.v('s')::uuid, null, null, 'Xe hư lần nữa')$$, 'Chuyến chờ nhận thì không hủy nhận (dùng Đổi)');
reset role;
update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.assign_shipment(pg_temp.v('s')::uuid, '40000000-0000-0000-0000-0000000000c1', '50000000-0000-0000-0000-0000000000c2');
select public.dispatch_act_for_driver(pg_temp.v('s')::uuid, 'accept', null, null, null, null);
select public.dispatch_act_for_driver(pg_temp.v('s')::uuid, 'start', null, null, null, null);
select public.dispatch_act_for_driver(pg_temp.v('s')::uuid, 'complete', 'full', null, true, 'Kiểm thử');
select tests.assert((select status from public.shipments where id = pg_temp.v('s')::uuid) = 'driver_completed', 'Chuyến đã giao');

-- Sửa số xe + tài xế khi chuyến đã hoàn thành
select tests.assert_fails($$select public.correct_shipment_crew(pg_temp.v('s')::uuid, '50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000c3', '')$$, 'Bắt buộc lý do sửa');
select public.correct_shipment_crew(pg_temp.v('s')::uuid, '50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000c3', 'Nhập nhầm tài xế');
select tests.assert((select status = 'driver_completed' and vehicle_id = '50000000-0000-0000-0000-000000000001' and driver_id = '40000000-0000-0000-0000-0000000000c3'
                     from public.shipments where id = pg_temp.v('s')::uuid), 'Sửa xe, tài xế giữ trạng thái đã giao');
select tests.assert((select driver_id = '40000000-0000-0000-0000-0000000000c3' and vehicle_id = '50000000-0000-0000-0000-000000000001'
                     from public.shipment_assignments where shipment_id = pg_temp.v('s')::uuid and response = 'accepted'), 'Phân công đã nhận theo tài xế đúng');
reset role;
select tests.assert(exists (select 1 from public.audit_logs where entity_id = pg_temp.v('s') and reason = 'Sửa xe, tài xế: Nhập nhầm tài xế' and 'driver_id' = any (changed_fields)), 'Nhật ký ghi sửa tài xế kèm lý do');

-- Bảng lương tháng đã lập thì không đổi tài xế
insert into public.driver_payrolls (driver_id, period_month)
select '40000000-0000-0000-0000-0000000000c1', date_trunc('month', completed_at at time zone 'Asia/Ho_Chi_Minh')::date from public.shipments where id = pg_temp.v('s')::uuid;
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.correct_shipment_crew(pg_temp.v('s')::uuid, '50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-0000000000c1', 'Sửa lại')$$, 'Bảng lương đã lập: chặn đổi tài xế');
select public.correct_shipment_crew(pg_temp.v('s')::uuid, '50000000-0000-0000-0000-0000000000c2', '40000000-0000-0000-0000-0000000000c3', 'Nhầm số xe');
select tests.assert((select vehicle_id from public.shipments where id = pg_temp.v('s')::uuid) = '50000000-0000-0000-0000-0000000000c2', 'Chỉ sửa xe vẫn được');
select tests.assert_fails($$select public.correct_shipment_crew(pg_temp.v('s')::uuid, null, '40000000-0000-0000-0000-0000000000c3', 'Bỏ xe')$$, 'Phải chọn xe');
reset role;
\o
\echo 'TẤT CẢ KIỂM THỬ HỦY NHẬN XE, SỬA XE / TÀI XẾ ĐỀU ĐẠT'
