-- =============================================================================
-- GHA 9034: TICK "CÓ CHI HỘ" + DANH SÁCH PHÍ BỐC XẾP / CHI HỘ CHƯA NHẬP (LE 20/11/2026)
--   1. shipments.requires_pass_through: ô tick "Có chi hộ" khi tạo/sửa đơn (cạnh "Có chi phí bốc xếp" của 9033).
--   2. View report_missing_fees: mỗi dòng một chuyến (chưa hủy) có tick mà chưa nhập phí:
--      - Thiếu bốc xếp: tick "Có chi phí bốc xếp" mà chưa có khoản trả bốc xếp 3PL (loại phí nhóm Bốc xếp trong
--        chi phí trả 3PL) và chưa có chi phí bốc xếp (hạng mục chi phí nhóm Bốc xếp, đã duyệt hoặc chờ duyệt).
--      - Thiếu chi hộ: tick "Có chi hộ" mà tổng chi hộ thu khách của chuyến = 0.
--      Nhập xong thì chuyến tự rời danh sách. Trang /phi-chua-nhap đọc view này.
-- Cần chạy 9033 trước. Chạy lại nhiều lần được.
-- =============================================================================

alter table public.shipments add column if not exists requires_pass_through boolean not null default false;
comment on column public.shipments.requires_pass_through is 'Có chi hộ (tick ở Điều phối): chưa nhập phí chi hộ thu khách thì hiện ở trang Phí chưa nhập';
create index if not exists shipments_requires_pass_through_idx on public.shipments (id) where requires_pass_through;

create or replace view public.report_missing_fees with (security_invoker = true) as
select t.*
from (
  select s.id, s.shipment_code, o.order_code, s.status,
         (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date as pickup_date,
         (coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_date,
         c.code as customer_code, c.name as customer_name,
         v.plate_number, d.full_name as driver_name,
         coalesce(sp.name, vsp.name) as carrier_name,
         pl.name as pickup_name, dl.name as delivery_name, el.name as empty_return_name,
         private.route_label(pl.name, dl.name, el.name) as route_label,
         s.container_no,
         round(coalesce(w.kg, 0) / 1000, 3) as tons,
         s.requires_loading, s.requires_pass_through,
         coalesce(lc.amount, 0) as loading_cost,
         coalesce(fl.amount, 0) as loading_revenue,
         s.pass_through_amount,
         (s.requires_loading and coalesce(lc.n, 0) = 0) as missing_loading,
         (s.requires_pass_through and s.pass_through_amount = 0) as missing_pass_through
  from public.shipments s
  join public.transport_orders o on o.id = s.order_id
  left join public.customers c on c.id = o.payer_customer_id
  left join public.vehicles v on v.id = s.vehicle_id
  left join public.suppliers sp on sp.id = s.carrier_supplier_id
  left join public.suppliers vsp on vsp.id = v.supplier_id
  left join public.drivers d on d.id = s.driver_id
  left join public.locations pl on pl.id = s.pickup_location_id
  left join public.locations dl on dl.id = s.delivery_location_id
  left join public.locations el on el.id = s.empty_return_location_id
  left join lateral (select sum(si.weight_kg) as kg from public.shipment_items si where si.shipment_id = s.id) w on true
  left join lateral (
    select count(*) as n, sum(x.amount) as amount from (
      select cc.amount from public.shipment_carrier_costs cc join public.fee_types ft on ft.id = cc.fee_type_id and ft.is_loading
      where cc.shipment_id = s.id
      union all
      select e.amount from public.shipment_expenses e join public.expense_categories ec on ec.id = e.category_id and ec.report_bucket = 'loading'
      where e.shipment_id = s.id and e.status in ('approved', 'pending')
    ) x
  ) lc on true
  left join lateral (
    select sum(sf.amount) as amount from public.shipment_fees sf join public.fee_types ft on ft.id = sf.fee_type_id
    where sf.shipment_id = s.id and ft.is_loading
  ) fl on true
  where s.status <> 'cancelled' and (s.requires_loading or s.requires_pass_through)
    and (private.has_perm('dispatch.view') or private.has_perm('shipments.view') or private.has_perm('reports.view'))
) t
where t.missing_loading or t.missing_pass_through;

revoke all on public.report_missing_fees from anon;
grant select on public.report_missing_fees to authenticated;

-- Kết quả: số chuyến còn thiếu phí
select count(*) filter (where missing_loading) as "Thiếu bốc xếp", count(*) filter (where missing_pass_through) as "Thiếu chi hộ"
from public.report_missing_fees;
