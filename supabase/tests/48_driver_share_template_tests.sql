-- =============================================================================
-- Kiểm thử 0066: mẫu Thông tin tài xế tự cấu hình, dữ liệu đầy đủ để ghép mẫu
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.drivers set phone = '0909123456', custom_fields = custom_fields || '{"so_bhxh":"BH01"}'
 where id = '40000000-0000-0000-0000-0000000000f8';
create temp table t_dt (k text primary key, v text);
grant all on t_dt to anon, authenticated;
insert into t_dt select 's', id::text from public.shipments where driver_id = '40000000-0000-0000-0000-0000000000f8' limit 1;
create or replace function pg_temp.v(key text) returns text language sql as $$ select v from t_dt where k = key $$;
select tests.assert((select jsonb_array_length(value) = 4 from public.system_settings where key = 'driver.share_template'), 'Mẫu mặc định 4 dòng (Tên, Số xe, CCCD, GPLX)');

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert((select data ->> 'phone' = '0909123456' and data ->> 'plate_number' = '50H25688' and data -> 'cf' ->> 'so_bhxh' = 'BH01'
  and data ? 'national_id_issued_date' from public.shipment_driver_share(array[pg_temp.v('s')::uuid])), 'Điều phối lấy đủ SĐT, biển số, trường bổ sung, ngày cấp');
select public.set_driver_share_template('[{"label":"Tên","source":"full_name"},{"label":"SĐT","source":"phone"},{"label":"Ngày cấp","source":"national_id_issued_date"},{"label":"BHXH","source":"cf.so_bhxh"}]');
select tests.assert((select value -> 1 ->> 'source' = 'phone' from public.system_settings where key = 'driver.share_template'), 'Điều phối lưu được mẫu mới');
select tests.assert_fails($$select public.set_driver_share_template('[]')$$, 'Mẫu rỗng bị chặn');
select tests.assert_fails($$select public.set_driver_share_template('[{"label":"","source":"phone"}]')$$, 'Dòng thiếu tên bị chặn');
select tests.assert_fails($$select public.set_driver_share_template('[{"label":"X","source":"phone; drop"}]')$$, 'Trường không hợp lệ bị chặn');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert_fails($$select public.set_driver_share_template('[{"label":"Tên","source":"full_name"}]')$$, 'Tài xế không sửa được mẫu');
select tests.assert_fails($$select * from public.shipment_driver_share(array['00000000-0000-0000-0000-000000000000'::uuid])$$, 'Tài xế không gọi được shipment_driver_share');
reset role;
\o
\echo '48_driver_share_template_tests: OK'
