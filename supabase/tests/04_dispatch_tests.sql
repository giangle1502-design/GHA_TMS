-- =============================================================================
-- Kiểm thử điều phối (Giai đoạn 4): tạo đơn nhiều chuyến, giá và hỗ trợ dầu, phân công, hủy.
-- Chạy sau 01_security_tests.sql (dùng lại khách hàng, địa điểm, tài xế, bảng giá BG001/BG002).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

create temp table t_ids (k text primary key, v jsonb);
grant all on t_ids to authenticated;

select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối
set role authenticated;

-- Báo giá trước khi lưu
select tests.assert(
  (select public.quote_shipment('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '2026-10-21') -> 'candidates' -> 0 ->> 'code') = 'BG001',
  'Báo giá: chọn bảng giá cụ thể nhất');
select tests.assert(
  (select (public.quote_shipment('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', null, '2026-10-21') -> 'fuel_rule' ->> 'rate_percent')::numeric) = 39,
  'Báo giá: không có bảng giá vẫn trả về quy tắc hỗ trợ dầu mặc định 39%');

-- Đơn gồm 2 chuyến, chuyến 1 phân công luôn cho tài xế A
insert into t_ids values ('o1', public.create_transport_order(
  '{"customer_id":"10000000-0000-0000-0000-000000000001","payer_customer_id":"10000000-0000-0000-0000-000000000002","notes":"Đơn kiểm thử"}',
  '[{"pickup_at":"2026-10-21T08:00:00+07:00","expected_delivery_at":"2026-10-21T12:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","vehicle_type_id":"30000000-0000-0000-0000-000000000001","driver_id":"40000000-0000-0000-0000-000000000001","vehicle_id":"50000000-0000-0000-0000-000000000001"},
    {"pickup_at":"2026-10-21T09:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002"}]'));

select tests.assert(jsonb_array_length((select v -> 'shipments' from t_ids where k = 'o1')) = 2, 'Tạo đơn hàng gồm 2 chuyến trong một lần lưu');
select tests.assert((select v ->> 'order_code' from t_ids where k = 'o1') ~ '^O[A-Z]{3}-\d{4,}$', 'Đơn hàng có mã tự sinh');
select tests.assert((select bool_and(e ->> 'shipment_code' ~ '^S[A-Z]{3}-\d{4,}$') from t_ids, jsonb_array_elements(v -> 'shipments') e where k = 'o1'), 'Các chuyến có mã S tự sinh');

select tests.assert((select unit_price = 9999999 and pricing_snapshot ->> 'price_list_code' = 'BG001' from public.shipments where id = (select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_ids where k = 'o1')),
  'Chuyến 1 lấy giá từ bảng giá BG001 và lưu lại mã bảng giá');
select tests.assert((select fuel_support_rate = 39 and fuel_support_base = 'freight_revenue' and fuel_support_amount = 3900000 from public.shipments where id = (select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_ids where k = 'o1')),
  'Hỗ trợ dầu = 39% × doanh thu cước (9.999.999 → 3.900.000)');
select tests.assert((select unit_price = 3000000 and pricing_snapshot ->> 'price_list_code' = 'BG002' from public.shipments where id = (select (v -> 'shipments' -> 1 ->> 'id')::uuid from t_ids where k = 'o1')),
  'Chuyến 2 (không chọn loại xe) lấy bảng giá chung của khách hàng BG002');
select tests.assert((select status = 'assigned' and driver_id = '40000000-0000-0000-0000-000000000001' from public.shipments where id = (select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_ids where k = 'o1')),
  'Chuyến có tài xế khi tạo -> trạng thái Chờ tài xế nhận');
select tests.assert((select count(*) from public.shipment_assignments where shipment_id = (select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_ids where k = 'o1') and response = 'pending') = 1,
  'Phân công được ghi nhận');
select tests.assert((select status from public.shipments where id = (select (v -> 'shipments' -> 1 ->> 'id')::uuid from t_ids where k = 'o1')) = 'draft',
  'Chuyến chưa có tài xế ở trạng thái Nháp');

-- Sửa số lượng -> tiền hỗ trợ dầu tự tính lại
update public.shipments set quantity = 2 where id = (select (v -> 'shipments' -> 1 ->> 'id')::uuid from t_ids where k = 'o1');
select tests.assert((select freight_amount = 6000000 and fuel_support_amount = 2340000 from public.shipments where id = (select (v -> 'shipments' -> 1 ->> 'id')::uuid from t_ids where k = 'o1')),
  'Đổi số lượng: doanh thu cước và hỗ trợ dầu tính lại');

-- Thêm chuyến vào đơn đang mở: số thứ tự nối tiếp
select public.create_transport_order(
  jsonb_build_object('id', (select v ->> 'order_id' from t_ids where k = 'o1')),
  '[{"pickup_at":"2026-10-22T08:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000002","delivery_location_id":"20000000-0000-0000-0000-000000000001","unit_price":"1500000"}]');
select tests.assert((select max(sequence_in_order) from public.shipments where order_id = (select (v ->> 'order_id')::uuid from t_ids where k = 'o1')) = 3,
  'Thêm chuyến vào đơn có sẵn: số thứ tự nối tiếp');

-- Không có bảng giá và chưa nhập đơn giá: vẫn tạo được (xem 14_price_later_tests.sql)
insert into t_ids values ('o2', public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-000000000002"}',
  '[{"pickup_at":"2026-10-21T10:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"2000000"},
    {"pickup_at":"2026-10-21T11:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"2000000","fuel_support_rate":"10"}]'));
select tests.assert((select fuel_support_amount = 780000 and pricing_snapshot ->> 'price_source' = 'manual' and pricing_snapshot ->> 'fuel_source' = 'rule:default'
  from public.shipments where id = (select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_ids where k = 'o2')),
  'Giá nhập tay + hỗ trợ dầu theo quy tắc mặc định (2.000.000 × 39%)');
select tests.assert((select fuel_support_amount = 200000 and pricing_snapshot ->> 'fuel_source' = 'manual'
  from public.shipments where id = (select (v -> 'shipments' -> 1 ->> 'id')::uuid from t_ids where k = 'o2')),
  'Tỷ lệ hỗ trợ dầu nhập trên chuyến được ưu tiên');
select tests.assert((select payer_customer_id = customer_id from public.transport_orders where id = (select (v ->> 'order_id')::uuid from t_ids where k = 'o2')),
  'Không chọn khách thanh toán -> mặc định là khách hàng của đơn');

-- Bảng giá đã chọn phải thuộc danh sách áp dụng
select tests.assert_fails($$select public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-000000000002"}',
  format('[{"pickup_at":"2026-10-21T08:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","price_list_id":"%s"}]',
         (select id from public.transport_price_lists where code = 'BG001'))::jsonb)$$,
  'Không áp được bảng giá của khách hàng khác');

-- Đổi tài xế: phân công cũ thay thế, chỉ còn một phân công hiệu lực
select public.assign_shipment((select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_ids where k = 'o1'), '40000000-0000-0000-0000-000000000002', null);
select tests.assert((select count(*) filter (where response = 'pending') = 1 and count(*) filter (where response = 'superseded') = 1
  from public.shipment_assignments where shipment_id = (select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_ids where k = 'o1')),
  'Đổi tài xế: phân công cũ chuyển sang Đã thay thế');
select tests.assert((select driver_id from public.shipments where id = (select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_ids where k = 'o1')) = '40000000-0000-0000-0000-000000000002',
  'Chuyến nhận tài xế mới');

-- Gỡ phân công: về Nháp
select public.assign_shipment((select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_ids where k = 'o1'), null, null);
select tests.assert((select status = 'draft' and driver_id is null from public.shipments where id = (select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_ids where k = 'o1')),
  'Gỡ phân công: chuyến về Nháp');

-- Không còn trạng thái "tài xế từ chối"
select tests.assert_fails($$update public.shipments set status = 'rejected' where id = (select (v -> 'shipments' -> 1 ->> 'id')::uuid from t_ids where k = 'o1')$$,
  'Không còn trạng thái tài xế từ chối');

-- Hủy chuyến
select tests.assert_fails($$select public.cancel_shipment((select (v -> 'shipments' -> 1 ->> 'id')::uuid from t_ids where k = 'o1'), '')$$, 'Hủy chuyến bắt buộc lý do');
select public.cancel_shipment((select (v -> 'shipments' -> 1 ->> 'id')::uuid from t_ids where k = 'o1'), 'Khách hủy đơn');
select tests.assert((select status = 'cancelled' and cancel_reason = 'Khách hủy đơn' from public.shipments where id = (select (v -> 'shipments' -> 1 ->> 'id')::uuid from t_ids where k = 'o1')),
  'Hủy chuyến lưu lý do, không xóa');
select tests.assert_fails($$select public.assign_shipment((select (v -> 'shipments' -> 1 ->> 'id')::uuid from t_ids where k = 'o1'), '40000000-0000-0000-0000-000000000001', null)$$,
  'Không phân công được chuyến đã hủy');
select tests.assert_fails($$update public.shipments set unit_price = 1 where id = (select (v -> 'shipments' -> 1 ->> 'id')::uuid from t_ids where k = 'o1')$$,
  'Chuyến đã hủy không sửa được giá');

select tests.assert((select bool_or(field = 'quantity' and old_value = '1.000' and new_value = '2.000') from public.shipment_change_history((select (v -> 'shipments' -> 1 ->> 'id')::uuid from t_ids where k = 'o1'))),
  'Lịch sử thay đổi chuyến ghi nhận sửa số lượng (cũ → mới)');
select tests.assert((select display_name from public.user_display_names(array['00000000-0000-0000-0000-0000000000d1'::uuid])) = 'Điều phối viên 1',
  'Tên người thao tác hiển thị được cho người không có quyền quản lý người dùng');
select tests.assert((select (s ->> 'total')::int >= 6 and (s -> 'by_status' -> 'cancelled' ->> 'count')::int = 1
  from public.shipment_list_summary('2026-10-01', (now() + interval '2 days')::timestamptz) s),
  'Tổng hợp bảng chuyến: đếm theo trạng thái');
select tests.assert((select count(*) from public.shipment_list where order_id = (select (v ->> 'order_id')::uuid from t_ids where k = 'o1')) = 3,
  'Danh sách chuyến hiển thị đủ chuyến của đơn');
select tests.assert((select total_revenue = freight_amount + surcharge_amount + fuel_support_amount and customer_name = 'Khách hàng A'
  from public.shipment_list where id = (select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_ids where k = 'o1')),
  'Danh sách chuyến: tổng doanh thu và tên khách hàng');
reset role;

-- Hai bảng giá ngang nhau -> bắt chọn
insert into public.transport_price_lists (code, customer_id, unit_price, pricing_unit, effective_from) values
  ('BG-T1', '10000000-0000-0000-0000-000000000002', 100000, 'ton', '2026-01-01'),
  ('BG-T2', '10000000-0000-0000-0000-000000000002', 200000, 'km', '2026-01-01');
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-000000000002"}',
  '[{"pickup_at":"2026-10-21T08:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002"}]')$$,
  'Có hai bảng giá ngang nhau mà không chọn -> bị chặn');
select tests.assert(
  (select public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-000000000002"}',
    format('[{"pickup_at":"2026-10-21T08:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","price_list_id":"%s","quantity":"3"}]',
           (select id from public.transport_price_lists where code = 'BG-T1'))::jsonb) ->> 'order_id') is not null,
  'Chọn một bảng giá trong số ngang nhau -> tạo được');
select tests.assert((select pricing_unit = 'ton' and freight_amount = 300000 from public.shipments where pricing_snapshot ->> 'price_list_code' = 'BG-T1'),
  'Chuyến theo tấn: doanh thu = đơn giá × số tấn');
reset role;

-- Tài xế A nhận được thông báo khi được phân công
select tests.assert(exists (select 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000b1' and type = 'shipment_assigned'),
  'Tài xế nhận thông báo khi được phân công');

-- Phân quyền
select tests.login('00000000-0000-0000-0000-0000000000c1'); -- kế toán: xem chuyến, không tạo/phân công
set role authenticated;
select tests.assert((select count(*) from public.shipment_list) > 0, 'Kế toán xem được danh sách chuyến');
select tests.assert_fails($$select public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-000000000001"}', '[{"pickup_at":"2026-10-21T08:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1"}]')$$,
  'Kế toán không tạo được đơn hàng');
select tests.assert_fails($$select public.assign_shipment((select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_ids where k = 'o1'), '40000000-0000-0000-0000-000000000001', null)$$,
  'Kế toán không phân công được chuyến');
select tests.assert_fails($$select public.cancel_shipment((select (v -> 'shipments' -> 0 ->> 'id')::uuid from t_ids where k = 'o1'), 'thử hủy')$$,
  'Kế toán không hủy được chuyến');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000b1'); -- tài xế
set role authenticated;
select tests.assert_fails($$select public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-000000000001"}', '[{"pickup_at":"2026-10-21T08:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1"}]')$$,
  'Tài xế không tạo được đơn hàng');
select tests.assert_fails($$select public.quote_shipment(null, null, null, null, '2026-10-21')$$, 'Tài xế không xem được báo giá');
select tests.assert((select count(*) from public.shipment_list) = 0, 'Tài xế không đọc được danh sách chuyến tổng hợp');
reset role;

set role anon;
select tests.assert_fails($$select count(*) from public.shipment_list$$, 'Người chưa đăng nhập không đọc được danh sách chuyến');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ ĐIỀU PHỐI ĐỀU ĐẠT'
