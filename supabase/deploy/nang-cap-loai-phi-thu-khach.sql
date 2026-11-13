-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Tách cước phí theo loại phí thu khách (bốc xếp, chi hộ...)
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.shipment_fees') is not null then
    raise exception 'CSDL đã được nâng cấp Tách cước phí theo loại phí thu khách (bốc xếp, chi hộ...) trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261030000029_customer_fees.sql
-- =============================================================================
-- 0029: Tách cước phí thu khách theo loại phí.
-- - Danh mục "Loại phí thu khách" (fee_types): Phí bốc xếp, Phí chi hộ... người dùng tự thêm.
--   fee_kind = 'revenue' (tính doanh thu) hoặc 'pass_through' (chi hộ: khách trả lại, không tính doanh thu).
-- - Mỗi chuyến có nhiều dòng phí (shipment_fees), ghi qua set_shipment_fees (thay toàn bộ danh sách).
-- - shipments.extra_fee_amount / pass_through_amount là tổng các dòng phí, dùng cho doanh thu, công nợ, báo cáo.
-- - Cước vận chuyển (đơn giá × số lượng), Phụ phí, Hỗ trợ dầu giữ nguyên như cũ.
-- =============================================================================

-- 1. Danh mục loại phí
create table if not exists public.fee_types (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  name text not null check (length(trim(name)) between 1 and 150),
  fee_kind text not null default 'revenue' check (fee_kind in ('revenue', 'pass_through')),
  description text check (description is null or length(description) <= 500),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.fee_types is 'Loại phí thu khách ngoài cước vận chuyển: bốc xếp, chi hộ, nâng hạ...';
select private.attach_standard_triggers('public.fee_types');
create trigger trg_fee_types_code before insert on public.fee_types for each row execute function private.fill_master_code('PT');
create trigger trg_fee_types_audit after insert or update or delete on public.fee_types for each row execute function private.audit_row_change('id');
alter table public.fee_types enable row level security;
select private.apply_module_policies('fee_types', 'catalogs', '(select private.is_active_user())');
revoke all on public.fee_types from anon;
grant select, insert, update, delete on public.fee_types to authenticated;

insert into public.fee_types (name, fee_kind, description, sort_order)
select v.name, v.kind, v.descr, v.ord
from (values
  ('Phí bốc xếp', 'revenue', 'Tiền bốc xếp thu của khách, tính vào doanh thu', 10),
  ('Phí chi hộ', 'pass_through', 'Tiền công ty trả hộ khách (phí cảng, phí lưu bãi...), khách trả lại; không tính doanh thu', 20)
) as v(name, kind, descr, ord)
where not exists (select 1 from public.fee_types f where lower(f.name) = lower(v.name));

-- 2. Dòng phí của chuyến
create table if not exists public.shipment_fees (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  line_no smallint not null check (line_no between 1 and 100),
  fee_type_id uuid not null references public.fee_types (id) on delete restrict,
  -- Ảnh chụp loại phí lúc nhập: đổi loại phí sau này không làm đổi doanh thu chuyến cũ
  fee_kind text not null check (fee_kind in ('revenue', 'pass_through')),
  amount numeric(18, 2) not null check (amount >= 0),
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  unique (shipment_id, line_no)
);
create index if not exists shipment_fees_type_idx on public.shipment_fees (fee_type_id);
comment on table public.shipment_fees is 'Các khoản phí thu khách của chuyến, theo loại phí';
select private.attach_standard_triggers('public.shipment_fees');
create trigger trg_shipment_fees_audit after insert or update or delete on public.shipment_fees for each row execute function private.audit_row_change('id');
alter table public.shipment_fees enable row level security;
create policy shipment_fees_select on public.shipment_fees for select to authenticated
  using (exists (select 1 from public.shipments s where s.id = shipment_id));
revoke all on public.shipment_fees from anon;
grant select on public.shipment_fees to authenticated;

alter table public.shipments
  add column if not exists extra_fee_amount numeric(18, 2) not null default 0 check (extra_fee_amount >= 0),
  add column if not exists pass_through_amount numeric(18, 2) not null default 0 check (pass_through_amount >= 0);
comment on column public.shipments.extra_fee_amount is 'Tổng các khoản phí thu khách tính doanh thu (bốc xếp...)';
comment on column public.shipments.pass_through_amount is 'Tổng tiền chi hộ: khách phải trả nhưng không tính doanh thu';

-- Trường bổ sung cho danh mục loại phí
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
  end;
$$;

-- 3. Ghi danh sách phí của chuyến (dòng số tiền trống bị bỏ qua)
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
  if s.status in ('closed', 'cancelled') then
    raise exception 'Chuyến đã đóng hoặc đã hủy, không sửa phí' using errcode = '22023';
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
    continue when v_amount is null and v_type is null and v_note is null;
    if v_type is null then
      raise exception 'Dòng phí % chưa chọn loại phí', n + 1 using errcode = '22023';
    end if;
    if v_amount is null or v_amount < 0 then
      raise exception 'Dòng phí % chưa nhập số tiền hợp lệ', n + 1 using errcode = '22023';
    end if;
    select * into ft from public.fee_types where id = v_type;
    if ft.id is null then
      raise exception 'Loại phí không tồn tại' using errcode = '22023';
    end if;
    n := n + 1;
    insert into public.shipment_fees (shipment_id, line_no, fee_type_id, fee_kind, amount, note)
    values (s.id, n, ft.id, ft.fee_kind, round(v_amount, 0), v_note);
    if ft.fee_kind = 'pass_through' then v_pass := v_pass + round(v_amount, 0); else v_extra := v_extra + round(v_amount, 0); end if;
  end loop;
  update public.shipments set extra_fee_amount = v_extra, pass_through_amount = v_pass
  where id = s.id and (extra_fee_amount, pass_through_amount) is distinct from (v_extra, v_pass);
  return n;
exception
  when invalid_text_representation then
    raise exception 'Số tiền hoặc loại phí không hợp lệ' using errcode = '22023';
end;
$$;
revoke all on function public.set_shipment_fees(uuid, jsonb) from public, anon;
grant execute on function public.set_shipment_fees(uuid, jsonb) to authenticated;

-- 4. Chuyến đã lập công nợ: khóa cả các khoản phí
create or replace function private.guard_billed_shipment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.receivable_id is not null and new.receivable_id is not distinct from old.receivable_id and (
       new.unit_price, new.quantity, new.surcharge_amount, new.fuel_support_amount, new.extra_fee_amount, new.pass_through_amount
     ) is distinct from (old.unit_price, old.quantity, old.surcharge_amount, old.fuel_support_amount, old.extra_fee_amount, old.pass_through_amount) then
    raise exception 'Chuyến đã lập công nợ, không được sửa giá. Hủy phiếu công nợ trước.' using errcode = '42501';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' and old.receivable_id is not null then
    raise exception 'Chuyến đã lập công nợ, không hủy được. Hủy phiếu công nợ trước.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 5. Công nợ phải thu: khách trả cả phí chi hộ
create or replace function public.create_receivable_from_shipments(
  p_shipment_ids uuid[], p_issued_date date default null, p_due_date date default null,
  p_invoice_no text default null, p_note text default null, p_custom_fields jsonb default '{}'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customers uuid[];
  v_customer public.customers;
  v_amount numeric;
  v_count int;
  v_issued date := coalesce(p_issued_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  r public.receivables;
begin
  if not private.has_perm('receivables.create') then
    raise exception 'Bạn không có quyền lập công nợ' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_shipment_ids), 0) = 0 then
    raise exception 'Chọn ít nhất một chuyến' using errcode = '22023';
  end if;
  perform 1 from public.shipments where id = any (p_shipment_ids) for update;
  select array_agg(distinct o.payer_customer_id), count(*),
         sum(s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount + s.pass_through_amount)
    into v_customers, v_count, v_amount
  from public.shipments s join public.transport_orders o on o.id = s.order_id
  where s.id = any (p_shipment_ids);
  if v_count <> cardinality(p_shipment_ids) then
    raise exception 'Có chuyến không tồn tại' using errcode = 'P0001';
  end if;
  if cardinality(v_customers) > 1 then
    raise exception 'Các chuyến phải cùng một khách hàng thanh toán' using errcode = '22023';
  end if;
  if exists (select 1 from public.shipments where id = any (p_shipment_ids) and receivable_id is not null) then
    raise exception 'Có chuyến đã lập công nợ rồi' using errcode = '22023';
  end if;
  if exists (select 1 from public.shipments where id = any (p_shipment_ids) and status not in ('driver_completed', 'closed')) then
    raise exception 'Chỉ lập công nợ cho chuyến đã hoàn thành' using errcode = '22023';
  end if;
  if coalesce(v_amount, 0) <= 0 then
    raise exception 'Tổng tiền các chuyến bằng 0, kiểm tra lại đơn giá' using errcode = '22023';
  end if;
  select * into v_customer from public.customers where id = v_customers[1];
  insert into public.receivables (customer_id, shipment_id, amount, issued_date, due_date, invoice_no, note, custom_fields)
  values (v_customer.id, case when v_count = 1 then p_shipment_ids[1] end, v_amount, v_issued,
    coalesce(p_due_date, v_issued + coalesce(v_customer.payment_term_days, 0)),
    nullif(trim(coalesce(p_invoice_no, '')), ''),
    coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Cước vận chuyển ' || v_count || ' chuyến'), coalesce(p_custom_fields, '{}'))
  returning * into r;
  update public.shipments set receivable_id = r.id where id = any (p_shipment_ids);
  return r.code;
end;
$$;

-- 6. Các view: doanh thu cộng phí tính doanh thu; "Khách phải trả" cộng thêm chi hộ
create or replace view public.shipment_list with (security_invoker = true) as
select
  s.id, s.shipment_code, s.order_id, o.order_code, s.sequence_in_order,
  o.customer_id, c.name as customer_name, c.code as customer_code,
  s.pickup_at, s.expected_delivery_at,
  s.pickup_location_id, pl.name as pickup_name,
  s.delivery_location_id, dl.name as delivery_name,
  s.vehicle_type_id, vt.name as vehicle_type_name,
  s.vehicle_id, v.plate_number,
  s.driver_id, d.full_name as driver_name, d.code as driver_code,
  s.price_list_id, s.unit_price, s.pricing_unit, s.quantity, s.freight_amount, s.surcharge_amount,
  s.fuel_support_rate, s.fuel_support_base, s.fuel_support_amount,
  s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as total_revenue,
  s.status, s.document_status, s.settlement_status,
  s.notes, s.version, s.created_at, s.updated_at,
  s.custom_fields, o.custom_fields as order_custom_fields,
  s.vehicle_day_order,
  s.extra_fee_amount, s.pass_through_amount,
  s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount + s.pass_through_amount as amount_due
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.customer_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicle_types vt on vt.id = s.vehicle_type_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id;

create or replace view public.billing_shipment_list with (security_invoker = true) as
select s.id, s.shipment_code, s.order_id, o.order_code, o.payer_customer_id as customer_id, c.name as customer_name,
       s.pickup_at, s.completed_at, pl.name as pickup_name, dl.name as delivery_name, v.plate_number, d.full_name as driver_name,
       s.freight_amount, s.surcharge_amount, s.fuel_support_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as total_revenue, s.status,
       s.extra_fee_amount, s.pass_through_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount + s.pass_through_amount as amount_due
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.payer_customer_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
where s.receivable_id is null and s.status in ('driver_completed', 'closed');

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
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount + s.pass_through_amount as amount_due
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.payer_customer_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join lateral (select sum(e.amount) as cost from public.shipment_expenses e where e.shipment_id = s.id and e.status = 'approved') x on true
where s.status in ('in_transit', 'driver_completed', 'closed') and private.has_perm('reports.view');

-- Chi tiết cước phí từng chuyến theo loại phí (mỗi khoản một dòng)
create or replace view public.report_fee_lines as
select r.id || ':' || f.kind_key as id, r.id as shipment_id, r.shipment_code, r.order_code, r.report_date, r.report_month,
       to_char(r.report_month, 'MM/YYYY') as month_label, r.customer_id, r.customer_name, r.plate_number, r.driver_name,
       r.pickup_name, r.delivery_name, f.fee_name, f.fee_kind, f.sort_order, f.amount, f.note
from public.report_shipment_profit r
join public.shipments s on s.id = r.id
cross join lateral (
  select 'cuoc' as kind_key, 'Cước vận chuyển' as fee_name, 'revenue' as fee_kind, -3 as sort_order, s.freight_amount as amount, null::text as note
  where s.freight_amount > 0
  union all
  select 'phu-phi', 'Phụ phí', 'revenue', -2, s.surcharge_amount, null where s.surcharge_amount > 0
  union all
  select 'dau', 'Hỗ trợ dầu', 'revenue', -1, s.fuel_support_amount, null where s.fuel_support_amount > 0
  union all
  select 'phi-' || sf.line_no, ft.name, sf.fee_kind, ft.sort_order, sf.amount, sf.note
  from public.shipment_fees sf join public.fee_types ft on ft.id = sf.fee_type_id
  where sf.shipment_id = s.id
) f;

-- Tổng hợp theo tháng, khách hàng, loại phí
create or replace view public.report_by_fee_type as
select to_char(report_month, 'YYYY-MM') || ':' || coalesce(customer_id::text, '-') || ':' || fee_name as id,
       report_month, month_label, customer_id, customer_name, fee_name, fee_kind, min(sort_order) as sort_order,
       count(distinct shipment_id) as trips, sum(amount) as amount
from public.report_fee_lines
group by report_month, month_label, customer_id, customer_name, fee_name, fee_kind;

revoke all on public.report_fee_lines, public.report_by_fee_type from anon;
grant select on public.report_fee_lines, public.report_by_fee_type to authenticated;

commit;
