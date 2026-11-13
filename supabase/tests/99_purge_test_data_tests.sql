-- =============================================================================
-- Chạy sau cùng vì xóa sạch dữ liệu giao dịch.
-- Kiểm thử 0031: mã khách trong báo cáo; xóa dữ liệu thử trong ứng dụng (mật khẩu riêng, gõ xác nhận).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
select tests.assert((select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'customer_code'
  and table_name in ('report_shipment_profit', 'report_by_customer', 'report_fee_lines', 'report_by_fee_type', 'report_pass_through_fees', 'report_loading')) = 6,
  'Các báo cáo có cột mã khách');
select tests.assert(not has_table_privilege('authenticated', 'private.admin_secrets', 'select'), 'Người dùng không đọc được bảng băm mật khẩu');

-- Kế toán (không phải admin): không đặt được
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert_fails($$select public.set_purge_password('MatKhauXoa-123')$$, 'Người không phải Admin không đặt được mật khẩu xóa dữ liệu');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a2'); -- admin
set role authenticated;
select tests.assert(not (public.purge_password_status() ->> 'is_set')::boolean, 'Ban đầu chưa có mật khẩu xóa dữ liệu');
select tests.assert(not (public.test_data_counts('bat-ky') ->> 'ok')::boolean, 'Chưa đặt mật khẩu thì không xem trước được');
select tests.assert_fails($$select public.set_purge_password('ngan')$$, 'Mật khẩu dưới 8 ký tự bị từ chối');
select public.set_purge_password('MatKhauXoa-123');
select tests.assert((public.purge_password_status() ->> 'is_set')::boolean, 'Đã đặt mật khẩu xóa dữ liệu');
select tests.assert_fails($$select public.set_purge_password('MatKhauMoi-456', 'sai-roi')$$, 'Đổi mật khẩu phải nhập đúng mật khẩu cũ');
select tests.assert((public.test_data_counts('MatKhauXoa-123') -> 'counts' ->> 'shipments')::int > 0, 'Đúng mật khẩu thì xem trước được số chuyến sẽ xóa');
select tests.assert(not (public.test_data_counts('sai-roi') ->> 'ok')::boolean, 'Sai mật khẩu thì không xem được');
select tests.assert_fails($$select public.purge_test_data('MatKhauXoa-123', 'xoa')$$, 'Gõ sai chữ xác nhận thì không xóa');
select tests.assert(not (public.purge_test_data('sai-roi', 'XOA DU LIEU') ->> 'ok')::boolean, 'Sai mật khẩu thì không xóa');
select tests.assert((select count(*) from public.shipments) > 0, 'Chưa có gì bị xóa sau các lần sai');
reset role;
select tests.assert((select count(*) from public.audit_logs where action = 'test_data.password_failed') = 2, 'Mỗi lần nhập sai mật khẩu được ghi nhật ký');

-- Sai 5 lần thì khóa (kể cả mật khẩu đúng)
insert into public.audit_logs (actor_id, action, entity_type, entity_id) select null, 'test_data.password_failed', 'system', 'x' from generate_series(1, 3);
select tests.login('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select tests.assert((public.test_data_counts('MatKhauXoa-123') ->> 'error') like '%quá 5 lần%', 'Sai quá 5 lần trong 15 phút thì khóa');
reset role;
-- Giả lập đã qua 15 phút (bỏ qua trigger chặn sửa nhật ký, chỉ trong kiểm thử)
set session_replication_role = replica;
update public.audit_logs set occurred_at = now() - interval '1 hour' where action = 'test_data.password_failed';
set session_replication_role = origin;

create temp table t_keep as select (select count(*) from public.customers) c, (select count(*) from public.vehicles) v, (select count(*) from public.profiles) p;
grant select on t_keep to authenticated;
select tests.login('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select tests.assert((public.purge_test_data('MatKhauXoa-123', 'xoa du lieu') ->> 'ok')::boolean, 'Đúng mật khẩu và chữ xác nhận thì xóa');
reset role;
select tests.assert((select count(*) from public.shipments) = 0 and (select count(*) from public.transport_orders) = 0, 'Đã xóa đơn hàng, chuyến');
select tests.assert((select count(*) from public.customers) = (select c from t_keep) and (select count(*) from public.vehicles) = (select v from t_keep)
  and (select count(*) from public.profiles) = (select p from t_keep), 'Giữ nguyên khách hàng, xe, người dùng');
select tests.assert(exists (select 1 from public.audit_logs where action = 'test_data.purge' and actor_id = '00000000-0000-0000-0000-0000000000a2'), 'Nhật ký ghi người xóa');

\o
\echo 'TẤT CẢ KIỂM THỬ MÃ KHÁCH BÁO CÁO, XÓA DỮ LIỆU THỬ ĐỀU ĐẠT'
