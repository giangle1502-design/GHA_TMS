-- =============================================================================
-- Kiểm thử 9022: bảng giá xe tải (ma trận km × tấn) và bảng giá xe cont lấy từ chuyến đã chạy.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
create temp table t_bg (k text primary key, v text);
grant all on t_bg to authenticated, anon;

-- Bảng giá nội bộ xe tải nhập sẵn từ file BANG_GIA_NOI_BO.xlsx
select tests.assert((select count(*) from public.truck_rate_cards) = 1, 'Có sẵn 1 bảng giá xe tải nội bộ');
select tests.assert((select fuel_pct_included = 20 and jsonb_array_length(distance_bands) = 11 and jsonb_array_length(weight_bands) = 8
  and jsonb_array_length(fuel_bands) = 8 and (prices -> 2 ->> 2)::numeric = 1390000 and (weight_bands -> 2 ->> 'loading_fee')::numeric = 250000
  and code like 'BGXT%' from public.truck_rate_cards), 'Bảng giá xe tải: 11 khoảng km × 8 trọng tải, 25-35 km / 3.5-5 tấn = 1,390,000, bốc xếp 250,000, mã BGXT…');

-- Hai chuyến cont đã chạy cùng tuyến, giá khác nhau; một chuyến chưa có giá; một chuyến xe tải không cont
insert into t_bg select 's' || row_number() over (order by s.pickup_at, s.id), s.id::text
from (select s.id, s.pickup_at from public.shipments s
      where s.status in ('in_transit', 'driver_completed', 'closed') and s.receivable_id is null
      order by s.pickup_at desc limit 4) s;
select tests.assert((select count(*) from t_bg where k like 's%') = 4, 'Có 4 chuyến đã chạy để kiểm thử');
-- Đưa 4 chuyến về cùng khách hàng, cùng tuyến, cùng ngày trong tháng 10/2026
update public.shipments s set
  pickup_location_id = (select pickup_location_id from public.shipments where id = (select v::uuid from t_bg where k = 's1')),
  delivery_location_id = (select delivery_location_id from public.shipments where id = (select v::uuid from t_bg where k = 's1')),
  empty_return_location_id = null,
  pickup_at = timestamptz '2026-10-05 08:00+07' + (select (substr(k, 2)::int) * interval '1 day' from t_bg where v = s.id::text),
  expected_delivery_at = null
where s.id in (select v::uuid from t_bg where k like 's%');
-- Đơn hàng của 4 chuyến về cùng một khách hàng
update public.transport_orders o set customer_id = (select o1.customer_id from public.transport_orders o1 join public.shipments s1 on s1.order_id = o1.id
                                                     where s1.id = (select v::uuid from t_bg where k = 's1'))
where o.id in (select order_id from public.shipments where id in (select v::uuid from t_bg where k like 's%'));
update public.shipments set container_no = 'TCNU1234567', unit_price = 2000000, fuel_support_rate = 20, fuel_support_base = 'freight_revenue' where id = (select v::uuid from t_bg where k = 's1');
update public.shipments set container_no = 'TCNU7654321', unit_price = 2200000, fuel_support_rate = 25, fuel_support_base = 'freight_revenue' where id = (select v::uuid from t_bg where k = 's2');
update public.shipments set container_no = 'TCNU0000001', unit_price = 0 where id = (select v::uuid from t_bg where k = 's3');
update public.shipments set container_no = null, unit_price = 900000, vehicle_id = null where id = (select v::uuid from t_bg where k = 's4');

-- Điều phối: xem được giá lấy từ chuyến, không ghi được bảng giá
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert((select count(*) from public.truck_rate_cards) = 1, 'Điều phối xem được bảng giá xe tải');
select tests.assert((select count(*) from public.container_prices_from_trips('2026-10-01', '2026-10-31')
  where trip_count = 2 and last_unit_price = 2200000 and price_min = 2000000 and price_max = 2200000 and last_fuel_rate = 25 and current_id is null) = 1,
  'Gom 2 chuyến cont có giá cùng tuyến: giá gần nhất 2,200,000 (chưa dầu), % dầu 25, bỏ chuyến chưa giá và chuyến không cont');
select tests.assert((select count(*) from public.container_prices_from_trips('2026-11-01', '2026-11-30') where last_unit_price = 2200000) = 0, 'Ngoài khoảng ngày thì không lấy');
select tests.assert_fails($$select public.upsert_container_prices('[]')$$, 'Điều phối (chỉ quyền xem) không cập nhật được bảng giá');
select tests.assert_fails($$insert into public.truck_rate_cards (name) values ('x')$$, 'Điều phối không thêm được bảng giá xe tải');
reset role;

-- Quản trị: tạo bảng giá xe cont từ chuyến, chạy lại thì cập nhật, không nhân đôi
select tests.login('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
insert into t_bg select 'r1', public.upsert_container_prices((
  select jsonb_agg(jsonb_build_object('customer_id', customer_id, 'pickup_location_id', pickup_location_id, 'delivery_location_id', delivery_location_id,
    'empty_return_location_id', empty_return_location_id, 'container_size', container_size, 'unit_price', last_unit_price, 'fuel_support_rate', last_fuel_rate,
    'trip_count', trip_count, 'price_min', price_min, 'price_max', price_max, 'last_trip_date', last_trip_date, 'last_shipment_code', last_shipment_code))
  from public.container_prices_from_trips('2026-10-01', '2026-10-31') where trip_count = 2))::text;
select tests.assert(((select v from t_bg where k = 'r1')::jsonb ->> 'inserted')::int = 1, 'Thêm 1 dòng bảng giá xe cont');
select tests.assert((select count(*) from public.container_prices_from_trips('2026-10-01', '2026-10-31') where trip_count = 2 and current_unit_price = 2200000) = 1,
  'Lấy lại thấy giá đang có trong bảng giá');
insert into t_bg select 'r2', public.upsert_container_prices((
  select jsonb_agg(jsonb_build_object('customer_id', customer_id, 'pickup_location_id', pickup_location_id, 'delivery_location_id', delivery_location_id,
    'empty_return_location_id', empty_return_location_id, 'container_size', container_size, 'unit_price', common_unit_price, 'trip_count', trip_count))
  from public.container_prices_from_trips('2026-10-01', '2026-10-31') where trip_count = 2))::text;
select tests.assert(((select v from t_bg where k = 'r2')::jsonb ->> 'updated')::int = 1 and (select count(*) from public.container_price_lists) = 1,
  'Cập nhật lại cùng tuyến: sửa dòng cũ, không thêm dòng');
select tests.assert_fails($$select public.upsert_container_prices('[{"customer_id":"00000000-0000-0000-0000-000000000001","pickup_location_id":"00000000-0000-0000-0000-000000000001","delivery_location_id":"00000000-0000-0000-0000-000000000001","unit_price":-1}]')$$,
  'Đơn giá âm bị chặn');
reset role;

-- Tài xế, tài khoản khách hàng: không xem được giá nội bộ
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((select count(*) from public.truck_rate_cards) = 0 and (select count(*) from public.container_price_lists) = 0, 'Tài xế không xem được bảng giá nội bộ');
select tests.assert_fails($$select * from public.container_prices_from_trips('2026-10-01', '2026-10-31')$$, 'Tài xế không lấy được giá từ chuyến');
reset role;
insert into public.user_roles (user_id, role_id)
select '00000000-0000-0000-0000-00000000c918', id from public.roles where code = 'customer_admin' on conflict do nothing;
insert into public.user_roles (user_id, role_id)
select '00000000-0000-0000-0000-00000000c918', id from public.roles where code = 'dispatcher' on conflict do nothing;
select tests.login('00000000-0000-0000-0000-00000000c918');
set role authenticated;
select tests.assert((select count(*) from public.truck_rate_cards) = 0 and (select count(*) from public.container_price_lists) = 0,
  'Tài khoản khách hàng (kể cả có quyền xem bảng giá) không thấy bảng giá nội bộ');
select tests.assert_fails($$select * from public.container_prices_from_trips('2026-10-01', '2026-10-31')$$, 'Tài khoản khách hàng không lấy được giá từ chuyến');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a1');
delete from public.user_roles where user_id = '00000000-0000-0000-0000-00000000c918' and role_id = (select id from public.roles where code = 'dispatcher');

\o
select 'TẤT CẢ KIỂM THỬ BẢNG GIÁ XE TẢI, XE CONT ĐỀU ĐẠT' as ket_qua;
