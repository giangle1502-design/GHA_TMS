-- =============================================================================
-- Kiểm thử 0018: chi phí tài xế gắn với bước Hoàn thành chuyến.
-- Chạy sau 07/08: chuyến s2 (Tài xế A, xe mặc định XE001) đang ở trạng thái Đã phân công.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

create temp table t_ex (k text primary key, v text);
grant all on t_ex to anon, authenticated;
insert into t_ex select 's2', id::text from public.shipments
 where vehicle_id is null and driver_id = '40000000-0000-0000-0000-000000000001' and status = 'assigned' order by created_at desc limit 1;
insert into t_ex select 'cat_' || code, id::text from public.expense_categories where code in ('TOLL', 'MEAL', 'WASH');
update public.expense_categories set requires_image = false where code = 'MEAL';

select set_config('request.jwt.claim.sub', '', false);
set role anon;
insert into t_ex select 'tok', public.driver_link_login('51C12345') ->> 'token';
select public.driver_link_accept((select v from t_ex where k = 'tok'), (select v::uuid from t_ex where k = 's2'));
select public.driver_link_start((select v from t_ex where k = 'tok'), (select v::uuid from t_ex where k = 's2'));
select tests.assert((public.driver_link_add_expense((select v from t_ex where k = 'tok'), (select v::uuid from t_ex where k = 's2'),
  (select v::uuid from t_ex where k = 'cat_MEAL'), 50000) ->> 'error') like '%Hoàn thành chuyến%', 'Chưa hoàn thành chuyến thì chưa nhập chi phí');
insert into t_ex select 'ticket', public.driver_link_upload_ticket((select v from t_ex where k = 'tok'), (select v::uuid from t_ex where k = 's2'), 'delivery') ->> 'ticket';
insert into storage.objects (bucket_id, name, metadata)
values ('documents', 'tx/' || (select v from t_ex where k = 'ticket') || '/photo-' || gen_random_uuid() || '.jpg', '{"mimetype":"image/jpeg","size":120000}');
select tests.assert((public.driver_link_complete((select v from t_ex where k = 'tok'), (select v::uuid from t_ex where k = 's2'),
  (select v::uuid from t_ex where k = 'ticket'), 'full', null) ->> 'ok')::boolean = false, 'Không khai chi phí thì không hoàn thành được');
select tests.assert((public.driver_link_complete((select v from t_ex where k = 'tok'), (select v::uuid from t_ex where k = 's2'),
  (select v::uuid from t_ex where k = 'ticket'), 'full', null, true) ->> 'ok')::boolean, 'Hoàn thành chuyến, xác nhận không phát sinh chi phí');
select tests.assert((select expense_declaration = 'none' and expense_count = 0 from public.driver_link_trips((select v from t_ex where k = 'tok'))
  where shipment_id = (select v::uuid from t_ex where k = 's2')), 'Thẻ chuyến hiện "không phát sinh chi phí"');
reset role;
select tests.assert(exists (select 1 from public.shipment_status_history where shipment_id = (select v::uuid from t_ex where k = 's2')
  and note like '%không phát sinh chi phí%'), 'Lịch sử chuyến ghi xác nhận không phát sinh chi phí');

-- Bổ sung chi phí sau khi đã xác nhận không có
set role anon;
insert into t_ex select 'e1', public.driver_link_add_expense((select v from t_ex where k = 'tok'), (select v::uuid from t_ex where k = 's2'),
  (select v::uuid from t_ex where k = 'cat_MEAL'), 50000, 'Cơm trưa') ->> 'code';
select tests.assert((select expense_declaration = 'has' and expense_count = 1 and expense_total = 50000 from public.driver_link_trips((select v from t_ex where k = 'tok'))
  where shipment_id = (select v::uuid from t_ex where k = 's2')), 'Bổ sung chi phí: thẻ chuyến chuyển sang có chi phí, đúng tổng');
reset role;
insert into t_ex select 'e1id', id::text from public.shipment_expenses where code = (select v from t_ex where k = 'e1');
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((select (x ->> 'editable')::boolean from jsonb_array_elements(public.driver_me_finance() -> 'expenses') x
  where x ->> 'code' = (select v from t_ex where k = 'e1')), 'Khoản chờ duyệt hiện nút Sửa');

-- Sửa: hủy khoản cũ, tạo khoản mới
insert into t_ex select 'e2', public.driver_me_update_expense((select v::uuid from t_ex where k = 'e1id'),
  (select v::uuid from t_ex where k = 'cat_MEAL'), 70000, 'Cơm trưa + nước') ->> 'code';
select tests.assert((select v from t_ex where k = 'e2') is not null, 'Sửa khoản chi phí thành công');
select tests.assert((select expense_count = 1 and expense_total = 70000 from public.driver_link_trips((select v from t_ex where k = 'tok'))
  where shipment_id = (select v::uuid from t_ex where k = 's2')), 'Sau khi sửa chỉ còn 1 khoản, số tiền mới');
select tests.assert((public.driver_me_update_expense((select v::uuid from t_ex where k = 'e1id'),
  (select v::uuid from t_ex where k = 'cat_MEAL'), 10000) ->> 'ok')::boolean = false, 'Khoản đã sửa (đã hủy) không sửa lại được');
reset role;
select tests.assert((select status from public.shipment_expenses where code = (select v from t_ex where k = 'e1')) = 'cancelled', 'Khoản cũ giữ lại ở trạng thái Đã hủy');
select tests.assert((select note like '%(sửa từ ' || (select v from t_ex where k = 'e1') || ')' from public.shipment_expenses where code = (select v from t_ex where k = 'e2')),
  'Khoản mới ghi sửa từ khoản nào');
select tests.assert((select r.status from public.approval_requests r join public.shipment_expenses e on e.approval_request_id = r.id
  where e.code = (select v from t_ex where k = 'e1')) = 'cancelled', 'Yêu cầu duyệt của khoản cũ bị hủy');

-- Khoản đã được Giám đốc duyệt: không sửa, không hủy
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select public.approval_decide((select approval_request_id from public.shipment_expenses where code = (select v from t_ex where k = 'e2')), 'approve');
reset role;
insert into t_ex select 'e2id', id::text from public.shipment_expenses where code = (select v from t_ex where k = 'e2');
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;

select tests.assert((public.driver_me_update_expense((select v::uuid from t_ex where k = 'e2id'),
  (select v::uuid from t_ex where k = 'cat_MEAL'), 10000) ->> 'ok')::boolean = false, 'Khoản đã duyệt không sửa được');
select tests.assert((public.driver_me_cancel('expense', (select v::uuid from t_ex where k = 'e2id')) ->> 'ok')::boolean = false,
  'Khoản đã duyệt không hủy được');

-- Loại không cần duyệt: hủy được khi chưa vào bảng lương
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
insert into t_ex select 'e3', public.driver_link_add_expense((select v from t_ex where k = 'tok'), (select v::uuid from t_ex where k = 's2'),
  (select v::uuid from t_ex where k = 'cat_WASH'), 80000) ->> 'code';
reset role;
insert into t_ex select 'e3id', id::text from public.shipment_expenses where code = (select v from t_ex where k = 'e3');
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;

select tests.assert((public.driver_me_cancel('expense', (select v::uuid from t_ex where k = 'e3id')) ->> 'ok')::boolean,
  'Hủy được khoản loại không cần duyệt');

-- Văn phòng đóng chuyến: không bổ sung, không sửa nữa
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
insert into t_ex select 'e4', public.driver_link_add_expense((select v from t_ex where k = 'tok'), (select v::uuid from t_ex where k = 's2'),
  (select v::uuid from t_ex where k = 'cat_MEAL'), 30000) ->> 'code';
reset role;
insert into t_ex select 'e4id', id::text from public.shipment_expenses where code = (select v from t_ex where k = 'e4');
update public.shipments set status = 'closed' where id = (select v::uuid from t_ex where k = 's2');
set role anon;
select tests.assert((public.driver_link_add_expense((select v from t_ex where k = 'tok'), (select v::uuid from t_ex where k = 's2'),
  (select v::uuid from t_ex where k = 'cat_MEAL'), 30000) ->> 'error') like '%đóng%', 'Chuyến đã đóng không bổ sung chi phí');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((public.driver_me_update_expense((select v::uuid from t_ex where k = 'e4id'),
  (select v::uuid from t_ex where k = 'cat_MEAL'), 10000) ->> 'ok')::boolean = false, 'Chuyến đã đóng không sửa chi phí');
select tests.assert((public.driver_me_cancel('expense', (select v::uuid from t_ex where k = 'e4id')) ->> 'ok')::boolean = false,
  'Chuyến đã đóng không hủy chi phí');

-- Tài xế khác, người chưa đăng nhập không sửa được chi phí của Tài xế A
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b2');
set role authenticated;
select tests.assert((public.driver_me_update_expense((select v::uuid from t_ex where k = 'e2id'),
  (select v::uuid from t_ex where k = 'cat_MEAL'), 10000) ->> 'ok')::boolean = false, 'Tài xế khác không sửa được chi phí');
select tests.assert((public.driver_me_cancel('expense', (select v::uuid from t_ex where k = 'e2id')) ->> 'ok')::boolean = false, 'Tài xế khác không hủy được chi phí');
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select tests.assert_fails($$select public.driver_me_update_expense((select v::uuid from t_ex where k = 'e2id'), (select v::uuid from t_ex where k = 'cat_MEAL'), 10000)$$,
  'Người chưa đăng nhập không sửa được');
select tests.assert_fails($$select public.driver_me_request_advance(100000, 'x')$$, 'Link biển số không xin ứng tiền được');
reset role;

-- Gắn tài khoản Google theo email trong hồ sơ tài xế (không cần lời mời)
update public.drivers set email = 'TaiXe.Moi@Gmail.com ' where id = '40000000-0000-0000-0000-000000000002' and profile_id is null;
insert into public.drivers (id, code, full_name, email) values ('40000000-0000-0000-0000-000000000009', 'TX009', 'Tài xế Mới', 'taixe.moi2@gmail.com');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b9', 'taixe.moi2@gmail.com');
select tests.assert((select profile_id from public.drivers where id = '40000000-0000-0000-0000-000000000009') = '00000000-0000-0000-0000-0000000000b9',
  'Đăng nhập Google lần đầu: email trùng hồ sơ tài xế thì tự gắn');
select tests.assert((select status from public.profiles where id = '00000000-0000-0000-0000-0000000000b9') = 'active', 'Tài khoản tài xế tự kích hoạt');
select tests.assert((select array_agg(r.code) from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = '00000000-0000-0000-0000-0000000000b9') = '{driver}',
  'Chỉ được vai trò Tài xế');
select tests.login('00000000-0000-0000-0000-0000000000b9');
set role authenticated;
select tests.assert((public.driver_me() ->> 'driver_name') = 'Tài xế Mới', 'Tài xế mới đăng nhập thấy tên mình');
select tests.assert((public.driver_me_request_advance(300000, 'Ứng tiền dầu, chưa có chuyến') ->> 'ok')::boolean, 'Ứng tiền khi chưa có chuyến, không cần xe');
select tests.assert((public.driver_me_finance() -> 'advances' -> 0 ->> 'amount')::numeric = 300000, 'Thấy yêu cầu ứng của mình');
reset role;
-- Đăng nhập trước, văn phòng ghi email sau
insert into public.drivers (id, code, full_name) values ('40000000-0000-0000-0000-000000000008', 'TX008', 'Tài xế Sau');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b8', 'taixe.sau@gmail.com');
select tests.login('00000000-0000-0000-0000-0000000000b8');
set role authenticated;
select tests.assert((public.driver_me() ->> 'ok')::boolean = false, 'Email chưa có trong hồ sơ tài xế thì chưa vào được trang tiền');
reset role;
update public.drivers set email = 'taixe.sau@gmail.com' where id = '40000000-0000-0000-0000-000000000008';
set role authenticated;
select tests.assert((public.driver_me() ->> 'driver_name') = 'Tài xế Sau', 'Văn phòng ghi email xong thì tài xế vào được ngay');
reset role;
-- Hai hồ sơ trùng email: không tự gắn
insert into public.drivers (code, full_name, email) values ('TX007', 'Trùng 1', 'trung@gmail.com'), ('TX006', 'Trùng 2', 'trung@gmail.com');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b7', 'trung@gmail.com');
select tests.assert((select count(*) from public.drivers where email = 'trung@gmail.com' and profile_id is not null) = 0, 'Email trùng 2 hồ sơ thì không tự gắn');
-- Tài khoản bị khóa không tự mở lại
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set status = 'disabled' where id = '00000000-0000-0000-0000-0000000000b8';
select tests.login('00000000-0000-0000-0000-0000000000b8');
set role authenticated;
select tests.assert((public.driver_me() ->> 'ok')::boolean = false, 'Tài khoản bị khóa không vào được trang tiền');
reset role;

-- Xe thuê ngoài 3PL: không ứng tiền, không nhập chi phí
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into t_ex select 's1', id::text from public.shipments
 where vehicle_id = '50000000-0000-0000-0000-000000000001' and status = 'driver_completed' order by completed_at desc limit 1;
update public.vehicles set ownership_type = 'outsourced' where id = '50000000-0000-0000-0000-000000000001';
set role anon;
insert into t_ex select 'tok3', public.driver_link_login('51C12345') ->> 'token';
select tests.assert((select outsourced from public.driver_link_trips((select v from t_ex where k = 'tok3')) where shipment_id = (select v::uuid from t_ex where k = 's1')),
  'Thẻ chuyến biết chuyến chạy xe 3PL');
select tests.assert((public.driver_link_add_expense((select v from t_ex where k = 'tok3'), (select v::uuid from t_ex where k = 's1'),
  (select v::uuid from t_ex where k = 'cat_MEAL'), 30000) ->> 'error') like '%3PL%', 'Chuyến xe 3PL không nhập chi phí');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((public.driver_me_request_advance(100000, 'Ứng cho chuyến 3PL', (select v::uuid from t_ex where k = 's1')) ->> 'error') like '%3PL%',
  'Chuyến xe 3PL không ứng tiền');
select tests.assert(not exists (select 1 from jsonb_array_elements(public.driver_me_finance() -> 'trips') x where x ->> 'id' = (select v from t_ex where k = 's1')),
  'Danh sách chuyến để ứng tiền bỏ chuyến xe 3PL');
reset role;
-- Hoàn thành chuyến xe 3PL không cần khai chi phí
insert into public.shipments (id, order_id, sequence_in_order, pickup_at, pickup_location_id, delivery_location_id, vehicle_type_id, unit_price, driver_id, vehicle_id)
values ('70000000-0000-0000-0000-000000000039', '60000000-0000-0000-0000-000000000001', 39, now(), '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000001', 3500000, '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001');
update public.shipments set status = 'assigned' where id = '70000000-0000-0000-0000-000000000039';
update public.shipments set status = 'accepted' where id = '70000000-0000-0000-0000-000000000039';
update public.shipments set status = 'in_transit' where id = '70000000-0000-0000-0000-000000000039';
set role anon;
insert into t_ex select 'ticket3', public.driver_link_upload_ticket((select v from t_ex where k = 'tok3'), '70000000-0000-0000-0000-000000000039', 'delivery') ->> 'ticket';
insert into storage.objects (bucket_id, name, metadata)
values ('documents', 'tx/' || (select v from t_ex where k = 'ticket3') || '/photo-' || gen_random_uuid() || '.jpg', '{"mimetype":"image/jpeg","size":120000}');
select tests.assert((public.driver_link_complete((select v from t_ex where k = 'tok3'), '70000000-0000-0000-0000-000000000039',
  (select v::uuid from t_ex where k = 'ticket3'), 'full', null) ->> 'ok')::boolean, 'Hoàn thành chuyến xe 3PL không cần khai chi phí');
reset role;
select tests.assert((select status = 'driver_completed' and expense_declaration is null from public.shipments where id = '70000000-0000-0000-0000-000000000039'),
  'Chuyến xe 3PL không ghi khai báo chi phí');
update public.vehicles set ownership_type = 'owned' where id = '50000000-0000-0000-0000-000000000001';

\o
\echo 'TẤT CẢ KIỂM THỬ CHI PHÍ KHI HOÀN THÀNH CHUYẾN ĐỀU ĐẠT'
