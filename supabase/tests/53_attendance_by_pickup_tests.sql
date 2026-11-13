-- =============================================================================
-- Kiểm thử 0071: chấm công theo ngày nhận của điều phối, Số ngày giao, bỏ xe 3PL
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

create temp table t_ap (k text primary key, v text);
grant all on t_ap to authenticated;
insert into t_ap values ('drv', '40000000-0000-0000-0000-000000000001'), ('today', ((now() at time zone 'Asia/Ho_Chi_Minh')::date)::text);
-- Hai chuyến đã chỉ định (xe nội bộ) để thử
insert into t_ap select 'a', id::text from public.shipments
where driver_id = '40000000-0000-0000-0000-000000000001' and status = 'assigned' and not private.shipment_is_3pl(vehicle_id) and vehicle_id is not null
order by shipment_code limit 1;
insert into t_ap select 'b', id::text from public.shipments
where driver_id = '40000000-0000-0000-0000-000000000001' and status = 'assigned' and not private.shipment_is_3pl(vehicle_id) and vehicle_id is not null
  and id <> (select v::uuid from t_ap where k = 'a')
order by shipment_code limit 1;
select tests.assert((select count(*) from t_ap) = 4, 'Có 2 chuyến đã chỉ định để thử');
-- Các chuyến khác của tài xế dời ra xa để không ảnh hưởng
update public.shipments set pickup_at = now() - interval '400 days', expected_delivery_at = null
where driver_id = (select v::uuid from t_ap where k = 'drv') and id not in ((select v::uuid from t_ap where k = 'a'), (select v::uuid from t_ap where k = 'b'));
update public.shipments set pickup_at = ((select v::date from t_ap where k = 'today') - 10)::timestamp at time zone 'Asia/Ho_Chi_Minh' + interval '8 hours',
  expected_delivery_at = null, delivery_days = null where id = (select v::uuid from t_ap where k = 'a');
update public.shipments set pickup_at = ((select v::date from t_ap where k = 'today') - 9)::timestamp at time zone 'Asia/Ho_Chi_Minh' + interval '8 hours',
  expected_delivery_at = null, delivery_days = null where id = (select v::uuid from t_ap where k = 'b');

-- 'trips' là cột thứ 3
create function pg_temp.n(p_off int) returns int language sql as $$
  select a.trips from private.attendance_rows((select v::date from t_ap where k = 'today') - 15,
    (select v::date from t_ap where k = 'today') + 5, (select v::uuid from t_ap where k = 'drv')) a
  where a.work_date = (select v::date from t_ap where k = 'today') + p_off $$;
create function pg_temp.src(p_off int) returns text language sql as $$
  select a.source from private.attendance_rows((select v::date from t_ap where k = 'today') - 15,
    (select v::date from t_ap where k = 'today') + 5, (select v::uuid from t_ap where k = 'drv')) a
  where a.work_date = (select v::date from t_ap where k = 'today') + p_off $$;
create function pg_temp.st2(p_off int) returns text language sql as $$
  select a.status from private.attendance_rows((select v::date from t_ap where k = 'today') - 15,
    (select v::date from t_ap where k = 'today') + 5, (select v::uuid from t_ap where k = 'drv')) a
  where a.work_date = (select v::date from t_ap where k = 'today') + p_off $$;
delete from public.driver_attendance where driver_id = (select v::uuid from t_ap where k = 'drv');
update public.drivers set start_date = null where id = (select v::uuid from t_ap where k = 'drv');

-- Ngày nhận của điều phối là ngày công; Số ngày giao trống = 1 ngày
select tests.assert(pg_temp.st2(-10) = 'work' and pg_temp.n(-10) = 1 and pg_temp.src(-10) = 'trip', 'Ngày nhận hàng của chuyến đã chỉ định là ngày công');
select tests.assert(pg_temp.st2(-9) = 'work' and pg_temp.n(-9) = 1, 'Chuyến thứ hai ngày hôm sau');
select tests.assert(pg_temp.st2(-8) in ('pending', 'off'), 'Ngày sau đó không có chuyến: chờ xác nhận');

-- Điều phối nhập Số ngày giao 3: cộng 3 ngày từ ngày nhận; ngày trùng với chuyến khác vẫn 1 công
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.set_shipment_delivery_days((select v::uuid from t_ap where k = 'a'), 3);
select tests.assert_fails($$select public.set_shipment_delivery_days((select v::uuid from t_ap where k = 'a'), 0)$$, 'Số ngày giao phải từ 1');
select tests.assert((select delivery_days from public.shipment_list where id = (select v::uuid from t_ap where k = 'a')) = 3
  and (select work_days from public.shipment_list where id = (select v::uuid from t_ap where k = 'a')) = 3, 'Danh sách chuyến hiện Số ngày giao');
reset role;
select tests.assert(pg_temp.st2(-8) = 'work' and pg_temp.src(-8) = 'trip_long' and pg_temp.n(-8) = 0, 'Chuyến dài ngày: ngày thứ 3 tính công, không đếm thêm chuyến');
select tests.assert(pg_temp.n(-9) = 1, 'Ngày trùng chuyến dài và chuyến mới: đếm 1 chuyến bắt đầu hôm đó');
select tests.assert(pg_temp.st2(-7) in ('pending', 'off'), 'Hết số ngày giao: ngày tiếp theo không còn công');
select tests.assert(not exists (select 1 from private.attendance_rows((select v::date from t_ap where k = 'today') - 15, (select v::date from t_ap where k = 'today') + 5,
  (select v::uuid from t_ap where k = 'drv')) a group by a.work_date having count(*) > 1), 'Mỗi ngày một ô (1 công)');

-- Trống Số ngày giao nhưng có ngày giao dự kiến: tự tính
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.set_shipment_delivery_days((select v::uuid from t_ap where k = 'a'), null);
reset role;
update public.shipments set expected_delivery_at = pickup_at + interval '1 day' where id = (select v::uuid from t_ap where k = 'a');
select tests.assert(pg_temp.st2(-9) = 'work' and pg_temp.st2(-8) in ('pending', 'off'), 'Ngày giao dự kiến hôm sau: tự tính 2 ngày');

-- Chuyến ngày mai: đã lên lịch, chưa tính công; hôm nay nhận đơn ngày mai không tính hôm nay
update public.shipments set pickup_at = ((select v::date from t_ap where k = 'today') + 2)::timestamp at time zone 'Asia/Ho_Chi_Minh' + interval '8 hours',
  expected_delivery_at = null where id = (select v::uuid from t_ap where k = 'b');
select tests.assert(pg_temp.st2(2) = 'upcoming' and pg_temp.n(2) = 1, 'Chuyến ngày sắp tới: đã lên lịch, chưa tính công');
select tests.assert(pg_temp.st2(-9) = 'work', 'Ngày -9 vẫn còn công từ chuyến a (2 ngày)');

-- Đổi tài xế: người cũ trả về như lúc đầu; hủy chuyến: không tính
update public.shipments set driver_id = (select id from public.drivers where id <> (select v::uuid from t_ap where k = 'drv') and not is_outsourced limit 1)
where id = (select v::uuid from t_ap where k = 'a');
select tests.assert(pg_temp.st2(-10) in ('pending', 'off'), 'Đổi tài xế: ngày của tài xế cũ trả về chờ xác nhận');
update public.shipments set driver_id = (select v::uuid from t_ap where k = 'drv') where id = (select v::uuid from t_ap where k = 'a');
select tests.assert(pg_temp.st2(-10) = 'work', 'Trả lại tài xế: tính công lại');

-- Xe 3PL: không tính công
update public.shipments set vehicle_id = (select id from public.vehicles where ownership_type = 'outsourced' or supplier_id is not null limit 1)
where id = (select v::uuid from t_ap where k = 'a');
select tests.assert(pg_temp.st2(-10) in ('pending', 'off'), 'Chuyến xe 3PL không tính công');
update public.shipments set vehicle_id = (select v.id from public.vehicles v where v.ownership_type <> 'outsourced' and v.supplier_id is null limit 1)
where id = (select v::uuid from t_ap where k = 'a');
select tests.assert(pg_temp.st2(-10) = 'work', 'Đổi lại xe nội bộ: tính công');
update public.shipments set status = 'cancelled', cancel_reason = 'Thử' where id = (select v::uuid from t_ap where k = 'a');
select tests.assert(pg_temp.st2(-10) in ('pending', 'off'), 'Chuyến hủy không tính công');

-- Bảng kê lương chuyến không có chuyến xe 3PL
select tests.assert(not exists (select 1 from public.trip_pay_lines where private.shipment_is_3pl(vehicle_id)), 'Bảng kê lương chuyến bỏ chuyến xe 3PL');
-- Tài xế 3PL không hiện trên bảng chấm công
select tests.assert(not exists (select 1 from private.attendance_rows((select v::date from t_ap where k = 'today') - 3, (select v::date from t_ap where k = 'today'), null) a
  join public.drivers d on d.id = a.driver_id where d.is_outsourced or d.supplier_id is not null), 'Tài xế 3PL không hiện trên bảng chấm công');

\o
\echo 'TẤT CẢ KIỂM THỬ CHẤM CÔNG THEO NGÀY NHẬN ĐỀU ĐẠT'
