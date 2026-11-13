-- =============================================================================
-- Kiểm thử 0045: Lập kế hoạch → tạo đơn trong Điều phối, thứ tự chuyến bắt buộc với tài xế, SĐT điểm nhận/giao
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
create temp table t_plan (k text primary key, v text);
grant all on t_plan to anon, authenticated;

-- 1. Điều phối nhập kế hoạch: mã tự sinh, tuyến đường tự ghép, khách thanh toán mặc định
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into public.transport_plans (customer_id, delivery_date, vehicle_type_id, empty_return_location_id, offroute_return_location_id,
  container_qty, pickup_location_id, delivery_location_id, trip_order, pickup_phone, notes)
values ('10000000-0000-0000-0000-000000000001', '2026-12-05', '30000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
  3, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 2, ' 0909 123 456 ', 'Hàng gấp');
insert into t_plan select 'p1', id::text from public.transport_plans order by created_at desc limit 1;
select tests.assert((select code like 'KP%' from public.transport_plans where id = (select v::uuid from t_plan where k = 'p1')), 'Mã kế hoạch tự sinh KP...');
select tests.assert((select route_name from public.transport_plans where id = (select v::uuid from t_plan where k = 'p1')) = 'Kho Bình Dương → Cảng Cát Lái', 'Tuyến đường = Điểm nhận → Điểm giao');
select tests.assert((select payer_customer_id from public.transport_plans where id = (select v::uuid from t_plan where k = 'p1')) is not null, 'Khách thanh toán để trống được điền sẵn');
select tests.assert((select status from public.transport_plans where id = (select v::uuid from t_plan where k = 'p1')) = 'planned', 'Kế hoạch mới ở trạng thái Chưa tạo đơn');
select tests.assert_fails($$insert into public.transport_plans (customer_id, container_qty, pickup_location_id, delivery_location_id)
  values ('10000000-0000-0000-0000-000000000001', 0, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002')$$, 'Số lượng cont phải từ 1');
select tests.assert_fails($$insert into public.transport_plans (customer_id, container_qty, pickup_location_id, delivery_location_id)
  values ('10000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001')$$, 'Điểm nhận và điểm giao phải khác nhau');
select tests.assert_fails($$update public.transport_plans set status = 'ordered' where id = (select v::uuid from t_plan where k = 'p1')$$, 'Không tự đổi trạng thái bằng tay');

-- 2. Tích chọn: 3 cont → 3 đơn, mỗi đơn một chuyến mang đủ thông tin kế hoạch
insert into t_plan select 'r1', public.plan_create_orders((select v::uuid from t_plan where k = 'p1'))::text;
select tests.assert((select (v::jsonb ->> 'count')::int from t_plan where k = 'r1') = 3, 'Tạo đủ 3 đơn');
select tests.assert((select count(distinct order_id) from public.shipments where plan_id = (select v::uuid from t_plan where k = 'p1')) = 3, '3 đơn hàng khác nhau, mỗi đơn một chuyến');
select tests.assert((select bool_and(trip_order = 2 and pickup_phone = '0909 123 456' and empty_return_location_id = '20000000-0000-0000-0000-000000000002'
    and offroute_return_location_id = '20000000-0000-0000-0000-000000000001' and quantity = 1
    and (pickup_at at time zone 'Asia/Ho_Chi_Minh')::date = '2026-12-05')
  from public.shipments where plan_id = (select v::uuid from t_plan where k = 'p1')), 'Chuyến mang thứ tự, SĐT, hạ rỗng, hạ rỗng trái tuyến, ngày theo kế hoạch');
select tests.assert((select bool_and(route_label = 'Kho Bình Dương → Cảng Cát Lái' and offroute_return_name = 'Kho Bình Dương' and plan_code like 'KP%' and pickup_phone = '0909 123 456')
  from public.shipment_list where plan_id = (select v::uuid from t_plan where k = 'p1')), 'Danh sách chuyến có tuyến đường, hạ rỗng trái tuyến, kế hoạch, SĐT');
select tests.assert((select status = 'ordered' and order_count = 3 and order_codes like '%,%' from public.transport_plans where id = (select v::uuid from t_plan where k = 'p1')),
  'Kế hoạch chuyển sang Đã tạo đơn, ghi mã các đơn');
select tests.assert_fails($$select public.plan_create_orders((select v::uuid from t_plan where k = 'p1'))$$, 'Không tạo đơn hai lần');
select tests.assert_fails($$update public.transport_plans set container_qty = 5 where id = (select v::uuid from t_plan where k = 'p1')$$, 'Kế hoạch đã tạo đơn không đổi số cont');
update public.transport_plans set notes = 'Đã báo khách' where id = (select v::uuid from t_plan where k = 'p1');
select tests.assert((select notes from public.transport_plans where id = (select v::uuid from t_plan where k = 'p1')) = 'Đã báo khách', 'Vẫn sửa được ghi chú');

-- Kế hoạch 2: thứ tự chuyến 1, ngày nhận chọn khi tích
insert into public.transport_plans (customer_id, container_qty, pickup_location_id, delivery_location_id, trip_order)
values ('10000000-0000-0000-0000-000000000001', 1, '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 1);
insert into t_plan select 'p2', id::text from public.transport_plans order by created_at desc, code desc limit 1;
insert into t_plan select 'r2', public.plan_create_orders((select v::uuid from t_plan where k = 'p2'), '2026-12-05')::text;
insert into t_plan select 'sA', id::text from public.shipments where plan_id = (select v::uuid from t_plan where k = 'p1') order by shipment_code limit 1;
insert into t_plan select 'sB', id::text from public.shipments where plan_id = (select v::uuid from t_plan where k = 'p2');
-- Giao cả hai chuyến cho xe XE001 (Tài xế A) cùng ngày
select public.assign_shipment((select v::uuid from t_plan where k = 'sA'), '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001');
select public.assign_shipment((select v::uuid from t_plan where k = 'sB'), '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001');
reset role;

set role anon;
select tests.assert_fails($$select count(*) from public.transport_plans$$, 'Người ngoài không đọc được kế hoạch');
select tests.assert_fails($$select public.plan_create_orders((select v::uuid from t_plan where k = 'p2'))$$, 'Người ngoài không tạo đơn được');

-- 3. Tài xế: SĐT, hạ rỗng, thứ tự; phải nhận chuyến thứ 1 trước chuyến thứ 2
insert into t_plan select 'tok', public.driver_link_login('51C12345') ->> 'token';
select tests.assert((select pickup_phone = '0909 123 456' and empty_return_name = 'Cảng Cát Lái' and offroute_return_name = 'Kho Bình Dương' and trip_rank = 2 and wait_for_code is not null
  from public.driver_link_trips((select v from t_plan where k = 'tok')) where shipment_id = (select v::uuid from t_plan where k = 'sA')),
  'Tài xế thấy SĐT điểm nhận, hạ rỗng, hạ rỗng trái tuyến, thứ tự 2 và chuyến phải nhận trước');
select tests.assert((public.driver_link_accept((select v from t_plan where k = 'tok'), (select v::uuid from t_plan where k = 'sA')) ->> 'error') like 'Phải nhận chuyến thứ 1%',
  'Không nhận được chuyến thứ 2 khi chuyến thứ 1 còn chờ nhận');
select tests.assert((public.driver_link_accept((select v from t_plan where k = 'tok'), (select v::uuid from t_plan where k = 'sB')) ->> 'ok')::boolean, 'Nhận chuyến thứ 1');
select tests.assert((public.driver_link_accept((select v from t_plan where k = 'tok'), (select v::uuid from t_plan where k = 'sA')) ->> 'ok')::boolean, 'Sau đó nhận được chuyến thứ 2');
reset role;

-- 4. Xóa dữ liệu thử xóa cả kế hoạch (tệp 99 kiểm tra chung)
\o
\echo 'TẤT CẢ KIỂM THỬ LẬP KẾ HOẠCH, THỨ TỰ CHUYẾN ĐỀU ĐẠT'
