-- =============================================================================
-- Kiểm thử 0068: dầu theo từng xe theo tháng
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

create temp table t_fu (k text primary key, v text);
grant all on t_fu to authenticated;
insert into t_fu select 'veh', id::text from public.vehicles where ownership_type <> 'outsourced' and archived_at is null and status <> 'sold' order by code limit 1;
insert into t_fu select 'plate', plate_number from public.vehicles where id = (select v::uuid from t_fu where k = 'veh');
update public.vehicles set fuel_ratio_l_per_km = 0.35 where id = (select v::uuid from t_fu where k = 'veh');
delete from public.vehicle_fuel_months where vehicle_id = (select v::uuid from t_fu where k = 'veh');

create or replace function pg_temp.row_of(p_month date) returns jsonb language sql as $$
  select e from jsonb_array_elements(public.fuel_month(p_month) -> 'rows') e where e ->> 'vehicle_id' = (select v from t_fu where k = 'veh')
$$;

-- Tài xế không xem, không sửa
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert_fails($$select public.fuel_month('2026-09-01')$$, 'Tài xế không xem dầu theo xe');
select tests.assert_fails($$select public.save_vehicle_fuel((select v::uuid from t_fu where k = 'veh'), '2026-09-01', '{"km_end": 1}')$$, 'Tài xế không nhập số dầu');
select tests.assert((select count(*) from public.vehicle_fuel_months) = 0, 'Tài xế không đọc bảng dầu');
reset role;

-- Điều phối nhập tháng 9
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert((pg_temp.row_of('2026-09-01') ->> 'fuel_ratio')::numeric = 0.35, 'Tỷ trọng lấy từ Phương tiện');
select tests.assert((pg_temp.row_of('2026-09-01') ->> 'fuel_ratio_auto')::boolean, 'Tỷ trọng đánh dấu tự lấy');
select public.save_vehicle_fuel((select v::uuid from t_fu where k = 'veh'), '2026-09-15',
  '{"km_start": 10000, "km_end": 12000, "fuel_opening": 100, "fuel_added": 700, "fuel_remaining": 120}');
select tests.assert((pg_temp.row_of('2026-09-01') ->> 'km_end')::int = 12000, 'Lưu KM cuối tháng (ngày bất kỳ trong tháng → đầu tháng)');
select tests.assert_fails($$select public.save_vehicle_fuel((select v::uuid from t_fu where k = 'veh'), '2026-09-01', '{"km_end": 9000}')$$,
  'KM cuối nhỏ hơn KM đầu bị từ chối');
select tests.assert_fails($$select public.save_vehicle_fuel((select v::uuid from t_fu where k = 'veh'), '2026-09-01', '{"fuel_added": -5}')$$, 'Số âm bị từ chối');
select tests.assert_fails($$select public.save_vehicle_fuel((select v::uuid from t_fu where k = 'veh'), '2026-09-01', '{"final_fuel": 5}')$$,
  'Điều phối không tự nhập số chốt qua ô thường');
select tests.assert_fails($$select public.set_vehicle_fuel_final((select v::uuid from t_fu where k = 'veh'), '2026-09-01', 600)$$, 'Điều phối không nhập số chốt');
select tests.assert_fails($$select public.lock_vehicle_fuel(array[(select v::uuid from t_fu where k = 'veh')], '2026-09-01', true, 'actual')$$, 'Điều phối không chốt');

-- Tháng 10 tự lấy KM đầu = KM cuối tháng 9, tồn đầu = còn lại tháng 9
select tests.assert((pg_temp.row_of('2026-10-01') ->> 'km_start')::int = 12000 and (pg_temp.row_of('2026-10-01') ->> 'km_start_auto')::boolean,
  'KM đầu tháng sau tự lấy KM cuối tháng trước');
select tests.assert((pg_temp.row_of('2026-10-01') ->> 'fuel_opening')::numeric = 120, 'Tồn dầu đầu tháng sau = dầu còn lại tháng trước');

-- Nhập Excel: dòng đúng lưu, dòng sai báo lỗi
select tests.assert((public.import_vehicle_fuel('2026-10-01', jsonb_build_array(
    jsonb_build_object('row', 2, 'plate', lower((select v from t_fu where k = 'plate')), 'km_end', 14500, 'fuel_added', 900, 'fuel_remaining', 150),
    jsonb_build_object('row', 3, 'plate', 'XEKHONGCO99', 'km_end', 1))) ->> 'saved')::int = 1, 'Nhập Excel lưu dòng đúng (biển số chữ thường vẫn khớp)');
select tests.assert(jsonb_array_length(public.import_vehicle_fuel('2026-10-01', jsonb_build_array(
    jsonb_build_object('row', 3, 'plate', 'XEKHONGCO99', 'km_end', 1))) -> 'errors') = 1, 'Nhập Excel báo lỗi xe không có');
reset role;
select tests.assert((select km_start from public.vehicle_fuel_months where vehicle_id = (select v::uuid from t_fu where k = 'veh') and period_month = '2026-10-01') is null,
  'KM đầu tháng tự lấy chưa ghi cố định trước khi chốt');

-- Giám đốc chốt
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert((public.fuel_month('2026-10-01') ->> 'can_lock')::boolean, 'Giám đốc có quyền chốt');
select tests.assert_fails($$select public.lock_vehicle_fuel(array[(select v::uuid from t_fu where k = 'veh')], '2026-10-01', true, 'none')$$,
  'Chưa có số chốt thì không chốt (không chọn cách lấy số)');
select public.set_vehicle_fuel_final((select v::uuid from t_fu where k = 'veh'), '2026-09-01', 690, 'Cân đối định mức');
select tests.assert(public.lock_vehicle_fuel(array[(select v::uuid from t_fu where k = 'veh')], '2026-09-01', true, 'none') = 1, 'Giám đốc chốt tháng 9');
-- tháng 10: thực tế = 120 + 900 - 150 = 870; định mức = (14500 - 12000) × 0.35 = 875
select tests.assert(public.lock_vehicle_fuel(array[(select v::uuid from t_fu where k = 'veh')], '2026-10-01', true, 'norm') = 1, 'Chốt tháng 10 lấy số định mức');
reset role;
select tests.assert((select final_fuel = 875 and km_start = 12000 and fuel_opening = 120 and fuel_ratio = 0.35 and locked_at is not null
                     from public.vehicle_fuel_months where vehicle_id = (select v::uuid from t_fu where k = 'veh') and period_month = '2026-10-01'),
  'Chốt ghi cố định số tự lấy và số chốt theo KM × tỷ trọng');
select tests.assert((select final_fuel = 690 from public.vehicle_fuel_months where vehicle_id = (select v::uuid from t_fu where k = 'veh') and period_month = '2026-09-01'),
  'Số Giám đốc nhập được giữ khi chốt');
select tests.assert(exists (select 1 from public.audit_logs where entity_type = 'vehicle_fuel_months'), 'Sửa số dầu được ghi nhật ký');

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.save_vehicle_fuel((select v::uuid from t_fu where k = 'veh'), '2026-10-01', '{"fuel_added": 1}')$$,
  'Đã chốt thì không sửa được');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000e1');
set role authenticated;
select tests.assert(public.lock_vehicle_fuel(array[(select v::uuid from t_fu where k = 'veh')], '2026-10-01', false) = 1, 'Giám đốc mở chốt');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.save_vehicle_fuel((select v::uuid from t_fu where k = 'veh'), '2026-10-01', '{"fuel_added": 950}');
select tests.assert((pg_temp.row_of('2026-10-01') ->> 'fuel_added')::numeric = 950, 'Mở chốt rồi sửa được');
reset role;

delete from public.vehicle_fuel_months where vehicle_id = (select v::uuid from t_fu where k = 'veh');
\o
\echo '50_vehicle_fuel_tests: OK'
