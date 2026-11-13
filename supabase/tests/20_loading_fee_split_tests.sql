-- =============================================================================
-- Kiểm thử 0032: phí bốc xếp (chi hộ không xuất hóa đơn) tách khỏi báo cáo phí chi hộ.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;
update public.fee_types set fee_kind = 'pass_through', is_loading = true where name = 'Phí bốc xếp';
insert into public.fee_types (name, fee_kind) values ('Phí nâng KT', 'pass_through');
create temp table t_sp as
  select s.id from public.shipments s
  where s.status in ('in_transit', 'driver_completed', 'closed') and s.receivable_id is null
  order by s.created_at desc limit 1;
grant select on t_sp to authenticated;
select tests.assert((select count(*) from t_sp) = 1, 'Có chuyến tính báo cáo để kiểm thử');

select tests.login('00000000-0000-0000-0000-0000000000a2');
set role authenticated;
select public.set_shipment_fees((select id from t_sp), jsonb_build_array(
  jsonb_build_object('fee_type_id', (select id from public.fee_types where name = 'Phí bốc xếp'), 'amount', 400000),
  jsonb_build_object('fee_type_id', (select id from public.fee_types where name = 'Phí nâng KT'), 'amount', 250000)));
select tests.assert((select string_agg(fee_name, ',') from public.report_pass_through_fees where shipment_id = (select id from t_sp)) = 'Phí nâng KT',
  'Báo cáo chi hộ chỉ có phí nâng, không có phí bốc xếp');
select tests.assert((select loading_revenue from public.report_loading where id = (select id from t_sp)) = 400000, 'Phí bốc xếp hiện ở báo cáo Bốc xếp');
select tests.assert((select pass_through_amount from public.report_shipment_profit where id = (select id from t_sp)) = 650000,
  'Khách phải trả vẫn gồm cả bốc xếp và phí nâng (chi hộ)');
select tests.assert((select count(*) from public.report_fee_lines where shipment_id = (select id from t_sp) and fee_name = 'Phí bốc xếp' and is_loading) = 1,
  'Chi tiết cước phí từng chuyến vẫn có dòng bốc xếp');
reset role;

\o
\echo 'TẤT CẢ KIỂM THỬ TÁCH PHÍ BỐC XẾP KHỎI CHI HỘ ĐỀU ĐẠT'
