-- =============================================================================
-- Kiểm thử 0067: báo cáo tổng chi theo nhóm phí, đánh dấu chi hộ ở phí chi ra
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
select tests.assert((select is_pass_through from public.expense_categories where 'LIFTING' in (code, legacy_code)), 'Phí Nâng hạ tự đánh dấu chi hộ');
select tests.assert((select not is_pass_through from public.expense_categories where 'DIESEL' in (code, legacy_code)), 'Dầu diesel không phải chi hộ');
select tests.assert((select counts_as = 'pass_through' from public.fee_catalog_items where name = 'Nâng hạ' and fee_source = 'expense'),
  'Danh mục phí gộp hiện Chi hộ cho phí chi ra đánh dấu chi hộ');

create temp table t_sp as
  select s.id from public.shipments s where s.status <> 'cancelled' and s.vehicle_id is not null order by s.created_at desc limit 1;
grant select on t_sp to authenticated;
insert into public.shipment_expenses (shipment_id, category_id, amount, source, status, note)
select id, (select id from public.expense_categories where 'DIESEL' in (code, legacy_code)), 1234567, 'admin', 'approved', 'kt-0067-dau' from t_sp
union all
select id, (select id from public.expense_categories where 'LIFTING' in (code, legacy_code)), 450000, 'admin', 'approved', 'kt-0067-nang' from t_sp
union all
select id, (select id from public.expense_categories where 'TOLL' in (code, legacy_code)), 80000, 'admin', 'pending', 'kt-0067-cho' from t_sp;
insert into public.shipment_carrier_costs (shipment_id, line_no, cost_kind, description, amount, note)
select id, 91, 'freight', 'Cước', 2000000, 'kt-0067-3pl' from t_sp
union all
select id, 92, 'pass_through', 'Nâng cont', 300000, 'kt-0067-3pl-ch' from t_sp;

select tests.login('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select tests.assert((select source = 'trip' and group_name = 'Nhiên liệu' and not is_pass_through and status = 'approved' and amount = 1234567
  from public.report_spending_lines where note = 'kt-0067-dau'), 'Chi phí chuyến có nhóm phí chi ra, đã duyệt');
select tests.assert((select is_pass_through from public.report_spending_lines where note = 'kt-0067-nang'), 'Nâng hạ là chi hộ (báo cáo loại ra)');
select tests.assert((select status = 'pending' from public.report_spending_lines where note = 'kt-0067-cho'), 'Khoản chờ duyệt có trạng thái riêng');
select tests.assert((select source = 'carrier' and not is_pass_through and group_name = 'Thuê xe ngoài 3PL' from public.report_spending_lines where note = 'kt-0067-3pl'),
  'Cước 3PL tính vào chi');
select tests.assert((select is_pass_through from public.report_spending_lines where note = 'kt-0067-3pl-ch'), 'Chi hộ 3PL loại ra');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((select count(*) from public.report_spending_lines) = 0, 'Tài xế không xem được báo cáo tổng chi');
reset role;
delete from public.shipment_carrier_costs where note like 'kt-0067%';
\o
\echo '49_spending_report_tests: OK'
