-- Bốc xếp tách khỏi báo cáo phí chi hộ: phí bốc xếp bản chất là chi hộ nhưng không xuất hóa đơn,
-- còn phí nâng, hạ, cược cont (chi hộ có hóa đơn) phải tách riêng. Phí thuộc nhóm bốc xếp chỉ hiện ở báo cáo Bốc xếp.
-- Khách phải trả vẫn gồm mọi khoản chi hộ.

create or replace view public.report_fee_lines as
select r.id || ':' || f.kind_key as id, r.id as shipment_id, r.shipment_code, r.order_code, r.report_date, r.report_month,
       to_char(r.report_month, 'MM/YYYY') as month_label, r.customer_id, r.customer_name, r.plate_number, r.driver_name,
       r.pickup_name, r.delivery_name, f.fee_name, f.fee_kind, f.sort_order, f.amount, f.note,
       r.customer_code, f.is_loading
from public.report_shipment_profit r
join public.shipments s on s.id = r.id
cross join lateral (
  select 'cuoc' as kind_key, 'Cước vận chuyển' as fee_name, 'revenue' as fee_kind, -3 as sort_order, s.freight_amount as amount, null::text as note, false as is_loading
  where s.freight_amount > 0
  union all
  select 'phu-phi', 'Phụ phí', 'revenue', -2, s.surcharge_amount, null, false where s.surcharge_amount > 0
  union all
  select 'dau', 'Hỗ trợ dầu', 'revenue', -1, s.fuel_support_amount, null, false where s.fuel_support_amount > 0
  union all
  select 'phi-' || sf.line_no, ft.name, sf.fee_kind, ft.sort_order, sf.amount, sf.note, ft.is_loading
  from public.shipment_fees sf join public.fee_types ft on ft.id = sf.fee_type_id
  where sf.shipment_id = s.id
) f;

create or replace view public.report_pass_through_fees as
select * from public.report_fee_lines where fee_kind = 'pass_through' and not is_loading;

revoke all on public.report_fee_lines, public.report_pass_through_fees from anon;
grant select on public.report_fee_lines, public.report_pass_through_fees to authenticated;

comment on column public.fee_types.is_loading is 'Phí bốc xếp (không xuất hóa đơn): tách khỏi báo cáo chi hộ, đưa vào báo cáo Bốc xếp';
