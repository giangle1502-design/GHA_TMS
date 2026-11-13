-- =============================================================================
-- Kiểm thử 0073: gom tuyến từ các chuyến, điều phối điền giá, sửa tay lương chuyến
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
\i supabase/migrations/20261111000073_route_pay_fill.sql

delete from public.trip_pay_rates;
create temp table t_rp (k text primary key, v text);
grant all on t_rp to authenticated;
insert into t_rp select 's', s.id::text from public.shipments s
where s.driver_id = '40000000-0000-0000-0000-000000000001' and s.status in ('driver_completed', 'closed') and not private.shipment_is_3pl(s.vehicle_id)
  and s.pickup_location_id <> s.delivery_location_id order by s.completed_at desc limit 1;
insert into t_rp select 'p', pickup_location_id::text from public.shipments where id = (select v::uuid from t_rp where k = 's');
insert into t_rp select 'd', delivery_location_id::text from public.shipments where id = (select v::uuid from t_rp where k = 's');
-- Chuyến thử nằm trong 30 ngày gần đây
update public.shipments set pickup_at = now() - interval '2 days', expected_delivery_at = null where id = (select v::uuid from t_rp where k = 's');

select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert(exists (select 1 from public.route_pay_gaps(365) g
  where least(g.location_a_id, g.location_b_id) = least((select v::uuid from t_rp where k = 'p'), (select v::uuid from t_rp where k = 'd'))
    and greatest(g.location_a_id, g.location_b_id) = greatest((select v::uuid from t_rp where k = 'p'), (select v::uuid from t_rp where k = 'd'))
    and g.source = 'missing' and g.trips >= 1), 'Điều phối thấy tuyến của chuyến, chưa có giá');
select tests.assert(public.route_pay_gap_count() >= 1, 'Đếm tuyến mới chưa có giá');
select tests.assert(not exists (select 1 from public.route_pay_gaps(365) g where g.location_a_id > g.location_b_id), 'Gộp 2 chiều: mỗi tuyến một dòng');
-- Điều phối điền giá
select tests.assert(public.save_route_pay_rates(jsonb_build_array(
  jsonb_build_object('a', (select v from t_rp where k = 'd'), 'b', (select v from t_rp where k = 'p'), 'amount', 900000),
  jsonb_build_object('a', (select v from t_rp where k = 'd'), 'b', (select v from t_rp where k = 'p'), 'amount', 1),
  jsonb_build_object('a', (select v from t_rp where k = 'p'), 'b', (select v from t_rp where k = 'd'), 'amount', null))) = 1,
  'Lưu giá tuyến mới, bỏ dòng trùng / trống');
select tests.assert(exists (select 1 from public.route_pay_gaps(365) g where g.has_route_rate and g.amount = 900000 and g.source = 'route'), 'Tuyến đã có giá');
select tests.assert((select amount from public.shipment_driver_pay(array[(select v::uuid from t_rp where k = 's')])) = 900000, 'Cột Lương chuyến lấy giá tuyến');
select tests.assert_fails($$select public.set_shipment_driver_pay((select v::uuid from t_rp where k = 's'), 1000000, 'Chờ lâu')$$, 'Điều phối không sửa tay lương chuyến');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert_fails($$select public.set_shipment_driver_pay((select v::uuid from t_rp where k = 's'), 1000000, '')$$, 'Sửa tay phải có lý do');
select tests.assert_fails($$select public.set_shipment_driver_pay((select v::uuid from t_rp where k = 's'), 1000000, 'Chờ lâu ở cảng')$$, 'Đã có bảng lương tháng: không sửa tay')
  from public.driver_payrolls p join public.shipments s on s.id = (select v::uuid from t_rp where k = 's')
  where p.driver_id = s.driver_id and p.status not in ('cancelled', 'rejected')
    and p.period_month = date_trunc('month', (s.completed_at at time zone 'Asia/Ho_Chi_Minh'))::date limit 1;
reset role;
-- Đưa ngày hoàn thành của chuyến thử sang tháng chưa có bảng lương
update public.shipments set completed_at = now() - interval '700 days' where id = (select v::uuid from t_rp where k = 's');
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select public.set_shipment_driver_pay((select v::uuid from t_rp where k = 's'), 1000000, 'Chờ lâu ở cảng');
select tests.assert((select source from public.shipment_driver_pay(array[(select v::uuid from t_rp where k = 's')])) = 'manual'
  and (select pay_amount from public.trip_pay_lines where id = (select v::uuid from t_rp where k = 's')) = 1000000
  and (select pay_source from public.trip_pay_lines where id = (select v::uuid from t_rp where k = 's')) = 'manual', 'Sửa tay: bảng kê dùng số sửa tay');
select public.set_shipment_driver_pay((select v::uuid from t_rp where k = 's'), null, null);
select tests.assert((select amount from public.shipment_driver_pay(array[(select v::uuid from t_rp where k = 's')])) = 900000, 'Bỏ sửa tay: theo đơn giá');
reset role;
-- Không có quyền thì không thấy tuyến
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert_fails($$select * from public.route_pay_gaps(30)$$, 'Tài xế không xem danh sách tuyến');
reset role;

delete from public.trip_pay_rates;
\o
\echo 'TẤT CẢ KIỂM THỬ ĐIỀN GIÁ TUYẾN TỪ CHUYẾN ĐỀU ĐẠT'
