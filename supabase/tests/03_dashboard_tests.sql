-- =============================================================================
-- Kiểm thử số liệu Tổng quan: hàm dashboard_shipment_stats tôn trọng RLS của người gọi
-- Chạy sau 01_security_tests.sql (dùng lại chuyến đã tạo ở đó).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

create temp table dash_today as
select count(*) filter (where status <> 'cancelled' and (pickup_at at time zone 'Asia/Ho_Chi_Minh')::date = (now() at time zone 'Asia/Ho_Chi_Minh')::date) as n
from public.shipments;
grant select on dash_today to authenticated;

select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối
set role authenticated;
select tests.assert((public.dashboard_shipment_stats() ->> 'today')::int = (select n from dash_today) and (select n from dash_today) >= 2,
  'Điều phối: số chuyến hôm nay khớp dữ liệu nguồn');
select tests.assert(jsonb_array_length(public.dashboard_shipment_stats() -> 'daily') = 14 and jsonb_array_length(public.dashboard_shipment_stats() -> 'monthly') = 6,
  'Đủ 14 ngày và 6 tháng (kể cả ngày/tháng không có chuyến)');
select tests.assert((select sum((v)::int) from jsonb_each_text(public.dashboard_shipment_stats() -> 'by_status') as t(k, v)) >= 2,
  'Trạng thái chuyến tháng này có dữ liệu');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000b1'); -- tài xế A
set role authenticated;
select tests.assert((public.dashboard_shipment_stats() ->> 'today')::int <= 1, 'Tài xế chỉ được tính chuyến của chính mình');
reset role;

select tests.login('00000000-0000-0000-0000-0000000000b2'); -- tài xế B
set role authenticated;
select tests.assert((public.dashboard_shipment_stats() ->> 'month_to_date')::int <= 1, 'Tài xế B không thấy chuyến của người khác qua số liệu tổng hợp');
reset role;

set role anon;
select tests.assert_fails($$select public.dashboard_shipment_stats()$$, 'Người chưa đăng nhập không gọi được hàm số liệu');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ SỐ LIỆU TỔNG QUAN ĐỀU ĐẠT'
