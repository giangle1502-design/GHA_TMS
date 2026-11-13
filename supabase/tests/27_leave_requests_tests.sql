-- =============================================================================
-- Kiểm thử 0041: Xin nghỉ (phép/ốm), Giám đốc duyệt, bàn giao khách hàng / công việc.
-- Điều phối d1 xin nghỉ, bàn giao khách cho kế toán c1 (giả định là nhân viên khác); Giám đốc e1 duyệt; tài xế b1.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
create temp table t_lv (k text primary key, v text);
grant all on t_lv to authenticated, anon;
insert into public.customers (id, code, name) values ('10000000-0000-0000-0000-0000000004a1', 'KHNP1', 'Khách nghỉ phép 1'),
  ('10000000-0000-0000-0000-0000000004a2', 'KHNP2', 'Khách nghỉ phép 2') on conflict do nothing;

-- Nhân viên phụ trách khách hàng
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
update public.customers set account_manager_id = '00000000-0000-0000-0000-0000000000d1'
 where id in ('10000000-0000-0000-0000-0000000004a1', '10000000-0000-0000-0000-0000000004a2');
select tests.assert((select count(*) = 2 from public.customers where account_manager_id = '00000000-0000-0000-0000-0000000000d1'),
  'Điều phối gán Nhân viên phụ trách cho khách');
select tests.assert(exists (select 1 from public.staff_directory where id = '00000000-0000-0000-0000-0000000000c1')
  and not exists (select 1 from public.staff_directory where id = '00000000-0000-0000-0000-0000000000b1'),
  'Danh bạ nhân viên có kế toán, không có tài xế');

-- Kiểm tra dữ liệu nhập
select tests.assert_fails($$select public.create_leave_request('annual', '2026-11-10', '2026-11-09', 1)$$, 'Ngày kết thúc trước ngày bắt đầu bị chặn');
select tests.assert_fails($$select public.create_leave_request('annual', '2026-11-10', '2026-11-11', 3)$$, 'Số ngày vượt khoảng ngày bị chặn');
select tests.assert_fails($$select public.create_leave_request('annual', '2026-11-10', '2026-11-11', 1.3)$$, 'Số ngày không theo bước 0.5 bị chặn');
select tests.assert_fails($$select public.create_leave_request('other', '2026-11-10', '2026-11-10', 1)$$, 'Nghỉ khác phải ghi lý do');
select tests.assert_fails($$select public.create_leave_request('annual', '2026-11-10', '2026-11-10', 1, null, null,
  '[{"customer_id":"10000000-0000-0000-0000-0000000004a1","receiver_id":"00000000-0000-0000-0000-0000000000d1"}]')$$, 'Không bàn giao cho chính mình');
select tests.assert_fails($$select public.create_leave_request('annual', '2026-11-10', '2026-11-10', 1, null, null,
  '[{"customer_id":"10000000-0000-0000-0000-0000000004a1","receiver_id":"00000000-0000-0000-0000-0000000000b1"}]')$$, 'Không bàn giao cho tài xế');
select tests.assert_fails($$select public.create_leave_request('annual', '2026-11-10', '2026-11-10', 1, null, null,
  '[{"receiver_id":"00000000-0000-0000-0000-0000000000c1"}]')$$, 'Dòng bàn giao phải có khách hoặc công việc');

-- Tạo đơn: 2 khách giao cho 2 người (c1, e1) + 1 việc khác
insert into t_lv select 'l1', public.create_leave_request('annual', current_date, current_date + 1, 1.5, 'Về quê', 'Mật khẩu email để trong tủ',
  '[{"customer_id":"10000000-0000-0000-0000-0000000004a1","receiver_id":"00000000-0000-0000-0000-0000000000c1"},
    {"customer_id":"10000000-0000-0000-0000-0000000004a2","receiver_id":"00000000-0000-0000-0000-0000000000e1"},
    {"task":"Theo dõi công nợ tuần","receiver_id":"00000000-0000-0000-0000-0000000000c1"}]', '{}', '11111111-0000-0000-0000-000000000041')::text;
select tests.assert((select public.create_leave_request('annual', current_date, current_date + 1, 1.5, 'Về quê', null, '[]', '{}',
  '11111111-0000-0000-0000-000000000041')::text) = (select v from t_lv where k = 'l1'), 'Bấm gửi hai lần không tạo hai đơn');
select tests.assert_fails($$select public.create_leave_request('sick', current_date + 1, current_date + 2, 1)$$, 'Đơn trùng ngày bị chặn');
select tests.assert((select status = 'pending' and handover_count = 3 and customer_count = 2 and is_mine and not can_approve
  from public.leave_list where id = (select v::uuid from t_lv where k = 'l1')), 'Đơn chờ duyệt, 3 dòng bàn giao, người xin không tự duyệt');
select tests.assert_fails($$select public.accept_leave_handover((select id from public.leave_handovers where leave_request_id = (select v::uuid from t_lv where k = 'l1') limit 1))$$,
  'Người xin nghỉ không bấm nhận thay được');
reset role;
select tests.assert((select count(*) = 1 from public.notifications n join public.approval_requests r on r.id = n.entity_id
  where n.recipient_id = '00000000-0000-0000-0000-0000000000e1' and n.type = 'approval_pending' and r.entity_type = 'leave_request'
    and n.title = 'Đơn xin nghỉ chờ duyệt' and n.link like '/nghi-phep%'), 'Giám đốc nhận thông báo đơn nghỉ (không ghi 0 đ)');

-- Người nhận chưa nhận được khi chưa duyệt
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((select i_receive from public.leave_list where id = (select v::uuid from t_lv where k = 'l1')), 'Người nhận bàn giao thấy đơn');
select tests.assert((select count(*) = 2 from public.leave_handover_list where receiver_id = auth.uid() and not can_accept), 'Chưa duyệt: chưa bấm nhận được');
select tests.assert_fails($$select public.accept_leave_handover((select id from public.leave_handovers where receiver_id = auth.uid() limit 1))$$,
  'Chưa duyệt thì không nhận bàn giao');
select tests.assert_fails($$select public.approval_decide((select approval_request_id from public.leave_requests where id = (select v::uuid from t_lv where k = 'l1')), 'approve')$$,
  'Kế toán không duyệt đơn nghỉ (cấp duyệt là Giám đốc)');
reset role;

-- Tài xế không thấy đơn
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((select count(*) = 0 from public.leave_list), 'Tài xế không thấy đơn nghỉ của người khác');
reset role;

-- Giám đốc duyệt
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert((select can_approve from public.leave_list where id = (select v::uuid from t_lv where k = 'l1')), 'Giám đốc thấy nút duyệt');
select public.approval_decide((select approval_request_id from public.leave_requests where id = (select v::uuid from t_lv where k = 'l1')), 'approve');
select tests.assert((select status = 'approved' and on_leave_now and decided_by_name is not null from public.leave_list where id = (select v::uuid from t_lv where k = 'l1')),
  'Duyệt xong: đơn Đã duyệt, đang nghỉ hôm nay');
reset role;
select tests.assert((select count(*) = 2 from public.notifications where type = 'leave_handover'
  and entity_id = (select v::uuid from t_lv where k = 'l1')), 'Mỗi người nhận bàn giao được báo một lần');

select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert(public.customer_acting_manager('10000000-0000-0000-0000-0000000004a1') = '00000000-0000-0000-0000-0000000000c1',
  'Trong ngày nghỉ: khách 1 do người nhận bàn giao phụ trách thay');
select tests.assert(public.customer_acting_manager('10000000-0000-0000-0000-0000000004a1', current_date + 5) = '00000000-0000-0000-0000-0000000000d1',
  'Hết ngày nghỉ: trở về nhân viên phụ trách gốc');
select tests.assert(public.accept_leave_handover((select id from public.leave_handovers where receiver_id = auth.uid()
  and leave_request_id = (select v::uuid from t_lv where k = 'l1') order by line_no limit 1), 'Đã nắm', true) = 2, 'Nhận hết bàn giao của mình trong một lần');
select tests.assert((select count(*) = 2 from public.leave_handover_list where receiver_id = auth.uid() and status = 'accepted'), 'Các dòng chuyển Đã nhận');
reset role;
select tests.assert((select count(*) = 1 from public.notifications where type = 'leave_handover_accepted' and recipient_id = '00000000-0000-0000-0000-0000000000d1'),
  'Người xin nghỉ được báo khi có người nhận bàn giao');

-- Từ chối và hủy
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into t_lv select 'l2', public.create_leave_request('sick', current_date + 10, current_date + 10, 1, 'Sốt')::text;
insert into t_lv select 'l3', public.create_leave_request('unpaid', current_date + 20, current_date + 21, 2, 'Việc riêng')::text;
reset role;
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert_fails($$select public.approval_decide((select approval_request_id from public.leave_requests where id = (select v::uuid from t_lv where k = 'l2')), 'reject')$$,
  'Từ chối phải có lý do');
select public.approval_decide((select approval_request_id from public.leave_requests where id = (select v::uuid from t_lv where k = 'l2')), 'reject', 'Đang cao điểm');
select tests.assert((select status = 'rejected' and reject_reason = 'Đang cao điểm' from public.leave_list where id = (select v::uuid from t_lv where k = 'l2')),
  'Từ chối: đơn Bị từ chối kèm lý do');
select tests.assert_fails($$select public.cancel_leave_request((select v::uuid from t_lv where k = 'l3'))$$, 'Giám đốc không hủy đơn của người khác');
reset role;
select tests.assert((select link = '/nghi-phep?tab=leave_requests' from public.notifications where type = 'approval_rejected'
  and recipient_id = '00000000-0000-0000-0000-0000000000d1' order by created_at desc limit 1), 'Thông báo từ chối mở trang Xin nghỉ');
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.cancel_leave_request((select v::uuid from t_lv where k = 'l3'), 'Đổi lịch');
select tests.assert((select status = 'cancelled' from public.leave_list where id = (select v::uuid from t_lv where k = 'l3')), 'Người xin hủy được đơn chờ duyệt');
select tests.assert((select r.status = 'cancelled' from public.approval_requests r join public.leave_requests l on l.approval_request_id = r.id
  where l.id = (select v::uuid from t_lv where k = 'l3')), 'Hủy đơn thì yêu cầu duyệt cũng hủy');
select public.cancel_leave_request((select v::uuid from t_lv where k = 'l1'));
select tests.assert(public.customer_acting_manager('10000000-0000-0000-0000-0000000004a1') = '00000000-0000-0000-0000-0000000000d1',
  'Hủy đơn đã duyệt: khách trở về người phụ trách gốc');
select tests.assert_fails($$update public.leave_requests set status = 'approved' where id = (select v::uuid from t_lv where k = 'l3')$$,
  'Không sửa trực tiếp bảng đơn nghỉ');
reset role;
select tests.assert((select count(*) >= 2 from public.notifications where type = 'leave_handover' and title like 'Đã hủy đơn nghỉ%'),
  'Hủy đơn đã duyệt: người nhận bàn giao được báo');

-- Dọn dữ liệu kiểm thử
delete from public.leave_requests where requester_id = '00000000-0000-0000-0000-0000000000d1';
update public.customers set account_manager_id = null where id in ('10000000-0000-0000-0000-0000000004a1', '10000000-0000-0000-0000-0000000004a2');
\o
\echo 'TẤT CẢ KIỂM THỬ XIN NGHỈ, BÀN GIAO ĐỀU ĐẠT'
