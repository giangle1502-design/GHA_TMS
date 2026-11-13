-- =============================================================================
-- Kiểm thử 0072: danh mục lý do ngày công
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
\i supabase/migrations/20261111000072_attendance_reasons.sql
\i supabase/migrations/20261111000072_attendance_reasons.sql

select tests.assert((select count(*) from public.attendance_reasons where is_system) = 6, 'Có 6 lý do hệ thống (mỗi nhóm một)');
select tests.assert(exists (select 1 from public.attendance_reasons where symbol = 'TS' and category = 'sick'), 'Có sẵn Nghỉ vợ sinh (thai sản)');
select tests.assert((select count(*) from public.attendance_reasons) = 13, 'Chạy lại không thêm trùng');

create temp table t_ar (k text primary key, v text);
grant all on t_ar to authenticated;
insert into t_ar values ('drv', '40000000-0000-0000-0000-000000000001'),
  ('d', (((now() at time zone 'Asia/Ho_Chi_Minh')::date) - 1)::text);
update public.drivers set start_date = null where id = '40000000-0000-0000-0000-000000000001';
delete from public.attendance_locks;

-- Điều phối chọn lý do thai sản: nhóm BHXH
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.set_driver_attendance_reason(array[(select v::uuid from t_ar where k = 'drv')], array[(select v::date from t_ar where k = 'd')],
  (select id from public.attendance_reasons where symbol = 'TS'), 'Vợ sinh');
select tests.assert((select status from public.driver_attendance where driver_id = (select v::uuid from t_ar where k = 'drv') and work_date = (select v::date from t_ar where k = 'd')) = 'sick',
  'Lý do thai sản lưu nhóm Nghỉ BHXH');
reset role;
select tests.assert((select a.status from private.attendance_rows((select v::date from t_ar where k = 'd'), (select v::date from t_ar where k = 'd'), (select v::uuid from t_ar where k = 'drv')) a) = 'sick',
  'Bảng chấm công hiện nhóm của lý do');
set role authenticated;
select tests.assert(exists (select 1 from jsonb_array_elements(public.attendance_month((select v::date from t_ar where k = 'd')) -> 'drivers') d
  where (d -> 'cells' -> (select v from t_ar where k = 'd') ->> 'r')::uuid = (select id from public.attendance_reasons where symbol = 'TS')), 'Ô chấm công trả về lý do');
-- Hàm cũ theo nhóm vẫn chạy, dùng lý do hệ thống
select public.set_driver_attendance(array[(select v::uuid from t_ar where k = 'drv')], array[(select v::date from t_ar where k = 'd')], 'leave_unpaid', null);
select tests.assert((select r.symbol from public.driver_attendance a join public.attendance_reasons r on r.id = a.reason_id
  where a.driver_id = (select v::uuid from t_ar where k = 'drv') and a.work_date = (select v::date from t_ar where k = 'd')) = 'KL', 'Hàm cũ gán lý do hệ thống');
select tests.assert_fails($$insert into public.attendance_reasons (name, symbol, category) values ('Thử', 'X', 'work')$$, 'Điều phối không thêm lý do');
reset role;

-- Kế toán thêm lý do mới; không xóa / đổi nhóm lý do hệ thống
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
insert into public.attendance_reasons (name, symbol, category) values ('Nghỉ khám sức khỏe', 'ks', 'leave_paid');
select tests.assert((select symbol from public.attendance_reasons where name = 'Nghỉ khám sức khỏe') = 'KS', 'Ký hiệu tự viết hoa');
select tests.assert_fails($$insert into public.attendance_reasons (name, symbol, category) values ('Trùng', 'KS', 'work')$$, 'Ký hiệu không trùng');
select tests.assert_fails($$delete from public.attendance_reasons where symbol = 'P'$$, 'Không xóa lý do hệ thống');
update public.attendance_reasons set category = 'work', name = 'Nghỉ phép' where symbol = 'P';
select tests.assert((select category from public.attendance_reasons where symbol = 'P') = 'leave_paid'
  and (select name from public.attendance_reasons where symbol = 'P') = 'Nghỉ phép', 'Lý do hệ thống đổi tên được, không đổi nhóm');
select tests.assert_fails($$delete from public.attendance_reasons where symbol = 'KL'$$, 'Không xóa lý do hệ thống đã dùng');
delete from public.attendance_reasons where symbol = 'KS';
select public.set_driver_attendance_reason(array[(select v::uuid from t_ar where k = 'drv')], array[(select v::date from t_ar where k = 'd')], null, null);
select tests.assert(not exists (select 1 from public.driver_attendance where driver_id = (select v::uuid from t_ar where k = 'drv')
  and work_date = (select v::date from t_ar where k = 'd')), 'Trả về tự động');
reset role;
update public.attendance_reasons set name = 'Nghỉ phép năm' where symbol = 'P';

\o
\echo 'TẤT CẢ KIỂM THỬ LÝ DO NGÀY CÔNG ĐỀU ĐẠT'
