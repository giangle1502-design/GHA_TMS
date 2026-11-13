-- =============================================================================
-- Kiểm thử 0040: Phiếu đề nghị chi / mua sắm.
-- Điều phối d1 lập phiếu, Giám đốc e1 duyệt, Kế toán c1 chi tiền.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
create temp table t_pr (k text primary key, v text);
grant all on t_pr to authenticated, anon;
select tests.assert((select count(*) from public.purchase_request_types where code in ('VPP', 'SUAVP', 'MMTB')) = 3,
  'Có sẵn loại đề nghị Văn phòng phẩm, Sửa văn phòng, Máy móc thiết bị');
select tests.assert(exists (select 1 from public.approval_rules ar join public.approval_types t on t.id = ar.approval_type_id
  join public.roles r on r.id = ar.approver_role_id where t.code = 'purchase_request' and r.code = 'director' and ar.is_active),
  'Đề nghị chi do Giám đốc duyệt');
select tests.assert(private.custom_field_table('purchase_requests') = 'purchase_requests', 'Phiếu đề nghị có trường bổ sung');
insert into t_pr values ('vpp', (select id::text from public.purchase_request_types where code = 'VPP'));

-- Điều phối: thêm nhanh loại mới, lập phiếu (có danh sách hàng: tổng tự cộng)
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into public.purchase_request_types (name) values ('Mua đồ bảo hộ lao động');
select tests.assert((select code from public.purchase_request_types where name = 'Mua đồ bảo hộ lao động') like 'LDN%', 'Thêm nhanh loại đề nghị, mã tự sinh');
update public.purchase_request_types set name = 'Đổi tên' where code = 'VPP';
select tests.assert((select name from public.purchase_request_types where code = 'VPP') = 'Mua văn phòng phẩm', 'Điều phối không sửa được danh mục loại đề nghị');
select tests.assert_fails($$select public.create_purchase_request((select v::uuid from t_pr where k = 'vpp'), '', 100000)$$, 'Thiếu nội dung bị chặn');
select tests.assert_fails($$select public.create_purchase_request((select v::uuid from t_pr where k = 'vpp'), 'Mua giấy', 0)$$, 'Số tiền 0 bị chặn');
select tests.assert_fails($$select public.create_purchase_request((select v::uuid from t_pr where k = 'vpp'), 'Mua giấy', null,
  '[{"name":"Giấy","qty":0,"price":1000}]')$$, 'Số lượng 0 bị chặn');
select tests.assert_fails($$insert into public.purchase_requests (type_id, title, amount_requested, requested_by)
  values ((select v::uuid from t_pr where k = 'vpp'), 'x', 1, auth.uid())$$, 'Không ghi thẳng vào bảng phiếu');
insert into t_pr select 'p1', public.create_purchase_request((select v::uuid from t_pr where k = 'vpp'), 'Mua văn phòng phẩm tháng 11', 999,
  '[{"name":"Giấy A4","qty":10,"unit":"ram","price":75000},{"name":"Mực in","qty":2,"unit":"hộp","price":450000},{"name":"","price":0}]',
  '2026-11-05', null, 'Nguyễn Văn A', null, '{}', '11111111-2222-3333-4444-555555555501')::text;
select tests.assert((select v from t_pr where k = 'p1') = public.create_purchase_request((select v::uuid from t_pr where k = 'vpp'), 'Lặp', 5,
  '[]', null, null, null, null, '{}', '11111111-2222-3333-4444-555555555501')::text, 'Gửi trùng (mạng chập chờn) không tạo phiếu mới');
select tests.assert((select amount_requested = 1650000 and item_count = 2 and status = 'pending' and code like 'DN-%' and requester_name is not null
  from public.purchase_request_list where id = (select v::uuid from t_pr where k = 'p1')), 'Tổng tiền = Σ SL × đơn giá, bỏ dòng trống, chờ duyệt');
select tests.assert((select not can_approve and not can_pay and can_cancel from public.purchase_request_list where id = (select v::uuid from t_pr where k = 'p1')),
  'Người lập không tự duyệt, không chi; được hủy khi chờ duyệt');
insert into t_pr select 'p2', public.create_purchase_request((select v::uuid from t_pr where k = 'vpp'), 'Sửa điều hòa phòng điều phối', 3000000)::text;
insert into t_pr select 'p3', public.create_purchase_request((select v::uuid from t_pr where k = 'vpp'), 'Mua máy in', 5000000)::text;
select tests.assert_fails($$select public.approval_decide((select approval_request_id from public.purchase_requests where id = (select v::uuid from t_pr where k = 'p1')), 'approve')$$,
  'Người lập không tự duyệt được');
reset role;
select tests.assert(exists (select 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000e1' and type = 'approval_pending'
  and entity_id = (select approval_request_id from public.purchase_requests where id = (select v::uuid from t_pr where k = 'p1'))), 'Giám đốc nhận thông báo chờ duyệt');

-- Người không liên quan không thấy phiếu
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((select count(*) from public.purchase_request_list) = 0, 'Tài xế không thấy phiếu đề nghị');
select tests.assert_fails($$select public.create_purchase_request((select v::uuid from t_pr where k = 'vpp'), 'x', 1000)$$, 'Tài xế không lập được phiếu');
reset role;

-- Giám đốc: duyệt ít hơn số đề nghị, từ chối phiếu khác
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert((select can_approve from public.purchase_request_list where id = (select v::uuid from t_pr where k = 'p1')), 'Giám đốc duyệt được');
select tests.assert_fails($$select public.approval_decide((select approval_request_id from public.purchase_requests where id = (select v::uuid from t_pr where k = 'p1')), 'approve', null, 2000000)$$,
  'Không duyệt vượt số đề nghị');
select public.approval_decide((select approval_request_id from public.purchase_requests where id = (select v::uuid from t_pr where k = 'p1')), 'approve', 'Mua 1 hộp mực thôi', 1200000);
select public.approval_decide((select approval_request_id from public.purchase_requests where id = (select v::uuid from t_pr where k = 'p3')), 'approve');
select tests.assert_fails($$select public.approval_decide((select approval_request_id from public.purchase_requests where id = (select v::uuid from t_pr where k = 'p2')), 'reject')$$,
  'Từ chối phải có lý do');
select public.approval_decide((select approval_request_id from public.purchase_requests where id = (select v::uuid from t_pr where k = 'p2')), 'reject', 'Để quý sau');
select tests.assert((select status = 'approved' and amount_approved = 1200000 and amount_to_pay = 1200000 and remaining_amount = 1200000
  from public.purchase_request_list where id = (select v::uuid from t_pr where k = 'p1')), 'Phiếu đã duyệt với số tiền duyệt');
select tests.assert((select status = 'rejected' and reject_reason = 'Để quý sau' from public.purchase_request_list where id = (select v::uuid from t_pr where k = 'p2')),
  'Phiếu bị từ chối có lý do');
select tests.assert_fails($$select public.pay_purchase_request((select v::uuid from t_pr where k = 'p1'))$$, 'Giám đốc không có quyền chi tiền');
reset role;
select tests.assert(exists (select 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000c1' and type = 'purchase_to_pay'),
  'Kế toán nhận thông báo chờ chi tiền');
select tests.assert(exists (select 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000d1' and type = 'approval_rejected'
  and link = '/de-nghi'), 'Người lập nhận thông báo bị từ chối');

-- Kế toán chi 2 lần, hủy một phiếu chi ghi nhầm, hoàn tất phiếu chi chưa hết
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((select count(*) from public.purchase_request_list where id in (select v::uuid from t_pr where k like 'p%')) = 3, 'Kế toán thấy tất cả phiếu');
select tests.assert_fails($$select public.pay_purchase_request((select v::uuid from t_pr where k = 'p2'))$$, 'Không chi phiếu bị từ chối');
select tests.assert_fails($$select public.pay_purchase_request((select v::uuid from t_pr where k = 'p1'), 1300000)$$, 'Không chi vượt số đã duyệt');
insert into t_pr select 'pay1', public.pay_purchase_request((select v::uuid from t_pr where k = 'p1'), 500000, null, null, 'FT001');
select tests.assert((select status = 'partial' and paid_amount = 500000 and remaining_amount = 700000 and can_complete
  from public.purchase_request_list where id = (select v::uuid from t_pr where k = 'p1')), 'Chi một phần: đang chi, còn lại 700,000');
insert into t_pr select 'pay2', public.pay_purchase_request((select v::uuid from t_pr where k = 'p1'));
select tests.assert((select status = 'paid' and paid_amount = 1200000 and remaining_amount = 0 and not can_pay
  from public.purchase_request_list where id = (select v::uuid from t_pr where k = 'p1')), 'Chi phần còn lại: đã chi xong');
select tests.assert((select status from public.approval_requests where id = (select approval_request_id from public.purchase_requests where id = (select v::uuid from t_pr where k = 'p1'))) = 'paid',
  'Yêu cầu duyệt chuyển Đã thanh toán');
select tests.assert((select purpose = 'purchase_request' and direction = 'out' and source_code like 'DN-%' and partner_name = 'Nguyễn Văn A' and can_void
  from public.payment_list where code = (select v from t_pr where k = 'pay2')), 'Phiếu chi hiện ở Phiếu thu chi, có chứng từ gốc, hủy được');
select public.void_payment((select id from public.payments where code = (select v from t_pr where k = 'pay2')), 'Ghi nhầm số tiền');
select tests.assert((select status = 'partial' and paid_amount = 500000 from public.purchase_request_list where id = (select v::uuid from t_pr where k = 'p1')),
  'Hủy phiếu chi: trả lại số còn được chi');
select tests.assert((select status from public.approval_requests where id = (select approval_request_id from public.purchase_requests where id = (select v::uuid from t_pr where k = 'p1'))) = 'approved',
  'Hủy phiếu chi: yêu cầu duyệt về Đã duyệt');
select public.complete_purchase_request((select v::uuid from t_pr where k = 'p1'), 'Mua được giá rẻ hơn');
select tests.assert((select status = 'paid' and paid_amount = 500000 and remaining_amount = 0 and completed_note = 'Mua được giá rẻ hơn'
  from public.purchase_request_list where id = (select v::uuid from t_pr where k = 'p1')), 'Hoàn tất: đóng phiếu với số đã chi');
select tests.assert_fails($$select public.complete_purchase_request((select v::uuid from t_pr where k = 'p3'))$$, 'Phiếu chưa chi đồng nào không hoàn tất được (hủy thay vì hoàn tất)');
select tests.assert_fails($$select public.cancel_purchase_request((select v::uuid from t_pr where k = 'p1'), 'x')$$, 'Không hủy phiếu đã chi');
select public.cancel_purchase_request((select v::uuid from t_pr where k = 'p3'), 'Đã có máy in cũ dùng tạm');
select tests.assert((select status from public.purchase_request_list where id = (select v::uuid from t_pr where k = 'p3')) = 'cancelled', 'Kế toán hủy phiếu đã duyệt chưa chi');
select tests.assert((select request_count >= 3 and amount_approved >= 1200000 and paid_amount >= 500000
  from public.report_purchase_requests where type_id = (select v::uuid from t_pr where k = 'vpp')
    and report_month = date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh')::date),
  'Báo cáo theo tháng, theo loại đề nghị');
select tests.assert((select count(*) >= 5 from public.purchase_request_history((select v::uuid from t_pr where k = 'p1'))),
  'Lịch sử phiếu: gửi, duyệt, chi, hủy phiếu chi, hoàn tất');
reset role;
select tests.assert(exists (select 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000d1' and type = 'purchase_paid'),
  'Người lập nhận thông báo đã chi tiền');

-- Người lập: hủy phiếu của mình khi còn chờ duyệt; xem lịch sử phiếu của mình
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
insert into t_pr select 'p4', public.create_purchase_request((select v::uuid from t_pr where k = 'vpp'), 'Mua bút bi', 50000)::text;
select public.cancel_purchase_request((select v::uuid from t_pr where k = 'p4'), 'Nhập nhầm');
select tests.assert((select status from public.purchase_request_list where id = (select v::uuid from t_pr where k = 'p4')) = 'cancelled', 'Người lập hủy phiếu chờ duyệt');
select tests.assert((select status from public.approval_list where id = (select approval_request_id from public.purchase_requests where id = (select v::uuid from t_pr where k = 'p4'))) = 'cancelled',
  'Hủy phiếu thì yêu cầu duyệt cũng hủy');
select tests.assert((select count(*) >= 5 from public.purchase_request_history((select v::uuid from t_pr where k = 'p1'))), 'Người lập xem được lịch sử phiếu');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((select count(*) from public.purchase_request_history((select v::uuid from t_pr where k = 'p1'))) = 0, 'Người khác không xem lịch sử phiếu');
reset role;
set role anon;
select tests.assert_fails($$select * from public.purchase_request_list$$, 'Khách vãng lai không xem được phiếu');
reset role;

-- Móc mở rộng: loại yêu cầu mới tự xử lý qua private.on_approval_<entity_type>
create table tests.hook_log (request_id uuid, entity_id uuid, action text, comment text);
create function private.on_approval_test_hook(p_request uuid, p_entity uuid, p_action text, p_comment text) returns void
language sql security definer set search_path = '' as $$ insert into tests.hook_log values (p_request, p_entity, p_action, p_comment) $$;
insert into public.approval_types (code, name) values ('test_hook', 'Thử móc');
insert into public.approval_rules (approval_type_id, level, approver_role_id) select id, 1, (select id from public.roles where code = 'director') from public.approval_types where code = 'test_hook';
insert into t_pr select 'h1', private.submit_approval('test_hook', 'test_hook', gen_random_uuid(), null, 0, 'Thử móc', '00000000-0000-0000-0000-0000000000d1', null, null)::text;
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select public.approval_decide((select v::uuid from t_pr where k = 'h1'), 'approve', 'ok');
reset role;
select tests.assert((select count(*) from tests.hook_log where request_id = (select v::uuid from t_pr where k = 'h1') and action = 'approve' and comment = 'ok') = 1,
  'Duyệt xong gọi hàm private.on_approval_<loại>');
drop function private.on_approval_test_hook(uuid, uuid, text, text);
drop table tests.hook_log;

\o
\echo TẤT CẢ KIỂM THỬ PHIẾU ĐỀ NGHỊ CHI, MUA SẮM ĐỀU ĐẠT
