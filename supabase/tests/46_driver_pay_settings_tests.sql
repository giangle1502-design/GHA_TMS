-- =============================================================================
-- Kiểm thử 0063: thiết lập lương do người dùng chọn (trừ tiền ứng, ngày nghỉ tuần,
-- ngày lễ, thêm tiền chuyến ngày nghỉ) và chi tiết hoàn chi phí theo danh mục.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

create temp table t_st (k text primary key, v text);
grant all on t_st to authenticated;
insert into t_st values ('drv', '40000000-0000-0000-0000-000000000001');
insert into t_st select 's', id::text from public.shipments
where driver_id = '40000000-0000-0000-0000-000000000001' and status in ('driver_completed', 'closed') and not private.shipment_is_3pl(vehicle_id)
order by completed_at desc limit 1;
insert into t_st select 'day', (completed_at at time zone 'Asia/Ho_Chi_Minh')::date::text from public.shipments where id = (select v::uuid from t_st where k = 's');
insert into t_st select 'month', date_trunc('month', v::date)::date::text from t_st where k = 'day';
insert into t_st select 'trips_on_day', count(*)::text from public.shipments
where driver_id = (select v::uuid from t_st where k = 'drv') and status in ('driver_completed', 'closed') and not private.shipment_is_3pl(vehicle_id)
  and (completed_at at time zone 'Asia/Ho_Chi_Minh')::date = (select v::date from t_st where k = 'day');
select tests.assert((select count(*) from t_st) = 5, 'Có chuyến hoàn thành để thử');
select tests.assert((select not is_active from public.pay_components where code = 'PCBX'), 'Khoản nhập tay Bốc xếp đã tắt (chuyển sang hoàn chi phí)');
select tests.assert(exists (select 1 from public.pay_components where code = 'CHUYENNGHI' and method = 'per_trip_offday'), 'Có khoản Thêm tiền chuyến ngày nghỉ, lễ');

create or replace function pg_temp.pv(p_offset boolean default null) returns jsonb language sql as $$
  select public.driver_payroll_preview((select v::uuid from t_st where k = 'drv'), (select v::date from t_st where k = 'month'), 0, 0, '{}'::jsonb, p_offset)
$$;

-- Điều phối không xem, không đổi thiết lập lương
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.payroll_settings()$$, 'Điều phối không xem thiết lập lương');
select tests.assert_fails($$select public.set_payroll_setting('payroll.offset_advance', 'false')$$, 'Điều phối không đổi thiết lập lương');
select tests.assert_fails($$insert into public.pay_holidays (holiday_date, name) values (date '2026-09-02', 'Quốc khánh')$$, 'Điều phối không thêm ngày lễ');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((public.payroll_settings() ->> 'offset_advance')::boolean, 'Mặc định trừ tiền ứng vào lương');
select tests.assert((public.payroll_settings() -> 'weekly_off_days') = '[0]'::jsonb, 'Mặc định nghỉ Chủ nhật');
select tests.assert_fails($$select public.set_payroll_setting('payroll.weekly_off_days', '[7]')$$, 'Ngày trong tuần ngoài 0..6 bị từ chối');
select tests.assert_fails($$select public.set_payroll_setting('payroll.offset_advance', '"có"')$$, 'Trừ tiền ứng phải là bật/tắt');
select tests.assert_fails($$select public.set_payroll_setting('dispatch.require_director_approval', 'false')$$, 'Không đổi được tham số ngoài lương');

-- Ngày có chuyến thành ngày nghỉ (đổi ngày nghỉ tuần sang đúng thứ đó) → khoản thêm tiền ngày nghỉ
select public.set_payroll_setting('payroll.weekly_off_days',
  jsonb_build_array(extract(dow from (select v::date from t_st where k = 'day'))::int));
insert into public.driver_pay_components (driver_id, component_id, amount)
select (select v::uuid from t_st where k = 'drv'), id, 100000 from public.pay_components where code = 'CHUYENNGHI';
select tests.assert((pg_temp.pv() ->> 'offday_trips')::int >= (select v::int from t_st where k = 'trips_on_day'), 'Đếm được chuyến chạy ngày nghỉ trong tuần');
select tests.assert(jsonb_path_exists(pg_temp.pv(), '$.components[*] ? (@.code == "CHUYENNGHI" && @.amount > 0)'), 'Có tiền thêm cho chuyến ngày nghỉ');
-- Không còn ngày nghỉ tuần → không có tiền thêm; thêm ngày lễ đúng ngày đó → lại có
select public.set_payroll_setting('payroll.weekly_off_days', '[]');
select tests.assert((pg_temp.pv() ->> 'offday_trips')::int = 0, 'Bỏ ngày nghỉ tuần: không còn chuyến ngày nghỉ');
insert into public.pay_holidays (holiday_date, name) values ((select v::date from t_st where k = 'day'), 'Ngày lễ thử');
select tests.assert((pg_temp.pv() ->> 'offday_trips')::int = (select v::int from t_st where k = 'trips_on_day'), 'Ngày lễ: chuyến hôm đó được tính ngày nghỉ');

-- Trừ tiền ứng vào lương: tắt thì không cấn trừ, tạm ứng chuyển hết sang sau
reset role;
insert into public.advance_transactions (driver_id, txn_type, amount, note)
select (select v::uuid from t_st where k = 'drv'), 'disbursement', 300000, 'Ứng thử 0063';
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((pg_temp.pv() ->> 'advance_offset')::numeric > 0, 'Bật: trừ tiền ứng vào lương');
select public.set_payroll_setting('payroll.offset_advance', 'false');
select tests.assert((pg_temp.pv() ->> 'advance_offset')::numeric = 0 and (pg_temp.pv() ->> 'advance_carry')::numeric >= 300000, 'Tắt: không trừ, tạm ứng giữ lại');
select tests.assert((pg_temp.pv(true) ->> 'advance_offset')::numeric > 0, 'Từng bảng lương vẫn chọn trừ được khi thiết lập tắt');
select public.set_payroll_setting('payroll.offset_advance', 'true');
select tests.assert((pg_temp.pv(false) ->> 'advance_offset')::numeric = 0, 'Từng bảng lương chọn không trừ được khi thiết lập bật');
select tests.assert(jsonb_typeof(pg_temp.pv() -> 'expense_lines') = 'array', 'Có chi tiết hoàn chi phí theo danh mục');
reset role;

-- Dọn
delete from public.advance_transactions where note = 'Ứng thử 0063';
delete from public.pay_holidays;
delete from public.driver_pay_components where driver_id = (select v::uuid from t_st where k = 'drv');
update public.system_settings set value = '[0]' where key = 'payroll.weekly_off_days';

\o
\echo 'TẤT CẢ KIỂM THỬ THIẾT LẬP LƯƠNG (NGÀY NGHỈ, TRỪ TIỀN ỨNG) ĐỀU ĐẠT'
