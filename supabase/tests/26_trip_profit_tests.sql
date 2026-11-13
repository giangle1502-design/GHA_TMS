-- =============================================================================
-- Kiểm thử 0039: lời/lỗ từng chuyến, chia chi phí xe theo số chuyến của xe trong tháng.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
select tests.assert((select count(*) from public.expense_categories where code in ('LOADING_TIP', 'OUTSOURCE')) = 2,
  'Có hạng mục chi Bồi dưỡng bốc xếp và Thuê xe ngoài');

-- Một xe có chuyến tính lời lỗ: lấy tháng của chuyến mới nhất
create temp table t_tp as
  select s.id, s.vehicle_id,
         date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as m,
         s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as revenue
  from public.shipments s
  where s.status in ('in_transit', 'driver_completed', 'closed') and s.vehicle_id is not null
  order by s.created_at desc limit 1;
create temp table t_tp_n as
  select count(*) as n from public.shipments s, t_tp
  where s.vehicle_id = t_tp.vehicle_id and s.status in ('in_transit', 'driver_completed', 'closed')
    and date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date = t_tp.m;
grant select on t_tp, t_tp_n to authenticated;
select tests.assert((select count(*) from t_tp) = 1, 'Có chuyến để kiểm thử lời lỗ');

-- Chi phí chuyến: 1 đã duyệt, 1 chờ duyệt; chi phí xe trong tháng 900.000 (và 1 khoản đã hủy không tính)
insert into public.shipment_expenses (shipment_id, category_id, amount, source, status)
select id, (select id from public.expense_categories where code = 'LOADING_TIP'), 150000, 'admin', 'approved' from t_tp
union all
select id, (select id from public.expense_categories where code = 'OUTSOURCE'), 70000, 'admin', 'pending' from t_tp;
insert into public.maintenance_records (vehicle_id, record_type, performed_at, description, amount, status)
select vehicle_id, 'repair', m + 3, 'Sửa máy (kiểm thử lời lỗ)', 900000, 'recorded' from t_tp
union all
select vehicle_id, 'insurance', m + 4, 'Bảo hiểm đã hủy', 500000, 'cancelled' from t_tp;

select tests.login('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select tests.assert((select trip_cost >= 150000 and pending_cost >= 70000 from public.shipment_profit where shipment_id = (select id from t_tp)),
  'Chi phí chuyến tính khoản đã duyệt, khoản chờ duyệt để riêng');
select tests.assert((select vehicle_month_trips from public.shipment_profit where shipment_id = (select id from t_tp)) = (select n from t_tp_n),
  'Đếm đúng số chuyến của xe trong tháng');
select tests.assert((select vehicle_month_cost >= 900000 and vehicle_month_cost < 1400000 from public.shipment_profit where shipment_id = (select id from t_tp)),
  'Chi phí xe trong tháng không gồm khoản đã hủy');
select tests.assert((select vehicle_cost = round(vehicle_month_cost / vehicle_month_trips, 0) from public.shipment_profit where shipment_id = (select id from t_tp)),
  'Chi phí xe chia đều theo số chuyến');
select tests.assert((select profit = revenue - trip_cost - vehicle_cost and profit_before_vehicle = revenue - trip_cost
  from public.shipment_profit where shipment_id = (select id from t_tp)), 'Lời/lỗ = doanh thu − chi phí chuyến − chi phí xe chia về');
select tests.assert((select revenue from public.shipment_profit where shipment_id = (select id from t_tp)) = (select revenue from t_tp),
  'Doanh thu giống Tổng doanh thu của chuyến');
select tests.assert((select r.vehicle_cost = p.vehicle_cost and r.net_profit = p.profit and r.profit = p.profit_before_vehicle
  from public.report_shipment_profit r join public.shipment_profit p on p.shipment_id = r.id where r.id = (select id from t_tp)),
  'Báo cáo Lợi nhuận từng chuyến có chi phí xe chia về và lời/lỗ sau khi chia');
select tests.assert((select sum(vehicle_cost) from public.shipment_profit p join public.shipments s on s.id = p.shipment_id
  where s.vehicle_id = (select vehicle_id from t_tp) and p.trip_month = (select m from t_tp))
  between (select vehicle_month_cost from public.shipment_profit where shipment_id = (select id from t_tp)) - (select n from t_tp_n)
      and (select vehicle_month_cost from public.shipment_profit where shipment_id = (select id from t_tp)) + (select n from t_tp_n),
  'Tổng phần chia của các chuyến bằng chi phí xe trong tháng (sai số làm tròn)');
reset role;
set role anon;
select tests.assert_fails($$select * from public.shipment_profit$$, 'Khách vãng lai không xem được lời lỗ');
reset role;

-- Dọn dữ liệu kiểm thử
delete from public.shipment_expenses where shipment_id = (select id from t_tp) and source = 'admin'
  and category_id in (select id from public.expense_categories where code in ('LOADING_TIP', 'OUTSOURCE'));
delete from public.maintenance_records where description in ('Sửa máy (kiểm thử lời lỗ)', 'Bảo hiểm đã hủy');
\o
\echo 'TẤT CẢ KIỂM THỬ LỜI LỖ TỪNG CHUYẾN ĐỀU ĐẠT'
