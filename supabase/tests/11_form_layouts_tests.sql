-- =============================================================================
-- Kiểm thử 0021: thứ tự trường trên biểu mẫu (form_layouts)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

-- Điều phối không có quyền cấu hình trường: xem được, không lưu được
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.save_form_layout('shipments', array['driver_id', 'pickup_at'])$$, 'Không có quyền cấu hình trường thì không sắp được');
reset role;

-- Quản trị sắp xếp; bỏ trùng và khóa lạ
select tests.login('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select public.save_form_layout('shipments', array['so_container', 'driver_id', 'pickup_at', 'driver_id', 'Bad Key', 'vehicle_id']);
select tests.assert((select field_order from public.form_layouts where module = 'shipments') = array['so_container', 'driver_id', 'pickup_at', 'vehicle_id'],
  'Lưu thứ tự, bỏ trùng và khóa không hợp lệ');
select public.save_form_layout('shipments', array['pickup_at', 'so_container']);
select tests.assert((select field_order from public.form_layouts where module = 'shipments') = array['pickup_at', 'so_container'], 'Lưu lại thay thế thứ tự cũ');
select tests.assert_fails($$select public.save_form_layout('Sai Ten', array['a'])$$, 'Tên màn hình không hợp lệ bị chặn');
select tests.assert_fails($$insert into public.form_layouts (module) values ('vehicles')$$, 'Không ghi thẳng vào bảng, phải qua hàm');
reset role;
select tests.assert((select count(*) from public.audit_logs where action = 'form_layout.save' and entity_id = 'shipments') = 2, 'Ghi nhật ký mỗi lần lưu');

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert((select field_order[1] from public.form_layouts where module = 'shipments') = 'pickup_at', 'Người dùng khác đọc được thứ tự');
reset role;
set role anon;
select tests.assert_fails($$select count(*) from public.form_layouts$$, 'Người ngoài không đọc được');
select tests.assert_fails($$select public.save_form_layout('shipments', array['a'])$$, 'Người ngoài không lưu được');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ THỨ TỰ TRƯỜNG TRÊN BIỂU MẪU ĐỀU ĐẠT'
