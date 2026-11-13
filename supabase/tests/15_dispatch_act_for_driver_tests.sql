-- =============================================================================
-- Kiểm thử 0026: điều phối làm thay tài xế (nhận đơn, bắt đầu, hoàn thành; bỏ qua ảnh có lý do).
-- Chạy sau 14 (dùng khách KHGIASAU).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
create temp table t_af (k text primary key, v uuid);
grant all on t_af to authenticated, anon;

select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối
set role authenticated;
insert into t_af select 's' || ord, (e ->> 'id')::uuid
  from jsonb_array_elements((public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-0000000000f4"}',
  '[{"pickup_at":"2026-10-27T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1000000","driver_id":"40000000-0000-0000-0000-000000000001","vehicle_id":"50000000-0000-0000-0000-000000000001"},
    {"pickup_at":"2026-10-27T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1000000","driver_id":"40000000-0000-0000-0000-000000000001","vehicle_id":"50000000-0000-0000-0000-000000000001"}]')) -> 'shipments')
  with ordinality as x(e, ord);

select tests.assert_fails($$select public.dispatch_act_for_driver((select v from t_af where k = 's1'), 'start')$$, 'Chưa nhận đơn thì không bắt đầu được');
select public.dispatch_act_for_driver((select v from t_af where k = 's1'), 'accept');
select tests.assert((select status = 'accepted' from public.shipments where id = (select v from t_af where k = 's1'))
  and (select response = 'accepted' from public.shipment_assignments where shipment_id = (select v from t_af where k = 's1')),
  'Điều phối nhận đơn thay tài xế: chuyến Đã nhận, phân công được chấp nhận');
select tests.assert((select note like '%nhận chuyến thay tài xế%' from public.shipment_status_history where shipment_id = (select v from t_af where k = 's1') and to_status = 'accepted' order by id desc limit 1),
  'Lịch sử ghi rõ điều phối làm thay');
select public.dispatch_act_for_driver((select v from t_af where k = 's1'), 'start');
select tests.assert((select status = 'in_transit' and departed_pickup_at is not null from public.shipments where id = (select v from t_af where k = 's1')), 'Điều phối bắt đầu chạy thay');

select tests.assert_fails($$select public.dispatch_act_for_driver((select v from t_af where k = 's1'), 'complete', 'full', null, true, null)$$,
  'Hoàn thành không ảnh và không lý do bị chặn');
select tests.assert_fails($$select public.dispatch_act_for_driver((select v from t_af where k = 's1'), 'complete', 'full', null, null, 'Chưa in phiếu')$$,
  'Phải chọn có/không phát sinh chi phí');
select public.dispatch_act_for_driver((select v from t_af where k = 's1'), 'complete', 'full', null, true, 'Khách chưa ký phiếu, bổ sung sau');
select tests.assert((select status = 'driver_completed' and document_status = 'missing' and photo_skip_reason = 'Khách chưa ký phiếu, bổ sung sau' and expense_declaration = 'none'
  from public.shipments where id = (select v from t_af where k = 's1')),
  'Bỏ qua ảnh có lý do: chuyến hoàn thành, chứng từ vẫn Thiếu, lưu lý do');
reset role;

-- Bổ sung ảnh sau: lý do tự xóa
insert into public.documents (bucket, storage_path, file_name, mime_type, size_bytes, entity_type, entity_id, doc_type)
values ('documents', 'shipment/' || (select v from t_af where k = 's1') || '/a.jpg', 'a.jpg', 'image/jpeg', 100, 'shipment', (select v from t_af where k = 's1'), 'delivery_note');
select tests.assert((select photo_skip_reason is null from public.shipments where id = (select v from t_af where k = 's1')), 'Bổ sung phiếu ký nhận sau thì xóa lý do bỏ qua ảnh');

-- Có ảnh sẵn thì không cần lý do
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.dispatch_act_for_driver((select v from t_af where k = 's2'), 'accept');
select public.dispatch_act_for_driver((select v from t_af where k = 's2'), 'start');
reset role;
insert into public.documents (bucket, storage_path, file_name, mime_type, size_bytes, entity_type, entity_id, doc_type)
values ('documents', 'shipment/' || (select v from t_af where k = 's2') || '/b.jpg', 'b.jpg', 'image/jpeg', 100, 'shipment', (select v from t_af where k = 's2'), 'photo');
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.dispatch_act_for_driver((select v from t_af where k = 's2'), 'complete', 'partial', 'Thiếu 1 kiện', false, null);
select tests.assert((select status = 'driver_completed' and document_status = 'submitted' and photo_skip_reason is null and delivery_result = 'partial' and expense_declaration = 'has'
  from public.shipments where id = (select v from t_af where k = 's2')),
  'Hoàn thành thay khi đã có ảnh: chứng từ Đã nộp');
reset role;

-- Người không có quyền điều phối không làm thay được
select tests.login('00000000-0000-0000-0000-0000000000c1'); -- kế toán
set role authenticated;
select tests.assert_fails($$select public.dispatch_act_for_driver((select v from t_af where k = 's2'), 'accept')$$, 'Kế toán không làm thay tài xế được');
reset role;
set role anon;
select tests.assert_fails($$select public.dispatch_act_for_driver((select v from t_af where k = 's2'), 'accept')$$, 'Người ngoài không gọi được');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ ĐIỀU PHỐI LÀM THAY TÀI XẾ ĐỀU ĐẠT'
