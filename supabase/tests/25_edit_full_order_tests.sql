-- =============================================================================
-- Kiểm thử "Sửa toàn bộ đơn hàng" (form tạo đơn ở chế độ sửa, action updateOrderFull).
-- Không có migration mới: kiểm tra đúng các câu lệnh action chạy với quyền điều phối d1
-- (RLS, trigger khóa công nợ, duyệt lại khi đổi tài xế, hủy chuyến).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.system_settings set value = 'true' where key = 'dispatch.require_director_approval';
create temp table t_ed (k text primary key, v text);
grant all on t_ed to authenticated, anon;

select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối
set role authenticated;
insert into t_ed select 'res', public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-000000000001"}',
  '[{"pickup_at":"2026-11-05T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1000000","driver_id":"40000000-0000-0000-0000-000000000001","vehicle_id":"50000000-0000-0000-0000-000000000001"},
    {"pickup_at":"2026-11-05T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"900000"}]')::text;
insert into t_ed select 'order', v::jsonb ->> 'order_id' from t_ed where k = 'res';
insert into t_ed select 's' || ord, e ->> 'id' from jsonb_array_elements((select v::jsonb -> 'shipments' from t_ed where k = 'res')) with ordinality as x(e, ord);
reset role;

-- Giám đốc duyệt chuyến 1
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select public.approval_decide((select dispatch_approval_request_id from public.shipments where id = (select v::uuid from t_ed where k = 's1')), 'approve');
reset role;
select tests.assert((select dispatch_approval = 'approved' from public.shipments where id = (select v::uuid from t_ed where k = 's1')), 'Chuẩn bị: chuyến 1 đã duyệt');

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
-- Phần đầu đơn: đổi khách hàng, khách thanh toán, ghi chú, trường bổ sung
update public.transport_orders set customer_id = '10000000-0000-0000-0000-000000000002', payer_customer_id = '10000000-0000-0000-0000-000000000002',
  notes = 'Sửa toàn bộ đơn', custom_fields = '{"so_po":"PO-1"}'
where id = (select v::uuid from t_ed where k = 'order');
-- Chuyến 1: sửa ngày, ghi chú, trường bổ sung, giá theo bảng giá (cột action ghi khi tính lại giá)
with u as (
  update public.shipments set
    pickup_at = '2026-11-06T00:00:00+07:00', expected_delivery_at = '2026-11-07T23:59:59+07:00', notes = 'Giao cổng sau',
    custom_fields = custom_fields || '{"so_cont":"ABCU1234567"}', quantity = 2,
    route_id = null, price_list_id = (select id from public.transport_price_lists where code = 'BG001'),
    unit_price = 3500000, pricing_unit = 'trip', surcharge_amount = 100000,
    fuel_support_rate = 10, fuel_support_base = 'freight_revenue', fuel_support_rule_id = null,
    pricing_snapshot = pricing_snapshot || '{"price_source":"price_list","price_list_code":"BG001","edited_from_order_form":true}'
  where id = (select v::uuid from t_ed where k = 's1') and version = (select version from public.shipments where id = (select v::uuid from t_ed where k = 's1'))
  returning id)
insert into t_ed select 'n1', count(*)::text from u;
select public.set_shipment_items((select v::uuid from t_ed where k = 's1'), '[{"item_code":"MH1","item_name":"Thép","quantity":"5","unit":"cuộn"}]');
select public.set_shipment_fees((select v::uuid from t_ed where k = 's1'), jsonb_build_array(jsonb_build_object('fee_type_id', (select id from public.fee_types where name = 'Phí chi hộ'), 'amount', '300000')));
reset role;

select tests.assert((select v = '1' from t_ed where k = 'n1'), 'Điều phối cập nhật được mọi cột của chuyến (RLS)');
select tests.assert((select o.customer_id = '10000000-0000-0000-0000-000000000002' and o.notes = 'Sửa toàn bộ đơn' and o.custom_fields ->> 'so_po' = 'PO-1'
  from public.transport_orders o where id = (select v::uuid from t_ed where k = 'order')), 'Sửa được phần đầu đơn khi chưa lập công nợ');
select tests.assert((select freight_amount = 7000000 and fuel_support_amount = 700000 and pass_through_amount = 300000 and custom_fields ->> 'so_cont' = 'ABCU1234567'
    and pricing_snapshot ->> 'price_list_code' = 'BG001' and notes = 'Giao cổng sau'
  from public.shipments where id = (select v::uuid from t_ed where k = 's1')), 'Giá, hỗ trợ dầu tự tính lại, phí, trường bổ sung đã lưu');
select tests.assert((select count(*) = 1 from public.shipment_items where shipment_id = (select v::uuid from t_ed where k = 's1')), 'Hàng hóa đã lưu');
select tests.assert((select dispatch_approval = 'approved' from public.shipments where id = (select v::uuid from t_ed where k = 's1')),
  'Sửa ngày, giá, ghi chú không làm mất duyệt của Giám đốc');

-- Đổi tài xế khi sửa đơn: phải chờ Giám đốc duyệt lại
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.assign_shipment((select v::uuid from t_ed where k = 's1'), '40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001');
-- Hủy chuyến 2 ngay trong form sửa
select public.cancel_shipment((select v::uuid from t_ed where k = 's2'), 'Khách báo hủy');
reset role;
select tests.assert((select driver_id = '40000000-0000-0000-0000-000000000002' and dispatch_approval = 'pending'
  from public.shipments where id = (select v::uuid from t_ed where k = 's1')), 'Đổi tài xế: chuyến chờ Giám đốc duyệt lại');
select tests.assert((select status = 'cancelled' and cancel_reason = 'Khách báo hủy' from public.shipments where id = (select v::uuid from t_ed where k = 's2')),
  'Hủy chuyến trong form sửa: lưu lý do, không xóa');

-- Chuyến đã lập công nợ: vẫn sửa ngày, ghi chú, tuyến; không sửa giá, phí, khách hàng
update public.shipments set receivable_id = (select id from public.receivables limit 1) where id = (select v::uuid from t_ed where k = 's1');
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
with u as (
  update public.shipments set pickup_at = '2026-11-07T00:00:00+07:00', notes = 'Đổi ngày sau khi lập công nợ', route_id = null
  where id = (select v::uuid from t_ed where k = 's1') returning id)
insert into t_ed select 'n2', count(*)::text from u;
select tests.assert_fails($$update public.shipments set unit_price = 1 where id = (select v::uuid from t_ed where k = 's1')$$,
  'Chuyến đã lập công nợ: không sửa giá');
select tests.assert_fails($$select public.set_shipment_fees((select v::uuid from t_ed where k = 's1'), '[]')$$,
  'Chuyến đã lập công nợ: không sửa phí');
select tests.assert_fails($$update public.transport_orders set customer_id = '10000000-0000-0000-0000-000000000001' where id = (select v::uuid from t_ed where k = 'order')$$,
  'Đơn có chuyến lập công nợ: không đổi khách hàng');
reset role;
select tests.assert((select v = '1' from t_ed where k = 'n2'), 'Chuyến đã lập công nợ: vẫn sửa được ngày, ghi chú');

update public.shipments set receivable_id = null where id = (select v::uuid from t_ed where k = 's1');
update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
\o
\echo 'TẤT CẢ KIỂM THỬ SỬA TOÀN BỘ ĐƠN HÀNG ĐỀU ĐẠT'
