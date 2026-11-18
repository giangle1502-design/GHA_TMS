-- =============================================================================
-- Kiểm thử 9027: vai trò Thủ kho, danh sách cont về / đi kho GHA trong ngày
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

insert into public.customers (id, code, name) values ('c9270000-0000-0000-0000-000000000001', 'T27-VAP', 'Việt An Pha (thử 9027)');
insert into public.products (id, code, name, unit) values ('a9270000-0000-0000-0000-000000000001', 'T27-37MK', 'PP37MK10 (thử 9027)', 'KG');
insert into public.locations (id, code, name, full_address) values
  ('d9270000-0000-0000-0000-000000000001', 'T27-CANG', 'Cảng (thử 9027)', 'Cảng'),
  ('d9270000-0000-0000-0000-000000000002', 'T27-KHACH', 'Khách (thử 9027)', 'Q1');
insert into public.transport_orders (id, order_code, customer_id, payer_customer_id, stock_kind, stock_bin_id) values
  ('e9270000-0000-0000-0000-000000000001', 'T9027-1', 'c9270000-0000-0000-0000-000000000001', 'c9270000-0000-0000-0000-000000000001',
   'receipt', (select id from public.warehouse_bins where code = 'GHA1')),
  ('e9270000-0000-0000-0000-000000000002', 'T9027-2', 'c9270000-0000-0000-0000-000000000001', 'c9270000-0000-0000-0000-000000000001', 'issue', null),
  ('e9270000-0000-0000-0000-000000000003', 'T9027-3', 'c9270000-0000-0000-0000-000000000001', 'c9270000-0000-0000-0000-000000000001', null, null);
-- S1: cont về GHA1 hôm nay; S2: xuất chưa chọn vị trí hôm nay; S3: không liên quan kho; S4: cont về tuần trước
insert into public.shipments (id, shipment_code, order_id, pickup_at, pickup_location_id, delivery_location_id, status, sequence_in_order, container_no, unit_price) values
  ('f9270000-0000-0000-0000-000000000001', 'T9027-S1', 'e9270000-0000-0000-0000-000000000001', now(), 'd9270000-0000-0000-0000-000000000001', 'd9270000-0000-0000-0000-000000000002', 'in_transit', 1, 'TGHU1234567', 5000000),
  ('f9270000-0000-0000-0000-000000000002', 'T9027-S2', 'e9270000-0000-0000-0000-000000000002', now(), 'd9270000-0000-0000-0000-000000000002', 'd9270000-0000-0000-0000-000000000001', 'assigned', 1, null, 1000000),
  ('f9270000-0000-0000-0000-000000000003', 'T9027-S3', 'e9270000-0000-0000-0000-000000000003', now(), 'd9270000-0000-0000-0000-000000000001', 'd9270000-0000-0000-0000-000000000002', 'in_transit', 1, null, 1000000),
  ('f9270000-0000-0000-0000-000000000004', 'T9027-S4', 'e9270000-0000-0000-0000-000000000001', now() - interval '8 days', 'd9270000-0000-0000-0000-000000000001', 'd9270000-0000-0000-0000-000000000002', 'in_transit', 2, null, 1000000);
insert into public.shipment_items (shipment_id, line_no, product_id, item_code, quantity, unit)
select id, 1, 'a9270000-0000-0000-0000-000000000001', 'T27-37MK', 24750, 'KG' from public.shipments where id::text like 'f9270000%';

-- Tài khoản thủ kho
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000e271', 'thukho9027@gha.test') on conflict do nothing;
update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000e271';
insert into public.user_roles (user_id, role_id) select '00000000-0000-0000-0000-00000000e271', id from public.roles where code = 'warehouse_keeper';

select tests.login('00000000-0000-0000-0000-00000000e271');
set role authenticated;
select tests.assert((select count(*) from public.stock_trips_by_date(current_date, current_date) where shipment_code like 'T9027-%') = 2,
  'Thủ kho thấy 2 chuyến qua kho hôm nay (không có chuyến không liên quan, chuyến tuần trước)');
select tests.assert((select kind = 'receipt' and bin_code = 'GHA1' and container_no = 'TGHU1234567' and not needs_bin
    and items -> 0 ->> 'item_code' = 'T27-37MK' and (items -> 0 ->> 'quantity')::numeric = 24750 and voucher_no is null
  from public.stock_trips_by_date(current_date, current_date) where shipment_code = 'T9027-S1'), 'Cont về GHA1: số cont, mã hàng, số lượng, vị trí');
select tests.assert((select kind = 'issue' and needs_bin from public.stock_trips_by_date(current_date, current_date) where shipment_code = 'T9027-S2'),
  'Chuyến xuất chưa chọn vị trí: báo chưa chọn');
select tests.assert((select count(*) from public.stock_trips_by_date(current_date - 9, current_date) where shipment_code like 'T9027-%') = 3,
  'Chọn nhiều ngày: thấy cả chuyến tuần trước');
select tests.assert((select count(*) = 1 and min(shipment_code) = 'T9027-S1' and min(bin_code) = 'GHA1'
  from public.stock_trips_by_date(current_date - 30, current_date - 30, 'tghu 123-4567')), 'Gõ số cont (có khoảng trắng, gạch, chữ thường): thấy cont, không cần đúng ngày');
select tests.assert((select count(*) from public.shipments) = 0 and (select count(*) from public.shipment_fees) = 0,
  'Thủ kho không đọc được bảng chuyến, phí (không thấy cước)');
select tests.assert(not private.has_perm('shipments.view') and not private.has_perm('dispatch.view') and private.has_perm('inventory.create'),
  'Thủ kho chỉ có quyền kho');
reset role;

-- Hoàn thành S1: hiện số phiếu đã lập
update public.shipments set status = 'driver_completed', completed_at = now(), arrived_delivery_at = now() where id = 'f9270000-0000-0000-0000-000000000001';
select tests.login('00000000-0000-0000-0000-00000000e271');
set role authenticated;
select tests.assert((select voucher_no like 'PN-%' and status = 'driver_completed' from public.stock_trips_by_date(current_date, current_date) where shipment_code = 'T9027-S1'),
  'Chuyến đã hoàn thành: hiện số phiếu nhập kho');
reset role;

-- Tài khoản không có quyền kho: không thấy gì
select tests.login('00000000-0000-0000-0000-00000000e261');
set role authenticated;
select tests.assert((select count(*) from public.stock_trips_by_date(current_date, current_date)) = 0, 'Không có quyền kho: danh sách trống');
reset role;

delete from public.stock_entries where product_id = 'a9270000-0000-0000-0000-000000000001';
