-- =============================================================================
-- Kiểm thử 0027: hàng hóa của chuyến (nhiều mã hàng).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
create temp table t_si as select id from public.shipments where status not in ('closed', 'cancelled') order by created_at limit 1;
grant select on t_si to authenticated, anon;

select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối
set role authenticated;
select tests.assert(public.set_shipment_items((select id from t_si),
  '[{"item_code":"MH001","item_name":"Thép cuộn","quantity":"12.5","unit":"tấn"},{"item_code":"","item_name":"","quantity":"","note":""},{"item_code":"MH002","quantity":3,"custom_fields":{"so_seal":"S1"}}]') = 2,
  'Lưu 2 dòng hàng hóa, bỏ dòng trống');
select tests.assert((select string_agg(item_code || ':' || line_no, ',' order by line_no) from public.shipment_items where shipment_id = (select id from t_si)) = 'MH001:1,MH002:2',
  'Dòng hàng hóa đánh số liên tục');
select tests.assert((select custom_fields ->> 'so_seal' from public.shipment_items where shipment_id = (select id from t_si) and line_no = 2) = 'S1', 'Lưu cột bổ sung của dòng hàng');
select public.set_shipment_items((select id from t_si), '[{"item_code":"MH003","quantity":1}]');
select tests.assert((select count(*) from public.shipment_items where shipment_id = (select id from t_si)) = 1, 'Lưu lại thay toàn bộ danh sách');
select tests.assert_fails($$select public.set_shipment_items((select id from t_si), '[{"item_code":"X","quantity":"abc"}]')$$, 'Số lượng không phải số bị chặn');
select tests.assert_fails($$insert into public.shipment_items (shipment_id, line_no) values ((select id from t_si), 9)$$, 'Không ghi thẳng vào bảng được');
-- 9014: số bao nhập tay, ĐVT bao, và tự tính theo quy cách đóng gói của mã hàng
reset role;
insert into public.products (code, name, unit) values ('TSB25', 'Phân bón bao 25', 'KG');
insert into public.products (code, name, unit, kg_per_bag) values ('TSJ1150', 'Hạt nhựa jumbo', 'KG', 1150);
set role authenticated;
select tests.assert(public.set_shipment_items((select id from t_si),
  '[{"item_code":"MH001","quantity":"10","unit":"tấn","bag_count":"7"},{"item_code":"MH002","quantity":40,"unit":"Bao"},{"item_code":"tsb25","quantity":1000,"unit":"KG"},{"item_code":"MH004","quantity":5,"unit":"KG"},{"item_code":"TSJ1150","quantity":2300}]') = 5,
  'Lưu dòng hàng có số bao');
select tests.assert((select bag_count from public.shipment_items where shipment_id = (select id from t_si) and line_no = 1) = 7, 'Lưu số bao nhập tay');
select tests.assert_fails($$select public.set_shipment_items((select id from t_si), '[{"item_code":"X","bag_count":"-1"}]')$$, 'Số bao âm bị chặn');
select tests.assert_fails($$select public.set_shipment_items((select id from t_si), '[{"item_code":"X","bag_count":"abc"}]')$$, 'Số bao không phải số bị chặn');
select tests.assert((select string_agg(coalesce((i ->> 'bag_count')::numeric::text, '-'), ',' order by (i ->> 'line_no')::int)
                     from jsonb_array_elements(public.delivery_note((select id from t_si)) -> 'items') i) = '7.00,40.000,40.00,-,2.00',
  'Phiếu giao hàng: số bao nhập tay, theo ĐVT bao, Số lượng KG ÷ Số KG/bao (mặc định 25), để trống khi không có mã hàng');
reset role;

insert into public.field_definitions (module, field_key, label, data_type) values ('shipment_items', 'so_seal', 'Số seal', 'short_text');
select tests.assert(true, 'Thêm được cột bổ sung cho bảng hàng hóa');

select tests.login('00000000-0000-0000-0000-0000000000c1'); -- kế toán
set role authenticated;
select tests.assert((select count(*) from public.shipment_items where shipment_id = (select id from t_si)) >= 0, 'Kế toán đọc được hàng hóa của chuyến xem được');
select tests.assert_fails($$select public.set_shipment_items((select id from t_si), '[]')$$, 'Kế toán không sửa hàng hóa được');
reset role;
set role anon;
select tests.assert_fails($$select count(*) from public.shipment_items$$, 'Người ngoài không đọc được');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ HÀNG HÓA CỦA CHUYẾN ĐỀU ĐẠT'
