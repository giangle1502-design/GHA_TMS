-- =============================================================================
-- Kiểm thử 0036: Nhập đơn hàng / chuyến từ Excel.
-- Bật duyệt Giám đốc: chuyến "Đã phân công" phải chờ duyệt, chuyến cũ "Đã hoàn thành" thì không.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.system_settings set value = 'true' where key = 'dispatch.require_director_approval';
create temp table t_im (k text primary key, v text);
grant all on t_im to authenticated, anon;

select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối
set role authenticated;
insert into t_im select 'res', public.import_transport_order('{"customer_id":"10000000-0000-0000-0000-000000000001","order_date":"2026-10-20"}',
  jsonb_build_array(
    jsonb_build_object('pickup_at','2026-10-20T00:00:00+07:00','expected_delivery_at','2026-10-21T00:00:00+07:00','pickup_location_id','20000000-0000-0000-0000-000000000001','delivery_location_id','20000000-0000-0000-0000-000000000002','unit_price','1500000','driver_id','40000000-0000-0000-0000-000000000001','vehicle_id','50000000-0000-0000-0000-000000000001','import_status','completed','completed_at','2026-10-21T00:00:00+07:00',
      'fees', jsonb_build_array(jsonb_build_object('fee_type_id', (select id from public.fee_types where name = 'Phí chi hộ'), 'amount', '250000'))),
    jsonb_build_object('pickup_at','2026-11-03T00:00:00+07:00','pickup_location_id','20000000-0000-0000-0000-000000000001','delivery_location_id','20000000-0000-0000-0000-000000000002','unit_price','1000000','driver_id','40000000-0000-0000-0000-000000000001','vehicle_id','50000000-0000-0000-0000-000000000001','import_status','assigned'),
    jsonb_build_object('pickup_at','2026-11-04T00:00:00+07:00','pickup_location_id','20000000-0000-0000-0000-000000000001','delivery_location_id','20000000-0000-0000-0000-000000000002','driver_id','40000000-0000-0000-0000-000000000001','import_status','draft')
  ))::text;
insert into t_im select 's' || ord, e ->> 'id' from jsonb_array_elements((select v::jsonb -> 'shipments' from t_im where k = 'res')) with ordinality as x(e, ord);
reset role;

select tests.assert((select count(*) = 3 from public.shipments where order_id = (select (v::jsonb ->> 'order_id')::uuid from t_im where k = 'res')),
  'Một đơn hàng, 3 chuyến');
select tests.assert((select status = 'driver_completed' and dispatch_approval = 'not_required' and delivery_result = 'full'
    and completed_at = '2026-10-21T00:00:00+07:00'::timestamptz and expense_declaration = 'none' and photo_skip_reason is not null
  from public.shipments where id = (select v::uuid from t_im where k = 's1')),
  'Chuyến cũ đã hoàn thành: Tài xế đã hoàn thành, không cần Giám đốc duyệt, ngày hoàn thành theo file');
select tests.assert((select count(*) = 0 from public.approval_requests where entity_id = (select v::uuid from t_im where k = 's1')),
  'Chuyến cũ: không tạo yêu cầu duyệt');
select tests.assert((select count(*) = 0 from public.notifications where entity_id = (select v::uuid from t_im where k = 's1')),
  'Chuyến cũ: không báo tài xế, không báo Giám đốc');
select tests.assert((select response = 'accepted' from public.shipment_assignments where shipment_id = (select v::uuid from t_im where k = 's1')),
  'Chuyến cũ: có phân công tài xế (tính lương, số chuyến)');
select tests.assert((select pass_through_amount = 250000 from public.shipments where id = (select v::uuid from t_im where k = 's1')),
  'Phí thu khách nhập cùng chuyến');
select tests.assert((select status = 'assigned' and dispatch_approval = 'pending' and dispatch_approval_request_id is not null
  from public.shipments where id = (select v::uuid from t_im where k = 's2')),
  'Chuyến Đã phân công: chờ Giám đốc duyệt như tạo tay');
select tests.assert((select status = 'draft' and driver_id is null from public.shipments where id = (select v::uuid from t_im where k = 's3')),
  'Chuyến Chờ phân công: nháp, bỏ qua tài xế');
select tests.assert((select unit_price = 1500000 and price_list_id is null and pricing_snapshot ->> 'price_source' = 'excel' and freight_amount = 1500000
  from public.shipments where id = (select v::uuid from t_im where k = 's1')),
  'Có đơn giá trong file: dùng đúng đơn giá file, không lấy bảng giá');
select tests.assert((select pricing_snapshot ->> 'price_source' <> 'excel' from public.shipments where id = (select v::uuid from t_im where k = 's3')),
  'Không có đơn giá trong file: tính như tạo tay');
select tests.assert(private.trip_approval_on(), 'Sau khi nhập, tham số duyệt vẫn bật');

-- Lỗi ở một chuyến: cả đơn không lưu, báo đúng số chuyến
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into t_im select 'cnt', count(*)::text from public.transport_orders;
select tests.assert_fails($$select public.import_transport_order('{"customer_id":"10000000-0000-0000-0000-000000000001"}',
  '[{"pickup_at":"2026-11-03T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","import_status":"draft"},
    {"pickup_at":"2026-11-03T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","import_status":"assigned"}]')$$,
  'Đã phân công mà thiếu tài xế bị chặn');
select tests.assert((select count(*)::text = (select v from t_im where k = 'cnt') from public.transport_orders), 'Lỗi thì cả đơn không lưu');
select tests.assert_fails($$select public.import_transport_order('{"customer_id":"10000000-0000-0000-0000-000000000001"}',
  '[{"pickup_at":"2026-11-03T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","import_status":"completed"}]')$$,
  'Đã hoàn thành mà không có xe, tài xế bị chặn');
select tests.assert_fails($$select public.import_transport_order('{"customer_id":"10000000-0000-0000-0000-000000000001"}',
  '[{"pickup_at":"2026-11-03T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","import_status":"closed"}]')$$,
  'Trạng thái lạ bị chặn');
reset role;

-- Người không có quyền tạo đơn
select tests.login('00000000-0000-0000-0000-0000000000f1');
set role authenticated;
select tests.assert_fails($$select public.import_transport_order('{"customer_id":"10000000-0000-0000-0000-000000000001"}',
  '[{"pickup_at":"2026-11-03T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002"}]')$$,
  'Không có quyền điều phối thì không nhập được');
reset role;

update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
\o
\echo 'TẤT CẢ KIỂM THỬ NHẬP CHUYẾN TỪ EXCEL ĐỀU ĐẠT'
