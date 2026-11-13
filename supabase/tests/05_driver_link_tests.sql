-- =============================================================================
-- Kiểm thử tài xế nhận chuyến qua link bằng biển số xe (Giai đoạn 5).
-- Chạy sau 04 (dùng lại xe XE001 51C-123.45 – tài xế mặc định Tài xế A).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

create temp table t_link (k text primary key, v text);
grant all on t_link to anon, authenticated;

-- Điều phối tạo 2 chuyến: chuyến 1 giao Tài xế A + xe XE001, chuyến 2 giao Tài xế B không chọn xe
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into t_link
select 'order', public.create_transport_order(
  '{"customer_id":"10000000-0000-0000-0000-000000000001"}',
  '[{"pickup_at":"2026-10-22T08:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","vehicle_type_id":"30000000-0000-0000-0000-000000000001","driver_id":"40000000-0000-0000-0000-000000000001","vehicle_id":"50000000-0000-0000-0000-000000000001"},
    {"pickup_at":"2026-10-22T09:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1000000","driver_id":"40000000-0000-0000-0000-000000000002"}]')::text;
reset role;
insert into t_link
select 's1', (v::jsonb -> 'shipments' -> 0 ->> 'id') from t_link where k = 'order';
insert into t_link
select 's2', (v::jsonb -> 'shipments' -> 1 ->> 'id') from t_link where k = 'order';

set role anon;
select tests.assert((public.driver_link_login('51C') ->> 'ok')::boolean = false, 'Biển số quá ngắn bị từ chối');
select tests.assert((public.driver_link_login('99Z-999.99') ->> 'ok')::boolean = false, 'Biển số không có trong hệ thống bị từ chối');
insert into t_link select 'tok', public.driver_link_login('51c 12345') ->> 'token';
select tests.assert((select length(v) from t_link where k = 'tok') = 64, 'Nhập biển số (không phân biệt hoa thường, dấu chấm, gạch) mở được phiên');
select tests.assert(public.driver_link_me((select v from t_link where k = 'tok')) ->> 'plate' = '51C-123.45', 'Phiên cho biết đúng xe');

select tests.assert(exists (select 1 from public.driver_link_trips((select v from t_link where k = 'tok'))
  where shipment_id = (select v::uuid from t_link where k = 's1') and status = 'assigned'), 'Xe thấy chuyến được giao cho mình');
select tests.assert(not exists (select 1 from public.driver_link_trips((select v from t_link where k = 'tok'))
  where shipment_id = (select v::uuid from t_link where k = 's2')), 'Xe không thấy chuyến của tài xế khác');
select tests.assert((select count(*) from public.driver_link_trips('khong-phai-ma-phien-hop-le-khong-phai-ma-phien-hop-le')) = 0, 'Mã phiên sai không xem được chuyến');
select tests.assert_fails($$select * from private.driver_link_session('x')$$, 'Người ngoài không gọi được hàm nội bộ');
select tests.assert_fails($$select count(*) from private.driver_link_sessions$$, 'Người ngoài không đọc được bảng phiên');

-- Nhận chuyến của xe khác: bị từ chối
select tests.assert((public.driver_link_accept((select v from t_link where k = 'tok'), (select v::uuid from t_link where k = 's2')) ->> 'ok')::boolean = false,
  'Không nhận được chuyến của xe khác');
-- Nhận chuyến của mình
select tests.assert((public.driver_link_accept((select v from t_link where k = 'tok'), (select v::uuid from t_link where k = 's1')) ->> 'ok')::boolean,
  'Bấm nhận đơn thành công');
select tests.assert((public.driver_link_accept((select v from t_link where k = 'tok'), (select v::uuid from t_link where k = 's1')) ->> 'ok')::boolean,
  'Bấm nhận lần nữa không lỗi');
reset role;

select tests.assert((select status from public.shipments where id = (select v::uuid from t_link where k = 's1')) = 'accepted', 'Chuyến chuyển sang Đã nhận');
select tests.assert((select response from public.shipment_assignments where shipment_id = (select v::uuid from t_link where k = 's1') and response <> 'superseded') = 'accepted',
  'Phân công ghi nhận tài xế đã nhận');
select tests.assert((select note from public.shipment_status_history where shipment_id = (select v::uuid from t_link where k = 's1') and to_status = 'accepted') like 'Tài xế A nhận chuyến trên điện thoại',
  'Lịch sử trạng thái ghi tài xế nhận trên điện thoại');
select tests.assert(exists (select 1 from public.notifications where type = 'shipment_accepted' and entity_id = (select v::uuid from t_link where k = 's1')),
  'Điều phối nhận thông báo tài xế đã nhận chuyến');

-- Chuyến chưa chọn xe nhưng giao cho tài xế mặc định của xe: vẫn thấy
update public.shipments set driver_id = '40000000-0000-0000-0000-000000000001' where id = (select v::uuid from t_link where k = 's2');
update public.shipment_assignments set driver_id = '40000000-0000-0000-0000-000000000001' where shipment_id = (select v::uuid from t_link where k = 's2') and response = 'pending';
set role anon;
select tests.assert(exists (select 1 from public.driver_link_trips((select v from t_link where k = 'tok')) where shipment_id = (select v::uuid from t_link where k = 's2')),
  'Chuyến chưa chọn xe vẫn hiện cho xe của tài xế mặc định');

-- Thoát: mã phiên hết hiệu lực
select public.driver_link_logout((select v from t_link where k = 'tok'));
select tests.assert((select count(*) from public.driver_link_trips((select v from t_link where k = 'tok'))) = 0, 'Thoát xong mã phiên cũ không dùng được');
select tests.assert((public.driver_link_accept((select v from t_link where k = 'tok'), (select v::uuid from t_link where k = 's2')) ->> 'expired')::boolean,
  'Nhận chuyến bằng phiên đã thoát báo hết hạn');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ NHẬN CHUYẾN QUA LINK ĐỀU ĐẠT'
