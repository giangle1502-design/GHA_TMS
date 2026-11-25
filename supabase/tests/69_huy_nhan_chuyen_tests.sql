-- =============================================================================
-- Kiểm thử 9041: Hủy nhận chuyến (tài xế / nhà xe đã nhận nhưng không đi), giao lại 3PL khác
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

insert into public.suppliers (id, code, name) values
  ('b9410000-0000-0000-0000-000000000001', 'T941-NX1', 'Nhà xe cũ 9041'),
  ('b9410000-0000-0000-0000-000000000002', 'T941-NX2', 'Nhà xe mới 9041');
insert into public.customers (id, code, name) values ('c9410000-0000-0000-0000-000000000001', 'T941-KH', 'Khách thử 9041');
insert into public.locations (id, code, name, full_address) values
  ('d9410000-0000-0000-0000-000000000001', 'T941-NHAN', 'Kho nhận 9041', 'KCN'),
  ('d9410000-0000-0000-0000-000000000002', 'T941-GIAO', 'Kho giao 9041', 'Q1');
insert into public.transport_orders (id, order_code, customer_id, payer_customer_id) values
  ('e9410000-0000-0000-0000-000000000001', 'T941-1', 'c9410000-0000-0000-0000-000000000001', 'c9410000-0000-0000-0000-000000000001'),
  ('e9410000-0000-0000-0000-000000000002', 'T941-2', 'c9410000-0000-0000-0000-000000000001', 'c9410000-0000-0000-0000-000000000001');
insert into public.shipments (id, shipment_code, order_id, pickup_at, pickup_location_id, delivery_location_id, unit_price, pricing_unit, quantity) values
  ('f9410000-0000-0000-0000-000000000001', 'T941-S1', 'e9410000-0000-0000-0000-000000000001', '2027-06-01 08:00+07', 'd9410000-0000-0000-0000-000000000001', 'd9410000-0000-0000-0000-000000000002', 1000000, 'trip', 1),
  ('f9410000-0000-0000-0000-000000000002', 'T941-S2', 'e9410000-0000-0000-0000-000000000002', '2027-06-01 08:00+07', 'd9410000-0000-0000-0000-000000000001', 'd9410000-0000-0000-0000-000000000002', 1000000, 'trip', 1);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000d941', 'dp.9041@gha.test', '{"full_name":"Điều phối 9041"}')
on conflict do nothing;
update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000d941';
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000e941', 'kt.9041@gha.test', '{"full_name":"Không quyền 9041"}')
on conflict do nothing;
update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000e941';
insert into public.user_roles (user_id, role_id) select '00000000-0000-0000-0000-00000000d941', id from public.roles where code = 'dispatcher' on conflict do nothing;

select tests.login('00000000-0000-0000-0000-00000000d941');
set role authenticated;

-- Giao 3PL cũ có số xe + tài xế, GHA nhận thay rồi bấm bắt đầu (đang chạy) nhưng xe không đi
select public.assign_shipment_3pl('f9410000-0000-0000-0000-000000000001', 'b9410000-0000-0000-0000-000000000001', '51C94101', 'Tài xế cũ 9041', '0909941001', null, null);
select public.dispatch_act_for_driver('f9410000-0000-0000-0000-000000000001', 'accept');
select public.dispatch_act_for_driver('f9410000-0000-0000-0000-000000000001', 'start');
select public.set_shipment_carrier_costs('f9410000-0000-0000-0000-000000000001', 'b9410000-0000-0000-0000-000000000001',
  '[{"cost_kind":"freight","description":"Cước 3PL","quantity":1,"unit_price":800000,"amount":800000}]'::jsonb);
reset role;
select tests.assert((select status from public.shipments where id = 'f9410000-0000-0000-0000-000000000001') = 'in_transit', 'Chuẩn bị: chuyến đang chạy');
select tests.assert(exists (select 1 from public.payables where shipment_id = 'f9410000-0000-0000-0000-000000000001' and kind = 'carrier' and status <> 'cancelled'), 'Chuẩn bị: có công nợ trả 3PL cũ');

select tests.login('00000000-0000-0000-0000-00000000d941');
set role authenticated;
select tests.assert_fails($$select public.release_shipment('f9410000-0000-0000-0000-000000000001', 'x')$$, 'Bắt buộc lý do');
select tests.assert_fails($$select public.release_shipment('f9410000-0000-0000-0000-000000000002', 'Không ai nhận')$$, 'Chuyến chưa ai nhận: không cần hủy');
select public.release_shipment('f9410000-0000-0000-0000-000000000001', 'Tài xế nhận nhưng không đi', 'b9410000-0000-0000-0000-000000000002');
reset role;

select tests.assert((select status = 'draft' and driver_id is null and vehicle_id is null and carrier_supplier_id = 'b9410000-0000-0000-0000-000000000002'
                     from public.shipments where id = 'f9410000-0000-0000-0000-000000000001'), 'Hủy nhận: chuyến về Nháp, gỡ xe/tài xế, gắn nhà xe mới');
select tests.assert(not exists (select 1 from public.shipment_assignments where shipment_id = 'f9410000-0000-0000-0000-000000000001' and response in ('pending', 'accepted')),
  'Tài xế cũ không còn phân công');
select tests.assert(not exists (select 1 from public.shipment_carrier_costs where shipment_id = 'f9410000-0000-0000-0000-000000000001'), 'Xóa chi phí 3PL của nhà xe cũ');
select tests.assert(not exists (select 1 from public.payables where shipment_id = 'f9410000-0000-0000-0000-000000000001' and kind = 'carrier' and status <> 'cancelled'), 'Hủy công nợ trả 3PL cũ');
select tests.assert((select count(*) = 1 and bool_and(from_status = 'in_transit' and old_carrier_name = 'Nhà xe cũ 9041' and new_carrier_name = 'Nhà xe mới 9041'
                       and old_plate = '51C94101' and old_driver_name = 'Tài xế cũ 9041' and carrier_costs_removed = 800000
                       and released_by = '00000000-0000-0000-0000-00000000d941')
                     from public.shipment_releases where shipment_id = 'f9410000-0000-0000-0000-000000000001'), 'Ghi nhật ký hủy nhận');
select tests.assert(exists (select 1 from public.shipment_status_history where shipment_id = 'f9410000-0000-0000-0000-000000000001'
                            and to_status = 'draft' and note like 'Hủy nhận chuyến: Tài xế nhận nhưng không đi%'), 'Ghi chú ở lịch sử trạng thái');

-- Giao lại cho nhà xe mới: nhập số xe bình thường
select tests.login('00000000-0000-0000-0000-00000000d941');
set role authenticated;
select public.assign_shipment_3pl('f9410000-0000-0000-0000-000000000001', 'b9410000-0000-0000-0000-000000000002', '51C94102', null, null, null, null);
reset role;
select tests.assert((select status = 'assigned' and carrier_supplier_id = 'b9410000-0000-0000-0000-000000000002' from public.shipments where id = 'f9410000-0000-0000-0000-000000000001'),
  'Giao lại cho nhà xe mới được');

-- Nhà xe mới cũng chưa có số xe → hủy tiếp khi chỉ mới gắn nhà xe (Nháp), không chọn nhà xe mới
select tests.login('00000000-0000-0000-0000-00000000d941');
set role authenticated;
select public.release_shipment('f9410000-0000-0000-0000-000000000001', 'Nhà xe mới báo hết xe');
reset role;
select tests.assert((select status = 'draft' and carrier_supplier_id is null and vehicle_id is null from public.shipments where id = 'f9410000-0000-0000-0000-000000000001'),
  'Hủy nhận không chọn nhà xe mới: chuyến trống để chọn sau');
select tests.assert((select count(*) from public.shipment_releases where shipment_id = 'f9410000-0000-0000-0000-000000000001') = 2, 'Mỗi lần hủy một dòng nhật ký');

-- Người không có quyền điều phối không hủy được
select tests.login('00000000-0000-0000-0000-00000000e941');
set role authenticated;
select tests.assert_fails($$select public.release_shipment('f9410000-0000-0000-0000-000000000001', 'Thử không quyền')$$, 'Không quyền điều phối: bị chặn');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ HỦY NHẬN CHUYẾN ĐỀU ĐẠT'
