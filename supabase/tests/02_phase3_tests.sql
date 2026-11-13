-- =============================================================================
-- Kiểm thử Giai đoạn 3: mã tự sinh, trường dữ liệu động, cấu hình bảng theo người dùng
-- Chạy sau 01_security_tests.sql (dùng lại người dùng và dữ liệu đã tạo ở đó).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

-- ---------------------------------------------------------------------------
-- Mã danh mục tự sinh
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000a2'); -- admin
set role authenticated;
insert into public.vehicles (plate_number) values ('99A-000.01');
select tests.assert((select code from public.vehicles where plate_number = '99A-000.01') ~ '^XE\d{3}$', 'Xe không nhập mã -> tự sinh XE###');
insert into public.vehicles (code, plate_number) values (' xe777 ', '99A-000.02');
select tests.assert((select code from public.vehicles where plate_number = '99A-000.02') = 'XE777', 'Mã nhập tay được chuẩn hóa chữ hoa, bỏ khoảng trắng');
insert into public.customers (name) values ('Khách tự sinh mã 1'), ('Khách tự sinh mã 2');
select tests.assert((select count(distinct code) from public.customers where name like 'Khách tự sinh mã %') = 2, 'Hai khách hàng tự sinh mã không trùng');
select tests.assert(not exists (select 1 from public.customers c1 join public.customers c2 on c1.code = c2.code and c1.id <> c2.id), 'Mã tự sinh bỏ qua mã đã nhập tay (KH001, KH002)');
select tests.assert_fails($$insert into public.vehicles (plate_number, custom_fields) values ('99A-000.03', '[]')$$, 'custom_fields phải là object JSON');
reset role;

-- ---------------------------------------------------------------------------
-- Trường dữ liệu động
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối: không có fields.configure
set role authenticated;
select tests.assert_fails($$select public.save_field_definition(null, '{"module":"vehicles","field_key":"so_hop_dong","label":"Số hợp đồng","data_type":"short_text"}'::jsonb)$$,
  'Người không có quyền cấu hình không tạo được trường');
select tests.assert_fails($$insert into public.field_definitions (module, field_key, label, data_type) values ('vehicles', 'x_hack', 'Hack', 'short_text')$$,
  'RLS chặn ghi trực tiếp định nghĩa trường');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select public.save_field_definition(null, '{"module":"vehicles","field_key":"so_container","label":"Số container","data_type":"short_text"}'::jsonb);
select public.save_field_definition(null, '{"module":"vehicles","field_key":"tai_trong","label":"Tải trọng","data_type":"decimal"}'::jsonb);
select public.save_field_definition(null, '{"module":"vehicles","field_key":"kg","label":"Kg","data_type":"formula","formula":"tai_trong * 1000"}'::jsonb);
select tests.assert((select version from public.field_definitions where field_key = 'so_container') = 1, 'Trường mới có phiên bản 1');
select tests.assert((select count(*) from public.field_definition_versions v join public.field_definitions f on f.id = v.field_id where f.field_key = 'so_container') = 1,
  'Tạo trường lưu ảnh chụp phiên bản 1');
select tests.assert_fails($$select public.save_field_definition(null, '{"module":"bang_bi_mat","field_key":"abc","label":"x","data_type":"short_text"}'::jsonb)$$,
  'Không tạo trường cho module không được phép');

-- Sửa nội dung -> phiên bản 2 kèm ghi chú; lưu lại y nguyên -> không tăng phiên bản
select public.save_field_definition((select id from public.field_definitions where field_key = 'so_container'),
  '{"label":"Số container (cont)","data_type":"short_text"}'::jsonb, 'Đổi tên');
select tests.assert((select version from public.field_definitions where field_key = 'so_container') = 2, 'Sửa trường tăng phiên bản');
select tests.assert((select change_note from public.field_definition_versions v join public.field_definitions f on f.id = v.field_id
                     where f.field_key = 'so_container' and v.version = 2) = 'Đổi tên', 'Phiên bản lưu ghi chú thay đổi');
update public.field_definitions set label = label where field_key = 'so_container';
select tests.assert((select version from public.field_definitions where field_key = 'so_container') = 2, 'Lưu không đổi nội dung thì không tạo phiên bản');
select tests.assert_fails($$update public.field_definitions set field_key = 'doi_ma' where field_key = 'so_container'$$, 'Không đổi được mã trường');

-- Khôi phục phiên bản 1 -> tạo phiên bản 3 với nội dung cũ
select public.restore_field_version((select id from public.field_definitions where field_key = 'so_container'), 1);
select tests.assert((select label || '/' || version from public.field_definitions where field_key = 'so_container') = 'Số container/3',
  'Khôi phục phiên bản cũ tạo phiên bản mới với nội dung cũ');

-- Có dữ liệu -> không đổi kiểu, không xóa; bị công thức dùng -> không xóa
update public.vehicles set custom_fields = jsonb_build_object('so_container', 'MSKU1234567', 'tai_trong', 2.5) where plate_number = '99A-000.01';
select tests.assert((public.field_impact((select id from public.field_definitions where field_key = 'so_container')) ->> 'records_with_value')::int = 1,
  'Phân tích ảnh hưởng đếm đúng số bản ghi có dữ liệu');
select tests.assert(jsonb_array_length(public.field_impact((select id from public.field_definitions where field_key = 'tai_trong')) -> 'used_in_formulas') = 1,
  'Phân tích ảnh hưởng phát hiện công thức đang dùng trường');
select tests.assert_fails($$select public.save_field_definition((select id from public.field_definitions where field_key = 'so_container'), '{"label":"Số container","data_type":"integer"}'::jsonb)$$,
  'Không đổi kiểu dữ liệu khi trường đã có dữ liệu');
select tests.assert_fails($$delete from public.field_definitions where field_key = 'so_container'$$, 'Không xóa trường đang có dữ liệu');
update public.vehicles set custom_fields = custom_fields - 'tai_trong' where plate_number = '99A-000.01';
select tests.assert_fails($$delete from public.field_definitions where field_key = 'tai_trong'$$, 'Không xóa trường đang được công thức sử dụng');
delete from public.field_definitions where field_key = 'kg';
select tests.assert(not exists (select 1 from public.field_definitions where field_key = 'kg'), 'Xóa được trường chưa có dữ liệu, không ai dùng');
update public.field_definitions set status = 'inactive' where field_key = 'so_container';
select tests.assert((select custom_fields ->> 'so_container' from public.vehicles where plate_number = '99A-000.01') = 'MSKU1234567',
  'Ngừng sử dụng trường vẫn giữ dữ liệu cũ');
reset role;

-- ---------------------------------------------------------------------------
-- Cấu hình bảng theo người dùng
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.save_table_view('vehicles', '{"hidden":["brand"]}'::jsonb);
select public.save_table_view('vehicles', '{"hidden":["brand","notes"]}'::jsonb);
select tests.assert((select count(*) from public.table_view_preferences where table_key = 'vehicles' and user_id = '00000000-0000-0000-0000-0000000000d1') = 1,
  'Lưu cấu hình bảng nhiều lần chỉ giữ một bản cho mỗi người');
select tests.assert_fails($$insert into public.table_view_preferences (table_key, scope, user_id, config) values ('vehicles', 'user', '00000000-0000-0000-0000-0000000000c1', '{}')$$,
  'Không ghi được cấu hình bảng cho người khác');
select tests.assert_fails($$insert into public.table_view_preferences (table_key, scope, config) values ('vehicles', 'system', '{}')$$,
  'Người không có quyền cấu hình không đặt được cấu hình mặc định hệ thống');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((select count(*) from public.table_view_preferences where user_id = '00000000-0000-0000-0000-0000000000d1') = 0,
  'Không đọc được cấu hình bảng của người khác');
-- Kế toán không có quyền tạo xe, xem được tài chính xe; điều phối thì ngược lại
select tests.assert_fails($$insert into public.vehicles (plate_number) values ('99A-000.09')$$, 'Kế toán không tạo được xe');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert((select count(*) from public.vehicle_financials) = 0, 'Điều phối không đọc được tài chính xe');
select tests.assert_fails($$insert into public.vehicle_financials (vehicle_id, purchase_price) select id, 1 from public.vehicles limit 1$$, 'Điều phối không ghi được tài chính xe');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ CSDL GIAI ĐOẠN 3 ĐỀU ĐẠT'
