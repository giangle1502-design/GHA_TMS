-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Chi phí và thanh toán xe thuê ngoài 3PL (cước, chi hộ phải trả nhà xe, báo cáo)
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.shipment_carrier_costs') is not null then
    raise exception 'CSDL đã được nâng cấp Chi phí và thanh toán xe thuê ngoài 3PL (cước, chi hộ phải trả nhà xe, báo cáo) trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261101000042_carrier_costs.sql
-- =============================================================================
-- 0042: Chi phí và thanh toán xe thuê ngoài 3PL (yêu cầu người dùng 01/11/2026)
-- - Xe 3PL (vehicles.ownership_type = 'outsourced') có thể gắn "Nhà xe 3PL" (vehicles.supplier_id, là một nhà cung cấp).
-- - Mỗi chuyến chạy 3PL có nhà xe (shipments.carrier_supplier_id) và các khoản phải trả 3PL (shipment_carrier_costs):
--     freight      = cước phải trả 3PL (tính vào chi phí, trừ vào lời/lỗ chuyến)
--     pass_through = phí chi hộ 3PL đã trả thay (nâng, hạ, cược...), công ty trả lại cho 3PL; không trừ lời/lỗ
--                    vì khoản này thu lại của khách qua phí chi hộ
--     other        = chi phí khác phải trả 3PL (neo xe, bốc xếp...), trừ vào lời/lỗ
-- - Tổng các khoản tự lập/cập nhật MỘT công nợ phải trả (payables.kind = 'carrier') cho nhà xe, trả nhiều lần như GĐ7.
-- - Trả nhiều chuyến một lần cho một nhà xe (pay_carrier_payables).
-- - Báo cáo: report_carrier_trips (từng chuyến) và report_carrier_by_supplier (theo nhà xe, theo tháng).
-- - Lời/lỗ chuyến và các báo cáo lợi nhuận trừ cước + chi phí khác phải trả 3PL.
-- =============================================================================

-- 1. Nhà xe 3PL của xe thuê ngoài
alter table public.vehicles add column if not exists supplier_id uuid references public.suppliers (id);
comment on column public.vehicles.supplier_id is 'Nhà xe 3PL (chủ xe thuê ngoài); tự điền làm nhà xe của chuyến chạy xe này';
create index if not exists vehicles_supplier_idx on public.vehicles (supplier_id) where supplier_id is not null;

-- 2. Nhà xe của chuyến, loại công nợ phải trả
alter table public.shipments add column if not exists carrier_supplier_id uuid references public.suppliers (id);
comment on column public.shipments.carrier_supplier_id is 'Nhà xe 3PL chạy chuyến này (công ty phải trả cước, chi hộ cho nhà xe)';
create index if not exists shipments_carrier_supplier_idx on public.shipments (carrier_supplier_id) where carrier_supplier_id is not null;

alter table public.payables add column if not exists kind text not null default 'manual';
alter table public.payables drop constraint if exists payables_kind_check;
alter table public.payables add constraint payables_kind_check check (kind in ('manual', 'carrier'));
comment on column public.payables.kind is 'manual = lập tay; carrier = tự lập từ chi phí 3PL của chuyến';
create unique index if not exists payables_carrier_shipment_uq on public.payables (shipment_id)
  where kind = 'carrier' and status <> 'cancelled';

-- 3. Các khoản phải trả 3PL của chuyến
create table if not exists public.shipment_carrier_costs (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  line_no smallint not null check (line_no between 1 and 100),
  cost_kind text not null check (cost_kind in ('freight', 'pass_through', 'other')),
  fee_type_id uuid references public.fee_types (id) on delete restrict,
  description text not null check (length(trim(description)) between 1 and 200),
  quantity numeric(14, 3) check (quantity is null or quantity > 0),
  unit_price numeric(18, 2) check (unit_price is null or unit_price >= 0),
  amount numeric(18, 2) not null check (amount > 0),
  ref_no text check (ref_no is null or length(ref_no) <= 100),
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (shipment_id, line_no)
);
comment on table public.shipment_carrier_costs is 'Khoản công ty phải trả nhà xe 3PL cho chuyến: cước, chi hộ, chi phí khác';
create index if not exists shipment_carrier_costs_fee_type_idx on public.shipment_carrier_costs (fee_type_id) where fee_type_id is not null;
select private.attach_standard_triggers('public.shipment_carrier_costs');
create trigger trg_shipment_carrier_costs_audit after insert or update or delete on public.shipment_carrier_costs
  for each row execute function private.audit_row_change('id');
alter table public.shipment_carrier_costs enable row level security;
create policy shipment_carrier_costs_select on public.shipment_carrier_costs for select to authenticated
  using ((select private.has_perm('dispatch.view')) or (select private.has_perm('receivables.view'))
         or (select private.has_perm('reports.view')) or (select private.has_perm('expenses.view')));
revoke all on public.shipment_carrier_costs from anon;
grant select on public.shipment_carrier_costs to authenticated;

-- Tổng theo chuyến (dùng chung cho lời/lỗ và báo cáo)
create or replace view public.shipment_carrier_totals with (security_invoker = true) as
select c.shipment_id,
       sum(c.amount) filter (where c.cost_kind = 'freight') as freight,
       sum(c.amount) filter (where c.cost_kind = 'pass_through') as pass_through,
       sum(c.amount) filter (where c.cost_kind = 'other') as other,
       sum(c.amount) as total,
       sum(c.amount) filter (where c.cost_kind <> 'pass_through') as cost
from public.shipment_carrier_costs c
group by c.shipment_id;
revoke all on public.shipment_carrier_totals from anon;
grant select on public.shipment_carrier_totals to authenticated;

-- 4. Đồng bộ công nợ phải trả nhà xe theo tổng chi phí 3PL của chuyến
create or replace function private.sync_carrier_payable(p_shipment_id uuid, p_invoice_no text default null, p_due_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  ap public.payables;
  v_total numeric;
  v_issued date;
  v_term int;
begin
  select * into s from public.shipments where id = p_shipment_id;
  select coalesce(sum(amount), 0) into v_total from public.shipment_carrier_costs where shipment_id = p_shipment_id;
  select * into ap from public.payables where shipment_id = p_shipment_id and kind = 'carrier' and status <> 'cancelled' for update;

  if ap.id is not null then
    if v_total < ap.paid_amount then
      raise exception 'Đã trả nhà xe % mà tổng mới chỉ còn %. Hủy phiếu chi ở Công nợ trước khi giảm.',
        to_char(ap.paid_amount, 'FM999G999G999G990'), to_char(v_total, 'FM999G999G999G990') using errcode = '22023';
    end if;
    if ap.supplier_id is distinct from s.carrier_supplier_id and ap.paid_amount > 0 then
      raise exception 'Đã trả tiền cho nhà xe cũ, không đổi nhà xe được. Hủy phiếu chi ở Công nợ trước.' using errcode = '22023';
    end if;
    if v_total = 0 or s.carrier_supplier_id is null then
      update public.payables set status = 'cancelled', cancel_reason = 'Chuyến không còn chi phí 3PL' where id = ap.id;
      return null;
    end if;
    update public.payables
    set amount = v_total, supplier_id = s.carrier_supplier_id,
        status = private.debt_status(v_total, paid_amount),
        invoice_no = coalesce(nullif(trim(coalesce(p_invoice_no, '')), ''), invoice_no),
        due_date = coalesce(p_due_date, due_date),
        content = 'Trả 3PL chuyến ' || s.shipment_code
    where id = ap.id;
    return ap.id;
  end if;

  if v_total = 0 or s.carrier_supplier_id is null then
    return null;
  end if;
  v_issued := coalesce((coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date,
                       (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  select payment_term_days into v_term from public.suppliers where id = s.carrier_supplier_id;
  insert into public.payables (supplier_id, shipment_id, amount, issued_date, due_date, invoice_no, content, kind)
  values (s.carrier_supplier_id, s.id, v_total, v_issued, greatest(coalesce(p_due_date, v_issued + coalesce(v_term, 0)), v_issued),
          nullif(trim(coalesce(p_invoice_no, '')), ''), 'Trả 3PL chuyến ' || s.shipment_code, 'carrier')
  returning * into ap;
  return ap.id;
end;
$$;
revoke all on function private.sync_carrier_payable(uuid, text, date) from public, anon, authenticated;

-- 5. Nhập chi phí 3PL của chuyến (thay toàn bộ danh sách khoản)
create or replace function public.set_shipment_carrier_costs(
  p_shipment_id uuid, p_supplier_id uuid, p_lines jsonb, p_invoice_no text default null, p_due_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  it jsonb;
  n int := 0;
  v_kind text;
  v_amount numeric;
  v_qty numeric;
  v_price numeric;
  v_desc text;
  v_type uuid;
  v_type_name text;
  v_payable uuid;
  v_total numeric := 0;
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('shipments.update') or private.has_perm('receivables.create')) then
    raise exception 'Bạn không có quyền nhập chi phí 3PL' using errcode = '42501';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = '22023';
  end if;
  if s.status = 'cancelled' then
    raise exception 'Chuyến đã hủy, không nhập chi phí 3PL' using errcode = '22023';
  end if;
  if p_supplier_id is not null and not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'Không tìm thấy nhà xe' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Danh sách khoản không hợp lệ' using errcode = '22023';
  end if;

  delete from public.shipment_carrier_costs where shipment_id = s.id;
  for it in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_kind := coalesce(nullif(it->>'kind', ''), 'freight');
    if v_kind not in ('freight', 'pass_through', 'other') then
      raise exception 'Loại khoản không hợp lệ: %', v_kind using errcode = '22023';
    end if;
    v_qty := nullif(it->>'quantity', '')::numeric;
    v_price := nullif(it->>'unit_price', '')::numeric;
    v_amount := coalesce(nullif(it->>'amount', '')::numeric, case when v_qty is not null and v_price is not null then round(v_qty * v_price, 0) end);
    continue when coalesce(v_amount, 0) = 0;
    if v_amount < 0 then
      raise exception 'Số tiền không được âm' using errcode = '22023';
    end if;
    v_type := nullif(it->>'fee_type_id', '')::uuid;
    v_type_name := null;
    if v_type is not null then
      select name into v_type_name from public.fee_types where id = v_type;
      if v_type_name is null then
        raise exception 'Không tìm thấy loại phí' using errcode = '22023';
      end if;
    end if;
    v_desc := coalesce(nullif(trim(coalesce(it->>'description', '')), ''), v_type_name,
                       case v_kind when 'freight' then 'Cước 3PL' when 'pass_through' then 'Chi hộ 3PL' else 'Chi phí khác 3PL' end);
    n := n + 1;
    if n > 100 then
      raise exception 'Tối đa 100 khoản cho một chuyến' using errcode = '22023';
    end if;
    insert into public.shipment_carrier_costs (shipment_id, line_no, cost_kind, fee_type_id, description, quantity, unit_price, amount, ref_no, note)
    values (s.id, n, v_kind, v_type, left(v_desc, 200), v_qty, v_price, v_amount,
            nullif(left(trim(coalesce(it->>'ref_no', '')), 100), ''), nullif(left(trim(coalesce(it->>'note', '')), 500), ''));
    v_total := v_total + v_amount;
  end loop;

  if v_total > 0 and p_supplier_id is null then
    raise exception 'Chọn nhà xe 3PL nhận tiền' using errcode = '22023';
  end if;
  update public.shipments set carrier_supplier_id = p_supplier_id where id = s.id and carrier_supplier_id is distinct from p_supplier_id;
  v_payable := private.sync_carrier_payable(s.id, p_invoice_no, p_due_date);
  return jsonb_build_object('lines', n, 'total', v_total, 'payable_id', v_payable,
                            'payable_code', (select code from public.payables where id = v_payable));
end;
$$;
revoke all on function public.set_shipment_carrier_costs(uuid, uuid, jsonb, text, date) from public, anon;
grant execute on function public.set_shipment_carrier_costs(uuid, uuid, jsonb, text, date) to authenticated;

-- Chuyến bị hủy: hủy công nợ 3PL chưa trả
create or replace function private.carrier_payable_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payables set status = 'cancelled', cancel_reason = 'Chuyến đã hủy'
  where shipment_id = new.id and kind = 'carrier' and status = 'open' and paid_amount = 0;
  return new;
end;
$$;
drop trigger if exists trg_shipments_carrier_cancel on public.shipments;
create trigger trg_shipments_carrier_cancel after update of status on public.shipments
  for each row when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function private.carrier_payable_on_cancel();

-- 6. Trả nhiều chuyến một lần (mỗi công nợ một phiếu chi, cùng số giao dịch)
create or replace function public.pay_carrier_payables(
  p_payable_ids uuid[], p_payment_method_id uuid default null, p_company_bank_account_id uuid default null,
  p_reference_no text default null, p_paid_at timestamptz default null, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ap record;
  n int := 0;
  v_total numeric := 0;
  v_supplier uuid;
begin
  if not private.has_perm('receivables.pay') then
    raise exception 'Bạn không có quyền ghi nhận trả công nợ' using errcode = '42501';
  end if;
  if coalesce(array_length(p_payable_ids, 1), 0) = 0 then
    raise exception 'Chọn ít nhất một chuyến để trả' using errcode = '22023';
  end if;
  for ap in
    select id, supplier_id, amount - paid_amount as remaining from public.payables
    where id = any (p_payable_ids) and status in ('open', 'partial') order by issued_date, code
  loop
    if v_supplier is null then
      v_supplier := ap.supplier_id;
    elsif v_supplier is distinct from ap.supplier_id then
      raise exception 'Chỉ trả cùng lúc các chuyến của một nhà xe' using errcode = '22023';
    end if;
    perform public.record_debt_payment('payable', ap.id, ap.remaining, p_payment_method_id, p_company_bank_account_id,
                                       p_reference_no, p_paid_at, p_note);
    n := n + 1;
    v_total := v_total + ap.remaining;
  end loop;
  if n = 0 then
    raise exception 'Các chuyến đã chọn đã trả đủ hoặc đã hủy' using errcode = '22023';
  end if;
  return jsonb_build_object('count', n, 'total', v_total);
end;
$$;
revoke all on function public.pay_carrier_payables(uuid[], uuid, uuid, text, timestamptz, text) from public, anon;
grant execute on function public.pay_carrier_payables(uuid[], uuid, uuid, text, timestamptz, text) to authenticated;

-- 7. Lời/lỗ chuyến trừ chi phí 3PL (cước + chi phí khác; chi hộ thu lại của khách nên không trừ). Cột mới thêm cuối.
create or replace view public.shipment_profit as
with trips as (
  select s.id, s.vehicle_id,
         date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as trip_month,
         s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as revenue,
         coalesce((select sum(c.amount) from public.shipment_carrier_costs c where c.shipment_id = s.id and c.cost_kind <> 'pass_through'), 0) as carrier_cost
  from public.shipments s
  where s.status in ('in_transit', 'driver_completed', 'closed')
),
vm_trips as (
  select vehicle_id, trip_month, count(*) as trip_count from trips where vehicle_id is not null group by 1, 2
),
vm_cost as (
  select m.vehicle_id, date_trunc('month', m.performed_at)::date as cost_month, sum(m.amount) as amount
  from public.maintenance_records m
  where m.status = 'recorded' and m.amount > 0
  group by 1, 2
)
select t.id as shipment_id, t.trip_month, t.revenue,
       coalesce(e.approved, 0) as trip_cost,
       coalesce(e.pending, 0) as pending_cost,
       coalesce(round(vc.amount / nullif(vt.trip_count, 0), 0), 0) as vehicle_cost,
       coalesce(vc.amount, 0) as vehicle_month_cost,
       coalesce(vt.trip_count, 0) as vehicle_month_trips,
       t.revenue - coalesce(e.approved, 0) - t.carrier_cost as profit_before_vehicle,
       t.revenue - coalesce(e.approved, 0) - t.carrier_cost - coalesce(round(vc.amount / nullif(vt.trip_count, 0), 0), 0) as profit,
       case when t.revenue > 0 then round((t.revenue - coalesce(e.approved, 0) - t.carrier_cost
              - coalesce(round(vc.amount / nullif(vt.trip_count, 0), 0), 0)) * 100 / t.revenue, 1) end as margin_percent,
       t.carrier_cost
from trips t
left join vm_trips vt on vt.vehicle_id = t.vehicle_id and vt.trip_month = t.trip_month
left join vm_cost vc on vc.vehicle_id = t.vehicle_id and vc.cost_month = t.trip_month
left join lateral (
  select sum(x.amount) filter (where x.status = 'approved') as approved,
         sum(x.amount) filter (where x.status = 'pending') as pending
  from public.shipment_expenses x where x.shipment_id = t.id
) e on true
where private.has_perm('expenses.view') or private.has_perm('reports.view');

-- Báo cáo Lợi nhuận từng chuyến: Chi phí gồm chi phí chuyến đã duyệt + chi phí 3PL (báo cáo tháng/xe/tài xế/khách dùng cột này)
create or replace view public.report_shipment_profit as
select s.id, s.shipment_code, o.order_code,
       (coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_date,
       date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_month,
       o.payer_customer_id as customer_id, c.name as customer_name,
       s.vehicle_id, v.plate_number, s.driver_id, d.full_name as driver_name,
       pl.name as pickup_name, dl.name as delivery_name, s.status,
       s.freight_amount, s.surcharge_amount, s.fuel_support_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as revenue,
       coalesce(x.cost, 0) + coalesce(cc.cost, 0) as cost,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(x.cost, 0) - coalesce(cc.cost, 0) as profit,
       case when s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount > 0
            then round((s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(x.cost, 0) - coalesce(cc.cost, 0)) * 100
                       / (s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount), 1) end as margin_percent,
       (s.receivable_id is not null) as billed,
       s.extra_fee_amount, s.pass_through_amount,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount + s.pass_through_amount as amount_due,
       s.quantity, s.pricing_unit, s.unit_price,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + coalesce(ff.amount, 0) as freight_total,
       vt.name as vehicle_type_name, to_char(date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh'), 'MM/YYYY') as month_label,
       c.code as customer_code,
       coalesce(ff.amount, 0) as freight_fee_amount,
       coalesce(p.vehicle_cost, 0) as vehicle_cost,
       coalesce(p.profit, s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(x.cost, 0) - coalesce(cc.cost, 0)) as net_profit,
       coalesce(cc.cost, 0) as carrier_cost
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.payer_customer_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.drivers d on d.id = s.driver_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicle_types vt on vt.id = s.vehicle_type_id
left join lateral (select sum(e.amount) as cost from public.shipment_expenses e where e.shipment_id = s.id and e.status = 'approved') x on true
left join lateral (select sum(k.amount) as cost from public.shipment_carrier_costs k where k.shipment_id = s.id and k.cost_kind <> 'pass_through') cc on true
left join lateral (
  select sum(sf.amount) as amount
  from public.shipment_fees sf
  join public.fee_types ft on ft.id = sf.fee_type_id
  join public.fee_groups g on g.id = ft.fee_group_id
  where sf.shipment_id = s.id and g.report_role = 'freight'
) ff on true
left join public.shipment_profit p on p.shipment_id = s.id
where s.status in ('in_transit', 'driver_completed', 'closed') and private.has_perm('reports.view');

-- 8. Báo cáo chuyến 3PL: chi phí, công nợ, tình trạng thanh toán
create or replace view public.report_carrier_trips as
select s.id, s.shipment_code, o.order_code,
       (coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_date,
       date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_month,
       to_char(date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh'), 'MM/YYYY') as month_label,
       s.status,
       coalesce(s.carrier_supplier_id, v.supplier_id) as supplier_id,
       coalesce(sp.name, vsp.name, '(chưa chọn nhà xe)') as supplier_name,
       coalesce(sp.code, vsp.code) as supplier_code,
       o.payer_customer_id as customer_id, c.code as customer_code, c.name as customer_name,
       s.vehicle_id, v.plate_number, d.full_name as driver_name,
       pl.name as pickup_name, dl.name as delivery_name,
       coalesce(k.freight, 0) as carrier_freight,
       coalesce(k.pass_through, 0) as carrier_pass_through,
       coalesce(k.other, 0) as carrier_other,
       coalesce(k.total, 0) as carrier_total,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount as revenue,
       s.pass_through_amount as customer_pass_through,
       s.freight_amount + s.surcharge_amount + s.fuel_support_amount + s.extra_fee_amount - coalesce(k.cost, 0) as margin,
       ap.id as payable_id, ap.code as payable_code, ap.invoice_no, ap.issued_date, ap.due_date,
       coalesce(ap.paid_amount, 0) as paid_amount,
       coalesce(ap.amount - ap.paid_amount, 0) as remaining_amount,
       case when coalesce(k.total, 0) = 0 then 'no_cost'
            when ap.id is null then 'no_payable'
            when ap.status = 'open' then 'unpaid'
            else ap.status end as pay_status,
       case when ap.status in ('open', 'partial') then greatest((now() at time zone 'Asia/Ho_Chi_Minh')::date - ap.due_date, 0) else 0 end as overdue_days,
       (select max(p.paid_at) from public.payments p where p.payable_id = ap.id and p.status = 'posted') as last_paid_at,
       (ap.status in ('open', 'partial') and private.has_perm('receivables.pay')) as can_pay,
       false as can_cancel,
       ap.amount, ap.code, coalesce(sp.name, vsp.name) as partner_name
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.suppliers sp on sp.id = s.carrier_supplier_id
left join public.suppliers vsp on vsp.id = v.supplier_id
left join public.customers c on c.id = o.payer_customer_id
left join public.drivers d on d.id = s.driver_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.shipment_carrier_totals k on k.shipment_id = s.id
left join public.payables ap on ap.shipment_id = s.id and ap.kind = 'carrier' and ap.status <> 'cancelled'
where s.status <> 'cancelled'
  and (s.carrier_supplier_id is not null or v.ownership_type = 'outsourced' or k.total > 0)
  and (private.has_perm('reports.view') or private.has_perm('receivables.view'));

create or replace view public.report_carrier_by_supplier as
select to_char(r.report_month, 'YYYY-MM') || ':' || coalesce(r.supplier_id::text, '-') as id,
       r.report_month, r.month_label, r.supplier_id, r.supplier_name, r.supplier_code,
       count(*) as trips,
       count(*) filter (where r.pay_status = 'no_cost') as trips_no_cost,
       sum(r.carrier_freight) as carrier_freight, sum(r.carrier_pass_through) as carrier_pass_through,
       sum(r.carrier_other) as carrier_other, sum(r.carrier_total) as carrier_total,
       sum(r.paid_amount) as paid_amount, sum(r.remaining_amount) as remaining_amount,
       sum(r.revenue) as revenue, sum(r.margin) as margin,
       max(r.overdue_days) as max_overdue_days
from public.report_carrier_trips r
group by r.report_month, r.month_label, r.supplier_id, r.supplier_name, r.supplier_code;

revoke all on public.shipment_profit, public.report_shipment_profit, public.report_carrier_trips, public.report_carrier_by_supplier from anon;
grant select on public.shipment_profit, public.report_shipment_profit, public.report_carrier_trips, public.report_carrier_by_supplier to authenticated;

-- 9. Danh sách phải trả: thêm loại công nợ (cột mới cuối)
create or replace view public.payable_list with (security_invoker = true) as
select r.id, r.code, r.supplier_id, r.driver_id,
       coalesce(sp.name, d.full_name || ' (tài xế)') as partner_name, r.content, r.invoice_no, r.shipment_id, s.shipment_code,
       r.issued_date, r.due_date, r.amount, r.paid_amount, r.remaining_amount, r.status, r.note, r.cancel_reason,
       greatest((now() at time zone 'Asia/Ho_Chi_Minh')::date - r.due_date, 0) * (r.status in ('open', 'partial'))::int as overdue_days,
       private.aging_bucket(r.due_date, r.remaining_amount, r.status) as aging,
       (select max(p.paid_at) from public.payments p where p.payable_id = r.id and p.status = 'posted') as last_paid_at,
       (r.status in ('open', 'partial') and private.has_perm('receivables.pay')) as can_pay,
       (r.status in ('open') and r.paid_amount = 0 and private.has_perm('receivables.delete')) as can_cancel,
       r.created_at, r.custom_fields,
       r.kind
from public.payables r
left join public.suppliers sp on sp.id = r.supplier_id
left join public.drivers d on d.id = r.driver_id
left join public.shipments s on s.id = r.shipment_id;

-- 10. Xóa dữ liệu thử: thêm bảng chi phí 3PL
create or replace function public.purge_test_data(p_password text, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
begin
  begin
    perform private.check_purge_password(p_password);
  exception when sqlstate '42501' or sqlstate '22023' then
    if sqlerrm = 'Mật khẩu xóa dữ liệu không đúng.' then
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, reason)
      values (auth.uid(), 'test_data.password_failed', 'system', 'du-lieu-thu', 'Nhập sai mật khẩu xóa dữ liệu');
    end if;
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  if coalesce(upper(trim(p_confirm)), '') <> 'XOA DU LIEU' then
    raise exception 'Chữ xác nhận chưa đúng. Gõ XOA DU LIEU để xóa.' using errcode = '22023';
  end if;

  v_before := private.test_data_counts_raw();
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, reason)
  values (auth.uid(), 'test_data.purge', 'system', 'du-lieu-thu', v_before, 'Xóa dữ liệu thử trong ứng dụng');

  delete from public.documents
  where entity_type in ('shipment', 'shipment_expense', 'advance_request', 'payment', 'driver_payroll', 'approval_request', 'receivable', 'payable',
                        'transport_order', 'purchase_request');

  truncate table
    public.advance_transactions,
    public.payments,
    public.shipment_expenses,
    public.advance_requests,
    public.purchase_requests,
    public.driver_payrolls,
    public.approval_steps,
    public.approval_requests,
    public.payables,
    public.receivables,
    public.shipment_assignments,
    public.shipment_status_history,
    public.shipment_items,
    public.shipment_fees,
    public.shipment_carrier_costs,
    public.shipments,
    public.transport_orders,
    public.notifications,
    private.driver_upload_tickets;

  delete from public.code_sequences where scope in ('ORD', 'SHP', 'APR', 'ADV', 'PAY', 'AR', 'AP', 'BL', 'DN');
  return jsonb_build_object('ok', true, 'counts', v_before);
end;
$$;

revoke all on function public.purge_test_data(text, text) from public, anon;
grant execute on function public.purge_test_data(text, text) to authenticated;

commit;
