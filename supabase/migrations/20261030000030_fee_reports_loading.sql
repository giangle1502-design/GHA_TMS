-- =============================================================================
-- 0030: Báo cáo riêng cho Cước vận chuyển, Phí chi hộ, Bốc xếp; chi phí bốc xếp trả tài xế hoặc nhà thầu.
-- - fee_types.is_loading: loại phí thu khách thuộc nhóm bốc xếp (đưa vào báo cáo bốc xếp).
-- - expense_categories.report_bucket thêm nhóm 'loading' (Bốc xếp, nâng hạ), tách khỏi bến bãi.
-- - shipment_expenses.supplier_id: nhà thầu (nhà cung cấp) nhận tiền khi công ty trả.
-- =============================================================================

alter table public.fee_types add column if not exists is_loading boolean not null default false;
comment on column public.fee_types.is_loading is 'Phí thu khách thuộc nhóm bốc xếp (báo cáo bốc xếp so với chi phí bốc xếp)';
update public.fee_types set is_loading = true where lower(name) in ('phí bốc xếp', 'phí nâng hạ') and not is_loading;

alter table public.expense_categories drop constraint if exists expense_categories_report_bucket_check;
alter table public.expense_categories add constraint expense_categories_report_bucket_check check (report_bucket in (
  'fuel', 'toll', 'loading', 'loading_yard', 'repair', 'driver', 'outsourcing', 'allocated_overhead', 'depreciation', 'interest', 'other'));
update public.expense_categories set report_bucket = 'loading' where code in ('LOADING', 'LIFTING') and report_bucket = 'loading_yard';

-- Nhập chi phí ở văn phòng: chọn nhà thầu khi công ty trả
drop function if exists public.add_shipment_expense(uuid, uuid, numeric, timestamptz, text, text, uuid, jsonb, uuid);
create function public.add_shipment_expense(
  p_shipment_id uuid, p_category_id uuid, p_amount numeric, p_incurred_at timestamptz default null, p_note text default null,
  p_paid_by text default 'company', p_driver_id uuid default null, p_custom jsonb default '{}'::jsonb, p_client_request_id uuid default null,
  p_supplier_id uuid default null
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
    raise exception 'Chọn người trả tiền' using errcode = '22023';
  end if;
  if p_supplier_id is not null and p_paid_by <> 'company' then
    raise exception 'Chỉ chọn nhà thầu khi công ty trả tiền' using errcode = '22023';
  end if;
  if p_supplier_id is not null and not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'Nhà thầu không tồn tại' using errcode = '22023';
  end if;
  v_id := private.insert_expense(s, c, p_amount, p_incurred_at, p_note, 'admin', p_paid_by,
    coalesce(p_driver_id, s.driver_id), auth.uid(), p_custom, p_client_request_id, null);
  if p_supplier_id is not null then
    update public.shipment_expenses set supplier_id = p_supplier_id where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.add_shipment_expense(uuid, uuid, numeric, timestamptz, text, text, uuid, jsonb, uuid, uuid) from public, anon;
grant execute on function public.add_shipment_expense(uuid, uuid, numeric, timestamptz, text, text, uuid, jsonb, uuid, uuid) to authenticated;

create or replace view public.expense_list with (security_invoker = true) as
select e.id, e.code, e.shipment_id, s.shipment_code, e.category_id, c.name as category_name, c.report_bucket,
       e.amount, e.incurred_at, e.note, e.source, e.paid_by, e.driver_id, d.full_name as driver_name,
       v.plate_number, e.status, e.created_at, e.approval_request_id, ar.reject_reason,
       private.requester_name(e.entered_by, case when e.entered_by is null then e.driver_id end) as entered_by_name,
       (select count(*) from public.documents doc where doc.entity_type = 'shipment_expense' and doc.entity_id = e.id and doc.archived_at is null) as file_count,
       e.custom_fields,
       e.payroll_id, pr.code as payroll_code,
       e.supplier_id, sp.name as supplier_name
from public.shipment_expenses e
join public.shipments s on s.id = e.shipment_id
join public.expense_categories c on c.id = e.category_id
left join public.drivers d on d.id = e.driver_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.approval_requests ar on ar.id = e.approval_request_id
left join public.driver_payrolls pr on pr.id = e.payroll_id
left join public.suppliers sp on sp.id = e.supplier_id;

-- Đơn giá, số lượng cho báo cáo cước vận chuyển
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
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount as freight_total,
       vt.name as vehicle_type_name, to_char(date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh'), 'MM/YYYY') as month_label
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.payer_customer_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicle_types vt on vt.id = s.vehicle_type_id
left join lateral (select sum(e.amount) as cost from public.shipment_expenses e where e.shipment_id = s.id and e.status = 'approved') x on true
where s.status in ('in_transit', 'driver_completed', 'closed') and private.has_perm('reports.view');

-- Báo cáo phí chi hộ (thu hộ): mỗi khoản chi hộ một dòng
create or replace view public.report_pass_through_fees as
select * from public.report_fee_lines where fee_kind = 'pass_through';

-- Báo cáo bốc xếp từng chuyến: thu khách so với chi bốc xếp (tài xế trả để hoàn lương, công ty/nhà thầu trả)
create or replace view public.report_loading as
select r.id, r.shipment_code, r.order_code, r.report_date, r.report_month, r.month_label,
       r.customer_id, r.customer_name, r.plate_number, r.driver_id, r.driver_name, r.pickup_name, r.delivery_name,
       coalesce(fl.amount, 0) as loading_revenue,
       coalesce(ex.driver_paid, 0) as driver_paid,
       coalesce(ex.company_paid, 0) as company_paid,
       coalesce(ex.driver_paid, 0) + coalesce(ex.company_paid, 0) as loading_cost,
       coalesce(fl.amount, 0) - coalesce(ex.driver_paid, 0) - coalesce(ex.company_paid, 0) as loading_margin,
       coalesce(ex.pending, 0) as pending_cost,
       ex.contractors
from public.report_shipment_profit r
left join lateral (
  select sum(sf.amount) as amount
  from public.shipment_fees sf join public.fee_types ft on ft.id = sf.fee_type_id
  where sf.shipment_id = r.id and ft.is_loading
) fl on true
left join lateral (
  select sum(e.amount) filter (where e.status = 'approved' and e.paid_by = 'driver') as driver_paid,
         sum(e.amount) filter (where e.status = 'approved' and e.paid_by = 'company') as company_paid,
         sum(e.amount) filter (where e.status = 'pending') as pending,
         string_agg(distinct sp.name, ', ') as contractors
  from public.shipment_expenses e
  join public.expense_categories c on c.id = e.category_id
  left join public.suppliers sp on sp.id = e.supplier_id
  where e.shipment_id = r.id and c.report_bucket = 'loading' and e.status in ('approved', 'pending')
) ex on true
where coalesce(fl.amount, 0) > 0 or coalesce(ex.driver_paid, 0) + coalesce(ex.company_paid, 0) + coalesce(ex.pending, 0) > 0;

revoke all on public.report_pass_through_fees, public.report_loading from anon;
grant select on public.report_pass_through_fees, public.report_loading to authenticated;

-- Sửa chuyến đã đóng: chỉ khóa chuyến đã hủy và chuyến đã lập công nợ
create or replace function private.shipments_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.shipment_code <> old.shipment_code then
    raise exception 'Mã Shipment không được thay đổi' using errcode = '42501';
  end if;
  if new.order_id <> old.order_id then
    raise exception 'Không được chuyển Shipment sang đơn hàng khác' using errcode = '42501';
  end if;
  if not private.shipment_transition_allowed(old.status, new.status) then
    raise exception 'Không thể chuyển trạng thái chuyến từ % sang %', old.status, new.status using errcode = '22023';
  end if;
  -- Chuyến đã hủy: khóa dữ liệu giá. Chuyến đã đóng vẫn sửa được giá khi chưa lập công nợ
  -- (chuyến đã lập công nợ bị khóa ở trigger guard_billed_shipment)
  if old.status = 'cancelled' and (
       new.unit_price, new.quantity, new.surcharge_amount, new.fuel_support_amount, new.price_list_id
     ) is distinct from (
       old.unit_price, old.quantity, old.surcharge_amount, old.fuel_support_amount, old.price_list_id
     ) then
    raise exception 'Chuyến đã hủy, không được sửa giá' using errcode = '42501';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.cancelled_at := now();
    new.cancelled_by := auth.uid();
  end if;
  new.version := old.version + 1;
  return new;
end;
$function$;

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

-- Sửa phần đầu đơn hàng: không đổi khách hàng, khách thanh toán, pháp nhân khi đã có chuyến lập công nợ hoặc đơn đã hủy
create or replace function private.guard_order_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_code <> old.order_code then
    raise exception 'Mã đơn hàng không được thay đổi' using errcode = '42501';
  end if;
  if (new.customer_id, new.payer_customer_id, new.company_entity_id) is distinct from (old.customer_id, old.payer_customer_id, old.company_entity_id) then
    if old.status = 'cancelled' then
      raise exception 'Đơn hàng đã hủy, không sửa được' using errcode = '22023';
    end if;
    if exists (select 1 from public.shipments where order_id = old.id and receivable_id is not null) then
      raise exception 'Đơn hàng đã có chuyến lập công nợ, không đổi khách hàng được. Hủy phiếu công nợ trước.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_transport_orders_guard on public.transport_orders;
create trigger trg_transport_orders_guard before update on public.transport_orders
  for each row execute function private.guard_order_change();
