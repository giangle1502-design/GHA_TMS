-- =============================================================================
-- DỮ LIỆU MẪU CHỈ DÀNH CHO MÔI TRƯỜNG PHÁT TRIỂN / CHẠY THỬ CỤC BỘ
-- KHÔNG chạy trên CSDL thật. Script tự từ chối nếu CSDL đã có dữ liệu nghiệp vụ
-- hoặc có tài khoản không thuộc miền thử nghiệm (@khanhha.test).
-- =============================================================================
do $$
begin
  if exists (select 1 from public.customers)
     or exists (select 1 from auth.users where email not like '%@khanhha.test') then
    raise exception 'Từ chối nạp dữ liệu mẫu: CSDL đã có dữ liệu hoặc tài khoản thật.';
  end if;
end $$;

-- Tài khoản thử nghiệm (đăng nhập bằng email/mật khẩu chỉ ở môi trường cục bộ; xem scripts/e2e-smoke.mjs)
insert into public.user_invitations (email, role_codes, note) values
  ('owner@khanhha.test', '{super_admin}', 'Dữ liệu mẫu'),
  ('admin@khanhha.test', '{admin}', 'Dữ liệu mẫu'),
  ('dieuphoi@khanhha.test', '{dispatcher}', 'Dữ liệu mẫu'),
  ('ketoan@khanhha.test', '{accountant}', 'Dữ liệu mẫu'),
  ('giamdoc@khanhha.test', '{director}', 'Dữ liệu mẫu');

insert into public.company_entities (code, name, tax_code, address) values
  ('KH', 'Công ty Vận tải Khánh Hà (mẫu)', '0000000000', 'Địa chỉ mẫu');

insert into public.vehicle_types (code, name, payload_tons, sort_order) values
  ('XT2T5', 'Xe tải 2,5 tấn', 2.5, 1), ('XT8T', 'Xe tải 8 tấn', 8, 2), ('CONT40', 'Đầu kéo container 40ft', 30, 3);

insert into public.customers (code, name, tax_code, billing_address, contact_name, phone, invoice_email, payment_term_days, credit_limit) values
  ('KH001', 'Công ty Mẫu A', '0300000001', 'KCN Mẫu, Bình Dương', 'Chị Lan', '0900000001', 'ketoan@mau-a.test', 30, 500000000),
  ('KH002', 'Công ty Mẫu B', '0300000002', 'Quận 7, TP.HCM', 'Anh Minh', '0900000002', 'ketoan@mau-b.test', 15, 200000000);

insert into public.locations (code, name, company_name, full_address, province, contact_name, phone, latitude, longitude, operating_hours, gate_instructions) values
  ('DD001', 'Kho Mẫu Bình Dương', 'Công ty Mẫu A', 'Lô A1, KCN Mẫu, Thuận An, Bình Dương', 'Bình Dương', 'Thủ kho Hùng', '0900000011', 10.904, 106.703, '07:00-17:00', 'Vào cổng số 2, báo bảo vệ mã chuyến'),
  ('DD002', 'Cảng Cát Lái (mẫu)', null, 'Cát Lái, Thủ Đức, TP.HCM', 'TP.HCM', 'Điều độ cảng', '0900000012', 10.758, 106.788, '24/7', null),
  ('DD003', 'Kho Mẫu Long An', 'Công ty Mẫu B', 'KCN Mẫu, Bến Lức, Long An', 'Long An', 'Chị Hoa', '0900000013', null, null, '08:00-16:30', null);

insert into public.drivers (code, full_name, phone, contract_type, start_date, base_salary, per_trip_salary, meal_allowance) values
  ('TX001', 'Nguyễn Văn Mẫu', '0910000001', 'definite', '2025-01-01', 7000000, 300000, 50000),
  ('TX002', 'Trần Văn Thử', '0910000002', 'definite', '2025-03-01', 7000000, 300000, 50000);
insert into public.driver_sensitive (driver_id, national_id, national_id_issued_date, national_id_issued_place)
select id, '0790000000' || right(code, 2), '2021-01-01', 'Cục CS QLHC về TTXH' from public.drivers;

insert into public.user_invitations (email, role_codes, driver_id, note)
select 'taixe.a@khanhha.test', '{driver}', id, 'Dữ liệu mẫu' from public.drivers where code = 'TX001';
insert into public.user_invitations (email, role_codes, driver_id, note)
select 'taixe.b@khanhha.test', '{driver}', id, 'Dữ liệu mẫu' from public.drivers where code = 'TX002';

insert into public.vehicles (code, plate_number, vehicle_type_id, brand, model_year, ownership_type, registration_expiry, insurance_expiry, fuel_norm_l_per_100km, assigned_driver_id)
select 'XE001', '51C-000.01', (select id from public.vehicle_types where code = 'XT8T'), 'Hino', 2022, 'owned',
       (now() at time zone 'Asia/Ho_Chi_Minh')::date + 20, (now() at time zone 'Asia/Ho_Chi_Minh')::date + 200, 18,
       (select id from public.drivers where code = 'TX001')
union all
select 'XE002', '51C-000.02', (select id from public.vehicle_types where code = 'XT2T5'), 'Isuzu', 2021, 'lease_purchase',
       (now() at time zone 'Asia/Ho_Chi_Minh')::date + 120, (now() at time zone 'Asia/Ho_Chi_Minh')::date + 10, 12,
       (select id from public.drivers where code = 'TX002');

insert into public.vehicle_financials (vehicle_id, purchase_date, purchase_price, residual_value, depreciation_months, loan_principal, loan_interest_rate, loan_start_date, loan_end_date, monthly_installment)
select id, '2022-06-01', 1200000000, 120000000, 120, 800000000, 9.5, '2022-06-15', '2027-06-15', 16800000 from public.vehicles where code = 'XE001';

insert into public.routes (code, name, pickup_location_id, delivery_location_id, distance_km)
select 'TD001', 'Bình Dương - Cát Lái', a.id, b.id, 35 from public.locations a, public.locations b where a.code = 'DD001' and b.code = 'DD002';

insert into public.transport_price_lists (code, customer_id, pickup_location_id, delivery_location_id, vehicle_type_id, unit_price, pricing_unit, reference_distance_km, effective_from)
select 'BG001', c.id, a.id, b.id, vt.id, 3500000, 'trip', 35, '2026-01-01'
from public.customers c, public.locations a, public.locations b, public.vehicle_types vt
where c.code = 'KH001' and a.code = 'DD001' and b.code = 'DD002' and vt.code = 'XT8T';

-- Một đơn hàng mẫu gồm 2 chuyến (giá chụp từ bảng giá BG001)
with o as (
  insert into public.transport_orders (customer_id, payer_customer_id, notes)
  select (select id from public.customers where code = 'KH001'), (select id from public.customers where code = 'KH002'), 'Đơn hàng mẫu'
  returning id
)
insert into public.shipments (order_id, sequence_in_order, pickup_at, expected_delivery_at, pickup_location_id, delivery_location_id, vehicle_type_id,
                              vehicle_id, driver_id, price_list_id, unit_price, fuel_support_rate, fuel_support_base, fuel_support_amount, pricing_snapshot, notes)
select o.id, n, now() + (n || ' hours')::interval, now() + ((n + 4) || ' hours')::interval,
       (select id from public.locations where code = 'DD001'), (select id from public.locations where code = 'DD002'),
       (select id from public.vehicle_types where code = 'XT8T'),
       case when n = 1 then (select id from public.vehicles where code = 'XE001') end,
       case when n = 1 then (select id from public.drivers where code = 'TX001') end,
       (select id from public.transport_price_lists where code = 'BG001'), 3500000, 39, 'freight_revenue', 1365000,
       jsonb_build_object('source', 'seed', 'price_list', 'BG001', 'fuel_rule', 'default 39% freight_revenue'),
       case when n = 1 then 'Mang theo phiếu xuất kho' end
from o, generate_series(1, 2) n;

-- Phân công chuyến 1 cho tài xế TX001
insert into public.shipment_assignments (shipment_id, driver_id, vehicle_id)
select id, driver_id, vehicle_id from public.shipments where driver_id is not null;
update public.shipments set status = 'assigned' where driver_id is not null;
