-- =============================================================================
-- Kiểm thử 0069: đơn giá dầu theo xe
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
\i supabase/migrations/20261110000069_vehicle_fuel_price.sql

create temp table t_fp (k text primary key, v text);
grant all on t_fp to authenticated;
insert into t_fp select 'veh', id::text from public.vehicles where ownership_type <> 'outsourced' and archived_at is null and status <> 'sold' order by code limit 1;
insert into t_fp select 'plate', plate_number from public.vehicles where id = (select v::uuid from t_fp where k = 'veh');
delete from public.vehicle_fuel_months where vehicle_id = (select v::uuid from t_fp where k = 'veh');
create or replace function pg_temp.row_of(p_month date) returns jsonb language sql as $$
  select e from jsonb_array_elements(public.fuel_month(p_month) -> 'rows') e where e ->> 'vehicle_id' = (select v from t_fp where k = 'veh')
$$;

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.save_vehicle_fuel((select v::uuid from t_fp where k = 'veh'), '2026-09-01',
  '{"km_start": 1000, "km_end": 2000, "fuel_opening": 50, "fuel_added": 400, "fuel_remaining": 100, "fuel_price": 20500}');
select tests.assert((pg_temp.row_of('2026-09-01') ->> 'fuel_price')::numeric = 20500, 'Lưu đơn giá dầu');
select tests.assert((pg_temp.row_of('2026-10-01') ->> 'fuel_price')::numeric = 20500 and (pg_temp.row_of('2026-10-01') ->> 'fuel_price_auto')::boolean,
  'Tháng sau tự lấy đơn giá tháng trước');
select tests.assert_fails($$select public.save_vehicle_fuel((select v::uuid from t_fp where k = 'veh'), '2026-09-01', '{"fuel_price": -1}')$$, 'Đơn giá âm bị từ chối');
select tests.assert((public.import_vehicle_fuel('2026-10-01', jsonb_build_array(
  jsonb_build_object('plate', (select v from t_fp where k = 'plate'), 'fuel_price', 21000))) ->> 'saved')::int = 1, 'Nhập Excel đơn giá');
select tests.assert((pg_temp.row_of('2026-10-01') ->> 'fuel_price')::numeric = 21000, 'Đơn giá nhập Excel được lưu');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
reset role;
-- Chốt tháng 11 (không nhập gì) ghi cố định đơn giá tự lấy
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select public.set_vehicle_fuel_final((select v::uuid from t_fp where k = 'veh'), '2026-11-01', 300);
select tests.assert(public.lock_vehicle_fuel(array[(select v::uuid from t_fp where k = 'veh')], '2026-11-01', true) = 1, 'Giám đốc chốt tháng 11');
reset role;
select tests.assert((select fuel_price = 21000 from public.vehicle_fuel_months where vehicle_id = (select v::uuid from t_fp where k = 'veh') and period_month = '2026-11-01'),
  'Chốt ghi cố định đơn giá tự lấy');
delete from public.vehicle_fuel_months where vehicle_id = (select v::uuid from t_fp where k = 'veh');
\o
\echo '51_vehicle_fuel_price_tests: OK'
