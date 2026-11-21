-- =============================================================================
-- Kiểm thử 9036: cước xe ghép tính theo mã chuyến; số cont / thứ tự xe chung cả nhóm
-- (dùng dữ liệu của tệp 66: T935-S1 2,200,000 và T935-S2 2,500,000 cùng xe 61H93501)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

update public.shipments set container_no = 'TCLU1234567' where id = 'f9350000-0000-0000-0000-000000000001';
select tests.login('00000000-0000-0000-0000-00000000d935');
set role authenticated;
select public.set_shipment_load_group(array['f9350000-0000-0000-0000-000000000001', 'f9350000-0000-0000-0000-000000000002']::uuid[]);
reset role;
select tests.assert((select unit_price from public.shipments where id = 'f9350000-0000-0000-0000-000000000001') = 2200000
  and (select unit_price from public.shipments where id = 'f9350000-0000-0000-0000-000000000002') = 0, 'Chuyến đầu giữ đơn giá, chuyến ghép thêm về 0');
select tests.assert((select sum(freight_amount + surcharge_amount + fuel_support_amount) from public.shipments where load_group_id is not null and order_id in ('e9350000-0000-0000-0000-000000000001', 'e9350000-0000-0000-0000-000000000002')) = 2200000, 'Cả xe một giá cước');
select tests.assert((select container_no from public.shipments where id = 'f9350000-0000-0000-0000-000000000002') = 'TCLU1234567', 'Số cont chép sang chuyến ghép');

-- Sửa số cont, thứ tự xe ở chuyến ghép thêm: chép về chuyến đầu
update public.shipments set container_no = 'MSKU7654321', vehicle_day_order = 3 where id = 'f9350000-0000-0000-0000-000000000002';
select tests.assert((select container_no from public.shipments where id = 'f9350000-0000-0000-0000-000000000001') = 'MSKU7654321'
  and (select vehicle_day_order from public.shipments where id = 'f9350000-0000-0000-0000-000000000001') = 3, 'Sửa ở chuyến nào cũng chép cho cả nhóm');
select tests.assert((select container_no from public.shipments where id = 'f9350000-0000-0000-0000-000000000003') is null, 'Chuyến ngoài nhóm không đổi');

-- Nhóm tính theo tấn: giữ cước từng đơn
update public.shipments set load_group_id = null where id in ('f9350000-0000-0000-0000-000000000001', 'f9350000-0000-0000-0000-000000000002');
update public.shipments set pricing_unit = 'ton', quantity = 10, unit_price = 100000 where id in ('f9350000-0000-0000-0000-000000000001', 'f9350000-0000-0000-0000-000000000002');
select tests.login('00000000-0000-0000-0000-00000000d935');
set role authenticated;
select public.set_shipment_load_group(array['f9350000-0000-0000-0000-000000000001', 'f9350000-0000-0000-0000-000000000002']::uuid[]);
reset role;
select tests.assert((select count(*) from public.shipments where id in ('f9350000-0000-0000-0000-000000000001', 'f9350000-0000-0000-0000-000000000002') and unit_price = 100000) = 2, 'Tính theo tấn: giữ cước từng đơn');

\o
\echo 'TẤT CẢ KIỂM THỬ CƯỚC XE GHÉP THEO CHUYẾN ĐỀU ĐẠT'
