-- =============================================================================
-- Kiểm thử 9016: tài khoản khách hàng chỉ xem / tải bảng kê của các khách hàng được gán
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

-- Dữ liệu: 3 khách cùng chủ (VAP, PLA, DAM) + 1 khách khác (KHAC)
insert into public.customers (id, code, name, tax_code) values
  ('c9160000-0000-0000-0000-000000000001', 'T-VAP', 'Công ty TNHH Việt An Pha (thử)', '0300000001'),
  ('c9160000-0000-0000-0000-000000000002', 'T-PLA', 'Công ty Plastics Việt Nam (thử)', '0300000002'),
  ('c9160000-0000-0000-0000-000000000003', 'T-DAM', 'Công ty DAM (thử)', '0300000003'),
  ('c9160000-0000-0000-0000-000000000009', 'T-KHAC', 'Công ty khác (thử)', '0300000009');
insert into public.locations (id, code, name, full_address, billing_address) values
  ('d9160000-0000-0000-0000-000000000001', 'T-KHO', 'Kho thử', 'KCN thử', 'Kho thử HĐ'),
  ('d9160000-0000-0000-0000-000000000002', 'T-GIAO1', 'Điểm giao VAP', 'Q1', 'Điểm giao VAP HĐ'),
  ('d9160000-0000-0000-0000-000000000003', 'T-GIAO2', 'Điểm giao PLA', 'Q2', null),
  ('d9160000-0000-0000-0000-000000000004', 'T-GIAO3', 'Điểm giao DAM', 'Q3', null),
  ('d9160000-0000-0000-0000-000000000009', 'T-GIAO9', 'Điểm giao khách khác', 'Q9', null);
insert into public.transport_orders (id, order_code, customer_id, payer_customer_id) values
  ('e9160000-0000-0000-0000-000000000001', 'T9016-1', 'c9160000-0000-0000-0000-000000000001', 'c9160000-0000-0000-0000-000000000001'),
  ('e9160000-0000-0000-0000-000000000002', 'T9016-2', 'c9160000-0000-0000-0000-000000000002', 'c9160000-0000-0000-0000-000000000002'),
  ('e9160000-0000-0000-0000-000000000003', 'T9016-3', 'c9160000-0000-0000-0000-000000000003', 'c9160000-0000-0000-0000-000000000003'),
  ('e9160000-0000-0000-0000-000000000009', 'T9016-9', 'c9160000-0000-0000-0000-000000000009', 'c9160000-0000-0000-0000-000000000009');
insert into public.shipments (id, shipment_code, order_id, pickup_at, pickup_location_id, delivery_location_id, status, unit_price, quantity, driver_pay_override) values
  ('f9160000-0000-0000-0000-000000000001', 'T9016-S1', 'e9160000-0000-0000-0000-000000000001', '2027-02-03', 'd9160000-0000-0000-0000-000000000001', 'd9160000-0000-0000-0000-000000000002', 'driver_completed', 1000000, 1, 300000),
  ('f9160000-0000-0000-0000-000000000002', 'T9016-S2', 'e9160000-0000-0000-0000-000000000002', '2027-02-04', 'd9160000-0000-0000-0000-000000000001', 'd9160000-0000-0000-0000-000000000003', 'driver_completed', 2000000, 1, null),
  ('f9160000-0000-0000-0000-000000000003', 'T9016-S3', 'e9160000-0000-0000-0000-000000000003', '2027-02-05', 'd9160000-0000-0000-0000-000000000001', 'd9160000-0000-0000-0000-000000000004', 'closed', 3000000, 1, null),
  ('f9160000-0000-0000-0000-000000000009', 'T9016-S9', 'e9160000-0000-0000-0000-000000000009', '2027-02-06', 'd9160000-0000-0000-0000-000000000001', 'd9160000-0000-0000-0000-000000000009', 'driver_completed', 9000000, 1, null);
insert into public.shipment_fees (shipment_id, line_no, fee_type_id, fee_kind, amount)
select s.id, 1, (select id from public.fee_types order by sort_order limit 1), 'revenue', 50000
from public.shipments s where s.shipment_code in ('T9016-S1', 'T9016-S9');

-- Tài khoản chủ VAP/PLA/DAM: vai trò "Khách hàng – xem bảng kê"
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000c916', 'chu.vap@gha.test', '{"full_name":"Chủ VAP PLA DAM"}'),
  ('00000000-0000-0000-0000-00000000c917', 'kh.chua.gan@gha.test', '{"full_name":"Khách chưa gán"}'),
  ('00000000-0000-0000-0000-00000000c918', 'kh.admin@gha.test', '{"full_name":"Quản trị khách cũ"}')
on conflict do nothing;
update public.profiles set status = 'active' where id in ('00000000-0000-0000-0000-00000000c916', '00000000-0000-0000-0000-00000000c917', '00000000-0000-0000-0000-00000000c918');
insert into public.user_roles (user_id, role_id)
select u, id from public.roles, unnest(array['00000000-0000-0000-0000-00000000c916', '00000000-0000-0000-0000-00000000c917']::uuid[]) u where code = 'customer_statement';
insert into public.user_roles (user_id, role_id)
select '00000000-0000-0000-0000-00000000c918', id from public.roles where code = 'customer_admin';

-- Super Admin gán 3 công ty cho tài khoản chủ (đúng như thao tác trên trang Người dùng)
select tests.login('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
insert into public.user_customers (user_id, customer_id) values
  ('00000000-0000-0000-0000-00000000c916', 'c9160000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000c916', 'c9160000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-00000000c916', 'c9160000-0000-0000-0000-000000000003'),
  ('00000000-0000-0000-0000-00000000c918', 'c9160000-0000-0000-0000-000000000001');
select tests.assert((select count(*) from public.user_customers where user_id = '00000000-0000-0000-0000-00000000c916') = 3, 'Super Admin gán được 3 công ty cho một tài khoản');
select tests.assert(not private.is_customer_scoped(), 'Super Admin không bị giới hạn theo khách hàng');
select tests.assert((select count(*) from public.customers where code like 'T-%') = 4, 'Super Admin vẫn thấy đủ 4 khách hàng');
reset role;

-- Điều phối GHA không bị ảnh hưởng
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert((select count(*) from public.shipments where shipment_code like 'T9016-%') = 4, 'Điều phối GHA vẫn thấy đủ 4 chuyến');
select tests.assert((select count(*) from public.statement_shipment_list) = 0, 'Nhân viên GHA không dùng view bảng kê khách (không có quyền statements.view)');
reset role;

-- Tài khoản chủ VAP/PLA/DAM
select tests.login('00000000-0000-0000-0000-00000000c916');
set role authenticated;
select tests.assert(private.is_customer_scoped(), 'Tài khoản khách bị giới hạn theo khách hàng');
select tests.assert((select array_agg(code order by code) from public.statement_customers) = array['T-DAM', 'T-PLA', 'T-VAP'], 'Bộ lọc khách hàng chỉ có VAP, PLA, DAM');
select tests.assert((select count(*) from public.statement_shipment_list) = 3, 'Bảng kê thấy 3 chuyến của 3 công ty');
select tests.assert(not exists (select 1 from public.statement_shipment_list where shipment_code = 'T9016-S9'), 'Không thấy chuyến của công ty khác');
select tests.assert((select count(*) from public.statement_shipment_list where customer_id = 'c9160000-0000-0000-0000-000000000002') = 1, 'Chọn riêng PLA: 1 chuyến');
select tests.assert((select pickup_billing_address from public.statement_shipment_list where shipment_code = 'T9016-S1') = 'Kho thử HĐ', 'Có thông tin xuất hóa đơn của điểm nhận');
select tests.assert((select count(*) from public.statement_shipment_fees) = 1, 'Chỉ thấy phí của chuyến mình (không thấy phí chuyến công ty khác)');
select tests.assert(not exists (select 1 from information_schema.columns where table_name = 'statement_shipment_list' and column_name in ('driver_pay_override', 'carrier_supplier_id')),
  'View bảng kê không có lương tài xế, nhà xe 3-PL');
-- Bảng gốc: không đọc được gì (không có quyền xem chuyến), kể cả công ty mình
select tests.assert((select count(*) from public.shipments) = 0, 'Không đọc trực tiếp bảng chuyến');
select tests.assert((select count(*) from public.customers) = 0, 'Không đọc trực tiếp bảng khách hàng');
select tests.assert((select count(*) from public.locations) = 0, 'Không đọc trực tiếp danh mục địa điểm');
select tests.assert((select count(*) from public.shipment_fees) = 0, 'Không đọc trực tiếp bảng phí');
select tests.assert((select count(*) from public.vehicles_for_customer) = 0, 'Không xem danh sách xe');
-- Chỉ đọc: không sửa, không thêm, không tự gán thêm công ty
select tests.assert_fails($$insert into public.user_customers (user_id, customer_id) values ('00000000-0000-0000-0000-00000000c916', 'c9160000-0000-0000-0000-000000000009')$$,
  'Không tự gán thêm công ty khác');
update public.shipments set notes = 'sua' where shipment_code = 'T9016-S1';
update public.customers set name = 'sua' where code = 'T-VAP';
select tests.assert_fails($$insert into public.table_view_preferences (table_key, scope, name, config) values ('freight_statement', 'system', 'Mẫu khách tự tạo', '{"columns":["stt"]}')$$,
  'Khách không lưu được mẫu bảng kê dùng chung');
reset role;
select tests.assert((select notes is null from public.shipments where shipment_code = 'T9016-S1'), 'Khách không sửa được chuyến');
select tests.assert((select name from public.customers where code = 'T-VAP') = 'Công ty TNHH Việt An Pha (thử)', 'Khách không sửa được khách hàng');
select tests.assert(not exists (
  select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id
  where r.code = 'customer_statement' and rp.permission_code not in ('statements.view', 'statements.export')),
  'Vai trò Khách hàng – xem bảng kê chỉ có quyền xem / tải bảng kê');

-- Có vai trò khách mà chưa gán công ty: không thấy gì
select tests.login('00000000-0000-0000-0000-00000000c917');
set role authenticated;
select tests.assert((select count(*) from public.statement_customers) = 0 and (select count(*) from public.statement_shipment_list) = 0,
  'Chưa gán công ty: không thấy khách hàng, chuyến nào');
reset role;

-- Vai trò "Quản trị bên khách hàng" cũ (có quyền điều phối) cũng bị giới hạn ở RLS
select tests.login('00000000-0000-0000-0000-00000000c918');
set role authenticated;
select tests.assert((select array_agg(shipment_code) from public.shipments where shipment_code like 'T9016-%') = array['T9016-S1'], 'Quản trị bên khách hàng chỉ thấy chuyến của VAP');
select tests.assert((select count(*) from public.transport_orders where order_code like 'T9016-%') = 1, 'Quản trị bên khách hàng chỉ thấy đơn của VAP');
select tests.assert((select count(*) from public.shipment_fees f join public.shipments s on s.id = f.shipment_id where s.shipment_code like 'T9016-%') = 1, 'Quản trị bên khách hàng chỉ thấy phí chuyến VAP');
select tests.assert(not exists (select 1 from public.locations where code = 'T-GIAO9'), 'Quản trị bên khách hàng không thấy điểm giao của khách khác');
reset role;

-- Dọn: bỏ gán công ty (chuyến thử để lại cho kiểm thử xóa dữ liệu thử 99)
delete from public.user_customers where user_id in ('00000000-0000-0000-0000-00000000c916', '00000000-0000-0000-0000-00000000c918');

\o
\echo 'TẤT CẢ KIỂM THỬ TÀI KHOẢN KHÁCH XEM BẢNG KÊ ĐỀU ĐẠT'
