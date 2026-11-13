-- =============================================================================
-- Kiểm thử 0042: chi phí và thanh toán xe thuê ngoài 3PL.
-- Điều phối d1 nhập cước + chi hộ 3PL, Kế toán c1 trả nhiều lần / nhiều chuyến một lần, tài xế b1 không thấy.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
create temp table t_cc (k text primary key, v text);
grant all on t_cc to authenticated, anon;

-- Nhà xe 3PL, xe 3PL gắn nhà xe, hai chuyến đang chạy/đã hoàn thành chuyển sang xe 3PL
insert into public.suppliers (code, name, payment_term_days) values ('NX3PL1', 'Nhà xe Minh Phát (kiểm thử)', 15), ('NX3PL2', 'Nhà xe Hòa Bình (kiểm thử)', null);
insert into t_cc select 'sp1', id::text from public.suppliers where code = 'NX3PL1';
insert into t_cc select 'sp2', id::text from public.suppliers where code = 'NX3PL2';
insert into public.vehicles (code, plate_number, ownership_type, supplier_id) values ('XE3PLKT', '51C99999', 'outsourced', (select v::uuid from t_cc where k = 'sp1'));
insert into t_cc select 'veh', id::text from public.vehicles where code = 'XE3PLKT';
insert into t_cc select 's' || row_number() over (order by s.created_at desc), s.id::text
from (select id, created_at from public.shipments where status in ('in_transit', 'driver_completed', 'closed') and receivable_id is null
      order by created_at desc limit 3) s;
select tests.assert((select count(*) from t_cc where k in ('s1', 's2', 's3')) = 3, 'Có ba chuyến để kiểm thử 3PL');
update public.shipments set vehicle_id = (select v::uuid from t_cc where k = 'veh') where id in (select v::uuid from t_cc where k in ('s1', 's2'));
select tests.assert((select count(*) from public.payables where kind = 'carrier') = 0, 'Chưa có công nợ 3PL');

-- Điều phối nhập chi phí 3PL
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select tests.assert_fails($$select public.set_shipment_carrier_costs((select v::uuid from t_cc where k = 's1'), null,
  '[{"kind":"freight","amount":3000000}]')$$, 'Có tiền mà chưa chọn nhà xe bị chặn');
select tests.assert_fails($$select public.set_shipment_carrier_costs((select v::uuid from t_cc where k = 's1'), (select v::uuid from t_cc where k = 'sp1'),
  '[{"kind":"xyz","amount":3000000}]')$$, 'Loại khoản sai bị chặn');
select tests.assert_fails($$select public.set_shipment_carrier_costs((select v::uuid from t_cc where k = 's1'), (select v::uuid from t_cc where k = 'sp1'),
  '[{"kind":"freight","amount":-5}]')$$, 'Số tiền âm bị chặn');
select tests.assert_fails($$insert into public.shipment_carrier_costs (shipment_id, line_no, cost_kind, description, amount)
  values ((select v::uuid from t_cc where k = 's1'), 1, 'freight', 'x', 1)$$, 'Không ghi thẳng vào bảng chi phí 3PL');
insert into t_cc select 'r1', public.set_shipment_carrier_costs((select v::uuid from t_cc where k = 's1'), (select v::uuid from t_cc where k = 'sp1'),
  '[{"kind":"freight","amount":3000000,"note":"Cước HCM - Bình Dương"},
    {"kind":"pass_through","description":"Phí nâng","amount":350000,"ref_no":"HD001"},
    {"kind":"pass_through","description":"Phí hạ","quantity":2,"unit_price":150000},
    {"kind":"other","description":"Neo xe","amount":200000},
    {"kind":"other","description":"Dòng trống","amount":0}]', 'HĐ-3PL-01')::text;
select tests.assert(((select v from t_cc where k = 'r1')::jsonb->>'lines')::int = 4 and ((select v from t_cc where k = 'r1')::jsonb->>'total')::numeric = 3850000,
  'Lưu 4 khoản, bỏ dòng trống, SL × đơn giá tự tính, tổng 3.850.000');
reset role;
select tests.assert((select carrier_supplier_id from public.shipments where id = (select v::uuid from t_cc where k = 's1')) = (select v::uuid from t_cc where k = 'sp1'),
  'Chuyến ghi nhà xe 3PL');
select tests.assert((select amount = 3850000 and status = 'open' and kind = 'carrier' and invoice_no = 'HĐ-3PL-01' and due_date = issued_date + 15
  and content like 'Trả 3PL chuyến %' from public.payables where shipment_id = (select v::uuid from t_cc where k = 's1') and kind = 'carrier'),
  'Tự lập công nợ phải trả nhà xe, hạn = ngày chuyến + số ngày nợ của nhà xe');

-- Tài xế không thấy chi phí 3PL, không nhập được
select tests.login('00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select tests.assert((select count(*) from public.shipment_carrier_costs) = 0, 'Tài xế không thấy chi phí 3PL');
select tests.assert((select count(*) from public.report_carrier_trips) = 0, 'Tài xế không xem báo cáo 3PL');
select tests.assert_fails($$select public.set_shipment_carrier_costs((select v::uuid from t_cc where k = 's1'), null, '[]')$$, 'Tài xế không nhập được chi phí 3PL');
reset role;

-- Kế toán: báo cáo, trả một phần, sửa chi phí
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((select carrier_freight = 3000000 and carrier_pass_through = 650000 and carrier_other = 200000 and carrier_total = 3850000
  and pay_status = 'unpaid' and remaining_amount = 3850000 and supplier_name like 'Nhà xe Minh Phát%' and can_pay
  from public.report_carrier_trips where id = (select v::uuid from t_cc where k = 's1')), 'Báo cáo 3PL: cước, chi hộ, khác, chưa trả');
select tests.assert((select pay_status = 'no_cost' and supplier_name like 'Nhà xe Minh Phát%' from public.report_carrier_trips where id = (select v::uuid from t_cc where k = 's2')),
  'Chuyến xe 3PL chưa nhập chi phí vẫn hiện trong báo cáo, nhà xe lấy theo xe');
select tests.assert((select count(*) from public.report_carrier_trips where id = (select v::uuid from t_cc where k = 's3')) = 0, 'Chuyến xe công ty không vào báo cáo 3PL');
insert into t_cc select 'ap1', payable_id::text from public.report_carrier_trips where id = (select v::uuid from t_cc where k = 's1');
select public.record_debt_payment('payable', (select v::uuid from t_cc where k = 'ap1'), 2000000, null, null, 'FT001');
select tests.assert((select pay_status = 'partial' and paid_amount = 2000000 and remaining_amount = 1850000 from public.report_carrier_trips
  where id = (select v::uuid from t_cc where k = 's1')), 'Trả một phần: còn nợ 1.850.000');
select tests.assert_fails($$select public.set_shipment_carrier_costs((select v::uuid from t_cc where k = 's1'), (select v::uuid from t_cc where k = 'sp1'),
  '[{"kind":"freight","amount":1000000}]')$$, 'Không giảm tổng dưới số đã trả');
select tests.assert_fails($$select public.set_shipment_carrier_costs((select v::uuid from t_cc where k = 's1'), (select v::uuid from t_cc where k = 'sp2'),
  '[{"kind":"freight","amount":3000000}]')$$, 'Đã trả thì không đổi nhà xe');
select public.set_shipment_carrier_costs((select v::uuid from t_cc where k = 's1'), (select v::uuid from t_cc where k = 'sp1'),
  '[{"kind":"freight","amount":3200000},{"kind":"pass_through","description":"Phí nâng","amount":350000}]');
select tests.assert((select amount = 3550000 and status = 'partial' and invoice_no = 'HĐ-3PL-01' from public.payables where id = (select v::uuid from t_cc where k = 'ap1')),
  'Sửa chi phí cập nhật cùng công nợ, giữ số hóa đơn');
select tests.assert((select count(*) from public.payables where shipment_id = (select v::uuid from t_cc where k = 's1') and kind = 'carrier') = 1, 'Không sinh công nợ trùng');
-- Lời/lỗ trừ cước 3PL, không trừ chi hộ
select tests.assert((select carrier_cost = 3200000 and profit_before_vehicle = revenue - trip_cost - 3200000 from public.shipment_profit
  where shipment_id = (select v::uuid from t_cc where k = 's1')), 'Lời/lỗ trừ cước 3PL, không trừ chi hộ 3PL');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select tests.assert((select r.carrier_cost = 3200000 and r.profit = p.profit_before_vehicle and r.cost = p.trip_cost + 3200000
  from public.report_shipment_profit r join public.shipment_profit p on p.shipment_id = r.id where r.id = (select v::uuid from t_cc where k = 's1')),
  'Báo cáo lợi nhuận tính chi phí 3PL vào chi phí');
reset role;

-- Chuyến 2: nhập cước, trả nhiều chuyến một lần
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.set_shipment_carrier_costs((select v::uuid from t_cc where k = 's2'), (select v::uuid from t_cc where k = 'sp1'), '[{"kind":"freight","amount":2500000}]');
select public.set_shipment_carrier_costs((select v::uuid from t_cc where k = 's3'), (select v::uuid from t_cc where k = 'sp2'), '[{"kind":"freight","amount":900000}]');
select tests.assert_fails($$select public.pay_carrier_payables(array(select payable_id from public.payables where false))$$, 'Điều phối không trả tiền được');
reset role;
select tests.login('00000000-0000-0000-0000-0000000000c1');
set role authenticated;
select tests.assert((select count(*) from public.report_carrier_trips where id = (select v::uuid from t_cc where k = 's3')) = 1,
  'Chuyến xe công ty có nhập chi phí 3PL (thuê lại) thì vào báo cáo');
select tests.assert_fails($$select public.pay_carrier_payables(array(select payable_id from public.report_carrier_trips where id in
  (select v::uuid from t_cc where k in ('s2', 's3'))))$$, 'Không trả cùng lúc cho hai nhà xe');
insert into t_cc select 'bulk', public.pay_carrier_payables(array(select payable_id from public.report_carrier_trips where id in
  (select v::uuid from t_cc where k in ('s1', 's2'))), null, null, 'FT-GOP-01')::text;
select tests.assert(((select v from t_cc where k = 'bulk')::jsonb->>'count')::int = 2
  and ((select v from t_cc where k = 'bulk')::jsonb->>'total')::numeric = 1550000 + 2500000, 'Trả gộp 2 chuyến đúng số còn nợ');
select tests.assert((select bool_and(pay_status = 'paid' and remaining_amount = 0) from public.report_carrier_trips where id in
  (select v::uuid from t_cc where k in ('s1', 's2'))), 'Hai chuyến đã trả đủ');
select tests.assert((select count(*) from public.payments where reference_no = 'FT-GOP-01' and status = 'posted' and direction = 'out') = 2,
  'Mỗi chuyến một phiếu chi, cùng số giao dịch');
select tests.assert((select trips = 2 and carrier_total = 3550000 + 2500000 and remaining_amount = 0 from public.report_carrier_by_supplier
  where supplier_id = (select v::uuid from t_cc where k = 'sp1') and report_month = (select report_month from public.report_carrier_trips where id = (select v::uuid from t_cc where k = 's1'))
  ) or (select count(*) from public.report_carrier_by_supplier where supplier_id = (select v::uuid from t_cc where k = 'sp1')) = 2,
  'Tổng hợp theo nhà xe');
select tests.assert((select kind from public.payable_list where id = (select v::uuid from t_cc where k = 'ap1')) = 'carrier', 'Danh sách phải trả có loại công nợ 3PL');
reset role;

-- Xóa hết chi phí chuyến 3 (chưa trả) thì hủy công nợ; hủy chuyến hủy công nợ chưa trả
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.set_shipment_carrier_costs((select v::uuid from t_cc where k = 's3'), (select v::uuid from t_cc where k = 'sp2'), '[]');
reset role;
select tests.assert((select status from public.payables where shipment_id = (select v::uuid from t_cc where k = 's3') and kind = 'carrier') = 'cancelled',
  'Xóa hết khoản thì công nợ 3PL chưa trả bị hủy');
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.set_shipment_carrier_costs((select v::uuid from t_cc where k = 's3'), (select v::uuid from t_cc where k = 'sp2'), '[{"kind":"freight","amount":700000}]');
reset role;
select tests.assert((select count(*) from public.payables where shipment_id = (select v::uuid from t_cc where k = 's3') and kind = 'carrier' and status = 'open' and amount = 700000) = 1,
  'Nhập lại thì lập công nợ mới');
insert into t_cc select 's4', id::text from public.shipments where status in ('draft', 'assigned', 'accepted') order by created_at desc limit 1;
select tests.assert(exists (select 1 from t_cc where k = 's4'), 'Có chuyến chưa chạy để kiểm thử hủy');
select tests.login('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.set_shipment_carrier_costs((select v::uuid from t_cc where k = 's4'), (select v::uuid from t_cc where k = 'sp2'), '[{"kind":"freight","amount":500000}]');
reset role;
update public.shipments set status = 'cancelled', cancel_reason = 'Kiểm thử 3PL' where id = (select v::uuid from t_cc where k = 's4');
select tests.assert((select count(*) from public.payables where shipment_id = (select v::uuid from t_cc where k = 's4') and kind = 'carrier' and status <> 'cancelled') = 0,
  'Hủy chuyến thì hủy công nợ 3PL chưa trả');
set role anon;
select tests.assert_fails($$select * from public.report_carrier_trips$$, 'Khách vãng lai không xem được báo cáo 3PL');
reset role;
\o
\echo 'TẤT CẢ KIỂM THỬ CHI PHÍ, THANH TOÁN 3PL ĐỀU ĐẠT'
