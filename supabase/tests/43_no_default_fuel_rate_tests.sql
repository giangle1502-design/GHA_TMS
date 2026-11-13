-- =============================================================================
-- Kiểm thử 0060: không còn % hỗ trợ dầu mặc định; % dầu lấy theo từng khách
-- (test-db.sh đã kiểm tra 0060 tắt quy tắc mặc định rồi bật lại cho kiểm thử cũ)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
\i supabase/migrations/20261104000060_no_default_fuel_rate.sql
select tests.assert(not exists (select 1 from public.fuel_support_rules where scope_type = 'default' and is_active), '0060 tắt quy tắc dầu mặc định 39%');
select tests.assert(exists (select 1 from public.fuel_support_rules where scope_type = 'default'), 'Quy tắc mặc định chỉ tắt, không xóa');

select tests.login('00000000-0000-0000-0000-0000000000d1'); -- điều phối
set role authenticated;
select tests.assert(
  (select public.quote_shipment('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', null, '2026-10-21') -> 'fuel_rule') = 'null'::jsonb,
  'Khách chưa khai báo % dầu: báo giá không tự điền %');
reset role;

insert into public.fuel_support_rules (scope_type, customer_id, rate_percent, calculation_base, effective_from, notes)
values ('customer', '10000000-0000-0000-0000-000000000002', 25, 'freight_revenue', date '2026-01-01', 'kiểm thử 0060');
set role authenticated;
select tests.assert(
  (select (public.quote_shipment('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', null, '2026-10-21') -> 'fuel_rule' ->> 'rate_percent')::numeric) = 25,
  'Khách có quy tắc riêng: báo giá lấy % của khách (25%)');
reset role;
delete from public.fuel_support_rules where notes = 'kiểm thử 0060';
update public.fuel_support_rules set is_active = true where scope_type = 'default';

\o
\echo 'TẤT CẢ KIỂM THỬ BỎ % DẦU MẶC ĐỊNH ĐỀU ĐẠT'
