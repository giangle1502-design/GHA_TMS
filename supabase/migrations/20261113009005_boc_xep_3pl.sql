-- =============================================================================
-- GHA-TMS 9005: Bốc xếp theo đơn vị 3PL (giữ nghiệp vụ như app QLVT cũ, yêu cầu 14/11/2026)
-- - Một chuyến có thể: xe của nhà xe A chạy, bốc xếp do một hoặc nhiều đơn vị khác (B, C...) làm.
-- - Mỗi khoản phải trả 3PL của chuyến (shipment_carrier_costs) có thể gắn đơn vị nhận tiền riêng (supplier_id).
--   Trống = nhà xe của chuyến. Khoản bốc xếp nhận diện bằng loại phí thuộc nhóm Bốc xếp (fee_types.is_loading).
-- - Công nợ: nhà xe của chuyến giữ 1 công nợ kind 'carrier' như cũ; mỗi đơn vị bốc xếp khác có 1 công nợ
--   kind 'loading' cho chuyến đó → trả, xem đã/chưa thanh toán ở Công nợ hoặc trang Bốc xếp 3PL.
-- - Báo cáo: report_loading_3pl (từng khoản bốc xếp), report_loading_trips (từng chuyến: thu khách, trả bốc xếp).
-- - Đơn giá bốc xếp mặc định (đ/tấn): system_settings 'loading.unit_price_per_ton' (app cũ: 40,000).
-- =============================================================================

-- 1. Đơn vị nhận tiền của từng khoản
alter table public.shipment_carrier_costs add column if not exists supplier_id uuid references public.suppliers (id);
comment on column public.shipment_carrier_costs.supplier_id is 'Đơn vị nhận khoản này (VD đơn vị bốc xếp 3PL); trống = nhà xe của chuyến';
create index if not exists shipment_carrier_costs_supplier_idx on public.shipment_carrier_costs (supplier_id) where supplier_id is not null;

-- 2. Công nợ phải trả đơn vị bốc xếp (khác nhà xe)
alter table public.payables drop constraint if exists payables_kind_check;
alter table public.payables add constraint payables_kind_check check (kind in ('manual', 'carrier', 'loading'));
comment on column public.payables.kind is 'manual = lập tay; carrier = chi phí 3PL trả nhà xe của chuyến; loading = bốc xếp trả đơn vị 3PL khác';
create unique index if not exists payables_loading_shipment_uq on public.payables (shipment_id, supplier_id)
  where kind = 'loading' and status <> 'cancelled';

drop policy if exists payables_select on public.payables;
create policy payables_select on public.payables for select to authenticated
  using ((select private.has_perm('receivables.view')) and (kind not in ('carrier', 'loading') or (select private.can_view_3pl())));

-- 3. Tổng theo chuyến: cước/chi hộ/khác/tổng chỉ tính phần trả NHÀ XE (để khớp công nợ nhà xe);
--    cost = mọi chi phí 3PL trừ chi hộ (dùng cho lời/lỗ); vendor_total = phần trả đơn vị khác.
create or replace view public.shipment_carrier_totals with (security_invoker = true) as
select c.shipment_id,
       sum(c.amount) filter (where c.cost_kind = 'freight' and (c.supplier_id is null or c.supplier_id = s.carrier_supplier_id)) as freight,
       sum(c.amount) filter (where c.cost_kind = 'pass_through' and (c.supplier_id is null or c.supplier_id = s.carrier_supplier_id)) as pass_through,
       sum(c.amount) filter (where c.cost_kind = 'other' and (c.supplier_id is null or c.supplier_id = s.carrier_supplier_id)) as other,
       sum(c.amount) filter (where c.supplier_id is null or c.supplier_id = s.carrier_supplier_id) as total,
       sum(c.amount) filter (where c.cost_kind <> 'pass_through') as cost,
       sum(c.amount) filter (where c.supplier_id is not null and c.supplier_id is distinct from s.carrier_supplier_id) as vendor_total
from public.shipment_carrier_costs c
join public.shipments s on s.id = c.shipment_id
group by c.shipment_id;
revoke all on public.shipment_carrier_totals from anon;
grant select on public.shipment_carrier_totals to authenticated;

-- 4. Đồng bộ công nợ: nhà xe (carrier) + từng đơn vị bốc xếp khác (loading)
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
  v_id uuid;
  g record;
begin
  select * into s from public.shipments where id = p_shipment_id;
  v_issued := coalesce((coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date,
                       (now() at time zone 'Asia/Ho_Chi_Minh')::date);

  -- 4a. Đơn vị bốc xếp khác nhà xe: mỗi đơn vị một công nợ 'loading'
  for ap in
    select * from public.payables p
    where p.shipment_id = p_shipment_id and p.kind = 'loading' and p.status <> 'cancelled'
      and not exists (select 1 from public.shipment_carrier_costs c
                      where c.shipment_id = p_shipment_id and c.supplier_id = p.supplier_id
                        and c.supplier_id is distinct from s.carrier_supplier_id)
    for update
  loop
    if ap.paid_amount > 0 then
      raise exception 'Đã trả % cho đơn vị bốc xếp của chuyến này, không xóa khoản được. Hủy phiếu chi ở Công nợ trước.',
        to_char(ap.paid_amount, 'FM999G999G999G990') using errcode = '22023';
    end if;
    update public.payables set status = 'cancelled', cancel_reason = 'Chuyến không còn bốc xếp của đơn vị này' where id = ap.id;
  end loop;
  for g in
    select c.supplier_id, sum(c.amount) as total
    from public.shipment_carrier_costs c
    where c.shipment_id = p_shipment_id and c.supplier_id is not null and c.supplier_id is distinct from s.carrier_supplier_id
    group by c.supplier_id
  loop
    select * into ap from public.payables
    where shipment_id = p_shipment_id and kind = 'loading' and supplier_id = g.supplier_id and status <> 'cancelled' for update;
    if ap.id is not null then
      if g.total < ap.paid_amount then
        raise exception 'Đã trả đơn vị bốc xếp % mà tổng mới chỉ còn %. Hủy phiếu chi ở Công nợ trước khi giảm.',
          to_char(ap.paid_amount, 'FM999G999G999G990'), to_char(g.total, 'FM999G999G999G990') using errcode = '22023';
      end if;
      update public.payables set amount = g.total, status = private.debt_status(g.total, paid_amount),
             content = 'Bốc xếp chuyến ' || s.shipment_code
      where id = ap.id;
    else
      select payment_term_days into v_term from public.suppliers where id = g.supplier_id;
      insert into public.payables (supplier_id, shipment_id, amount, issued_date, due_date, content, kind)
      values (g.supplier_id, s.id, g.total, v_issued, v_issued + coalesce(v_term, 0), 'Bốc xếp chuyến ' || s.shipment_code, 'loading');
    end if;
  end loop;

  -- 4b. Nhà xe của chuyến: như cũ nhưng chỉ cộng khoản của nhà xe
  select coalesce(sum(amount), 0) into v_total from public.shipment_carrier_costs
  where shipment_id = p_shipment_id and (supplier_id is null or supplier_id = s.carrier_supplier_id);
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
  select payment_term_days into v_term from public.suppliers where id = s.carrier_supplier_id;
  insert into public.payables (supplier_id, shipment_id, amount, issued_date, due_date, invoice_no, content, kind)
  values (s.carrier_supplier_id, s.id, v_total, v_issued, greatest(coalesce(p_due_date, v_issued + coalesce(v_term, 0)), v_issued),
          nullif(trim(coalesce(p_invoice_no, '')), ''), 'Trả 3PL chuyến ' || s.shipment_code, 'carrier')
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function private.sync_carrier_payable(uuid, text, date) from public, anon, authenticated;

-- 5. Nhập chi phí 3PL: thêm đơn vị nhận tiền từng khoản (lines[].supplier_id)
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
  v_line_supplier uuid;
  v_payable uuid;
  v_total numeric := 0;
  v_carrier_total numeric := 0;
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('shipments.update') or private.has_perm('receivables.create')) then
    raise exception 'Bạn không có quyền nhập chi phí 3PL' using errcode = '42501';
  end if;
  if not private.can_view_3pl() then
    raise exception 'Bạn không có quyền xem/nhập chi phí 3PL' using errcode = '42501';
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

  -- Đổi nhà xe trước để công nợ tách đúng phần nhà xe / phần đơn vị khác
  update public.shipments set carrier_supplier_id = p_supplier_id where id = s.id and carrier_supplier_id is distinct from p_supplier_id;
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
    v_line_supplier := nullif(it->>'supplier_id', '')::uuid;
    if v_line_supplier is not null and not exists (select 1 from public.suppliers where id = v_line_supplier) then
      raise exception 'Không tìm thấy đơn vị 3PL của khoản "%"', coalesce(v_type_name, it->>'description') using errcode = '22023';
    end if;
    if v_line_supplier = p_supplier_id then
      v_line_supplier := null;
    end if;
    v_desc := coalesce(nullif(trim(coalesce(it->>'description', '')), ''), v_type_name,
                       case v_kind when 'freight' then 'Cước 3PL' when 'pass_through' then 'Chi hộ 3PL' else 'Chi phí khác 3PL' end);
    n := n + 1;
    if n > 100 then
      raise exception 'Tối đa 100 khoản cho một chuyến' using errcode = '22023';
    end if;
    insert into public.shipment_carrier_costs (shipment_id, line_no, cost_kind, fee_type_id, description, quantity, unit_price, amount, ref_no, note, supplier_id)
    values (s.id, n, v_kind, v_type, left(v_desc, 200), v_qty, v_price, v_amount,
            nullif(left(trim(coalesce(it->>'ref_no', '')), 100), ''), nullif(left(trim(coalesce(it->>'note', '')), 500), ''), v_line_supplier);
    v_total := v_total + v_amount;
    if v_line_supplier is null then
      v_carrier_total := v_carrier_total + v_amount;
    end if;
  end loop;

  if v_carrier_total > 0 and p_supplier_id is null then
    raise exception 'Chọn nhà xe 3PL nhận tiền (hoặc chọn đơn vị 3PL cho từng khoản)' using errcode = '22023';
  end if;
  v_payable := private.sync_carrier_payable(s.id, p_invoice_no, p_due_date);
  return jsonb_build_object('lines', n, 'total', v_total, 'payable_id', v_payable,
                            'payable_code', (select code from public.payables where id = v_payable));
end;
$$;
revoke all on function public.set_shipment_carrier_costs(uuid, uuid, jsonb, text, date) from public, anon;
grant execute on function public.set_shipment_carrier_costs(uuid, uuid, jsonb, text, date) to authenticated;

-- Chuyến bị hủy: hủy cả công nợ bốc xếp chưa trả
create or replace function private.carrier_payable_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payables set status = 'cancelled', cancel_reason = 'Chuyến đã hủy'
  where shipment_id = new.id and kind in ('carrier', 'loading') and status = 'open' and paid_amount = 0;
  return new;
end;
$$;

-- 6. Đơn giá bốc xếp mặc định (đ/tấn)
insert into public.system_settings (key, value, description, is_public)
values ('loading.unit_price_per_ton', '40000'::jsonb, 'Đơn giá bốc xếp mặc định (đ/tấn) khi nhập bốc xếp 3PL cho chuyến', false)
on conflict (key) do nothing;

-- 7. Báo cáo bốc xếp 3PL
-- Từng khoản bốc xếp (loại phí thuộc nhóm Bốc xếp) trong chi phí trả 3PL của chuyến
create or replace view public.report_loading_3pl with (security_invoker = true) as
select c.id, c.shipment_id, s.shipment_code, o.order_code,
       (coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_date,
       to_char(date_trunc('month', coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh'), 'MM/YYYY') as month_label,
       o.payer_customer_id as customer_id, cu.code as customer_code, cu.name as customer_name,
       v.plate_number, pl.name as pickup_name, dl.name as delivery_name,
       coalesce(pl.name, '-') || ' → ' || coalesce(dl.name, '-') as route_label,
       round(coalesce(w.kg, 0) / 1000, 3) as tons,
       coalesce(c.supplier_id, s.carrier_supplier_id) as supplier_id,
       coalesce(sp.name, '(chưa chọn đơn vị)') as vendor_name, sp.code as vendor_code,
       (c.supplier_id is null) as is_trip_carrier,
       ft.name as fee_name, c.description, c.quantity, c.unit_price, c.amount, c.ref_no, c.note,
       ap.id as payable_id, ap.code as payable_code,
       case when ap.id is null then 'no_payable' when ap.status = 'open' then 'unpaid' else ap.status end as pay_status,
       coalesce(ap.status = 'paid', false) as paid,
       (select max(p.paid_at) from public.payments p where p.payable_id = ap.id and p.status = 'posted') as last_paid_at,
       s.status
from public.shipment_carrier_costs c
join public.fee_types ft on ft.id = c.fee_type_id and ft.is_loading
join public.shipments s on s.id = c.shipment_id
join public.transport_orders o on o.id = s.order_id
left join public.customers cu on cu.id = o.payer_customer_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.suppliers sp on sp.id = coalesce(c.supplier_id, s.carrier_supplier_id)
left join lateral (select sum(si.weight_kg) as kg from public.shipment_items si where si.shipment_id = s.id) w on true
left join public.payables ap on ap.shipment_id = s.id and ap.status <> 'cancelled'
  and ((c.supplier_id is null and ap.kind = 'carrier') or (c.supplier_id is not null and ap.kind = 'loading' and ap.supplier_id = c.supplier_id))
where s.status <> 'cancelled'
  and private.can_view_3pl() and (private.has_perm('reports.view') or private.has_perm('receivables.view'));
revoke all on public.report_loading_3pl from anon;
grant select on public.report_loading_3pl to authenticated;

-- Từng chuyến có bốc xếp: thu khách (phí nhóm Bốc xếp) so với trả các đơn vị bốc xếp
create or replace view public.report_loading_trips with (security_invoker = true) as
select s.id, s.shipment_code, o.order_code,
       (coalesce(s.completed_at, s.pickup_at) at time zone 'Asia/Ho_Chi_Minh')::date as report_date,
       o.payer_customer_id as customer_id, c.code as customer_code, c.name as customer_name,
       v.plate_number, pl.name as pickup_name, dl.name as delivery_name, s.status,
       round(coalesce(w.kg, 0) / 1000, 3) as tons,
       coalesce(fl.amount, 0) as loading_revenue,
       coalesce(lc.amount, 0) as loading_cost,
       coalesce(lc.unpaid, 0) as loading_unpaid,
       coalesce(lc.n, 0) as loading_lines,
       lc.vendors
from public.shipments s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.payer_customer_id
left join public.vehicles v on v.id = s.vehicle_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join lateral (select sum(si.weight_kg) as kg from public.shipment_items si where si.shipment_id = s.id) w on true
left join lateral (
  select sum(sf.amount) as amount from public.shipment_fees sf join public.fee_types ft on ft.id = sf.fee_type_id
  where sf.shipment_id = s.id and ft.is_loading
) fl on true
left join lateral (
  select count(*) as n, sum(x.amount) as amount, sum(x.amount) filter (where not x.paid) as unpaid,
         string_agg(distinct x.vendor_name, ', ') as vendors
  from public.report_loading_3pl x where x.shipment_id = s.id
) lc on true
where s.status <> 'cancelled' and (coalesce(fl.amount, 0) > 0 or coalesce(lc.n, 0) > 0)
  and private.can_view_3pl() and (private.has_perm('reports.view') or private.has_perm('receivables.view'));
revoke all on public.report_loading_trips from anon;
grant select on public.report_loading_trips to authenticated;
