-- =============================================================================
-- Kiểm thử 0059: sửa trường hệ thống (form_layouts.system_fields)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối: không có fields.configure
set role authenticated;
select tests.assert_fails($$select public.save_system_field('vehicles', 'plate_number', '{"label": "Số xe"}')$$, 'Không có quyền cấu hình trường thì không sửa được');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select public.save_system_field('vehicles', 'plate_number', '{"label": "Số xe", "help": "VD: 61K31295"}');
select public.save_system_field('vehicles', 'notes', '{"hidden": true, "list": true}');
select tests.assert((select system_fields from public.form_layouts where module = 'vehicles')
  = '{"plate_number": {"label": "Số xe", "help": "VD: 61K31295"}, "notes": {"hidden": true, "list": true}}'::jsonb, 'Lưu tùy chỉnh từng trường');
select public.save_system_field('vehicles', 'plate_number', '{"label": "Biển kiểm soát"}');
select tests.assert((select system_fields -> 'plate_number' from public.form_layouts where module = 'vehicles') = '{"label": "Biển kiểm soát"}'::jsonb, 'Lưu lại thay phần cũ của trường');
select public.save_system_field('vehicles', 'notes', '{}');
select tests.assert((select not (system_fields ? 'notes') from public.form_layouts where module = 'vehicles'), 'Rỗng = trả về mặc định');
select tests.assert_fails($$select public.save_system_field('vehicles', 'plate_number', '{"data_type": "number"}')$$, 'Không đổi được kiểu dữ liệu');
select tests.assert_fails($$select public.save_system_field('vehicles', 'plate_number', '{"label": ""}')$$, 'Tên hiển thị không được rỗng');
select tests.assert_fails($$select public.save_system_field('vehicles', 'plate_number', '{"required": "yes"}')$$, 'Bắt buộc phải là true/false');
select tests.assert_fails($$select public.save_system_field('vehicles', 'Bad Key', '{"label": "x"}')$$, 'Mã trường không hợp lệ bị chặn');
update public.form_layouts set system_fields = '{}' where module = 'vehicles';
select tests.assert((select system_fields ? 'plate_number' from public.form_layouts where module = 'vehicles'), 'Không ghi thẳng vào bảng, phải qua hàm');
-- Lưu thứ tự không làm mất tùy chỉnh trường hệ thống
select public.save_form_layout('vehicles', array['plate_number']);
select tests.assert((select system_fields ? 'plate_number' from public.form_layouts where module = 'vehicles'), 'Lưu thứ tự giữ tùy chỉnh');
reset role;
select tests.assert((select count(*) from public.audit_logs where action = 'system_field.save' and entity_id = 'vehicles.plate_number') = 2, 'Ghi nhật ký');
set role anon;
select tests.assert_fails($$select public.save_system_field('vehicles', 'plate_number', '{"label": "x"}')$$, 'Người ngoài không sửa được');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ SỬA TRƯỜNG HỆ THỐNG ĐỀU ĐẠT'
