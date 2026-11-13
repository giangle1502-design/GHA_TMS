-- =============================================================================
-- Kiểm thử Giai đoạn 5 (bắt đầu/hoàn thành chuyến, ảnh giao hàng) và Giai đoạn 6
-- (tài xế xin ứng tiền, nhập chi phí -> Giám đốc duyệt -> Kế toán chuyển tiền).
-- Chạy sau 05: chuyến s1 của xe XE001 (51C-123.45, Tài xế A) đang ở trạng thái Đã nhận.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

create temp table t_fin (k text primary key, v text);
grant all on t_fin to anon, authenticated;
insert into t_fin select 's1', id::text from public.shipments
 where vehicle_id = '50000000-0000-0000-0000-000000000001' and status = 'accepted' order by created_at desc limit 1;
insert into t_fin select 's2', id::text from public.shipments
 where vehicle_id is null and driver_id = '40000000-0000-0000-0000-000000000001' and status = 'assigned' order by created_at desc limit 1;

-- Ngày nhận hàng trong 04 cố định (21/10/2026); dời về hôm nay để thẻ chuyến vẫn hiện chuyến đã xong (3 ngày gần đây)
update public.shipments set pickup_at = now(), expected_delivery_at = null
 where id in ((select v::uuid from t_fin where k = 's1'), (select v::uuid from t_fin where k = 's2'));

-- Giám đốc
select tests.login('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select public.invite_user('giamdoc@khanhha.test', '{director}');
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'giamdoc@khanhha.test');

-- Điện thoại xe XE001 mở link
select set_config('request.jwt.claim.sub', '', false);
set role anon;
insert into t_fin select 'tok', public.driver_link_login('51C12345') ->> 'token';
select tests.assert((public.driver_link_complete((select v from t_fin where k = 'tok'), (select v::uuid from t_fin where k = 's1'), null) ->> 'ok')::boolean = false,
  'Chưa bắt đầu chạy thì không hoàn thành được');
select tests.assert((public.driver_link_start((select v from t_fin where k = 'tok'), (select v::uuid from t_fin where k = 's2')) ->> 'ok')::boolean = false,
  'Không bắt đầu được chuyến chưa nhận');
select tests.assert((public.driver_link_start((select v from t_fin where k = 'tok'), (select v::uuid from t_fin where k = 's1')) ->> 'ok')::boolean,
  'Bấm Bắt đầu chạy thành công');
reset role;
select tests.assert((select status from public.shipments where id = (select v::uuid from t_fin where k = 's1')) = 'in_transit', 'Chuyến chuyển sang Đang chạy');
select tests.assert((select departed_pickup_at is not null from public.shipments where id = (select v::uuid from t_fin where k = 's1')), 'Ghi giờ bắt đầu chạy');
select tests.assert((select note from public.shipment_status_history where shipment_id = (select v::uuid from t_fin where k = 's1') and to_status = 'in_transit') = 'Tài xế A bắt đầu chạy trên điện thoại',
  'Lịch sử ghi tài xế bắt đầu chạy');

-- Vé tải ảnh và chính sách Storage
set role anon;
insert into t_fin select 'ticket', public.driver_link_upload_ticket((select v from t_fin where k = 'tok'), (select v::uuid from t_fin where k = 's1'), 'delivery') ->> 'ticket';
select tests.assert((select v from t_fin where k = 'ticket') is not null, 'Xin được vé tải ảnh');
select tests.assert((public.driver_link_upload_ticket('ma-phien-sai-ma-phien-sai-ma-phien-sai-123', null, 'delivery') ->> 'ok')::boolean = false,
  'Phiên sai không xin được vé');
select tests.assert(private.driver_upload_ok('tx/' || (select v from t_fin where k = 'ticket') || '/photo-' || gen_random_uuid() || '.jpg'), 'Tên tệp đúng vé được nhận');
select tests.assert(not private.driver_upload_ok('tx/' || gen_random_uuid() || '/photo-' || gen_random_uuid() || '.jpg'), 'Vé bịa không tải lên được');
select tests.assert(not private.driver_upload_ok('tx/' || (select v from t_fin where k = 'ticket') || '/../cccd.jpg'), 'Tên tệp lạ bị từ chối');
select tests.assert(not private.driver_upload_ok('vehicle/x/photo.jpg'), 'Ngoài thư mục tx bị từ chối');
reset role;
insert into storage.buckets (id, name) values ('documents', 'documents') on conflict do nothing;
set role anon;
select tests.assert_fails($$insert into storage.objects (bucket_id, name) values ('documents', 'tx/' || gen_random_uuid() || '/photo-' || gen_random_uuid() || '.jpg')$$,
  'Storage chặn tải lên không có vé');
insert into storage.objects (bucket_id, name, metadata)
values ('documents', 'tx/' || (select v from t_fin where k = 'ticket') || '/photo-' || gen_random_uuid() || '.jpg', '{"mimetype":"image/jpeg","size":120000}'),
       ('documents', 'tx/' || (select v from t_fin where k = 'ticket') || '/delivery_note-' || gen_random_uuid() || '.jpg', '{"mimetype":"image/jpeg","size":90000}');

select tests.assert((public.driver_link_complete((select v from t_fin where k = 'tok'), (select v::uuid from t_fin where k = 's1'), null) ->> 'error') like '%Không phát sinh chi phí%',
  'Hoàn thành chuyến phải khai có hay không có chi phí');
select tests.assert((public.driver_link_complete((select v from t_fin where k = 'tok'), (select v::uuid from t_fin where k = 's1'), null, p_no_expense => false) ->> 'error') like '%ít nhất 1 ảnh%',
  'Hoàn thành chuyến bắt buộc có ảnh');
select tests.assert((public.driver_link_complete((select v from t_fin where k = 'tok'), (select v::uuid from t_fin where k = 's1'),
  (select v::uuid from t_fin where k = 'ticket'), 'partial', '', false) ->> 'ok')::boolean = false, 'Giao thiếu phải ghi lý do');
select tests.assert((public.driver_link_complete((select v from t_fin where k = 'tok'), (select v::uuid from t_fin where k = 's1'),
  (select v::uuid from t_fin where k = 'ticket'), 'full', 'Đã giao đủ', false) ->> 'photos')::int = 2, 'Hoàn thành chuyến kèm 2 ảnh');
select tests.assert(not private.driver_upload_ok('tx/' || (select v from t_fin where k = 'ticket') || '/photo-' || gen_random_uuid() || '.jpg'), 'Vé đã dùng không tải thêm được');
select tests.assert((select photo_count from public.driver_link_trips((select v from t_fin where k = 'tok')) where shipment_id = (select v::uuid from t_fin where k = 's1')) = 2,
  'Thẻ chuyến hiện số ảnh đã gửi');
reset role;
select tests.assert((select status = 'driver_completed' and document_status = 'submitted' and delivery_result = 'full' and completed_at is not null
  from public.shipments where id = (select v::uuid from t_fin where k = 's1')), 'Chuyến Tài xế đã xong, chứng từ Đã nộp');
select tests.assert((select count(*) from public.documents where entity_type = 'shipment' and entity_id = (select v::uuid from t_fin where k = 's1') and doc_type in ('photo', 'delivery_note')) = 2,
  'Ảnh giao hàng và phiếu ký nhận lưu thành chứng từ của chuyến');
select tests.assert(exists (select 1 from public.notifications where type = 'shipment_completed' and entity_id = (select v::uuid from t_fin where k = 's1')),
  'Điều phối nhận thông báo hoàn thành chuyến');

-- ---------------------------------------------------------------------------
-- Ứng tiền: tài xế gửi -> Giám đốc duyệt -> Kế toán chuyển tiền
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((public.driver_me_request_advance(0, 'Dầu') ->> 'ok')::boolean = false, 'Số tiền ứng 0 bị từ chối');
insert into t_fin values ('cr1', gen_random_uuid()::text);
select tests.assert((public.driver_me_request_advance(2000000, 'Ứng tiền dầu chuyến Bình Dương', null, (select v::uuid from t_fin where k = 'cr1')) ->> 'ok')::boolean,
  'Tài xế gửi yêu cầu ứng tiền');
select public.driver_me_request_advance(2000000, 'Ứng tiền dầu chuyến Bình Dương', null, (select v::uuid from t_fin where k = 'cr1'));
reset role;
select tests.assert((select count(*) from public.advance_requests where client_request_id = (select v::uuid from t_fin where k = 'cr1')) = 1, 'Gửi trùng (mạng chập chờn) chỉ tạo 1 yêu cầu');
insert into t_fin select 'adv', id::text from public.advance_requests where client_request_id = (select v::uuid from t_fin where k = 'cr1');
insert into t_fin select 'apr', approval_request_id::text from public.advance_requests where id = (select v::uuid from t_fin where k = 'adv');
select tests.assert((select status = 'pending' and requested_driver_id = '40000000-0000-0000-0000-000000000001' and levels = '{1}'
  from public.approval_requests where id = (select v::uuid from t_fin where k = 'apr')), 'Yêu cầu phê duyệt chờ Giám đốc (1 cấp)');
select tests.assert(exists (select 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000e1' and type = 'approval_pending'),
  'Giám đốc nhận thông báo chờ duyệt');
select tests.assert(not exists (select 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000c1' and type = 'approval_pending'),
  'Kế toán không nhận thông báo duyệt (chỉ Giám đốc duyệt)');

-- Kế toán không duyệt được, cũng chưa chuyển tiền được
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((select can_approve from public.approval_list where id = (select v::uuid from t_fin where k = 'apr')) = false, 'Kế toán không thấy nút duyệt');
select tests.assert_fails($$select public.approval_decide((select v::uuid from t_fin where k = 'apr'), 'approve')$$, 'Kế toán không duyệt được');
select tests.assert_fails($$select public.pay_advance((select v::uuid from t_fin where k = 'adv'))$$, 'Chưa duyệt thì chưa chuyển tiền được');
reset role;

-- Giám đốc duyệt, giảm còn 1.500.000
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert((select can_approve and approver_label = 'Giám đốc' and requester_name = 'Tài xế A (tài xế)' from public.approval_list where id = (select v::uuid from t_fin where k = 'apr')),
  'Giám đốc thấy yêu cầu, được duyệt; biết người gửi là tài xế');
select tests.assert_fails($$select public.approval_decide((select v::uuid from t_fin where k = 'apr'), 'approve', null, 3000000)$$, 'Không duyệt vượt số tiền xin');
select public.approval_decide((select v::uuid from t_fin where k = 'apr'), 'approve', 'Đồng ý', 1500000);
select tests.assert_fails($$select public.approval_decide((select v::uuid from t_fin where k = 'apr'), 'approve')$$, 'Không duyệt lại lần hai');
select tests.assert_fails($$select public.pay_advance((select v::uuid from t_fin where k = 'adv'))$$, 'Giám đốc không có quyền chuyển tiền');
reset role;
select tests.assert((select status = 'approved' and amount_approved = 1500000 from public.advance_requests where id = (select v::uuid from t_fin where k = 'adv')),
  'Ứng tiền đã duyệt 1.500.000');
select tests.assert(exists (select 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000c1' and type = 'advance_to_pay'),
  'Kế toán nhận thông báo chờ chuyển tiền');

select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((select can_pay from public.advance_list where id = (select v::uuid from t_fin where k = 'adv')), 'Kế toán thấy nút chuyển tiền');
insert into t_fin select 'pay', public.pay_advance((select v::uuid from t_fin where k = 'adv'), null, null, 'FT2610220001');
select tests.assert_fails($$select public.pay_advance((select v::uuid from t_fin where k = 'adv'))$$, 'Không chuyển tiền hai lần');
select tests.assert((select status = 'paid' and payment_code = (select v from t_fin where k = 'pay') and amount_to_pay = 1500000 from public.advance_list where id = (select v::uuid from t_fin where k = 'adv')),
  'Danh sách ứng tiền hiện đã chuyển kèm mã phiếu chi');
reset role;
select tests.assert((select sum(amount) from public.advance_transactions where advance_request_id = (select v::uuid from t_fin where k = 'adv')) = 1500000,
  'Sổ tạm ứng ghi nhận 1.500.000 đã chuyển cho tài xế');
select tests.assert((select status from public.approval_requests where id = (select v::uuid from t_fin where k = 'apr')) = 'paid', 'Yêu cầu phê duyệt chuyển Đã thanh toán');

-- Từ chối có lý do
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select public.driver_me_request_advance(500000, 'Ứng ăn uống');
reset role;
insert into t_fin select 'apr2', approval_request_id::text from public.advance_requests where amount_requested = 500000;
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert_fails($$select public.approval_decide((select v::uuid from t_fin where k = 'apr2'), 'reject', '  ')$$, 'Từ chối phải có lý do');
select public.approval_decide((select v::uuid from t_fin where k = 'apr2'), 'reject', 'Đã ứng đủ trong tuần');
reset role;
select tests.assert((select status from public.advance_requests where amount_requested = 500000) = 'rejected', 'Yêu cầu bị từ chối');

-- ---------------------------------------------------------------------------
-- Chi phí do tài xế nhập
-- ---------------------------------------------------------------------------
update public.expense_categories set requires_approval = false where code = 'WASH';
select tests.assert(not exists (select 1 from public.expense_categories where requires_image), 'Mặc định mọi loại chi phí không bắt buộc ảnh biên lai');
-- Quản lý bật "Bắt buộc ảnh chứng từ" cho cầu đường
update public.expense_categories set requires_image = true where code = 'TOLL';
insert into t_fin select 'cat_' || code, id::text from public.expense_categories where code in ('TOLL', 'MEAL', 'WASH');
set role anon;
select tests.assert((public.driver_link_add_expense((select v from t_fin where k = 'tok'), (select v::uuid from t_fin where k = 's1'),
  (select v::uuid from t_fin where k = 'cat_TOLL'), 120000, 'BOT', null) ->> 'error') like '%cần ảnh%', 'Loại chi phí bắt buộc ảnh thì phải có ảnh');
select tests.assert((public.driver_link_add_expense((select v from t_fin where k = 'tok'), (select v::uuid from t_fin where k = 's2'),
  (select v::uuid from t_fin where k = 'cat_MEAL'), 50000) ->> 'ok')::boolean = false, 'Không nhập chi phí cho chuyến chưa nhận');
insert into t_fin select 'ticket2', public.driver_link_upload_ticket((select v from t_fin where k = 'tok'), (select v::uuid from t_fin where k = 's1'), 'expense') ->> 'ticket';
insert into storage.objects (bucket_id, name, metadata)
values ('documents', 'tx/' || (select v from t_fin where k = 'ticket2') || '/receipt-' || gen_random_uuid() || '.jpg', '{"mimetype":"image/jpeg","size":80000}');
select tests.assert((public.driver_link_add_expense((select v from t_fin where k = 'tok'), (select v::uuid from t_fin where k = 's1'),
  (select v::uuid from t_fin where k = 'cat_TOLL'), 120000, 'BOT Bình Dương', (select v::uuid from t_fin where k = 'ticket2')) ->> 'needs_approval')::boolean,
  'Nhập chi phí cầu đường kèm biên lai, chờ duyệt');
select tests.assert((public.driver_link_add_expense((select v from t_fin where k = 'tok'), (select v::uuid from t_fin where k = 's1'),
  (select v::uuid from t_fin where k = 'cat_WASH'), 80000) ->> 'needs_approval')::boolean = false,
  'Loại chi phí đã tắt duyệt thì không cần duyệt');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((public.driver_me_finance() -> 'month' ->> 'expense_pending')::numeric = 120000, 'Tài xế đăng nhập thấy chi phí chờ duyệt');
select tests.assert((public.driver_me_finance() -> 'month' ->> 'advance_paid')::numeric = 1500000, 'Tài xế đăng nhập thấy tiền đã ứng trong tháng');
reset role;
select tests.assert((select status from public.shipment_expenses e join public.expense_categories c on c.id = e.category_id where c.code = 'WASH') = 'approved', 'Chi phí rửa xe tự duyệt');
select tests.assert((select count(*) from public.documents d join public.shipment_expenses e on e.id = d.entity_id where d.entity_type = 'shipment_expense') = 1,
  'Biên lai lưu thành chứng từ của chi phí');
insert into t_fin select 'apr3', approval_request_id::text from public.shipment_expenses e join public.expense_categories c on c.id = e.category_id where c.code = 'TOLL';
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert_fails($$select public.approval_decide((select v::uuid from t_fin where k = 'apr3'), 'approve', null, 100000)$$, 'Không sửa số tiền khi duyệt chi phí');
select public.approval_decide((select v::uuid from t_fin where k = 'apr3'), 'approve');
reset role;
select tests.assert((select status from public.shipment_expenses e join public.expense_categories c on c.id = e.category_id where c.code = 'TOLL') = 'approved', 'Giám đốc duyệt chi phí');

-- Hủy yêu cầu đang chờ
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select public.driver_me_request_advance(300000, 'Ứng thử để hủy');
reset role;
insert into t_fin select 'adv3', id::text from public.advance_requests where amount_requested = 300000;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((public.driver_me_cancel('advance', (select v::uuid from t_fin where k = 'adv3')) ->> 'ok')::boolean, 'Tài xế hủy yêu cầu đang chờ');
select tests.assert((public.driver_me_cancel('advance', (select v::uuid from t_fin where k = 'adv')) ->> 'ok')::boolean = false, 'Không hủy được khoản đã chuyển tiền');
reset role;

-- Nhân viên tạo ứng tiền: không tự duyệt được khoản của mình
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
insert into t_fin select 'adv4', public.create_advance_request('40000000-0000-0000-0000-000000000002', 700000, 'Ứng hộ tài xế B')::text;
select tests.assert_fails($$select public.approval_decide((select approval_request_id from public.advance_requests where id = (select v::uuid from t_fin where k = 'adv4')), 'approve')$$,
  'Người tạo không tự duyệt được');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.create_advance_request('40000000-0000-0000-0000-000000000002', 700000, 'x')$$, 'Điều phối không tạo được ứng tiền');
select tests.assert((select count(*) from public.expense_list) >= 2, 'Điều phối xem được danh sách chi phí');
reset role;
set role anon;
select tests.assert_fails($$select count(*) from public.advance_list$$, 'Người ngoài không xem được danh sách ứng tiền');
select tests.assert_fails($$select public.approval_decide((select v::uuid from t_fin where k = 'apr'), 'approve')$$, 'Người ngoài không gọi được hàm duyệt');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ ỨNG TIỀN, CHI PHÍ, HOÀN THÀNH CHUYẾN ĐỀU ĐẠT'
