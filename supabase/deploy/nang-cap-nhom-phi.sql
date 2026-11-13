-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Nhóm phí (vận chuyển, chi hộ, tờ khai, bốc xếp), loại tờ khai, báo cáo chi phí theo nhóm
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.fee_groups') is not null then
    raise exception 'CSDL đã được nâng cấp Nhóm phí (vận chuyển, chi hộ, tờ khai, bốc xếp), loại tờ khai, báo cáo chi phí theo nhóm trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261101000035_fee_groups.sql
-- =============================================================================
-- 0035: Nhóm phí thu khách và báo cáo chi phí theo nhóm.
-- - fee_groups: Cước vận chuyển, Phí chi hộ, Phí dịch vụ tờ khai, Phí bốc xếp (người dùng tự thêm, sửa).
--   report_role: freight = cộng vào Tổng cước (cùng cước, phụ phí, hỗ trợ dầu); declaration = có chọn loại tờ khai;
--   loading = đưa vào báo cáo Bốc xếp (tự bật fee_types.is_loading); pass_through, other.
-- - declaration_types: Loại tờ khai (Xanh, Vàng, Đỏ), shipment_fees.declaration_type_id.
-- - report_fee_group_lines: mọi khoản cước phí theo nhóm; report_cost_lines: ứng tiền, chi bốc xếp.
-- - report_shipment_profit.freight_total = cước + phụ phí + hỗ trợ dầu + phí thuộc nhóm Cước vận chuyển.
-- Không xóa dữ liệu: loại phí cũ được xếp vào nhóm theo tên / cách tính.
-- =============================================================================

-- 1. Nhóm phí (tên theo người dùng 01/11/2026: Phí vận chuyển, Phí chi hộ, Phí tờ khai, Phí bốc xếp)
create table if not exists public.fee_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  name text not null check (length(trim(name)) between 1 and 150),
  report_role text not null default 'other' check (report_role in ('freight', 'pass_through', 'declaration', 'loading', 'other')),
  description text check (description is null or length(description) <= 500),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.fee_groups is 'Nhóm phí thu khách để tổng kết: Cước vận chuyển, Chi hộ, Tờ khai, Bốc xếp...';
select private.attach_standard_triggers('public.fee_groups');
create trigger trg_fee_groups_code before insert on public.fee_groups for each row execute function private.fill_master_code('NP');
create trigger trg_fee_groups_audit after insert or update or delete on public.fee_groups for each row execute function private.audit_row_change('id');
alter table public.fee_groups enable row level security;
select private.apply_module_policies('fee_groups', 'catalogs', '(select private.is_active_user())');
revoke all on public.fee_groups from anon;
grant select, insert, update, delete on public.fee_groups to authenticated;

insert into public.fee_groups (code, name, report_role, description, sort_order)
select v.code, v.name, v.role, v.descr, v.ord
from (values
  ('CUOC', 'Phí vận chuyển', 'freight', 'Tổng cước = cước vận chuyển + phụ phí + hỗ trợ dầu + các phí trong nhóm này (phụ thu vé, hạ rỗng xa + BOT, neo xe...)', 10),
  ('CHIHO', 'Phí chi hộ', 'pass_through', 'Phí hạ, phí nâng, phí cược: công ty trả hộ khách, khách trả lại', 20),
  ('TOKHAI', 'Phí tờ khai', 'declaration', 'Chọn loại tờ khai (Xanh, Vàng, Đỏ) và nhập phí tờ khai theo cont', 30),
  ('BOCXEP', 'Phí bốc xếp', 'loading', 'Bốc xếp bởi tài xế, bởi 3-PL, phí bồi dưỡng; đưa vào báo cáo Bốc xếp', 40)
) as v(code, name, role, descr, ord)
where not exists (select 1 from public.fee_groups g where g.code = v.code or lower(g.name) = lower(v.name));

-- 2. Loại tờ khai
create table if not exists public.declaration_types (
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
comment on table public.declaration_types is 'Loại tờ khai hải quan (luồng Xanh, Vàng, Đỏ)';
select private.attach_standard_triggers('public.declaration_types');
create trigger trg_declaration_types_code before insert on public.declaration_types for each row execute function private.fill_master_code('TK');
create trigger trg_declaration_types_audit after insert or update or delete on public.declaration_types for each row execute function private.audit_row_change('id');
alter table public.declaration_types enable row level security;
select private.apply_module_policies('declaration_types', 'catalogs', '(select private.is_active_user())');
revoke all on public.declaration_types from anon;
grant select, insert, update, delete on public.declaration_types to authenticated;

insert into public.declaration_types (code, name, description, sort_order)
select v.code, v.name, v.descr, v.ord
from (values
  ('XANH', 'Xanh', 'Luồng xanh: miễn kiểm tra hồ sơ, miễn kiểm hàng', 1),
  ('VANG', 'Vàng', 'Luồng vàng: kiểm tra hồ sơ', 2),
  ('DO', 'Đỏ', 'Luồng đỏ: kiểm tra hồ sơ và kiểm hàng thực tế', 3)
) as v(code, name, descr, ord)
where not exists (select 1 from public.declaration_types d where d.code = v.code or lower(d.name) = lower(v.name));

-- 3. Loại phí thuộc nhóm; nhóm Bốc xếp tự bật is_loading
alter table public.fee_types add column if not exists fee_group_id uuid references public.fee_groups (id) on delete set null;
create index if not exists fee_types_group_idx on public.fee_types (fee_group_id);
comment on column public.fee_types.fee_group_id is 'Nhóm phí để tổng kết (Cước vận chuyển, Chi hộ, Tờ khai, Bốc xếp)';

create or replace function private.fee_types_sync_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.fee_group_id is not null and (tg_op = 'INSERT' or new.fee_group_id is distinct from old.fee_group_id) then
    new.is_loading := coalesce((select g.report_role = 'loading' from public.fee_groups g where g.id = new.fee_group_id), new.is_loading);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_fee_types_sync_group on public.fee_types;
create trigger trg_fee_types_sync_group before insert or update of fee_group_id on public.fee_types
for each row execute function private.fee_types_sync_group();

create or replace function private.fee_groups_sync_types()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.report_role is distinct from old.report_role then
    update public.fee_types set is_loading = (new.report_role = 'loading')
    where fee_group_id = new.id and is_loading <> (new.report_role = 'loading');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_fee_groups_sync_types on public.fee_groups;
create trigger trg_fee_groups_sync_types after update of report_role on public.fee_groups
for each row execute function private.fee_groups_sync_types();

-- Loại phí mới theo yêu cầu (bỏ qua nếu đã có tên trùng)
insert into public.fee_types (name, fee_kind, description, sort_order, fee_group_id)
select v.name, v.kind, v.descr, v.ord, (select id from public.fee_groups where code = v.grp)
from (values
  ('Phụ thu vé (SP-ITC...)', 'revenue', 'Phụ thu vé cảng SP-ITC, Cát Lái...; cộng vào Tổng cước', 11, 'CUOC'),
  ('Phụ thu hạ rỗng xa + BOT', 'revenue', 'Hạ rỗng ở bãi xa kèm phí BOT; cộng vào Tổng cước', 12, 'CUOC'),
  ('Phí neo xe', 'revenue', 'Xe phải neo chờ hàng; cộng vào Tổng cước', 13, 'CUOC'),
  ('Phí hạ', 'pass_through', 'Phí hạ container, chi hộ khách', 21, 'CHIHO'),
  ('Phí nâng', 'pass_through', 'Phí nâng container, chi hộ khách', 22, 'CHIHO'),
  ('Phí cược cont', 'pass_through', 'Tiền cược container, chi hộ khách', 23, 'CHIHO'),
  ('Phí tờ khai theo cont', 'revenue', 'Phí làm tờ khai hải quan theo cont; chọn loại tờ khai Xanh, Vàng, Đỏ', 31, 'TOKHAI'),
  ('Bốc xếp bởi tài xế', 'pass_through', 'Tài xế bốc xếp', 41, 'BOCXEP'),
  ('Bốc xếp bởi 3-PL', 'pass_through', 'Thuê đội bốc xếp / nhà thầu 3-PL', 42, 'BOCXEP'),
  ('Phí bồi dưỡng', 'pass_through', 'Bồi dưỡng công nhân bốc xếp', 43, 'BOCXEP')
) as v(name, kind, descr, ord, grp)
where not exists (select 1 from public.fee_types f where lower(f.name) = lower(v.name));

-- Loại phí cũ chưa có nhóm: bốc xếp → nhóm Bốc xếp, chi hộ → nhóm Chi hộ (phí tính doanh thu khác để người dùng tự xếp)
update public.fee_types set fee_group_id = (select id from public.fee_groups where code = 'BOCXEP')
where fee_group_id is null and is_loading;
update public.fee_types set fee_group_id = (select id from public.fee_groups where code = 'CHIHO')
where fee_group_id is null and fee_kind = 'pass_through';
update public.fee_types set fee_group_id = (select id from public.fee_groups where code = 'TOKHAI')
where fee_group_id is null and lower(name) like '%tờ khai%';

-- 4. Loại tờ khai trên dòng phí
alter table public.shipment_fees add column if not exists declaration_type_id uuid references public.declaration_types (id) on delete restrict;
comment on column public.shipment_fees.declaration_type_id is 'Loại tờ khai (Xanh, Vàng, Đỏ) cho phí thuộc nhóm tờ khai';

-- Trường bổ sung cho 2 danh mục mới
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
  end;
$$;

-- 5. Ghi phí của chuyến kèm loại tờ khai
create or replace function public.set_shipment_fees(p_shipment_id uuid, p_fees jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  it jsonb;
  ft public.fee_types;
  n int := 0;
  v_amount numeric;
  v_note text;
  v_type uuid;
  v_decl uuid;
  v_extra numeric := 0;
  v_pass numeric := 0;
begin
  if not (private.has_perm('dispatch.create') or private.has_perm('dispatch.update') or private.has_perm('shipments.update')) then
    raise exception 'Bạn không có quyền nhập phí của chuyến' using errcode = '42501';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = '22023';
  end if;
  if s.status = 'cancelled' then
    raise exception 'Chuyến đã hủy, không sửa phí' using errcode = '22023';
  end if;
  if s.receivable_id is not null then
    raise exception 'Chuyến đã lập công nợ, không được sửa phí. Hủy phiếu công nợ trước.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_fees, '[]'::jsonb)) <> 'array' then
    raise exception 'Danh sách phí không hợp lệ' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_fees, '[]'::jsonb)) > 100 then
    raise exception 'Mỗi chuyến tối đa 100 dòng phí' using errcode = '22023';
  end if;
  delete from public.shipment_fees where shipment_id = s.id;
  for it in select * from jsonb_array_elements(coalesce(p_fees, '[]'::jsonb)) loop
    v_amount := nullif(trim(coalesce(it ->> 'amount', '')), '')::numeric;
    v_note := nullif(trim(coalesce(it ->> 'note', '')), '');
    v_type := nullif(trim(coalesce(it ->> 'fee_type_id', '')), '')::uuid;
    v_decl := nullif(trim(coalesce(it ->> 'declaration_type_id', '')), '')::uuid;
    continue when v_amount is null and v_type is null and v_note is null and v_decl is null;
    if v_type is null then
      raise exception 'Dòng phí % chưa chọn loại phí', n + 1 using errcode = '22023';
    end if;
    -- Chỉ chọn loại tờ khai, chưa có phí: ghi 0 đ để vẫn lưu loại tờ khai
    if v_amount is null and v_decl is not null then
      v_amount := 0;
    end if;
    if v_amount is null or v_amount < 0 then
      raise exception 'Dòng phí % chưa nhập số tiền hợp lệ', n + 1 using errcode = '22023';
    end if;
    select * into ft from public.fee_types where id = v_type;
    if ft.id is null then
      raise exception 'Loại phí không tồn tại' using errcode = '22023';
    end if;
    if v_decl is not null and not exists (select 1 from public.declaration_types where id = v_decl) then
      raise exception 'Loại tờ khai không tồn tại' using errcode = '22023';
    end if;
    n := n + 1;
    insert into public.shipment_fees (shipment_id, line_no, fee_type_id, fee_kind, amount, note, declaration_type_id)
    values (s.id, n, ft.id, ft.fee_kind, round(v_amount, 0), v_note, v_decl);
    if ft.fee_kind = 'pass_through' then v_pass := v_pass + round(v_amount, 0); else v_extra := v_extra + round(v_amount, 0); end if;
  end loop;
  update public.shipments set extra_fee_amount = v_extra, pass_through_amount = v_pass
  where id = s.id and (extra_fee_amount, pass_through_amount) is distinct from (v_extra, v_pass);
  return n;
exception
  when invalid_text_representation then
    raise exception 'Số tiền, loại phí hoặc loại tờ khai không hợp lệ' using errcode = '22023';
end;
$$;

-- 6. Tổng cước gồm các phí thuộc nhóm Cước vận chuyển (cột mới thêm cuối view)
create or replace view public.report_shipment_profit as
select s.id, s.shipment_code, o.order_code,
       (coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_date,
       date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_month,
       o.payer_customer_id as customer_id, c.name as customer_name,
       s.vehicle_id, v.plate_number, s.driver_id, d.full_name as driver_name,
       pl.name as pickup_name, dl.name as delivery_name, s.status,
       s.freight_amount, s.surcharge_amount, s.fuel_support_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as revenue,
       coalesce(x.cost, 0) as cost,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(x.cost, 0) as profit,
       case when s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount > 0
            then round((s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(x.cost, 0)) * 100
                       / (s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount), 1) end as margin_percent,
       (s.receivable_id is not null) as billed,
       s.extra_fee_amount, s.pass_through_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount + s.pass_through_amount as amount_due,
       s.quantity, s.pricing_unit, s.unit_price,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + coalesce(ff.amount, 0) as freight_total,
       vt.name as vehicle_type_name, to_char(date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh'), 'MM/YYYY') as month_label,
       c.code as customer_code,
       coalesce(ff.amount, 0) as freight_fee_amount
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.payer_customer_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicle_types vt on vt.id = s.vehicle_type_id
left join lateral (select sum(e.amount) as cost from public.shipment_expenses e where e.shipment_id = s.id and e.status = 'approved') x on true
left join lateral (
  select sum(sf.amount) as amount
  from public.shipment_fees sf
  join public.fee_types ft on ft.id = sf.fee_type_id
  join public.fee_groups g on g.id = ft.fee_group_id
  where sf.shipment_id = s.id and g.report_role = 'freight'
) ff on true
where s.status in ('in_transit', 'driver_completed', 'closed') and private.has_perm('reports.view');

-- 7. Mọi khoản cước phí theo nhóm. Cước, phụ phí, hỗ trợ dầu thuộc nhóm Cước vận chuyển (nhóm freight đầu tiên).
create or replace view public.report_fee_group_lines as
with fg as (
  select id, name, sort_order from public.fee_groups where report_role = 'freight' and is_active
  order by sort_order, created_at limit 1
)
select r.id || ':' || f.kind_key as id, r.id as shipment_id, r.shipment_code, r.order_code, r.report_date, r.month_label,
       r.customer_id, r.customer_code, r.customer_name, r.plate_number, r.driver_name, r.pickup_name, r.delivery_name,
       f.group_id, coalesce(f.group_name, 'Phí khác (chưa xếp nhóm)') as group_name, coalesce(f.group_role, 'other') as group_role,
       coalesce(f.group_sort, 9999) as group_sort, f.fee_name, f.fee_sort, f.fee_kind, f.amount, f.declaration_type_name, f.note
from public.report_shipment_profit r
join public.shipments s on s.id = r.id
cross join lateral (
  select 'cuoc' as kind_key, (select id from fg) as group_id, coalesce((select name from fg), 'Cước vận chuyển') as group_name,
         'freight' as group_role, coalesce((select sort_order from fg), 0) as group_sort,
         'Cước vận chuyển' as fee_name, -3 as fee_sort, 'revenue' as fee_kind, s.freight_amount as amount,
         null::text as declaration_type_name, null::text as note
  where s.freight_amount > 0
  union all
  select 'phu-phi', (select id from fg), coalesce((select name from fg), 'Cước vận chuyển'), 'freight', coalesce((select sort_order from fg), 0),
         'Phụ phí', -2, 'revenue', s.surcharge_amount, null, null
  where s.surcharge_amount > 0
  union all
  select 'dau', (select id from fg), coalesce((select name from fg), 'Cước vận chuyển'), 'freight', coalesce((select sort_order from fg), 0),
         'Phí hỗ trợ dầu', -1, 'revenue', s.fuel_support_amount, null, null
  where s.fuel_support_amount > 0
  union all
  select 'phi-' || sf.line_no, g.id, g.name, g.report_role, g.sort_order, ft.name, ft.sort_order, sf.fee_kind, sf.amount, dt.name, sf.note
  from public.shipment_fees sf
  join public.fee_types ft on ft.id = sf.fee_type_id
  left join public.fee_groups g on g.id = ft.fee_group_id
  left join public.declaration_types dt on dt.id = sf.declaration_type_id
  where sf.shipment_id = s.id
) f;

-- 8. Bên chi theo nhóm: chi phí chuyến đã duyệt (theo nhóm của hạng mục chi phí), bảo trì sửa chữa,
--    kiểm định bảo hiểm (theo xe, nhập ở Phương tiện → Bảo dưỡng, sửa chữa), ứng tiền tài xế.
alter table public.maintenance_records drop constraint if exists maintenance_records_record_type_check;
alter table public.maintenance_records add constraint maintenance_records_record_type_check
  check (record_type in ('repair', 'maintenance', 'tire', 'tire_patch', 'oil', 'inspection', 'insurance', 'other'));

create or replace view public.report_cost_lines as
select 'ung:' || a.id as id, 'advance' as cost_kind, 'Ứng tiền' as cost_group, 'Ứng tiền tài xế' as cost_item,
       (a.created_at at time zone 'Asia/Ho_Chi_Minh')::date as report_date, a.code,
       d.full_name as driver_name, v.plate_number, s.shipment_code,
       null::text as paid_by, null::text as supplier_name,
       coalesce(a.amount_approved, a.amount_requested) as amount, a.status, a.reason as note
from public.advance_requests a
left join public.drivers d on d.id = a.driver_id
left join public.shipments s on s.id = a.shipment_id
left join public.vehicles v on v.id = s.vehicle_id
where a.status in ('approved', 'paid') and private.has_perm('reports.view')
union all
select 'cp:' || e.id, case when c.report_bucket = 'loading' then 'loading_cost' else 'trip_expense' end,
       coalesce(nullif(trim(c.group_name), ''), 'Chi phí khác'), c.name,
       (e.incurred_at at time zone 'Asia/Ho_Chi_Minh')::date, e.code,
       d.full_name, v.plate_number, s.shipment_code, e.paid_by, sp.name,
       e.amount, e.status, e.note
from public.shipment_expenses e
join public.expense_categories c on c.id = e.category_id
join public.shipments s on s.id = e.shipment_id
left join public.drivers d on d.id = e.driver_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.suppliers sp on sp.id = e.supplier_id
where e.status = 'approved' and private.has_perm('reports.view')
union all
select 'bd:' || m.id, 'vehicle_cost',
       case when m.record_type in ('inspection', 'insurance') then 'Kiểm định, bảo hiểm'
            when m.record_type = 'other' then 'Chi phí xe khác'
            else 'Bảo trì, sửa chữa' end,
       case m.record_type when 'repair' then 'Sửa chữa máy móc' when 'maintenance' then 'Bảo dưỡng' when 'tire' then 'Thay lốp'
            when 'tire_patch' then 'Vá lốp' when 'oil' then 'Thay nhớt' when 'inspection' then 'Phí kiểm định'
            when 'insurance' then 'Phí bảo hiểm' else 'Khác' end,
       m.performed_at, null, null, v.plate_number, null, 'company', sp.name,
       m.amount, m.status, m.description
from public.maintenance_records m
join public.vehicles v on v.id = m.vehicle_id
left join public.suppliers sp on sp.id = m.supplier_id
where m.status = 'recorded' and m.amount > 0 and private.has_perm('reports.view');

revoke all on public.report_shipment_profit, public.report_fee_group_lines, public.report_cost_lines from anon;
grant select on public.report_shipment_profit, public.report_fee_group_lines, public.report_cost_lines to authenticated;

commit;
