-- =============================================================================
-- Kiểm thử 0033: Giám đốc duyệt chuyến trước khi tài xế nhận.
-- Các tệp kiểm thử trước chạy với tham số tắt (test-db.sh); tệp này bật lại.
-- Dùng điều phối d1, Giám đốc e1 (tạo ở 07), xe 51C-123.45 của Tài xế A.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.system_settings set value = 'true' where key = 'dispatch.require_director_approval';
create temp table t_ap (k text primary key, v text);
grant all on t_ap to authenticated, anon;

select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối
set role authenticated;
insert into t_ap select 's' || ord, e ->> 'id'
  from jsonb_array_elements((public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-000000000001"}',
  '[{"pickup_at":"2026-11-02T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1000000","driver_id":"40000000-0000-0000-0000-000000000001","vehicle_id":"50000000-0000-0000-0000-000000000001"},
    {"pickup_at":"2026-11-02T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1000000","driver_id":"40000000-0000-0000-0000-000000000001","vehicle_id":"50000000-0000-0000-0000-000000000001"},
    {"pickup_at":"2026-11-02T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1000000"}]')) -> 'shipments')
  with ordinality as x(e, ord);

select tests.assert((select dispatch_approval = 'pending' and dispatch_approval_request_id is not null from public.shipments where id = (select v::uuid from t_ap where k = 's1')),
  'Tạo chuyến có tài xế: chuyến Chờ Giám đốc duyệt, có yêu cầu duyệt');
select tests.assert((select dispatch_approval = 'not_required' from public.shipments where id = (select v::uuid from t_ap where k = 's3')),
  'Chuyến chưa phân công: chưa cần duyệt');
select tests.assert((select t.code = 'trip_dispatch' and r.status = 'pending' and r.entity_type = 'shipment_dispatch' and r.content like 'Chuyến %KH001%'
  from public.approval_list r join public.approval_types t on t.id = r.approval_type_id
  where r.entity_id = (select v::uuid from t_ap where k = 's1')),
  'Yêu cầu duyệt loại Duyệt chuyến xe, nội dung có mã chuyến và khách hàng');
select tests.assert_fails($$update public.shipments set dispatch_approval = 'approved' where id = (select v::uuid from t_ap where k = 's1')$$,
  'Điều phối không tự sửa trạng thái duyệt');
select tests.assert_fails($$select public.approval_decide((select dispatch_approval_request_id from public.shipments where id = (select v::uuid from t_ap where k = 's1')), 'approve')$$,
  'Điều phối không duyệt được chuyến');
select tests.assert_fails($$select public.dispatch_act_for_driver((select v::uuid from t_ap where k = 's1'), 'accept')$$,
  'Điều phối không nhận đơn thay khi chuyến chưa duyệt');
select tests.assert((select not can_approve_dispatch from public.shipment_list where id = (select v::uuid from t_ap where k = 's1')),
  'Bảng điều phối: điều phối không thấy nút duyệt');
reset role;

select tests.assert((select count(*) > 0 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000e1'
  and type = 'approval_pending' and link = '/chuyen-xe/' || (select v from t_ap where k = 's1')),
  'Giám đốc nhận thông báo, bấm mở thẳng chuyến');

-- Tài xế chưa thấy chuyến
select set_config('request.jwt.claim.sub', '', false);
set role anon;
insert into t_ap select 'tok', public.driver_link_login('51C12345') ->> 'token';
select tests.assert(not exists (select 1 from public.driver_link_trips((select v from t_ap where k = 'tok')) t where t.shipment_id = (select v::uuid from t_ap where k = 's1')),
  'Tài xế chưa thấy chuyến chờ duyệt');
select tests.assert((public.driver_link_accept((select v from t_ap where k = 'tok'), (select v::uuid from t_ap where k = 's1')) ->> 'ok')::boolean = false,
  'Tài xế không nhận được chuyến chờ duyệt');
reset role;

-- Giám đốc từ chối
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert((select can_approve_dispatch from public.shipment_list where id = (select v::uuid from t_ap where k = 's1')),
  'Giám đốc thấy nút duyệt trên bảng điều phối');
select tests.assert_fails($$select public.approval_decide((select dispatch_approval_request_id from public.shipments where id = (select v::uuid from t_ap where k = 's1')), 'reject', '  ')$$,
  'Từ chối bắt buộc lý do');
select public.approval_decide((select dispatch_approval_request_id from public.shipments where id = (select v::uuid from t_ap where k = 's1')), 'reject', 'Sai xe, đổi xe 8 tấn');
select tests.assert((select dispatch_approval = 'rejected' and dispatch_reject_reason = 'Sai xe, đổi xe 8 tấn' from public.shipment_list where id = (select v::uuid from t_ap where k = 's1')),
  'Từ chối: chuyến Bị từ chối, lưu lý do');
reset role;
select tests.assert((select count(*) = 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000d1' and type = 'approval_rejected'
  and link = '/chuyen-xe/' || (select v from t_ap where k = 's1')),
  'Điều phối nhận thông báo bị từ chối');
set role anon;
select tests.assert((public.driver_link_accept((select v from t_ap where k = 'tok'), (select v::uuid from t_ap where k = 's1')) ->> 'ok')::boolean = false,
  'Tài xế không nhận được chuyến bị từ chối');
reset role;

-- Điều phối gửi duyệt lại
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into t_ap select 'r1', dispatch_approval_request_id::text from public.shipments where id = (select v::uuid from t_ap where k = 's1');
select public.resubmit_trip_approval((select v::uuid from t_ap where k = 's1'), 'Đã đổi xe');
select tests.assert((select dispatch_approval = 'pending' and dispatch_reject_reason is null and dispatch_approval_request_id::text <> (select v from t_ap where k = 'r1')
  from public.shipments where id = (select v::uuid from t_ap where k = 's1')),
  'Gửi duyệt lại: yêu cầu mới, chuyến Chờ duyệt');
select tests.assert_fails($$select public.resubmit_trip_approval((select v::uuid from t_ap where k = 's1'))$$,
  'Không gửi lại khi đang chờ duyệt');
reset role;

-- Giám đốc duyệt -> tài xế thấy và nhận
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select public.approval_decide((select dispatch_approval_request_id from public.shipments where id = (select v::uuid from t_ap where k = 's1')), 'approve');
select tests.assert((select dispatch_approval = 'approved' and dispatch_approved_by = '00000000-0000-0000-0000-0000000000e1' and dispatch_approved_at is not null
  from public.shipments where id = (select v::uuid from t_ap where k = 's1')),
  'Duyệt: chuyến Đã duyệt, lưu người và giờ duyệt');
reset role;
set role anon;
select tests.assert(exists (select 1 from public.driver_link_trips((select v from t_ap where k = 'tok')) t where t.shipment_id = (select v::uuid from t_ap where k = 's1')),
  'Đã duyệt: tài xế thấy chuyến');
select tests.assert((public.driver_link_accept((select v from t_ap where k = 'tok'), (select v::uuid from t_ap where k = 's1')) ->> 'ok')::boolean,
  'Đã duyệt: tài xế bấm Nhận đơn được');
reset role;

-- Đổi tài xế / đổi xe / gỡ phân công
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.assign_shipment((select v::uuid from t_ap where k = 's1'), '40000000-0000-0000-0000-000000000002', null);
select tests.assert((select status = 'assigned' and dispatch_approval = 'pending' from public.shipments where id = (select v::uuid from t_ap where k = 's1')),
  'Đổi tài xế sau khi đã duyệt: phải duyệt lại');
insert into t_ap select 'r2', dispatch_approval_request_id::text from public.shipments where id = (select v::uuid from t_ap where k = 's2');
select public.assign_shipment((select v::uuid from t_ap where k = 's2'), '40000000-0000-0000-0000-000000000002', null);
reset role;
select tests.assert((select status = 'cancelled' from public.approval_requests where id = (select v::uuid from t_ap where k = 'r2'))
  and (select dispatch_approval = 'pending' and dispatch_approval_request_id::text <> (select v from t_ap where k = 'r2') from public.shipments where id = (select v::uuid from t_ap where k = 's2')),
  'Đổi tài xế khi đang chờ: hủy yêu cầu cũ, tạo yêu cầu mới');
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select public.approval_decide((select dispatch_approval_request_id from public.shipments where id = (select v::uuid from t_ap where k = 's2')), 'approve');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.assign_shipment((select v::uuid from t_ap where k = 's2'), '40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001');
select tests.assert((select dispatch_approval = 'approved' from public.shipments where id = (select v::uuid from t_ap where k = 's2')),
  'Chỉ đổi xe (cùng tài xế): giữ đã duyệt');
select public.assign_shipment((select v::uuid from t_ap where k = 's3'), '40000000-0000-0000-0000-000000000001', null);
select tests.assert((select dispatch_approval = 'pending' from public.shipments where id = (select v::uuid from t_ap where k = 's3')),
  'Phân công chuyến nháp: chờ duyệt');
insert into t_ap select 'r3', dispatch_approval_request_id::text from public.shipments where id = (select v::uuid from t_ap where k = 's3');
select public.assign_shipment((select v::uuid from t_ap where k = 's3'), null, null);
reset role;
select tests.assert((select dispatch_approval = 'not_required' and status = 'draft' from public.shipments where id = (select v::uuid from t_ap where k = 's3'))
  and (select status = 'cancelled' from public.approval_requests where id = (select v::uuid from t_ap where k = 'r3')),
  'Gỡ phân công: hủy yêu cầu duyệt');

-- Tắt tham số: chuyến đang chờ được thả cho tài xế; phân công mới không cần duyệt
update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
select tests.assert((select dispatch_approval = 'not_required' from public.shipments where id = (select v::uuid from t_ap where k = 's1')),
  'Tắt duyệt chuyến: chuyến đang chờ được thả cho tài xế');
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.assign_shipment((select v::uuid from t_ap where k = 's3'), '40000000-0000-0000-0000-000000000001', null);
select tests.assert((select dispatch_approval = 'not_required' from public.shipments where id = (select v::uuid from t_ap where k = 's3')),
  'Tắt duyệt chuyến: phân công mới không cần duyệt');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ GIÁM ĐỐC DUYỆT CHUYẾN ĐỀU ĐẠT'
