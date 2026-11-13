-- =============================================================================
-- Kiểm thử 0023: thứ tự chuyến của xe trong ngày (vehicle_day_order)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
create temp table t_vdo as select id from public.shipments where status <> 'cancelled' order by created_at limit 1;
grant select on t_vdo to authenticated, anon;

-- Điều phối ghi thứ tự, xem lại qua view shipment_list
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.set_vehicle_day_order((select id from t_vdo), 2::smallint);
select tests.assert((select vehicle_day_order from public.shipment_list where id = (select id from t_vdo)) = 2, 'Điều phối ghi được thứ tự chuyến của xe');
select tests.assert_fails($$select public.set_vehicle_day_order((select id from t_vdo), 0::smallint)$$, 'Thứ tự phải từ 1 trở lên');
select public.set_vehicle_day_order((select id from t_vdo), null);
select tests.assert((select vehicle_day_order from public.shipments where id = (select id from t_vdo)) is null, 'Bỏ được thứ tự');
reset role;

set role anon;
select tests.assert_fails($$select public.set_vehicle_day_order((select id from t_vdo), 1::smallint)$$, 'Người ngoài không ghi được');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ THỨ TỰ CHUYẾN CỦA XE ĐỀU ĐẠT'
