-- =============================================================================
-- Kiểm thử Giai đoạn 7: đối soát lương tài xế, công nợ phải thu/phải trả, báo cáo.
-- Chạy sau 07: Tài xế A có 1 chuyến đã xong trong tháng, đã ứng 1.500.000,
-- chi phí tự trả đã duyệt 200.000 (cầu đường 120.000 + rửa xe 80.000).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

create temp table t_pr (k text primary key, v text);
grant all on t_pr to anon, authenticated;
insert into t_pr values ('month', date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh')::date::text);
insert into t_pr select 's1', id::text from public.shipments
 where vehicle_id = '50000000-0000-0000-0000-000000000001' and status = 'driver_completed' order by completed_at desc limit 1;
update public.drivers set base_salary = 8000000, per_trip_salary = 300000, meal_allowance = 500000, other_allowance = 0
 where id = '40000000-0000-0000-0000-000000000001';
update public.drivers set base_salary = 6000000 where id = '40000000-0000-0000-0000-000000000002';
update public.shipments set unit_price = 5000000 where id = (select v::uuid from t_pr where k = 's1');

-- ---------------------------------------------------------------------------
-- Lương tài xế
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.driver_payroll_preview('40000000-0000-0000-0000-000000000001', current_date)$$, 'Điều phối không lập được bảng lương');
select tests.assert((select count(*) from public.payroll_list) = 0, 'Điều phối không xem được bảng lương');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
insert into t_pr select 'pv', public.driver_payroll_preview('40000000-0000-0000-0000-000000000001', (select v::date from t_pr where k = 'month'), 200000, 100000)::text;
select tests.assert((select (v::jsonb ->> 'trip_count')::int from t_pr where k = 'pv') = 1, 'Xem trước: 1 chuyến đã xong trong tháng');
select tests.assert((select (v::jsonb ->> 'expense_reimbursement')::numeric from t_pr where k = 'pv') = 200000, 'Xem trước: hoàn 200.000 chi phí tài xế tự trả');
select tests.assert((select (v::jsonb ->> 'advance_offset')::numeric from t_pr where k = 'pv') = 1500000, 'Xem trước: cấn trừ 1.500.000 tiền đã ứng');
-- 8.000.000 + 300.000 + 500.000 + 200.000 - 100.000 + 200.000 = 9.100.000; thực nhận 9.100.000 - 1.500.000
select tests.assert((select (v::jsonb ->> 'gross_amount')::numeric = 9100000 and (v::jsonb ->> 'net_amount')::numeric = 7600000 from t_pr where k = 'pv'),
  'Xem trước: tổng 9.100.000, thực nhận 7.600.000');
select tests.assert_fails($$select public.create_driver_payroll('40000000-0000-0000-0000-000000000001', current_date, -1)$$, 'Thưởng âm bị từ chối');
insert into t_pr select 'code', public.create_driver_payroll('40000000-0000-0000-0000-000000000001', (select v::date from t_pr where k = 'month'), 200000, 100000, 'Thưởng chuyên cần');
select tests.assert_fails($$select public.create_driver_payroll('40000000-0000-0000-0000-000000000001', (select v::date from t_pr where k = 'month'))$$,
  'Không lập hai bảng lương cùng tháng cho một tài xế');
update public.driver_payrolls set net_amount = 1;
reset role;
select tests.assert(not exists (select 1 from public.driver_payrolls where net_amount = 1), 'Không sửa trực tiếp bảng lương');
select tests.assert_fails($$update public.driver_payrolls set net_amount = 1$$, 'Kể cả quản trị CSDL cũng không sửa được số tiền bảng lương');
insert into t_pr select 'pr', id::text from public.driver_payrolls where code = (select v from t_pr where k = 'code');
insert into t_pr select 'apr', approval_request_id::text from public.driver_payrolls where id = (select v::uuid from t_pr where k = 'pr');
select tests.assert((select status = 'pending' and net_amount = 7600000 and expense_count = 2 from public.driver_payrolls where id = (select v::uuid from t_pr where k = 'pr')),
  'Bảng lương chờ duyệt, thực nhận 7.600.000');
select tests.assert((select count(*) from public.shipment_expenses where payroll_id = (select v::uuid from t_pr where k = 'pr')) = 2, 'Hai chi phí tự trả gắn vào bảng lương');
select tests.assert(exists (select 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000e1' and entity_id = (select v::uuid from t_pr where k = 'apr')),
  'Giám đốc nhận thông báo duyệt bảng lương');
select tests.assert(private.driver_advance_balance('40000000-0000-0000-0000-000000000001') = 0, 'Tạm ứng đã đưa vào bảng lương thì không cấn trừ lần nữa');

select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert_fails($$select public.pay_driver_payroll((select v::uuid from t_pr where k = 'pr'))$$, 'Chưa duyệt thì chưa trả lương');
select tests.assert_fails($$select public.approval_decide((select v::uuid from t_pr where k = 'apr'), 'approve')$$, 'Kế toán lập thì không tự duyệt');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert_fails($$select public.approval_decide((select v::uuid from t_pr where k = 'apr'), 'approve', null, 100)$$, 'Không sửa số tiền khi duyệt bảng lương');
select public.approval_decide((select v::uuid from t_pr where k = 'apr'), 'approve', 'Đồng ý');
select tests.assert_fails($$select public.pay_driver_payroll((select v::uuid from t_pr where k = 'pr'))$$, 'Giám đốc không trả lương được');
reset role;
select tests.assert((select status from public.driver_payrolls where id = (select v::uuid from t_pr where k = 'pr')) = 'approved', 'Bảng lương đã duyệt');
select tests.assert(exists (select 1 from public.notifications where recipient_id = '00000000-0000-0000-0000-0000000000c1' and type = 'payroll_to_pay'),
  'Kế toán nhận thông báo chờ trả lương');

select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((select can_pay from public.payroll_list where id = (select v::uuid from t_pr where k = 'pr')), 'Kế toán thấy nút trả lương');
insert into t_pr select 'pay', public.pay_driver_payroll((select v::uuid from t_pr where k = 'pr'), null, null, 'FT-LUONG-01');
select tests.assert_fails($$select public.pay_driver_payroll((select v::uuid from t_pr where k = 'pr'))$$, 'Không trả lương hai lần');
select tests.assert_fails($$select public.cancel_driver_payroll((select v::uuid from t_pr where k = 'pr'), 'Nhầm')$$, 'Không hủy bảng lương đã trả');
select tests.assert((select status = 'paid' and payment_code = (select v from t_pr where k = 'pay') from public.payroll_list where id = (select v::uuid from t_pr where k = 'pr')),
  'Danh sách bảng lương hiện đã trả kèm mã phiếu chi');
reset role;
select tests.assert((select amount = 7600000 and purpose = 'driver_settlement' and direction = 'out' from public.payments where code = (select v from t_pr where k = 'pay')),
  'Phiếu chi lương 7.600.000');
select tests.assert((select sum(amount) from public.advance_transactions where txn_type = 'settlement_offset' and payroll_id = (select v::uuid from t_pr where k = 'pr')) = 1500000,
  'Sổ tạm ứng ghi cấn trừ 1.500.000');
select tests.assert(private.driver_advance_balance('40000000-0000-0000-0000-000000000001') = 0, 'Số dư tạm ứng của tài xế về 0 sau khi trả lương');
select tests.assert((select status from public.approval_requests where id = (select v::uuid from t_pr where k = 'apr')) = 'paid', 'Yêu cầu phê duyệt chuyển Đã chi');

-- Tài xế đăng nhập Google xem bảng lương; link biển số không còn xem được lương
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((public.driver_me_payrolls() -> 'payrolls' -> 0 ->> 'net_amount')::numeric = 7600000,
  'Tài xế đăng nhập thấy bảng lương thực nhận 7.600.000');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000b2');
set role authenticated;
select tests.assert((public.driver_me_payrolls() -> 'payrolls' -> 0) is null, 'Tài xế khác không thấy bảng lương của Tài xế A');
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select tests.assert_fails($$select public.driver_me_payrolls()$$, 'Người chưa đăng nhập không xem được lương');
reset role;

-- Lập hàng loạt, từ chối, hủy rồi lập lại
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
insert into t_pr select 'bulk', public.create_driver_payrolls_for_month((select v::date from t_pr where k = 'month'))::text;
select tests.assert((select (v::jsonb ->> 'skipped')::int = 1 from t_pr where k = 'bulk'), 'Lập hàng loạt bỏ qua tài xế đã có bảng lương');
reset role;
insert into t_pr select 'apr_b', approval_request_id::text from public.driver_payrolls
 where driver_id = '40000000-0000-0000-0000-000000000002' and status = 'pending';
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select public.approval_decide((select v::uuid from t_pr where k = 'apr_b'), 'reject', 'Sai số chuyến');
reset role;
select tests.assert((select status from public.driver_payrolls where approval_request_id = (select v::uuid from t_pr where k = 'apr_b')) = 'rejected', 'Giám đốc từ chối bảng lương');
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
insert into t_pr select 'code_b', public.create_driver_payroll('40000000-0000-0000-0000-000000000002', (select v::date from t_pr where k = 'month'), 0, 0);
select public.cancel_driver_payroll((select id from public.driver_payrolls where code = (select v from t_pr where k = 'code_b')), 'Chờ đối chiếu lại');
reset role;
select tests.assert((select status = 'cancelled' from public.driver_payrolls where code = (select v from t_pr where k = 'code_b')), 'Lập lại sau khi bị từ chối, rồi hủy có lý do');
select tests.assert((select r.status from public.approval_requests r join public.driver_payrolls p on p.approval_request_id = r.id where p.code = (select v from t_pr where k = 'code_b')) = 'cancelled',
  'Hủy bảng lương thì hủy luôn yêu cầu phê duyệt');

-- ---------------------------------------------------------------------------
-- Công nợ phải thu: lập từ chuyến, thu nhiều lần, hủy phiếu thu
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((select count(*) from public.billing_shipment_list where id = (select v::uuid from t_pr where k = 's1')) = 1, 'Chuyến đã xong hiện trong danh sách chờ lập công nợ');
insert into t_pr select 'ar', public.create_receivable_from_shipments(array[(select v::uuid from t_pr where k = 's1')], null, null, 'HD0001');
select tests.assert_fails($$select public.create_receivable_from_shipments(array[(select v::uuid from t_pr where k = 's1')])$$, 'Một chuyến không lập công nợ hai lần');
reset role;
insert into t_pr select 'ar_id', id::text from public.receivables where code = (select v from t_pr where k = 'ar');
-- 5.000.000 cước + 39% hỗ trợ dầu = 6.950.000
select tests.assert((select amount from public.receivables where code = (select v from t_pr where k = 'ar')) = 6950000, 'Công nợ = cước + hỗ trợ dầu (6.950.000)');
select tests.assert_fails($$update public.shipments set unit_price = 1 where id = (select v::uuid from t_pr where k = 's1')$$, 'Chuyến đã lập công nợ bị khóa giá');

select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert_fails($$select public.record_debt_payment('receivable', (select v::uuid from t_pr where k = 'ar_id'), 7000000)$$, 'Không thu quá số còn nợ');
insert into t_pr select 'p1', public.record_debt_payment('receivable', (select v::uuid from t_pr where k = 'ar_id'), 3000000, null, null, 'CK001');
select tests.assert((select status = 'partial' and remaining_amount = 3950000 from public.receivable_list where id = (select v::uuid from t_pr where k = 'ar_id')),
  'Thu lần 1: còn nợ 3.950.000');
insert into t_pr select 'p2', public.record_debt_payment('receivable', (select v::uuid from t_pr where k = 'ar_id'), 3950000);
select tests.assert((select status = 'paid' and remaining_amount = 0 from public.receivable_list where id = (select v::uuid from t_pr where k = 'ar_id')), 'Thu lần 2: đã thu đủ');
select tests.assert_fails($$select public.void_payment((select id from public.payments where code = (select v from t_pr where k = 'p2')), '')$$, 'Hủy phiếu phải có lý do');
select public.void_payment((select id from public.payments where code = (select v from t_pr where k = 'p2')), 'Ghi nhầm số tiền');
select tests.assert((select status = 'partial' and remaining_amount = 3950000 from public.receivable_list where id = (select v::uuid from t_pr where k = 'ar_id')),
  'Hủy phiếu thu: công nợ trở lại còn 3.950.000');
select tests.assert_fails($$select public.void_payment((select id from public.payments where code = (select v from t_pr where k = 'pay')), 'x')$$, 'Chưa hủy được phiếu trả lương');
select tests.assert_fails($$select public.cancel_debt('receivable', (select v::uuid from t_pr where k = 'ar_id'), 'x')$$, 'Không hủy công nợ đã có phiếu thu');
delete from public.payments where code = (select v from t_pr where k = 'p1');
select tests.assert(exists (select 1 from public.payments where code = (select v from t_pr where k = 'p1')), 'Không xóa được phiếu thu');

-- Phải thu khác + hủy
insert into t_pr select 'ar2', public.create_receivable('10000000-0000-0000-0000-000000000001', 1000000, null, null, null, 'Phí lưu ca');
select public.cancel_debt('receivable', (select id from public.receivables where code = (select v from t_pr where k = 'ar2')), 'Khách không đồng ý');
select tests.assert((select status from public.receivable_list where code = (select v from t_pr where k = 'ar2')) = 'cancelled', 'Hủy công nợ chưa thu có lý do');

-- Phải trả nhà cung cấp, trả nhiều lần
insert into t_pr select 'ap', public.create_payable(null, '40000000-0000-0000-0000-000000000002', 2000000, 'Thuê xe ngoài chở hộ');
insert into t_pr select 'ap_id', id::text from public.payables where code = (select v from t_pr where k = 'ap');
select public.record_debt_payment('payable', (select v::uuid from t_pr where k = 'ap_id'), 500000);
select tests.assert((select status = 'partial' and remaining_amount = 1500000 and partner_name = 'Tài xế B (tài xế)' from public.payable_list where id = (select v::uuid from t_pr where k = 'ap_id')),
  'Trả nhà cung cấp lần 1: còn 1.500.000');
select tests.assert((select count(*) from public.payment_list where direction = 'in' and status = 'posted') = 1, 'Danh sách phiếu thu/chi đúng trạng thái');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.record_debt_payment('receivable', (select v::uuid from t_pr where k = 'ar_id'), 1000)$$, 'Điều phối không thu tiền công nợ được');
select tests.assert((select count(*) from public.receivable_list) = 0, 'Điều phối không xem được công nợ');
-- Điều phối có quyền xem báo cáo
select tests.assert((select profit from public.report_shipment_profit where id = (select v::uuid from t_pr where k = 's1')) = 6950000 - 200000,
  'Báo cáo lợi nhuận chuyến = doanh thu - chi phí đã duyệt');
reset role;

-- ---------------------------------------------------------------------------
-- Báo cáo
-- ---------------------------------------------------------------------------
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((select revenue from public.report_monthly where report_month = (select v::date from t_pr where k = 'month')) >= 6950000, 'Báo cáo tháng có doanh thu');
select tests.assert((select cash_in from public.report_monthly where report_month = (select v::date from t_pr where k = 'month')) = 3000000, 'Báo cáo tháng: tiền thu thực tế 3.000.000 (bỏ phiếu đã hủy)');
select tests.assert((select trips from public.report_by_driver where driver_id = '40000000-0000-0000-0000-000000000001' and report_month = (select v::date from t_pr where k = 'month')) >= 1,
  'Báo cáo theo tài xế');
select tests.assert((select amount from public.report_expense_by_category r join public.expense_categories c on c.id = r.category_id where c.code = 'TOLL') = 120000,
  'Báo cáo chi phí theo loại');
select tests.assert((select balance from public.report_advance_balance where driver_id = '40000000-0000-0000-0000-000000000001') = 0, 'Báo cáo số dư tạm ứng');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000f2');
set role authenticated;
select tests.assert((select count(*) from public.report_shipment_profit) = 0, 'Tài khoản chưa cấp quyền không xem được báo cáo');
reset role;
set role anon;
select tests.assert_fails($$select count(*) from public.report_monthly$$, 'Người ngoài không xem được báo cáo');
select tests.assert_fails($$select public.create_receivable_from_shipments(array[gen_random_uuid()])$$, 'Người ngoài không lập công nợ được');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ LƯƠNG TÀI XẾ, CÔNG NỢ, BÁO CÁO ĐỀU ĐẠT'
