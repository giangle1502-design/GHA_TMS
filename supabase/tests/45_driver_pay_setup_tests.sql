-- =============================================================================
-- Kiểm thử 0062: thiết lập lương tài xế (vùng lương, đơn giá lương chuyến,
-- khoản lương, mức theo tài xế, hình thức lương) và tính bảng lương theo đó.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
-- (0062 đã chạy cùng các migration; 0063 thay hàm tính lương nên không chạy lại 0062 ở đây)

create temp table t_ps (k text primary key, v text);
grant all on t_ps to authenticated;
insert into t_ps values ('drv', '40000000-0000-0000-0000-000000000001');
insert into t_ps select 'month', date_trunc('month', (completed_at at time zone 'Asia/Ho_Chi_Minh'))::date::text
from public.shipments where driver_id = '40000000-0000-0000-0000-000000000001' and status in ('driver_completed', 'closed') and not private.shipment_is_3pl(vehicle_id)
order by completed_at desc limit 1;
insert into t_ps select 's', id::text from public.shipments
where driver_id = '40000000-0000-0000-0000-000000000001' and status in ('driver_completed', 'closed') and not private.shipment_is_3pl(vehicle_id)
  and date_trunc('month', (completed_at at time zone 'Asia/Ho_Chi_Minh'))::date = (select v::date from t_ps where k = 'month')
order by completed_at desc limit 1;
insert into t_ps select 'pick', pickup_location_id::text from public.shipments where id = (select v::uuid from t_ps where k = 's');
insert into t_ps select 'del', delivery_location_id::text from public.shipments where id = (select v::uuid from t_ps where k = 's');
insert into t_ps select 'trips', count(*)::text from public.shipments
where driver_id = (select v::uuid from t_ps where k = 'drv') and status in ('driver_completed', 'closed') and not private.shipment_is_3pl(vehicle_id)
  and date_trunc('month', (completed_at at time zone 'Asia/Ho_Chi_Minh'))::date = (select v::date from t_ps where k = 'month');
-- 0064: ngày công lấy từ bảng chấm công (ngày nhận chuyến hoặc hoàn thành chuyến)
insert into t_ps select 'days', count(*)::text from private.attendance_rows((select v::date from t_ps where k = 'month'),
  ((select v::date from t_ps where k = 'month') + interval '1 month - 1 day')::date, (select v::uuid from t_ps where k = 'drv')) a
where a.status = 'work';
select tests.assert((select count(*) from t_ps) = 7 and (select v::int from t_ps where k = 'trips') >= 1, 'Có tài xế với chuyến hoàn thành để thử');
update public.drivers set base_salary = 8000000, per_trip_salary = 300000, meal_allowance = 500000, other_allowance = 0, pay_type = 'base_and_trip'
where id = (select v::uuid from t_ps where k = 'drv');
-- 0063 tắt khoản nhập tay Bốc xếp (chuyển sang hoàn chi phí); bật lại để thử cách tính nhập tay
update public.pay_components set is_active = true where code = 'PCBX';
select tests.assert((select count(*) from public.pay_components where is_system) = 2, 'Có sẵn 2 khoản hệ thống: Lương cơ bản, Lương chuyến');
select tests.assert((select count(*) from public.pay_components where code in ('PCAN', 'PCDL', 'PCTRO', 'PCLOXE', 'PCDT', 'THUONGVUOT')) = 6, 'Có sẵn các phụ cấp theo bảng lương tài xế cont');

-- Hàm xem trước gọn
create or replace function pg_temp.pv(p_manual jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select public.driver_payroll_preview((select v::uuid from t_ps where k = 'drv'), (select v::date from t_ps where k = 'month'), 0, 0, p_manual)
$$;

-- Điều phối không xem, không sửa đơn giá lương
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$insert into public.trip_pay_rates (amount) values (1)$$, 'Điều phối không thêm được đơn giá lương chuyến');
select tests.assert((select count(*) from public.trip_pay_lines) = 0, 'Điều phối không xem được bảng kê lương chuyến');
select tests.assert_fails($$select public.trip_pay_rate_preview((select v::uuid from t_ps where k = 's'))$$, 'Điều phối không xem được đơn giá của chuyến');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
-- Chưa thiết lập gì: tính như cũ (lương chuyến theo hồ sơ tài xế)
select tests.assert((pg_temp.pv() ->> 'trip_salary')::numeric = 300000 * (select v::int from t_ps where k = 'trips'), 'Chưa có đơn giá: lương chuyến theo hồ sơ tài xế như cũ');
select tests.assert((pg_temp.pv() ->> 'base_salary')::numeric = 8000000 and not (pg_temp.pv() ->> 'setup')::boolean, 'Chưa có mức theo khoản: lương cơ bản theo hồ sơ');

-- Giá mặc định → vùng → một địa điểm → tuyến (chiều ngược) → riêng tài xế
insert into public.trip_pay_rates (name, amount) values ('Mặc định', 700000);
select tests.assert((pg_temp.pv() ->> 'trip_salary')::numeric = 700000 * (select v::int from t_ps where k = 'trips'), 'Giá mặc định 700,000 thay lương chuyến cũ');
insert into public.pay_zones (name) values ('Bến Tre');
insert into t_ps select 'zone', id::text from public.pay_zones where name = 'Bến Tre';
select tests.assert((select code from public.pay_zones where id = (select v::uuid from t_ps where k = 'zone')) like 'VL%', 'Mã vùng tự sinh');
reset role;
update public.locations set pay_zone_id = (select v::uuid from t_ps where k = 'zone') where id = (select v::uuid from t_ps where k = 'del');
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
insert into public.trip_pay_rates (zone_id, amount) values ((select v::uuid from t_ps where k = 'zone'), 1000000);
select tests.assert((public.trip_pay_rate_preview((select v::uuid from t_ps where k = 's')) ->> 'pay_amount')::numeric = 1000000, 'Điểm giao thuộc vùng Bến Tre: 1,000,000');
select tests.assert((public.trip_pay_rate_preview((select v::uuid from t_ps where k = 's')) ->> 'rate_scope') = 'zone', 'Nguồn giá: vùng');
insert into public.trip_pay_rates (location_a_id, amount) values ((select v::uuid from t_ps where k = 'del'), 1100000);
select tests.assert((public.trip_pay_rate_preview((select v::uuid from t_ps where k = 's')) ->> 'pay_amount')::numeric = 1100000, 'Giá riêng một địa điểm thắng giá vùng');
-- Tuyến khai theo chiều ngược lại (Điểm 1 = điểm giao, Điểm 2 = điểm nhận) vẫn khớp
insert into public.trip_pay_rates (location_a_id, location_b_id, amount)
values ((select v::uuid from t_ps where k = 'del'), (select v::uuid from t_ps where k = 'pick'), 1150000);
select tests.assert((public.trip_pay_rate_preview((select v::uuid from t_ps where k = 's')) ->> 'pay_amount')::numeric = 1150000, 'Tuyến (tính cả chiều ngược lại) thắng giá địa điểm');
-- Giá hết hiệu lực không dùng
insert into public.trip_pay_rates (location_a_id, location_b_id, amount, effective_from, effective_to)
values ((select v::uuid from t_ps where k = 'pick'), (select v::uuid from t_ps where k = 'del'), 5000000, date '2020-01-01', date '2020-12-31');
select tests.assert((public.trip_pay_rate_preview((select v::uuid from t_ps where k = 's')) ->> 'pay_amount')::numeric = 1150000, 'Đơn giá đã hết hiệu lực không dùng');
insert into public.trip_pay_rates (driver_id, amount) values ((select v::uuid from t_ps where k = 'drv'), 1200000);
select tests.assert((public.trip_pay_rate_preview((select v::uuid from t_ps where k = 's')) ->> 'pay_amount')::numeric = 1200000, 'Giá riêng cho tài xế thắng mọi giá chung');
select tests.assert_fails($$insert into public.trip_pay_rates (zone_id, location_a_id, amount) values ((select v::uuid from t_ps where k = 'zone'), (select v::uuid from t_ps where k = 'del'), 1)$$,
  'Không chọn cùng lúc vùng và địa điểm');
select tests.assert_fails($$insert into public.trip_pay_rates (location_b_id, amount) values ((select v::uuid from t_ps where k = 'del'), 1)$$, 'Có Điểm 2 thì phải có Điểm 1');
select tests.assert(exists (select 1 from public.trip_pay_lines where id = (select v::uuid from t_ps where k = 's') and pay_amount = 1200000), 'Bảng kê lương chuyến hiện đúng đơn giá');

-- Mức theo khoản cho tài xế: lương cơ bản 7,000,000, tiền ăn 40,000/ngày, BHXH trừ 100,000, bốc xếp nhập tay
insert into public.driver_pay_components (driver_id, component_id, amount)
select (select v::uuid from t_ps where k = 'drv'), id, case code when 'LCB' then 7000000 when 'PCAN' then 40000 when 'BHXH' then 100000 end
from public.pay_components where code in ('LCB', 'PCAN', 'BHXH');
-- Tăng lương từ năm sau: tháng này chưa áp dụng
insert into public.driver_pay_components (driver_id, component_id, amount, effective_from)
select (select v::uuid from t_ps where k = 'drv'), id, 9000000, ((select v::date from t_ps where k = 'month') + interval '1 year')::date
from public.pay_components where code = 'LCB';
insert into t_ps select 'pv2', pg_temp.pv(jsonb_build_object('PCBX', 50000))::text;
select tests.assert((select (v::jsonb ->> 'setup')::boolean from t_ps where k = 'pv2'), 'Có mức theo khoản: tính theo thiết lập mới');
select tests.assert((select (v::jsonb ->> 'base_salary')::numeric from t_ps where k = 'pv2') = 7000000, 'Lương cơ bản 7,000,000 (mức tăng lương sau chưa áp dụng)');
select tests.assert((select (v::jsonb ->> 'meal_allowance')::numeric from t_ps where k = 'pv2') = 40000 * (select v::int from t_ps where k = 'days'),
  'Tiền ăn = 40,000 × số ngày công');
select tests.assert((select (v::jsonb ->> 'other_allowance')::numeric from t_ps where k = 'pv2') = 50000, 'Bốc xếp nhập tay 50,000');
select tests.assert((select (v::jsonb ->> 'deduction')::numeric from t_ps where k = 'pv2') = 100000, 'Trừ BHXH 100,000');
select tests.assert((select (v::jsonb ->> 'trip_salary')::numeric from t_ps where k = 'pv2') = 1200000 * (select v::int from t_ps where k = 'trips'), 'Lương chuyến theo đơn giá');
select tests.assert((select jsonb_path_exists(v::jsonb, '$.components[*] ? (@.code == "LCHUYEN")') from t_ps where k = 'pv2'), 'Chi tiết khoản có Lương chuyến');
select tests.assert(not (select jsonb_path_exists(v::jsonb, '$.components[*] ? (@.code == "PCTRO")') from t_ps where k = 'pv2'), 'Khoản 0 đồng (tiền trọ) không hiện');
select tests.assert_fails($$select pg_temp.pv(jsonb_build_object('PCBX', -1))$$, 'Khoản nhập tay âm bị từ chối');

-- Thưởng vượt chuyến: mốc 0 chuyến, 10,000 mỗi chuyến vượt
reset role;
update public.pay_components set threshold = 0 where code = 'THUONGVUOT';
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
insert into public.driver_pay_components (driver_id, component_id, amount)
select (select v::uuid from t_ps where k = 'drv'), id, 10000 from public.pay_components where code = 'THUONGVUOT';
select tests.assert((pg_temp.pv() ->> 'other_allowance')::numeric = 10000 * (select v::int from t_ps where k = 'trips'), 'Thưởng vượt chuyến = mức × số chuyến vượt mốc');

-- Hình thức lương
reset role;
update public.drivers set pay_type = 'trip_only' where id = (select v::uuid from t_ps where k = 'drv');
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((pg_temp.pv() ->> 'base_salary')::numeric = 0 and (pg_temp.pv() ->> 'trip_salary')::numeric > 0, 'Chỉ lương chuyến: không có lương cơ bản');
reset role;
update public.drivers set pay_type = 'monthly_only' where id = (select v::uuid from t_ps where k = 'drv');
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((pg_temp.pv() ->> 'trip_salary')::numeric = 0 and (pg_temp.pv() ->> 'base_salary')::numeric = 7000000, 'Chỉ lương tháng: chuyến không tính tiền');
reset role;
update public.drivers set pay_type = 'base_and_trip' where id = (select v::uuid from t_ps where k = 'drv');

-- Không còn đơn giá nào và hồ sơ không có lương chuyến: báo chuyến chưa có đơn giá
update public.trip_pay_rates set is_active = false;
update public.drivers set per_trip_salary = 0 where id = (select v::uuid from t_ps where k = 'drv');
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((pg_temp.pv() ->> 'trips_missing_rate')::int = (select v::int from t_ps where k = 'trips'), 'Chuyến không khớp đơn giá nào được báo chưa có đơn giá');
select tests.assert(exists (select 1 from public.trip_pay_lines where id = (select v::uuid from t_ps where k = 's') and missing_rate), 'Bảng kê đánh dấu chuyến chưa có đơn giá');

-- Khoản hệ thống không xóa, không đổi cách tính
select tests.assert_fails($$delete from public.pay_components where code = 'LCB'$$, 'Không xóa khoản Lương cơ bản');
select tests.assert_fails($$update public.pay_components set method = 'manual' where code = 'LCHUYEN'$$, 'Không đổi cách tính Lương chuyến');
select tests.assert_fails($$insert into public.pay_components (name, method) values ('Lương chuyến 2', 'trip_rate')$$, 'Không tạo thêm khoản theo đơn giá lương chuyến');
select tests.assert_fails($$insert into public.pay_components (name, method) values ('Thưởng', 'over_trips')$$, 'Thưởng vượt chuyến phải có mốc');
insert into public.pay_components (name, method, kind) values ('Phụ cấp xăng xe máy', 'monthly', 'income');
select tests.assert((select code from public.pay_components where name = 'Phụ cấp xăng xe máy') like 'KL%', 'Khoản mới: mã tự sinh');
reset role;

-- Dọn để các kiểm thử sau không bị ảnh hưởng
delete from public.driver_pay_components where driver_id = (select v::uuid from t_ps where k = 'drv');
delete from public.trip_pay_rates;
update public.locations set pay_zone_id = null where pay_zone_id is not null;
delete from public.pay_zones;
delete from public.pay_components where name = 'Phụ cấp xăng xe máy';
update public.pay_components set threshold = 41 where code = 'THUONGVUOT';
update public.pay_components set is_active = false where code = 'PCBX';
update public.drivers set per_trip_salary = 300000 where id = (select v::uuid from t_ps where k = 'drv');

\o
\echo 'TẤT CẢ KIỂM THỬ THIẾT LẬP LƯƠNG TÀI XẾ ĐỀU ĐẠT'
