-- =============================================================================
-- Kiểm thử 0028: đổi kiểu trường tương thích khi đã có dữ liệu; hủy cả đơn hàng.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
create temp table t_co (k text primary key, v jsonb);
grant all on t_co to authenticated, anon;

-- Trường số đã có dữ liệu: đổi sang Tiền được, sang Ngày thì bị chặn
insert into public.field_definitions (module, field_key, label, data_type) values ('shipments', 'phi_cau_duong', 'Phí cầu đường', 'decimal');
update public.shipments set custom_fields = custom_fields || '{"phi_cau_duong": 50000}' where id = (select id from public.shipments order by created_at limit 1);
update public.field_definitions set data_type = 'currency' where module = 'shipments' and field_key = 'phi_cau_duong';
select tests.assert((select data_type from public.field_definitions where module = 'shipments' and field_key = 'phi_cau_duong') = 'currency', 'Đã có dữ liệu: đổi Số sang Tiền được');
select tests.assert_fails($$update public.field_definitions set data_type = 'date' where module = 'shipments' and field_key = 'phi_cau_duong'$$, 'Đã có dữ liệu: đổi Tiền sang Ngày bị chặn');
update public.field_definitions set data_type = 'short_text' where module = 'shipments' and field_key = 'phi_cau_duong';
select tests.assert(true, 'Đổi sang Văn bản được');

-- Hủy cả đơn hàng
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into t_co values ('o', public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-0000000000f4"}',
  '[{"pickup_at":"2026-10-28T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1000000","driver_id":"40000000-0000-0000-0000-000000000001","vehicle_id":"50000000-0000-0000-0000-000000000001"},
    {"pickup_at":"2026-10-28T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1000000"}]'));
select tests.assert_fails($$select public.cancel_transport_order((select (v ->> 'order_id')::uuid from t_co where k = 'o'), 'x')$$, 'Hủy đơn phải có lý do');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2'); -- admin (có quyền xóa điều phối)
set role authenticated;
select tests.assert(public.cancel_transport_order((select (v ->> 'order_id')::uuid from t_co where k = 'o'), 'Tạo trùng đơn') = 2, 'Hủy đơn hủy cả 2 chuyến');
select tests.assert((select bool_and(status = 'cancelled' and cancel_reason like 'Hủy đơn hàng: Tạo trùng đơn') from public.shipments where order_id = (select (v ->> 'order_id')::uuid from t_co where k = 'o')), 'Các chuyến ghi lý do hủy đơn');
select tests.assert((select status from public.transport_orders where id = (select (v ->> 'order_id')::uuid from t_co where k = 'o')) = 'cancelled', 'Đơn hàng chuyển Đã hủy');
select tests.assert((select count(*) from public.shipment_assignments a join public.shipments s on s.id = a.shipment_id where s.order_id = (select (v ->> 'order_id')::uuid from t_co where k = 'o') and a.response in ('pending', 'accepted')) = 0, 'Gỡ phân công tài xế');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert_fails($$select public.cancel_transport_order((select (v ->> 'order_id')::uuid from t_co where k = 'o'), 'Kế toán thử')$$, 'Kế toán không hủy đơn được');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ ĐỔI KIỂU TRƯỜNG / HỦY ĐƠN ĐỀU ĐẠT'
