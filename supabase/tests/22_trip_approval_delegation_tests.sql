-- =============================================================================
-- Kiểm thử 0034: Giám đốc ủy quyền điều phối duyệt hộ chuyến (công tác, hội họp).
-- Chạy sau 21. Điều phối d1, Giám đốc e1.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.system_settings set value = 'true' where key = 'dispatch.require_director_approval';
create temp table t_dg (k text primary key, v text);
grant all on t_dg to authenticated, anon;

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into t_dg select 's' || ord, e ->> 'id'
  from jsonb_array_elements((public.create_transport_order('{"customer_id":"10000000-0000-0000-0000-000000000001"}',
  '[{"pickup_at":"2026-11-03T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1000000","driver_id":"40000000-0000-0000-0000-000000000001","vehicle_id":"50000000-0000-0000-0000-000000000001"},
    {"pickup_at":"2026-11-03T00:00:00+07:00","pickup_location_id":"20000000-0000-0000-0000-000000000001","delivery_location_id":"20000000-0000-0000-0000-000000000002","unit_price":"1000000","driver_id":"40000000-0000-0000-0000-000000000001","vehicle_id":"50000000-0000-0000-0000-000000000001"}]')) -> 'shipments')
  with ordinality as x(e, ord);
select tests.assert_fails($$select public.grant_trip_delegation('00000000-0000-0000-0000-0000000000d1')$$, 'Điều phối không tự ủy quyền được');
select tests.assert((public.trip_delegation_info() ->> 'is_approver')::boolean = false and (public.trip_delegation_info() -> 'delegations') = 'null'::jsonb,
  'Điều phối không thấy danh sách ủy quyền');
select tests.assert((select not can_approve_dispatch from public.shipment_list where id = (select v::uuid from t_dg where k = 's1')), 'Chưa ủy quyền: điều phối chưa duyệt được');
reset role;

-- Giám đốc ủy quyền
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert((public.trip_delegation_info() ->> 'is_approver')::boolean
  and exists (select 1 from jsonb_array_elements(public.trip_delegation_info() -> 'candidates') c where c ->> 'id' = '00000000-0000-0000-0000-0000000000d1'),
  'Giám đốc thấy điều phối trong danh sách chọn ủy quyền');
select tests.assert_fails($$select public.grant_trip_delegation('00000000-0000-0000-0000-0000000000d1', now() - interval '1 hour')$$, 'Ngày hết hạn đã qua bị chặn');
select tests.assert_fails($$select public.grant_trip_delegation('00000000-0000-0000-0000-0000000000e1')$$, 'Không ủy quyền cho chính mình');
insert into t_dg select 'g1', public.grant_trip_delegation('00000000-0000-0000-0000-0000000000d1', now() + interval '2 days', 'Đi công tác Hà Nội')::text;
reset role;
select tests.assert((select count(*) = 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000d1' and type = 'trip_delegation'),
  'Người được ủy quyền nhận thông báo');

-- Điều phối duyệt hộ
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert((public.trip_delegation_info() ->> 'is_delegate')::boolean, 'Điều phối biết mình đang được ủy quyền');
select tests.assert((select can_approve_dispatch from public.shipment_list where id = (select v::uuid from t_dg where k = 's1')), 'Được ủy quyền: thấy nút duyệt');
select public.approval_decide((select dispatch_approval_request_id from public.shipments where id = (select v::uuid from t_dg where k = 's1')), 'approve');
select tests.assert((select dispatch_approval = 'approved' and dispatch_approved_on_behalf and dispatch_approved_by = '00000000-0000-0000-0000-0000000000d1'
  from public.shipments where id = (select v::uuid from t_dg where k = 's1')),
  'Duyệt hộ: chuyến Đã duyệt, ghi là duyệt hộ');
select public.approval_decide((select dispatch_approval_request_id from public.shipments where id = (select v::uuid from t_dg where k = 's2')), 'reject', 'Sai tuyến');
select tests.assert((select dispatch_approval = 'rejected' from public.shipments where id = (select v::uuid from t_dg where k = 's2')), 'Từ chối hộ được');
reset role;
select tests.assert((select comment like 'Duyệt hộ Giám đốc%' from public.approval_steps
  where request_id = (select dispatch_approval_request_id from public.shipments where id = (select v::uuid from t_dg where k = 's1')) and action = 'approve'),
  'Lịch sử duyệt ghi "Duyệt hộ Giám đốc"');
select tests.assert((select count(*) = 2 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000e1' and type = 'trip_delegate_decided'),
  'Giám đốc nhận thông báo mỗi lần được duyệt/từ chối hộ');

-- Chỉ áp dụng cho chuyến: yêu cầu khác (ứng tiền) không duyệt hộ được
insert into public.approval_requests (approval_type_id, entity_type, entity_id, requested_by, amount, content, status)
select id, 'advance_request', gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1', 100000, 'Ứng thử', 'pending' from public.approval_types where code = 'advance'
returning id \gset adv_
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert(not private.can_approve(:'adv_id'), 'Ủy quyền chỉ cho duyệt chuyến, không duyệt ứng tiền');
-- Chuyến mới phân công trong thời gian ủy quyền: người được ủy quyền nhận thông báo
select public.resubmit_trip_approval((select v::uuid from t_dg where k = 's2'));
reset role;
select tests.assert((select count(*) >= 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000d1' and type = 'approval_pending_delegate'),
  'Chuyến chờ duyệt: người được ủy quyền cũng nhận thông báo');

-- Thu hồi
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select public.revoke_trip_delegation((select v::uuid from t_dg where k = 'g1'));
select tests.assert_fails($$select public.revoke_trip_delegation((select v::uuid from t_dg where k = 'g1'))$$, 'Không thu hồi hai lần');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.approval_decide((select dispatch_approval_request_id from public.shipments where id = (select v::uuid from t_dg where k = 's2')), 'approve')$$,
  'Đã thu hồi: không duyệt hộ được nữa');
reset role;

-- Ủy quyền hết hạn không còn hiệu lực
insert into public.trip_approval_delegations (delegate_id, granted_by, starts_at, ends_at)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', now() - interval '3 days', now() - interval '1 day');
select tests.assert(not private.is_trip_delegate('00000000-0000-0000-0000-0000000000d1'), 'Ủy quyền hết hạn không còn hiệu lực');
set role authenticated;
select tests.assert_fails($$select count(*) from public.trip_approval_delegations$$, 'Không đọc thẳng bảng ủy quyền');
reset role;

update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';
\o
\echo 'TẤT CẢ KIỂM THỬ ỦY QUYỀN DUYỆT CHUYẾN ĐỀU ĐẠT'
