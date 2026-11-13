-- =============================================================================
-- Kiểm thử 0029: loại phí thu khách, dòng phí của chuyến, doanh thu và báo cáo theo loại phí.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
-- Từ 0037 loại phí nhóm Bốc xếp tính như chi hộ; kiểm thử 0029 dùng Phí bốc xếp làm phí tính doanh thu
update public.fee_types set fee_kind = 'revenue' where name = 'Phí bốc xếp';
create temp table t_cf as
  select s.id, (select id from public.fee_types where name = 'Phí bốc xếp') as boc_xep, (select id from public.fee_types where name = 'Phí chi hộ') as chi_ho,
         s.freight_amount + s.surcharge_amount + s.fuel_support_amount as base
  from public.shipments s where s.status in ('in_transit', 'driver_completed') and s.receivable_id is null order by s.created_at limit 1;
grant select on t_cf to authenticated, anon;
select tests.assert((select count(*) from t_cf where boc_xep is not null and chi_ho is not null) = 1, 'Có sẵn loại phí Phí bốc xếp và Phí chi hộ');

select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối
set role authenticated;
select tests.assert(public.set_shipment_fees((select id from t_cf), jsonb_build_array(
  jsonb_build_object('fee_type_id', (select boc_xep from t_cf), 'amount', '500000', 'note', 'Bốc 2 đầu'),
  jsonb_build_object('fee_type_id', '', 'amount', '', 'note', ''),
  jsonb_build_object('fee_type_id', (select chi_ho from t_cf), 'amount', 1000000))) = 2, 'Lưu 2 dòng phí, bỏ dòng trống');
select tests.assert((select extra_fee_amount = 500000 and pass_through_amount = 1000000 from public.shipments where id = (select id from t_cf)), 'Tổng phí tính doanh thu và tổng chi hộ tách riêng');
select tests.assert((select total_revenue = (select base from t_cf) + 500000 and amount_due = (select base from t_cf) + 1500000 from public.shipment_list where id = (select id from t_cf)),
  'Doanh thu cộng phí bốc xếp, không cộng chi hộ; khách phải trả cộng cả chi hộ');
select tests.assert_fails($$select public.set_shipment_fees((select id from t_cf), jsonb_build_array(jsonb_build_object('amount', 1000)))$$, 'Dòng phí thiếu loại phí bị chặn');
select tests.assert_fails($$select public.set_shipment_fees((select id from t_cf), jsonb_build_array(jsonb_build_object('fee_type_id', (select boc_xep from t_cf), 'amount', 'abc')))$$, 'Số tiền không phải số bị chặn');
select tests.assert_fails($$select public.set_shipment_fees((select id from t_cf), jsonb_build_array(jsonb_build_object('fee_type_id', (select boc_xep from t_cf), 'amount', -5)))$$, 'Số tiền âm bị chặn');
select tests.assert_fails($$insert into public.shipment_fees (shipment_id, line_no, fee_type_id, fee_kind, amount) values ((select id from t_cf), 9, (select boc_xep from t_cf), 'revenue', 1)$$, 'Không ghi thẳng vào bảng phí được');
select tests.assert(
  (select string_agg(fee_name || '=' || amount::bigint, ',' order by sort_order) from public.report_fee_lines where shipment_id = (select id from t_cf) and fee_name in ('Phí bốc xếp', 'Phí chi hộ'))
  = 'Phí bốc xếp=500000,Phí chi hộ=1000000', 'Báo cáo chi tiết có từng khoản phí');
select tests.assert((select bool_and(fee_kind = 'pass_through') from public.report_fee_lines where shipment_id = (select id from t_cf) and fee_name = 'Phí chi hộ'), 'Báo cáo đánh dấu chi hộ không tính doanh thu');
select tests.assert((select count(*) from public.report_by_fee_type where fee_name = 'Cước vận chuyển') >= 1, 'Báo cáo tổng hợp theo loại phí có Cước vận chuyển');
select tests.assert_fails($$insert into public.fee_types (name) values ('Phí nâng hạ')$$, 'Điều phối không có quyền danh mục thì không thêm loại phí');
reset role;

-- Đổi loại phí sau này không đổi chuyến cũ (ảnh chụp fee_kind)
update public.fee_types set fee_kind = 'revenue' where id = (select chi_ho from t_cf);
select tests.assert((select pass_through_amount from public.shipments where id = (select id from t_cf)) = 1000000, 'Đổi loại phí không làm đổi số liệu chuyến cũ');
update public.fee_types set fee_kind = 'pass_through' where id = (select chi_ho from t_cf);

select tests.login('00000000-0000-0000-0000-0000000000c1'); -- kế toán
set role authenticated;
insert into public.fee_types (name, fee_kind) values ('Phí nâng hạ', 'revenue');
select tests.assert((select code ~ '^TK\d{4}$' from public.fee_types where name = 'Phí nâng hạ'), 'Kế toán thêm loại phí, mã tự sinh');
select tests.assert(public.set_shipment_fees((select id from t_cf), jsonb_build_array(
  jsonb_build_object('fee_type_id', (select boc_xep from t_cf), 'amount', 500000),
  jsonb_build_object('fee_type_id', (select chi_ho from t_cf), 'amount', 1000000))) = 2, 'Kế toán sửa được phí trước khi lập công nợ');
reset role;

-- Đã lập công nợ: khóa phí, công nợ gồm cả chi hộ
update public.shipments set status = 'driver_completed' where id = (select id from t_cf) and status = 'in_transit';
select tests.login('00000000-0000-0000-0000-0000000000a2'); -- admin
set role authenticated;
select public.create_receivable_from_shipments(array[(select id from t_cf)]);
select tests.assert((select r.amount from public.receivables r join public.shipments s on s.receivable_id = r.id where s.id = (select id from t_cf)) = (select base from t_cf) + 1500000,
  'Công nợ phải thu gồm cước, phí và tiền chi hộ');
select tests.assert_fails($$select public.set_shipment_fees((select id from t_cf), '[]')$$, 'Chuyến đã lập công nợ không sửa phí được');
reset role;
set role anon;
select tests.assert_fails($$select count(*) from public.shipment_fees$$, 'Người ngoài không đọc được phí');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ PHÍ THU KHÁCH ĐỀU ĐẠT'
