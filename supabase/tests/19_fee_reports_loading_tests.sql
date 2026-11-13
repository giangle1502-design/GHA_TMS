-- =============================================================================
-- Kiểm thử 0030: báo cáo cước vận chuyển, chi hộ, bốc xếp; chi phí bốc xếp trả tài xế hoặc nhà thầu.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
insert into public.suppliers (name) values ('Tổ bốc xếp Kiểm Thử');
create temp table t_ld as
  select s.id,
         (select id from public.fee_types where name = 'Phí bốc xếp') as boc_xep,
         (select id from public.fee_types where name = 'Phí chi hộ') as chi_ho,
         (select id from public.expense_categories where code = 'LOADING') as c_loading,
         (select id from public.expense_categories where code = 'LIFTING') as c_lifting,
         (select id from public.expense_categories where code = 'TOLL') as c_toll,
         (select id from public.suppliers where name = 'Tổ bốc xếp Kiểm Thử') as sup
  from public.shipments s where s.status in ('in_transit', 'driver_completed') and s.receivable_id is null and s.driver_id is not null
  order by s.created_at desc limit 1;
grant select on t_ld to authenticated, anon;
select tests.assert((select count(*) from t_ld) = 1, 'Có chuyến đang chạy để kiểm thử');
select tests.assert((select is_loading from public.fee_types where id = (select boc_xep from t_ld)), 'Phí bốc xếp thuộc nhóm bốc xếp');
select tests.assert((select report_bucket from public.expense_categories where code = 'LOADING') = 'loading', 'Chi phí Bốc xếp tách thành nhóm báo cáo riêng');

select tests.login('00000000-0000-0000-0000-0000000000a2'); -- admin
set role authenticated;
select public.set_shipment_fees((select id from t_ld), jsonb_build_array(
  jsonb_build_object('fee_type_id', (select boc_xep from t_ld), 'amount', 500000),
  jsonb_build_object('fee_type_id', (select chi_ho from t_ld), 'amount', 200000, 'note', 'Phí cảng')));
create temp table t_ex (id uuid);
insert into t_ex select public.add_shipment_expense((select id from t_ld), (select c_loading from t_ld), 300000, null, 'Bốc hàng', 'driver');
insert into t_ex select public.add_shipment_expense((select id from t_ld), (select c_lifting from t_ld), 150000, null, 'Nâng cont', 'company', null, '{}', null, (select sup from t_ld));
insert into t_ex select public.add_shipment_expense((select id from t_ld), (select c_toll from t_ld), 90000, null, 'Cầu đường', 'driver');
select tests.assert((select supplier_name from public.expense_list where supplier_id = (select sup from t_ld) limit 1) = 'Tổ bốc xếp Kiểm Thử', 'Chi phí công ty trả ghi được nhà thầu');
select tests.assert_fails($$select public.add_shipment_expense((select id from t_ld), (select c_loading from t_ld), 1000, null, null, 'driver', null, '{}', null, (select sup from t_ld))$$,
  'Tài xế tự trả thì không chọn nhà thầu');
select tests.assert((select pending_cost from public.report_loading where id = (select id from t_ld)) = 450000, 'Chi bốc xếp chờ duyệt hiện riêng, không gồm cầu đường');
reset role;
update public.shipment_expenses set status = 'approved' where id in (select id from t_ex);

select tests.login('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select tests.assert((select loading_revenue::bigint || '|' || driver_paid::bigint || '|' || company_paid::bigint || '|' || loading_margin::bigint || '|' || contractors
                     from public.report_loading where id = (select id from t_ld)) = '500000|300000|150000|50000|Tổ bốc xếp Kiểm Thử',
  'Báo cáo bốc xếp: thu khách, tài xế trả, nhà thầu trả, chênh lệch');
select tests.assert((select amount::bigint || '|' || note from public.report_pass_through_fees where shipment_id = (select id from t_ld)) = '200000|Phí cảng', 'Báo cáo chi hộ có khoản chi hộ');
select tests.assert((select count(*) from public.report_pass_through_fees where fee_kind <> 'pass_through') = 0, 'Báo cáo chi hộ chỉ có khoản chi hộ');
select tests.assert((select freight_total = freight_amount + surcharge_amount + fuel_support_amount and unit_price is not null from public.report_shipment_profit where id = (select id from t_ld)),
  'Báo cáo cước có đơn giá và tổng cước');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000b1'); -- tài xế
set role authenticated;
select tests.assert((select count(*) from public.report_loading) = 0, 'Tài xế không xem báo cáo bốc xếp');
reset role;
set role anon;
select tests.assert_fails($$select count(*) from public.report_loading$$, 'Người ngoài không đọc được báo cáo bốc xếp');
reset role;

-- Sửa chuyến đã đóng (chưa lập công nợ) và sửa đầu đơn hàng
reset role;
create temp table t_ord as select s.id as sid, s.order_id as oid, (select id from public.customers order by created_at desc limit 1) as other_cust
  from public.shipments s where s.status <> 'cancelled' and not exists (select 1 from public.shipments x where x.order_id = s.order_id and x.receivable_id is not null) order by s.created_at limit 1;
grant select on t_ord to authenticated;
select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối
set role authenticated;
update public.transport_orders set payer_customer_id = (select other_cust from t_ord), notes = 'Sửa khách thanh toán' where id = (select oid from t_ord);
select tests.assert((select payer_customer_id = (select other_cust from t_ord) from public.transport_orders where id = (select oid from t_ord)), 'Điều phối sửa được khách thanh toán của đơn');
select tests.assert_fails($$update public.transport_orders set order_code = 'X' where id = (select oid from t_ord)$$, 'Không đổi được mã đơn hàng');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1'); -- kế toán
set role authenticated;
update public.transport_orders set notes = 'kt' where id = (select oid from t_ord);
select tests.assert((select notes from public.transport_orders where id = (select oid from t_ord)) = 'Sửa khách thanh toán', 'Kế toán không có quyền điều phối thì không sửa được đơn');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2'); -- admin
set role authenticated;
select tests.assert_fails($$update public.transport_orders set customer_id = (select other_cust from t_ord) where id = (select order_id from public.shipments where receivable_id is not null limit 1)$$,
  'Đơn có chuyến đã lập công nợ thì không đổi khách hàng');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ BÁO CÁO CƯỚC, CHI HỘ, BỐC XẾP ĐỀU ĐẠT'
