-- =============================================================================
-- Kiểm thử 0022: điều kiện hiện trường bổ sung (visibility_condition)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

select tests.login('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select public.save_field_definition(null, jsonb_build_object('module', 'transport_orders', 'field_key', 'ncc', 'label', 'NCC', 'data_type', 'single_select',
  'options', jsonb_build_array(jsonb_build_object('value', 'noi_bo', 'label', 'Xe nội bộ'), jsonb_build_object('value', '3pl', 'label', '3-PL'))));
select public.save_field_definition(null, jsonb_build_object('module', 'transport_orders', 'field_key', 'nha_3pl', 'label', '3-PL', 'data_type', 'short_text',
  'is_required', true, 'visibility_condition', '{"field": "ncc", "in": ["3pl"]}'));
select tests.assert((select visibility_condition::jsonb from public.field_definitions where module = 'transport_orders' and field_key = 'nha_3pl') = '{"field": "ncc", "in": ["3pl"]}'::jsonb,
  'Lưu điều kiện hiện khi thêm trường');
select tests.assert((select public.field_impact(id) -> 'used_in_visibility' -> 0 ->> 'label' from public.field_definitions where module = 'transport_orders' and field_key = 'ncc') = '3-PL',
  'Phân tích ảnh hưởng cho biết trường nào dùng NCC làm điều kiện');
select tests.assert(jsonb_array_length((select public.field_impact(id) -> 'used_in_visibility' from public.field_definitions where module = 'transport_orders' and field_key = 'nha_3pl')) = 0,
  'Trường không làm điều kiện thì không bị báo');

-- Sửa: bỏ điều kiện (luôn hiện) tạo phiên bản mới
select public.save_field_definition((select id from public.field_definitions where module = 'transport_orders' and field_key = 'nha_3pl'),
  jsonb_build_object('label', '3-PL', 'data_type', 'short_text', 'visibility_condition', null), 'Bỏ điều kiện');
select tests.assert((select visibility_condition from public.field_definitions where module = 'transport_orders' and field_key = 'nha_3pl') is null, 'Bỏ điều kiện hiện');
select tests.assert((select count(*) from public.field_definition_versions v join public.field_definitions f on f.id = v.field_id
  where f.module = 'transport_orders' and f.field_key = 'nha_3pl') = 2, 'Mỗi lần sửa điều kiện có phiên bản');

-- Khôi phục phiên bản 1 lấy lại điều kiện
select public.restore_field_version((select id from public.field_definitions where module = 'transport_orders' and field_key = 'nha_3pl'), 1);
select tests.assert((select visibility_condition::jsonb ->> 'field' from public.field_definitions where module = 'transport_orders' and field_key = 'nha_3pl') = 'ncc',
  'Khôi phục phiên bản cũ lấy lại điều kiện hiện');

select tests.assert_fails($$select public.save_field_definition(null, jsonb_build_object('module', 'transport_orders', 'field_key', 'x1', 'label', 'X', 'data_type', 'short_text', 'visibility_condition', 'không phải json'))$$,
  'Điều kiện không phải JSON bị chặn');
select tests.assert_fails($$select public.save_field_definition(null, jsonb_build_object('module', 'transport_orders', 'field_key', 'x2', 'label', 'X', 'data_type', 'short_text', 'visibility_condition', '{"field": "ncc", "in": []}'))$$,
  'Điều kiện không có giá trị nào bị chặn');
select tests.assert_fails($$select public.save_field_definition(null, jsonb_build_object('module', 'transport_orders', 'field_key', 'x3', 'label', 'X', 'data_type', 'short_text', 'visibility_condition', '{"field": "Sai Ma", "in": ["a"]}'))$$,
  'Mã trường điều kiện sai định dạng bị chặn');
reset role;

-- Không có quyền cấu hình trường thì không đặt được điều kiện
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.save_field_definition((select id from public.field_definitions where field_key = 'nha_3pl'), jsonb_build_object('label', 'X', 'data_type', 'short_text', 'visibility_condition', null))$$,
  'Điều phối không sửa được điều kiện hiện');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ ĐIỀU KIỆN HIỆN TRƯỜNG ĐỀU ĐẠT'
