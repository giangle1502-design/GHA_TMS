-- =============================================================================
-- Kiểm thử 0064: bảng chấm công tài xế
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

create temp table t_at (k text primary key, v text);
grant all on t_at to authenticated;
insert into t_at values ('drv', '40000000-0000-0000-0000-000000000001');
insert into t_at select 'tripday', (responded_at at time zone 'Asia/Ho_Chi_Minh')::date::text from public.shipment_assignments
where driver_id = '40000000-0000-0000-0000-000000000001' and response = 'accepted' and responded_at is not null
order by responded_at desc limit 1;
-- Ngày trống: 400 ngày trước (không chuyến), không phải Chủ nhật
insert into t_at select 'empty', d::text from (
  select ((now() at time zone 'Asia/Ho_Chi_Minh')::date - g) as d from generate_series(400, 410) g) x
where extract(dow from d) <> 0 order by d desc limit 1;
insert into t_at select 'sunday', d::text from (
  select ((now() at time zone 'Asia/Ho_Chi_Minh')::date - g) as d from generate_series(400, 410) g) x
where extract(dow from d) = 0 limit 1;
update public.drivers set start_date = null where id = (select v::uuid from t_at where k = 'drv');
select tests.assert((select count(*) from t_at) = 4, 'Có ngày nhận chuyến, ngày trống, Chủ nhật để thử');

create or replace function pg_temp.st(p_day text) returns text language sql as $$
  select a.status from private.attendance_rows((select v::date from t_at where k = p_day), (select v::date from t_at where k = p_day),
    (select v::uuid from t_at where k = 'drv')) a
$$;
select tests.assert(pg_temp.st('tripday') = 'work', 'Ngày tài xế nhận chuyến: tự chấm công');
select tests.assert(pg_temp.st('empty') = 'pending', 'Ngày đã qua không chuyến, không đơn nghỉ: chờ xác nhận');
select tests.assert(pg_temp.st('sunday') = 'off', 'Chủ nhật (ngày nghỉ tuần): không cảnh báo');

-- Tài xế không xem / không sửa; điều phối xác nhận được
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert_fails($$select public.attendance_month(current_date)$$, 'Tài xế không xem bảng chấm công');
select tests.assert_fails($$select public.set_driver_attendance(array[(select v::uuid from t_at where k = 'drv')], array[(select v::date from t_at where k = 'empty')], 'work')$$,
  'Tài xế không tự chấm công');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert(jsonb_array_length(public.attendance_month((select v::date from t_at where k = 'empty')) -> 'drivers') > 0, 'Điều phối xem bảng chấm công tháng');
select tests.assert(public.attendance_pending_count() >= 0, 'Đếm ngày chờ xác nhận');
select tests.assert_fails($$select public.set_driver_attendance(array[(select v::uuid from t_at where k = 'drv')], array[(select v::date from t_at where k = 'empty')], 'vui')$$,
  'Trạng thái lạ bị từ chối');
select public.set_driver_attendance(array[(select v::uuid from t_at where k = 'drv')], array[(select v::date from t_at where k = 'empty')], 'leave_unpaid', 'Báo nghỉ qua điện thoại');
reset role;
select tests.assert(pg_temp.st('empty') = 'leave_unpaid', 'Điều phối xác nhận nghỉ không lương');
select tests.assert(exists (select 1 from public.audit_logs where entity_type = 'driver_attendance'), 'Xác nhận ngày công được ghi nhật ký');
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.lock_attendance_month((select v::date from t_at where k = 'empty'), true)$$, 'Điều phối không chốt công');
reset role;

-- Kế toán chốt công: còn ngày chờ xác nhận thì không chốt được
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert_fails($$select public.lock_attendance_month((select v::date from t_at where k = 'empty'), true)$$, 'Còn ngày chờ xác nhận thì chưa chốt được');
-- Xác nhận hết các ngày chờ của tháng đó rồi chốt
reset role;
insert into t_at select 'm', date_trunc('month', v::date)::date::text from t_at where k = 'empty';
create temp table t_pend as
select a.driver_id, a.work_date from private.attendance_rows((select v::date from t_at where k = 'm'),
  ((select v::date from t_at where k = 'm') + interval '1 month - 1 day')::date, null) a where a.status = 'pending';
grant select on t_pend to authenticated;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select public.set_driver_attendance((select array_agg(driver_id order by driver_id, work_date) from t_pend),
  (select array_agg(work_date order by driver_id, work_date) from t_pend), 'work')
where exists (select 1 from t_pend);
select public.lock_attendance_month((select v::date from t_at where k = 'm'), true);
select tests.assert((public.attendance_month((select v::date from t_at where k = 'm')) ->> 'locked')::boolean, 'Đã chốt công tháng');
select tests.assert_fails($$select public.set_driver_attendance(array[(select v::uuid from t_at where k = 'drv')], array[(select v::date from t_at where k = 'empty')], 'work')$$,
  'Tháng đã chốt: không sửa ngày công');
select public.lock_attendance_month((select v::date from t_at where k = 'm'), false);
select tests.assert(not (public.attendance_month((select v::date from t_at where k = 'm')) ->> 'locked')::boolean, 'Mở chốt được');

-- Bảng lương: ngày nghỉ không lương trừ lương cơ bản theo công chuẩn
reset role;
insert into public.driver_pay_components (driver_id, component_id, amount)
select (select v::uuid from t_at where k = 'drv'), id, 2600000 from public.pay_components where code = 'LCB';
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
insert into t_at select 'pv', public.driver_payroll_preview((select v::uuid from t_at where k = 'drv'), (select v::date from t_at where k = 'm'))::text;
select tests.assert((select (v::jsonb -> 'attendance' ->> 'leave_unpaid')::int from t_at where k = 'pv') = 1, 'Bảng lương thấy 1 ngày nghỉ không lương');
select tests.assert((select (v::jsonb ->> 'base_salary')::numeric = round(2600000 * ((v::jsonb ->> 'standard_days')::numeric - 1) / (v::jsonb ->> 'standard_days')::numeric)
  from t_at where k = 'pv'), 'Lương cơ bản trừ 1 ngày theo công chuẩn');
select public.set_payroll_setting('payroll.deduct_base_unpaid', 'false');
select tests.assert((public.driver_payroll_preview((select v::uuid from t_at where k = 'drv'), (select v::date from t_at where k = 'm')) ->> 'base_salary')::numeric = 2600000,
  'Tắt trừ lương cơ bản: giữ đủ lương cơ bản');
select public.set_payroll_setting('payroll.deduct_base_unpaid', 'true');
reset role;

-- Dọn
delete from public.driver_pay_components where driver_id = (select v::uuid from t_at where k = 'drv');
delete from public.driver_attendance;
delete from public.attendance_locks;

\o
\echo 'TẤT CẢ KIỂM THỬ CHẤM CÔNG TÀI XẾ ĐỀU ĐẠT'
