-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Nhập chi phí đầu ra theo dòng ở chuyến, Nhóm chi phí trong Danh mục hệ thống
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.expense_groups') is not null then
    raise exception 'CSDL đã được nâng cấp Nhập chi phí đầu ra theo dòng ở chuyến, Nhóm chi phí trong Danh mục hệ thống trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261102000050_trip_costs_groups.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0050: Nhập chi phí đầu ra theo dòng ở chi tiết chuyến + Nhóm chi phí trong Danh mục hệ thống (02/11/2026)
--   * Bảng expense_groups (Danh mục hệ thống → Nhóm chi phí). Hạng mục chi phí bắt buộc CHỌN nhóm từ danh sách
--     (trước đây gõ tay group_name nên dễ sai chính tả, báo cáo tách thành nhiều nhóm). group_name vẫn giữ,
--     tự chép từ nhóm để các báo cáo cũ không đổi.
--   * shipment_expenses.ref_no: số chứng từ (hóa đơn, biên lai) của từng khoản chi.
--   * add_shipment_expense nhận thêm p_ref_no; cancel_shipment_expense: văn phòng hủy khoản chi nhập sai.
--   * expense_list, report_cost_lines, report_expense_by_category: thêm nhóm chi phí (theo thứ tự nhóm),
--     số chứng từ, khoản CHỜ DUYỆT (báo cáo trước chỉ hiện khoản đã duyệt nên trông như "không có số liệu").
-- Không xóa dữ liệu. Nhóm cũ được tạo từ các group_name đang có.
-- =============================================================================

-- 1. Nhóm chi phí
create table if not exists public.expense_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  name text not null check (length(trim(name)) between 1 and 100),
  description text check (description is null or length(description) <= 500),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.expense_groups is 'Nhóm chi phí (chi phí đầu ra của chuyến): Nhiên liệu, Cầu đường bến bãi, Bốc xếp nâng hạ...';
create unique index if not exists expense_groups_name_uq on public.expense_groups (lower(trim(name)));
select private.attach_standard_triggers('public.expense_groups');
create trigger trg_expense_groups_code before insert on public.expense_groups for each row execute function private.fill_master_code('NCP');
create trigger trg_expense_groups_audit after insert or update or delete on public.expense_groups for each row execute function private.audit_row_change('id');
alter table public.expense_groups enable row level security;
select private.apply_module_policies('expense_groups', 'catalogs', '(select private.is_active_user())');
revoke all on public.expense_groups from anon;
grant select, insert, update, delete on public.expense_groups to authenticated;

insert into public.expense_groups (name, sort_order)
select g.name, (row_number() over (order by g.ord, g.name))::int * 10
from (
  select min(trim(group_name)) as name, min(sort_order) as ord
  from public.expense_categories
  where trim(coalesce(group_name, '')) <> ''
  group by lower(trim(group_name))
) g
where not exists (select 1 from public.expense_groups x where lower(trim(x.name)) = lower(g.name));

insert into public.expense_groups (name, sort_order)
select 'Khác', 990
where not exists (select 1 from public.expense_groups where lower(trim(name)) = 'khác');

-- 2. Hạng mục chi phí thuộc nhóm (bắt buộc)
alter table public.expense_categories add column if not exists group_id uuid references public.expense_groups (id);
update public.expense_categories c
   set group_id = g.id
  from public.expense_groups g
 where c.group_id is null and lower(trim(g.name)) = lower(trim(coalesce(nullif(trim(c.group_name), ''), 'Khác')));
alter table public.expense_categories alter column group_id set not null;
create index if not exists expense_categories_group_idx on public.expense_categories (group_id);

-- Chép tên nhóm vào group_name; mã cũ (chỉ gửi group_name) phải khớp đúng một nhóm đã có
create or replace function private.expense_categories_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.expense_groups;
begin
  if new.group_id is null then
    select * into g from public.expense_groups where lower(trim(name)) = lower(trim(coalesce(new.group_name, '')));
    if g.id is null then
      raise exception 'Chọn nhóm chi phí trong danh sách (Danh mục hệ thống → Nhóm chi phí)' using errcode = '22023';
    end if;
    new.group_id := g.id;
  else
    select * into g from public.expense_groups where id = new.group_id;
  end if;
  new.group_name := g.name;
  return new;
end;
$$;
drop trigger if exists trg_expense_categories_group on public.expense_categories;
create trigger trg_expense_categories_group before insert or update of group_id, group_name on public.expense_categories
for each row execute function private.expense_categories_group();

create or replace function private.expense_groups_sync_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.expense_categories set group_name = new.name where group_id = new.id and group_name is distinct from new.name;
  return null;
end;
$$;
drop trigger if exists trg_expense_groups_sync_name on public.expense_groups;
create trigger trg_expense_groups_sync_name after update of name on public.expense_groups
for each row execute function private.expense_groups_sync_name();

-- Trường bổ sung cho nhóm chi phí (module "expense_groups")
create or replace function private.custom_field_table(p_module text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_module
    when 'vehicles' then 'vehicles'
    when 'drivers' then 'drivers'
    when 'customers' then 'customers'
    when 'suppliers' then 'suppliers'
    when 'locations' then 'locations'
    when 'shipments' then 'shipments'
    when 'transport_orders' then 'transport_orders'
    when 'vehicle_types' then 'vehicle_types'
    when 'routes' then 'routes'
    when 'price_lists' then 'transport_price_lists'
    when 'fuel_rules' then 'fuel_support_rules'
    when 'expense_categories' then 'expense_categories'
    when 'expense_groups' then 'expense_groups'
    when 'banks' then 'banks'
    when 'payment_methods' then 'payment_methods'
    when 'company_entities' then 'company_entities'
    when 'salary_rules' then 'salary_rules'
    when 'maintenance_records' then 'maintenance_records'
    when 'catalog_items' then 'catalog_items'
    when 'advances' then 'advance_requests'
    when 'expenses' then 'shipment_expenses'
    when 'payrolls' then 'driver_payrolls'
    when 'receivables' then 'receivables'
    when 'payables' then 'payables'
    when 'shipment_items' then 'shipment_items'
    when 'fee_types' then 'fee_types'
    when 'fee_groups' then 'fee_groups'
    when 'declaration_types' then 'declaration_types'
    when 'leaves' then 'leave_requests'
    when 'purchase_requests' then 'purchase_requests'
    when 'purchase_request_types' then 'purchase_request_types'
    when 'tasks' then 'tasks'
    when 'transport_plans' then 'transport_plans'
  end;
$$;

-- 3. Số chứng từ của khoản chi
alter table public.shipment_expenses add column if not exists ref_no text check (ref_no is null or length(ref_no) <= 100);
comment on column public.shipment_expenses.ref_no is 'Số chứng từ (hóa đơn, biên lai, phiếu) của khoản chi';

-- 4. Văn phòng nhập chi phí (thêm số chứng từ)
drop function if exists public.add_shipment_expense(uuid, uuid, numeric, timestamptz, text, text, uuid, jsonb, uuid, uuid);
create function public.add_shipment_expense(
  p_shipment_id uuid, p_category_id uuid, p_amount numeric, p_incurred_at timestamptz default null, p_note text default null,
  p_paid_by text default 'company', p_driver_id uuid default null, p_custom jsonb default '{}'::jsonb, p_client_request_id uuid default null,
  p_supplier_id uuid default null, p_ref_no text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  c public.expense_categories;
  v_id uuid;
begin
  if not private.has_perm('expenses.create') then
    raise exception 'Bạn không có quyền nhập chi phí' using errcode = '42501';
  end if;
  if p_client_request_id is not null then
    select id into v_id from public.shipment_expenses where client_request_id = p_client_request_id;
    if v_id is not null then return v_id; end if;
  end if;
  select * into s from public.shipments where id = p_shipment_id;
  if s.id is null then
    raise exception 'Chọn chuyến xe' using errcode = '22023';
  end if;
  if s.status = 'cancelled' then
    raise exception 'Chuyến đã hủy, không nhập chi phí' using errcode = '22023';
  end if;
  select * into c from public.expense_categories where id = p_category_id and is_active;
  if c.id is null then
    raise exception 'Chọn loại chi phí' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Số tiền phải lớn hơn 0' using errcode = '22023';
  end if;
  if coalesce(p_paid_by, '') not in ('driver', 'company') then
    raise exception 'Chọn nguồn chi (công ty hoặc tài xế)' using errcode = '22023';
  end if;
  if p_supplier_id is not null and p_paid_by <> 'company' then
    raise exception 'Chỉ chọn nhà thầu khi công ty chi' using errcode = '22023';
  end if;
  if p_supplier_id is not null and not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'Nhà thầu không tồn tại' using errcode = '22023';
  end if;
  if length(coalesce(p_ref_no, '')) > 100 then
    raise exception 'Số chứng từ tối đa 100 ký tự' using errcode = '22023';
  end if;
  v_id := private.insert_expense(s, c, p_amount, p_incurred_at, p_note, 'admin', p_paid_by,
    coalesce(p_driver_id, s.driver_id), auth.uid(), p_custom, p_client_request_id, null);
  update public.shipment_expenses
     set supplier_id = p_supplier_id, ref_no = nullif(trim(coalesce(p_ref_no, '')), '')
   where id = v_id and (p_supplier_id is not null or nullif(trim(coalesce(p_ref_no, '')), '') is not null);
  return v_id;
end;
$$;
revoke all on function public.add_shipment_expense(uuid, uuid, numeric, timestamptz, text, text, uuid, jsonb, uuid, uuid, text) from public, anon;
grant execute on function public.add_shipment_expense(uuid, uuid, numeric, timestamptz, text, text, uuid, jsonb, uuid, uuid, text) to authenticated;

-- 5. Hủy khoản chi nhập sai (giữ lịch sử, khoản đã vào bảng lương thì không hủy)
create or replace function public.cancel_shipment_expense(p_expense_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.shipment_expenses;
  v_label text;
begin
  select * into e from public.shipment_expenses where id = p_expense_id for update;
  if e.id is null then
    raise exception 'Không tìm thấy khoản chi phí' using errcode = '22023';
  end if;
  if not (private.has_perm('expenses.update') or private.has_perm('expenses.delete')
          or (private.has_perm('expenses.create') and e.entered_by = auth.uid() and e.status = 'pending')) then
    raise exception 'Bạn không có quyền hủy khoản chi phí này' using errcode = '42501';
  end if;
  if e.status not in ('pending', 'approved', 'draft') then
    raise exception 'Khoản chi phí đã hủy hoặc bị từ chối' using errcode = '22023';
  end if;
  if e.payroll_id is not null then
    raise exception 'Khoản chi đã vào bảng lương tài xế, hủy bảng lương trước' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Nhập lý do hủy' using errcode = '22023';
  end if;
  v_label := coalesce((select coalesce(nullif(trim(full_name), ''), email) from public.profiles where id = auth.uid()), 'Văn phòng');
  perform private.driver_cancel_expense(e, v_label, 'Hủy khoản chi: ' || left(trim(p_reason), 500));
  update public.shipment_expenses
     set note = left(coalesce(note || ' ', '') || '(hủy: ' || left(trim(p_reason), 200) || ')', 1000)
   where id = e.id;
end;
$$;
revoke all on function public.cancel_shipment_expense(uuid, text) from public, anon;
grant execute on function public.cancel_shipment_expense(uuid, text) to authenticated;

-- 6. Danh sách chi phí: thêm nhóm, số chứng từ (cột mới đặt cuối view)
create or replace view public.expense_list with (security_invoker = true) as
select e.id, e.code, e.shipment_id, s.shipment_code, e.category_id, c.name as category_name, c.report_bucket,
       e.amount, e.incurred_at, e.note, e.source, e.paid_by, e.driver_id, d.full_name as driver_name,
       v.plate_number, e.status, e.created_at, e.approval_request_id, ar.reject_reason,
       private.requester_name(e.entered_by, case when e.entered_by is null then e.driver_id end) as entered_by_name,
       (select count(*) from public.documents doc where doc.entity_type = 'shipment_expense' and doc.entity_id = e.id and doc.archived_at is null) as file_count,
       e.custom_fields,
       e.payroll_id, pr.code as payroll_code,
       e.supplier_id, sp.name as supplier_name,
       e.ref_no, c.group_id, g.name as group_name, g.sort_order as group_sort
from public.shipment_expenses e
join public.shipments s on s.id = e.shipment_id
join public.expense_categories c on c.id = e.category_id
left join public.expense_groups g on g.id = c.group_id
left join public.drivers d on d.id = e.driver_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.approval_requests ar on ar.id = e.approval_request_id
left join public.driver_payrolls pr on pr.id = e.payroll_id
left join public.suppliers sp on sp.id = e.supplier_id;

-- 7. Báo cáo chi theo nhóm: nhóm lấy từ Danh mục, thêm khoản chờ duyệt (status = 'pending', trang báo cáo tách riêng)
create or replace view public.report_cost_lines as
select 'ung:' || a.id as id, 'advance' as cost_kind, 'Ứng tiền' as cost_group, 'Ứng tiền tài xế' as cost_item,
       (a.created_at at time zone 'Asia/Ho_Chi_Minh')::date as report_date, a.code,
       d.full_name as driver_name, v.plate_number, s.shipment_code,
       null::text as paid_by, null::text as supplier_name,
       coalesce(a.amount_approved, a.amount_requested) as amount, a.status, a.reason as note,
       -1 as group_sort, null::text as ref_no
from public.advance_requests a
left join public.drivers d on d.id = a.driver_id
left join public.shipments s on s.id = a.shipment_id
left join public.vehicles v on v.id = s.vehicle_id
where a.status in ('approved', 'paid') and private.has_perm('reports.view')
union all
select 'cp:' || e.id, case when c.report_bucket = 'loading' then 'loading_cost' else 'trip_expense' end,
       coalesce(g.name, nullif(trim(c.group_name), ''), 'Chi phí khác'), c.name,
       (e.incurred_at at time zone 'Asia/Ho_Chi_Minh')::date, e.code,
       d.full_name, v.plate_number, s.shipment_code, e.paid_by, sp.name,
       e.amount, e.status, e.note,
       coalesce(g.sort_order, 9000), e.ref_no
from public.shipment_expenses e
join public.expense_categories c on c.id = e.category_id
left join public.expense_groups g on g.id = c.group_id
join public.shipments s on s.id = e.shipment_id
left join public.drivers d on d.id = e.driver_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.suppliers sp on sp.id = e.supplier_id
where e.status in ('approved', 'pending') and private.has_perm('reports.view')
union all
select 'bd:' || m.id, 'vehicle_cost',
       case when m.record_type in ('inspection', 'insurance') then 'Kiểm định, bảo hiểm'
            when m.record_type = 'other' then 'Chi phí xe khác'
            else 'Bảo trì, sửa chữa' end,
       case m.record_type when 'repair' then 'Sửa chữa máy móc' when 'maintenance' then 'Bảo dưỡng' when 'tire' then 'Thay lốp'
            when 'tire_patch' then 'Vá lốp' when 'oil' then 'Thay nhớt' when 'inspection' then 'Phí kiểm định'
            when 'insurance' then 'Phí bảo hiểm' else 'Khác' end,
       m.performed_at, null, null, v.plate_number, null, 'company', sp.name,
       m.amount, m.status, m.description,
       9500, null
from public.maintenance_records m
join public.vehicles v on v.id = m.vehicle_id
left join public.suppliers sp on sp.id = m.supplier_id
where m.status = 'recorded' and m.amount > 0 and private.has_perm('reports.view');

-- 8. Chi phí theo loại: thêm nhóm và số tiền chờ duyệt
create or replace view public.report_expense_by_category as
select to_char(date_trunc('month', e.incurred_at at time zone 'Asia/Ho_Chi_Minh'), 'YYYY-MM') || ':' || e.category_id as id,
       date_trunc('month', e.incurred_at at time zone 'Asia/Ho_Chi_Minh')::date as report_month,
       to_char(date_trunc('month', e.incurred_at at time zone 'Asia/Ho_Chi_Minh'), 'MM/YYYY') as month_label,
       e.category_id, c.name as category_name, c.report_bucket,
       count(*) filter (where e.status = 'approved') as expense_count,
       coalesce(sum(e.amount) filter (where e.status = 'approved'), 0) as amount,
       sum(e.amount) filter (where e.status = 'approved' and e.paid_by = 'driver') as driver_paid,
       sum(e.amount) filter (where e.status = 'approved' and e.paid_by = 'company') as company_paid,
       c.group_name,
       sum(e.amount) filter (where e.status = 'pending') as pending_amount
from public.shipment_expenses e
join public.expense_categories c on c.id = e.category_id
where e.status in ('approved', 'pending') and private.has_perm('reports.view')
group by 1, 2, 3, e.category_id, c.name, c.report_bucket, c.group_name;

commit;
