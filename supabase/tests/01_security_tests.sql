-- =============================================================================
-- Kiểm thử bảo mật & ràng buộc nghiệp vụ cốt lõi (chạy bằng scripts/test-db.sh)
-- Mỗi khối mô phỏng một người dùng bằng request.jwt.claim.sub + role authenticated.
-- Bất kỳ assert nào sai sẽ dừng script với mã lỗi khác 0.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

create or replace function tests.assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then
    raise exception 'FAIL: %', msg;
  end if;
  raise notice 'PASS: %', msg;
end $$;
grant execute on function tests.assert(boolean, text) to authenticated, anon;

-- Chạy một câu lệnh và kiểm tra nó PHẢI bị từ chối
create or replace function tests.assert_fails(stmt text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS: % (bị chặn: %)', msg, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (câu lệnh lẽ ra phải bị chặn)', msg;
end $$;
grant execute on function tests.assert_fails(text, text) to authenticated, anon;

create or replace function tests.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid::text, false);
$$;
grant execute on function tests.login(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Chuẩn bị: mời Super Admin (thao tác trong SQL editor), tạo tài khoản đăng nhập
-- ---------------------------------------------------------------------------
insert into public.user_invitations (email, role_codes, note) values ('owner@khanhha.test', '{super_admin}', 'Bootstrap');

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'Owner@KhanhHa.test', '{"full_name":"Chủ doanh nghiệp"}'),
  ('00000000-0000-0000-0000-0000000000f1', 'stranger@gmail.com', '{"full_name":"Người lạ"}');

select tests.assert((select status from public.profiles where id = '00000000-0000-0000-0000-0000000000a1') = 'active',
  'Email được mời trước -> đăng nhập lần đầu được kích hoạt');
select tests.assert((select status from public.profiles where id = '00000000-0000-0000-0000-0000000000f1') = 'pending',
  'Tài khoản Google chưa được mời -> trạng thái chờ cấp quyền');
select tests.assert(exists (select 1 from public.notifications n where n.recipient_id = '00000000-0000-0000-0000-0000000000a1' and n.type = 'user.pending'),
  'Super Admin nhận thông báo có tài khoản chờ cấp quyền');

-- Dữ liệu danh mục tối thiểu (do quản trị viên nhập)
insert into public.customers (id, code, name) values
  ('10000000-0000-0000-0000-000000000001', 'KH001', 'Khách hàng A'),
  ('10000000-0000-0000-0000-000000000002', 'KH002', 'Khách hàng B');
insert into public.locations (id, code, name, full_address) values
  ('20000000-0000-0000-0000-000000000001', 'DD001', 'Kho Bình Dương', 'KCN VSIP, Bình Dương'),
  ('20000000-0000-0000-0000-000000000002', 'DD002', 'Cảng Cát Lái', 'Cát Lái, TP.HCM');
insert into public.vehicle_types (id, code, name) values ('30000000-0000-0000-0000-000000000001', 'XE8T', 'Xe tải 8 tấn');
insert into public.drivers (id, code, full_name) values
  ('40000000-0000-0000-0000-000000000001', 'TX001', 'Tài xế A'),
  ('40000000-0000-0000-0000-000000000002', 'TX002', 'Tài xế B');
insert into public.driver_sensitive (driver_id, national_id) values ('40000000-0000-0000-0000-000000000001', '079000000001');
insert into public.vehicles (id, code, plate_number, vehicle_type_id, assigned_driver_id) values
  ('50000000-0000-0000-0000-000000000001', 'XE001', '51C-123.45', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001');
insert into public.vehicle_financials (vehicle_id, purchase_price, residual_value, depreciation_months)
values ('50000000-0000-0000-0000-000000000001', 1200000000, 120000000, 120);

select tests.assert((select monthly_depreciation from public.vehicle_financials where vehicle_id = '50000000-0000-0000-0000-000000000001') = 9000000,
  'Khấu hao đường thẳng hàng tháng = (1.200tr - 120tr)/120 = 9tr');
select tests.assert((select outstanding_principal from public.vehicle_loan_summary where vehicle_id = '50000000-0000-0000-0000-000000000001') is null,
  'Chưa có lịch trả nợ -> không suy đoán dư nợ');

select tests.assert_fails($$insert into public.vehicles (code, plate_number) values ('XE002', '51c 12345')$$,
  'Biển số trùng (khác định dạng) bị chặn');

-- ---------------------------------------------------------------------------
-- Super Admin mời các vai trò
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select tests.assert(private.has_perm('users.configure'), 'Super Admin có quyền cấu hình người dùng');
select public.invite_user('admin@khanhha.test', '{admin}');
select public.invite_user('dieuphoi@khanhha.test', '{dispatcher}');
select public.invite_user('ketoan@khanhha.test', '{accountant}');
select public.invite_user('taixe.a@gmail.com', '{driver}', '40000000-0000-0000-0000-000000000001');
select public.invite_user('taixe.b@gmail.com', '{driver}', '40000000-0000-0000-0000-000000000002');
-- Kích hoạt tài khoản đã đăng nhập trước đó (đang chờ)
select public.invite_user('stranger@gmail.com', '{report_viewer}');
reset role;

select tests.assert((select status from public.profiles where id = '00000000-0000-0000-0000-0000000000f1') = 'active',
  'Mời email đã đăng nhập trước -> kích hoạt ngay');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'admin@khanhha.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'dieuphoi@khanhha.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'ketoan@khanhha.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'taixe.a@gmail.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'taixe.b@gmail.com');

select tests.assert((select profile_id from public.drivers where id = '40000000-0000-0000-0000-000000000001') = '00000000-0000-0000-0000-0000000000b1',
  'Lời mời tài xế gắn tài khoản đăng nhập với hồ sơ tài xế');

-- ---------------------------------------------------------------------------
-- Người chưa được cấp quyền / ẩn danh
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f2', 'nobody@gmail.com');
select tests.login('00000000-0000-0000-0000-0000000000f2');
set role authenticated;
select tests.assert((select count(*) from public.customers) = 0, 'Tài khoản chờ duyệt không đọc được khách hàng');
select tests.assert((select count(*) from public.my_permissions()) = 0, 'Tài khoản chờ duyệt không có quyền nào');
select tests.assert((select count(*) from public.driver_list_my_shipments()) = 0, 'Tài khoản chờ duyệt không gọi được hàm tài xế');
select tests.assert((select count(*) from public.profiles) = 1, 'Tài khoản chờ duyệt chỉ thấy hồ sơ của mình');
select tests.assert_fails($$insert into public.customers (code, name) values ('X', 'X')$$, 'Tài khoản chờ duyệt không tạo được khách hàng');
reset role;

set role anon;
select tests.assert_fails($$select count(*) from public.customers$$, 'Khách ẩn danh không truy cập được bảng');
reset role;

-- ---------------------------------------------------------------------------
-- Chống leo thang đặc quyền
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select tests.assert(private.has_perm('users.configure') and not private.is_super_admin(), 'Admin có quyền cấu hình nhưng không phải Super Admin');
select tests.assert_fails($$insert into public.user_roles (user_id, role_id) select '00000000-0000-0000-0000-0000000000a2', id from public.roles where code = 'super_admin'$$,
  'Admin không tự cấp Super Admin cho mình');
select tests.assert_fails($$insert into public.user_roles (user_id, role_id) select '00000000-0000-0000-0000-0000000000d1', id from public.roles where code = 'super_admin'$$,
  'Admin không cấp Super Admin cho người khác');
select tests.assert_fails($$delete from public.user_roles where user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  'Admin không thu hồi vai trò của Super Admin');
select tests.assert_fails($$update public.profiles set status = 'disabled' where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'Admin không khóa được Super Admin');
select tests.assert_fails($$select public.invite_user('x@khanhha.test', '{super_admin}')$$, 'Admin không mời được Super Admin');
select tests.assert_fails($$delete from public.role_permissions where role_id = (select id from public.roles where code = 'admin')$$,
  'Admin không sửa quyền của vai trò Admin');
-- Admin được cấp quyền riêng cho người khác
insert into public.user_permission_overrides (user_id, permission_code, effect, reason)
values ('00000000-0000-0000-0000-0000000000d1', 'reports.export', 'grant', 'Cho phép xuất báo cáo');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert(private.has_perm('reports.export'), 'Quyền cấp riêng có hiệu lực');
select tests.assert_fails($$update public.profiles set status = 'disabled' where id = auth.uid()$$, 'Không tự đổi trạng thái tài khoản');
select tests.assert_fails($$insert into public.user_roles (user_id, role_id) select auth.uid(), id from public.roles where code = 'admin'$$,
  'Điều phối không tự cấp vai trò Admin');
select tests.assert_fails($$insert into public.user_permission_overrides (user_id, permission_code, effect) values (auth.uid(), 'users.configure', 'grant')$$,
  'Điều phối không tự cấp quyền riêng');
update public.profiles set full_name = 'Điều phối viên 1' where id = auth.uid();
select tests.assert((select full_name from public.profiles where id = auth.uid()) = 'Điều phối viên 1', 'Người dùng tự sửa được họ tên');
select tests.assert((select count(*) from public.driver_sensitive) = 0, 'Điều phối không xem được CCCD tài xế');
select tests.assert((select count(*) from public.vehicle_financials) = 0, 'Điều phối không xem được thông tin tài chính xe');

-- ---------------------------------------------------------------------------
-- Điều phối tạo đơn hàng và Shipment
-- ---------------------------------------------------------------------------
insert into public.transport_orders (id, customer_id, payer_customer_id, dispatcher_id)
values ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', auth.uid());
insert into public.shipments (id, order_id, sequence_in_order, pickup_at, pickup_location_id, delivery_location_id, vehicle_type_id, unit_price, driver_id, vehicle_id)
values
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 1, now(), '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 3500000, '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000001', 2, now(), '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 3500000, null, null);

select tests.assert((select count(distinct shipment_code) from public.shipments) = 2, 'Hai Shipment có mã khác nhau');
select tests.assert((select bool_and(shipment_code ~ '^S[A-Z]{3}-\d{4,}$') from public.shipments), 'Mã Shipment đúng định dạng SNOV-0001');
select tests.assert((select order_code ~ '^O[A-Z]{3}-\d{4,}$' from public.transport_orders), 'Mã đơn hàng tự sinh');
select tests.assert((select created_by from public.shipments where id = '70000000-0000-0000-0000-000000000001') = auth.uid(), 'Ghi nhận người tạo chuyến');
select tests.assert_fails($$update public.shipments set shipment_code = 'SHP-X' where id = '70000000-0000-0000-0000-000000000001'$$, 'Không đổi được mã Shipment');
select tests.assert_fails($$update public.shipments set status = 'closed' where id = '70000000-0000-0000-0000-000000000001'$$, 'Không nhảy trạng thái nháp -> đã đóng');

insert into public.shipment_assignments (shipment_id, driver_id, vehicle_id, assigned_by)
values ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', auth.uid());
update public.shipments set status = 'assigned' where id = '70000000-0000-0000-0000-000000000001';
select tests.assert_fails($$insert into public.shipment_assignments (shipment_id, driver_id) values ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002')$$,
  'Một chuyến không có hai phân công còn hiệu lực');
select tests.assert((select count(*) from public.shipment_status_history where shipment_id = '70000000-0000-0000-0000-000000000001') = 2,
  'Lịch sử trạng thái ghi nhận tạo + phân công');
delete from public.shipments where id = '70000000-0000-0000-0000-000000000001';
select tests.assert(exists (select 1 from public.shipments where id = '70000000-0000-0000-0000-000000000001'), 'Không xóa cứng chuyến đã phân công (RLS)');
reset role;
select tests.assert_fails($$delete from public.shipments where id = '70000000-0000-0000-0000-000000000001'$$, 'Không xóa cứng chuyến đã phân công (trigger, kể cả chủ CSDL)');

-- ---------------------------------------------------------------------------
-- Tài xế chỉ thấy chuyến của mình
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((select count(*) from public.shipments) = 1, 'Tài xế A chỉ thấy 1 chuyến được phân công');
select tests.assert((select count(*) from public.shipment_assignments) = 1, 'Tài xế A thấy phân công của mình');
select tests.assert((select count(*) from public.drivers) = 1, 'Tài xế A chỉ thấy hồ sơ của mình');
select tests.assert((select count(*) from public.driver_sensitive) = 1, 'Tài xế A xem được CCCD của chính mình');
select tests.assert((select count(*) from public.customers) = 0, 'Tài xế không xem danh mục khách hàng');
select tests.assert((select count(*) from public.driver_list_my_shipments()) = 1, 'Hàm tài xế trả về đúng 1 chuyến của mình');
select tests.assert((select pickup_name || ' / ' || plate_number from public.driver_list_my_shipments()) = 'Kho Bình Dương / 51C-123.45', 'Hàm tài xế trả về địa điểm và biển số');
select tests.assert_fails($$insert into public.shipments (order_id, pickup_at, pickup_location_id, delivery_location_id) values ('60000000-0000-0000-0000-000000000001', now(), '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002')$$,
  'Tài xế không tạo được chuyến');
update public.shipments set driver_id = '40000000-0000-0000-0000-000000000002' where id = '70000000-0000-0000-0000-000000000001';
reset role;
select tests.assert((select driver_id from public.shipments where id = '70000000-0000-0000-0000-000000000001') = '40000000-0000-0000-0000-000000000001',
  'Tài xế không tự đổi được tài xế của chuyến');

select tests.login('00000000-0000-0000-0000-0000000000b2');
set role authenticated;
select tests.assert((select count(*) from public.shipments) = 0, 'Tài xế B không thấy chuyến của tài xế A');
select tests.assert((select count(*) from public.driver_sensitive) = 0, 'Tài xế B không xem CCCD của tài xế A');
select tests.assert((select count(*) from public.driver_list_my_shipments()) = 0, 'Hàm tài xế không trả chuyến của người khác');
reset role;

-- ---------------------------------------------------------------------------
-- Kế toán, nhật ký, thanh toán
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((select count(*) from public.driver_sensitive) = 1, 'Kế toán xem được dữ liệu nhạy cảm theo quyền');
select tests.assert((select count(*) from public.audit_logs) = 0, 'Kế toán không có quyền xem nhật ký');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select tests.assert((select count(*) from public.audit_logs where entity_type = 'shipments') >= 3, 'Nhật ký ghi lại tạo/sửa chuyến');
select tests.assert_fails($$delete from public.audit_logs$$, 'Không xóa được nhật ký');
select tests.assert_fails($$update public.audit_logs set action = 'x'$$, 'Không sửa được nhật ký');
reset role;
select tests.assert_fails($$delete from public.audit_logs where id = 1$$, 'Kể cả chủ CSDL cũng không xóa được nhật ký qua lệnh thường');
select tests.assert((select count(*) from public.audit_logs where entity_type = 'driver_sensitive' and new_data ? 'national_id') = 0,
  'Nhật ký không lưu CCCD dạng rõ');

-- Thanh toán trùng cho một yêu cầu phê duyệt bị chặn
insert into public.approval_requests (id, approval_type_id, entity_type, requested_by, amount, content, status)
select '80000000-0000-0000-0000-000000000001', id, 'advance_request', '00000000-0000-0000-0000-0000000000b1', 1000000, 'Ứng tiền dầu', 'approved'
from public.approval_types where code = 'advance';
insert into public.payments (direction, purpose, amount, approval_request_id) values ('out', 'advance', 1000000, '80000000-0000-0000-0000-000000000001');
select tests.assert_fails($$insert into public.payments (direction, purpose, amount, approval_request_id) values ('out', 'advance', 1000000, '80000000-0000-0000-0000-000000000001')$$,
  'Không ghi nhận thanh toán hai lần cho một yêu cầu');
select tests.assert_fails($$update public.approval_requests set amount = 2000000 where id = '80000000-0000-0000-0000-000000000001'$$,
  'Yêu cầu đã duyệt không sửa được số tiền');
select tests.assert_fails($$delete from public.payments$$, 'Không xóa được thanh toán');

-- Tài xế không ghi trực tiếp yêu cầu tài chính (phải qua hàm nghiệp vụ)
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert_fails($$insert into public.advance_requests (driver_id, amount_requested, reason) values ('40000000-0000-0000-0000-000000000001', 500000, 'x')$$,
  'Tài xế không chèn trực tiếp yêu cầu ứng tiền');
select tests.assert_fails($$insert into public.payments (direction, purpose, amount) values ('out', 'other', 1)$$, 'Tài xế không tạo thanh toán');
reset role;

-- ---------------------------------------------------------------------------
-- Bảng giá: chống trùng và thứ tự ưu tiên
-- ---------------------------------------------------------------------------
insert into public.transport_price_lists (code, customer_id, pickup_location_id, delivery_location_id, vehicle_type_id, unit_price, effective_from)
values ('BG001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 3500000, '2026-01-01');
insert into public.transport_price_lists (code, customer_id, unit_price, effective_from)
values ('BG002', '10000000-0000-0000-0000-000000000001', 3000000, '2026-01-01');
select tests.assert_fails($$insert into public.transport_price_lists (code, customer_id, pickup_location_id, delivery_location_id, vehicle_type_id, unit_price, effective_from) values ('BG003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 3600000, '2026-06-01')$$,
  'Hai bảng giá cùng phạm vi, cùng ưu tiên, chồng thời gian bị chặn');
select tests.assert((select code from public.find_price_lists('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '2026-10-16') limit 1) = 'BG001',
  'Tìm bảng giá: ưu tiên bảng giá cụ thể nhất');
select tests.assert((select count(*) from public.find_price_lists('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', null, '2026-10-16')) = 0,
  'Không có bảng giá phù hợp -> trả về rỗng, không tự chọn giá');

-- Đổi bảng giá không làm đổi doanh thu chuyến cũ
update public.transport_price_lists set unit_price = 9999999 where code = 'BG001';
select tests.assert((select unit_price from public.shipments where id = '70000000-0000-0000-0000-000000000001') = 3500000,
  'Đổi bảng giá không làm thay đổi đơn giá chuyến cũ');

-- Mã chứng từ đồng thời: mô phỏng nhiều lần sinh mã liên tiếp
select tests.assert((select count(distinct private.next_code('TST')) from generate_series(1, 50)) = 50, 'Sinh 50 mã liên tiếp không trùng');

\o
\echo 'TẤT CẢ KIỂM THỬ CSDL ĐỀU ĐẠT'
