-- =============================================================================
-- Kiểm thử 0065: lương chuyến chiều về tính theo % (thiết lập chung + từng dòng đơn giá)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

create temp table t_rt (k text primary key, v text);
grant all on t_rt to authenticated;
insert into t_rt select 's', id::text from public.shipments
where driver_id = '40000000-0000-0000-0000-000000000001' and status in ('driver_completed', 'closed') and not private.shipment_is_3pl(vehicle_id)
  and pickup_location_id is not null and delivery_location_id is not null and pickup_location_id <> delivery_location_id
order by completed_at desc limit 1;
insert into t_rt select 'pick', pickup_location_id::text from public.shipments where id = (select v::uuid from t_rt where k = 's');
insert into t_rt select 'del', delivery_location_id::text from public.shipments where id = (select v::uuid from t_rt where k = 's');
select tests.assert((select count(*) from t_rt) = 3, 'Có chuyến hoàn thành để thử');
update public.drivers set pay_type = 'base_and_trip' where id = '40000000-0000-0000-0000-000000000001';
delete from public.trip_pay_rates;

create function pg_temp.amt() returns numeric language sql as $$
  select (public.trip_pay_rate_preview((select v::uuid from t_rt where k = 's')) ->> 'pay_amount')::numeric $$;
create function pg_temp.line() returns jsonb language sql as $$
  select public.trip_pay_rate_preview((select v::uuid from t_rt where k = 's')) $$;

select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((public.payroll_settings() ->> 'return_trip_percent')::numeric = 100, 'Mặc định chiều về 100%');

-- Tuyến khai Điểm 1 = điểm nhận, Điểm 2 = điểm giao: chuyến là chiều đi
insert into public.trip_pay_rates (location_a_id, location_b_id, amount)
values ((select v::uuid from t_rt where k = 'pick'), (select v::uuid from t_rt where k = 'del'), 1000000);
select public.set_payroll_setting('payroll.return_trip_percent', '80'::jsonb);
select tests.assert(pg_temp.amt() = 1000000 and pg_temp.line() ->> 'trip_direction' = 'outbound', 'Chiều đi: đủ đơn giá');

-- Đảo tuyến: chuyến thành chiều về, áp 80% chung
update public.trip_pay_rates set location_a_id = (select v::uuid from t_rt where k = 'del'), location_b_id = (select v::uuid from t_rt where k = 'pick');
select tests.assert(pg_temp.amt() = 800000 and pg_temp.line() ->> 'trip_direction' = 'return'
  and (pg_temp.line() ->> 'return_percent')::numeric = 80 and (pg_temp.line() ->> 'rate_amount')::numeric = 1000000, 'Chiều về: 80% thiết lập chung');
-- % riêng của dòng đơn giá thắng thiết lập chung
update public.trip_pay_rates set return_percent = 75;
select tests.assert(pg_temp.amt() = 750000, 'Chiều về: % riêng của dòng đơn giá');

-- Giá theo địa điểm: lấy hàng tại địa điểm = chiều về, giao tới = chiều đi
delete from public.trip_pay_rates;
insert into public.trip_pay_rates (location_a_id, amount) values ((select v::uuid from t_rt where k = 'pick'), 1000000);
select tests.assert(pg_temp.amt() = 800000, 'Địa điểm: lấy hàng tại địa điểm là chiều về');
update public.trip_pay_rates set location_a_id = (select v::uuid from t_rt where k = 'del');
select tests.assert(pg_temp.amt() = 1000000, 'Địa điểm: giao tới địa điểm là chiều đi');

-- Giá mặc định không phân chiều
delete from public.trip_pay_rates;
insert into public.trip_pay_rates (amount) values (700000);
select tests.assert(pg_temp.amt() = 700000 and pg_temp.line() ->> 'trip_direction' is null, 'Giá mặc định không phân chiều');

select tests.assert_fails($$select public.set_payroll_setting('payroll.return_trip_percent', '250'::jsonb)$$, '% chiều về quá 200 bị chặn');
select tests.assert_fails($$update public.trip_pay_rates set return_percent = -1$$, '% riêng âm bị chặn');
select tests.login('00000000-0000-0000-0000-0000000000d1');
select tests.assert_fails($$select public.set_payroll_setting('payroll.return_trip_percent', '90'::jsonb)$$, 'Điều phối không đổi được % chiều về');
reset role;

-- Dọn
delete from public.trip_pay_rates;
update public.system_settings set value = '100'::jsonb where key = 'payroll.return_trip_percent';

\o
\echo 'TẤT CẢ KIỂM THỬ LƯƠNG CHUYẾN CHIỀU VỀ ĐỀU ĐẠT'
