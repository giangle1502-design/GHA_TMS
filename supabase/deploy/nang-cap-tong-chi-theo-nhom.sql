-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Báo cáo tổng chi theo nhóm phí (trừ chi hộ), đánh dấu phí chi ra là chi hộ khách
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.report_spending_lines') is not null then
    raise exception 'CSDL đã được nâng cấp Báo cáo tổng chi theo nhóm phí (trừ chi hộ), đánh dấu phí chi ra là chi hộ khách trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261108000067_spending_report.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0067: Báo cáo tổng chi theo nhóm phí, trừ chi hộ (08/11/2026)
--   * expense_categories.is_pass_through: phí chi ra là CHI HỘ khách (công ty/tài xế trả thay, khách trả lại,
--     ví dụ nâng hạ, cược cont). Báo cáo tổng chi không cộng các phí này. Tự đánh dấu sẵn phí có tên
--     chứa "chi hộ", "nâng", "cược"; người dùng sửa ở Danh mục hệ thống → Danh mục phí → Chi ra.
--   * fee_catalog_items: phí chi ra đánh dấu chi hộ hiện "Chi hộ" ở cột Tính vào.
--   * report_spending_lines: mọi khoản chi theo ngày, mỗi dòng có nhóm phí, khoản chi, nguồn:
--       trip     = chi phí chuyến (shipment_expenses, đã duyệt / chờ duyệt), nhóm = Nhóm phí chi ra
--       vehicle  = bảo trì, sửa chữa, kiểm định, bảo hiểm theo xe (maintenance_records)
--       carrier  = khoản trả nhà xe 3PL (shipment_carrier_costs; chi hộ 3PL đánh dấu chi hộ)
--       purchase = phiếu chi của Đề nghị chi, mua sắm (payments đã ghi sổ)
--     Ứng tiền tài xế KHÔNG phải chi phí (trừ vào lương) nên không có ở đây.
-- Không xóa dữ liệu.
-- =============================================================================

alter table public.expense_categories add column if not exists is_pass_through boolean not null default false;
comment on column public.expense_categories.is_pass_through is 'Chi hộ khách: công ty / tài xế trả thay, khách trả lại; không cộng vào báo cáo tổng chi';

do $$
begin
  -- Chỉ đánh dấu sẵn một lần, lúc thêm cột (chạy lại tệp nâng cấp không ghi đè lựa chọn của người dùng)
  if not exists (select 1 from public.system_settings where key = 'report.spending_pass_through_seeded') then
    update public.expense_categories
       set is_pass_through = true
     where name ~* '(chi hộ|nâng|cược)' or legacy_code = 'LIFTING' or code = 'LIFTING';
    insert into public.system_settings (key, value, description, is_public)
    values ('report.spending_pass_through_seeded', 'true', 'Đã tự đánh dấu phí chi ra là chi hộ (0067)', false)
    on conflict (key) do nothing;
  end if;
end $$;

create or replace view public.fee_catalog_items with (security_invoker = true) as
select t.id, 'customer'::text as fee_source, t.code, t.name, g.name as group_name,
       t.fee_kind as counts_as, t.description, t.sort_order, t.is_active, g.sort_order as group_sort,
       t.created_at, t.updated_at
from public.fee_types t
left join public.fee_groups g on g.id = t.fee_group_id
union all
select c.id, 'expense', c.code, c.name, coalesce(g.name, c.group_name),
       case when c.is_pass_through then 'pass_through' else 'cost' end, null, c.sort_order, c.is_active, g.sort_order,
       c.created_at, c.updated_at
from public.expense_categories c
left join public.expense_groups g on g.id = c.group_id;

create or replace view public.report_spending_lines as
select 'cp:' || e.id as id, 'trip'::text as source,
       coalesce(g.name, nullif(trim(c.group_name), ''), 'Khác') as group_name,
       coalesce(g.sort_order, 9000) as group_sort,
       c.name as item_name,
       (e.incurred_at at time zone 'Asia/Ho_Chi_Minh')::date as report_date,
       e.amount, e.status, c.is_pass_through,
       e.code, s.shipment_code, v.plate_number, d.full_name as driver_name, cu.name as customer_name,
       sp.name as supplier_name, e.paid_by, e.ref_no, e.note
from public.shipment_expenses e
join public.expense_categories c on c.id = e.category_id
left join public.expense_groups g on g.id = c.group_id
join public.shipments s on s.id = e.shipment_id
left join public.transport_orders o on o.id = s.order_id
left join public.customers cu on cu.id = o.customer_id
left join public.drivers d on d.id = e.driver_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.suppliers sp on sp.id = e.supplier_id
where e.status in ('approved', 'pending') and private.has_perm('reports.view')
union all
select 'bd:' || m.id, 'vehicle',
       case when m.record_type in ('inspection', 'insurance') then 'Kiểm định, bảo hiểm'
            when m.record_type = 'other' then 'Chi phí xe khác'
            else 'Bảo trì, sửa chữa' end,
       9500,
       case m.record_type when 'repair' then 'Sửa chữa máy móc' when 'maintenance' then 'Bảo dưỡng' when 'tire' then 'Thay lốp'
            when 'tire_patch' then 'Vá lốp' when 'oil' then 'Thay nhớt' when 'inspection' then 'Phí kiểm định'
            when 'insurance' then 'Phí bảo hiểm' else 'Khác' end,
       m.performed_at, m.amount, 'approved', false,
       null, null, v.plate_number, null, null, sp.name, 'company', null, m.description
from public.maintenance_records m
join public.vehicles v on v.id = m.vehicle_id
left join public.suppliers sp on sp.id = m.supplier_id
where m.status = 'recorded' and m.amount > 0 and private.has_perm('reports.view')
union all
select 'tn:' || k.id, 'carrier', 'Thuê xe ngoài 3PL', 9600,
       case k.cost_kind when 'freight' then 'Cước trả 3PL' when 'pass_through' then 'Chi hộ trả 3PL' else 'Chi phí khác 3PL' end
         || coalesce(': ' || nullif(trim(k.description), ''), ''),
       (coalesce(s.completed_at, s.pickup_at, s.created_at) at time zone 'Asia/Ho_Chi_Minh')::date,
       k.amount, 'approved', k.cost_kind = 'pass_through',
       null, s.shipment_code, v.plate_number, d.full_name, cu.name, sp.name, 'company', k.ref_no, k.note
from public.shipment_carrier_costs k
join public.shipments s on s.id = k.shipment_id
left join public.transport_orders o on o.id = s.order_id
left join public.customers cu on cu.id = o.customer_id
left join public.drivers d on d.id = s.driver_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.suppliers sp on sp.id = s.carrier_supplier_id
where s.status <> 'cancelled' and private.has_perm('reports.view')
union all
select 'dn:' || p.id, 'purchase', coalesce(nullif(trim(t.group_name), ''), 'Đề nghị chi, mua sắm'), 9700,
       t.name,
       (p.paid_at at time zone 'Asia/Ho_Chi_Minh')::date,
       p.amount, 'approved', false,
       p.code, null, null, null, null, coalesce(sp.name, pr.payee), null, pr.code, pr.title
from public.payments p
join public.purchase_requests pr on pr.id = p.purchase_request_id
join public.purchase_request_types t on t.id = pr.type_id
left join public.suppliers sp on sp.id = pr.supplier_id
where p.purpose = 'purchase_request' and p.status = 'posted' and p.direction = 'out' and private.has_perm('reports.view');

comment on view public.report_spending_lines is 'Báo cáo tổng chi: từng khoản chi (chi phí chuyến, chi phí xe, trả 3PL, đề nghị chi) có nhóm phí và cờ chi hộ';
revoke all on public.report_spending_lines from anon;
grant select on public.report_spending_lines to authenticated;

commit;
