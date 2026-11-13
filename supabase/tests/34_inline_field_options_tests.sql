-- =============================================================================
-- Kiểm thử 0048: nút + thêm lựa chọn ngay tại ô chọn của trường bổ sung
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a2'); -- admin
set role authenticated;
select public.save_field_definition(null, '{"module":"transport_orders","field_key":"loai_hinh_vc","label":"Loại hình vận chuyển","data_type":"single_select","options":[{"value":"nhap","label":"Nhập"},"Xuất"]}'::jsonb);
select public.save_field_definition(null, '{"module":"transport_orders","field_key":"ghi_chu_x","label":"Ghi chú X","data_type":"short_text"}'::jsonb);
reset role;

select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối: không có fields.configure nhưng nhập liệu được
set role authenticated;
select tests.assert((public.add_field_option((select id from public.field_definitions where field_key = 'loai_hinh_vc'), '  Nội   địa ') ->> 'value') = 'Nội địa',
  'Điều phối thêm được lựa chọn, tên được gọn khoảng trắng');
select tests.assert((public.add_field_option((select id from public.field_definitions where field_key = 'loai_hinh_vc'), 'NHẬP') ->> 'value') = 'nhap',
  'Trùng tên (không phân biệt hoa thường) trả về lựa chọn đã có');
select tests.assert((public.add_field_option((select id from public.field_definitions where field_key = 'loai_hinh_vc'), 'xuất') ->> 'existed')::boolean,
  'Lựa chọn dạng chuỗi cũ cũng nhận ra trùng');
select tests.assert_fails($$select public.add_field_option((select id from public.field_definitions where field_key = 'ghi_chu_x'), 'A')$$,
  'Không thêm lựa chọn cho trường không phải danh sách chọn');
select tests.assert_fails($$select public.add_field_option((select id from public.field_definitions where field_key = 'loai_hinh_vc'), '   ')$$,
  'Tên trống bị chặn');
reset role;
select tests.assert((select jsonb_array_length(options) from public.field_definitions where field_key = 'loai_hinh_vc') = 3, 'Chỉ thêm đúng một lựa chọn mới');
select tests.assert(exists (select 1 from public.field_definition_versions v join public.field_definitions f on f.id = v.field_id
  where f.field_key = 'loai_hinh_vc' and v.change_note like 'Thêm lựa chọn "Nội địa"%' and v.changed_by = '00000000-0000-0000-0000-0000000000d1'),
  'Có phiên bản mới ghi người thêm');

select tests.login('00000000-0000-0000-0000-0000000000b1'); -- tài xế
set role authenticated;
select tests.assert_fails($$select public.add_field_option((select id from public.field_definitions where field_key = 'loai_hinh_vc'), 'Tài xế thêm')$$,
  'Tài xế không thêm được lựa chọn');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000f1'); -- chỉ xem báo cáo
set role authenticated;
select tests.assert_fails($$select public.add_field_option((select id from public.field_definitions where field_key = 'loai_hinh_vc'), 'Người xem thêm')$$,
  'Người chỉ xem không thêm được lựa chọn');
reset role;

-- dọn dẹp
delete from public.field_definitions where module = 'transport_orders' and field_key in ('loai_hinh_vc', 'ghi_chu_x');
\o
\echo 'THÊM LỰA CHỌN NGAY TẠI Ô CHỌN ĐẠT'
