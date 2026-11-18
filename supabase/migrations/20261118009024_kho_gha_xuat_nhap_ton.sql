-- =============================================================================
-- GHA 9024: Quản lý kho GHA – nhập, xuất, tồn (LE yêu cầu 18/11/2026)
--   Chỉ dùng cho kho nội bộ của GHA (hàng GHA nhận vào kho rồi xuất đi), để đối chiếu hàng hóa.
--   * warehouses: kho (Kho GHA). warehouse_bins: vị trí trong kho (GHA1, GHA2).
--     Mỗi kho / vị trí gắn được với một địa điểm trong danh mục: chuyến có điểm giao là địa điểm đó
--     được gợi ý lập phiếu nhập, chuyến có điểm nhận là địa điểm đó được gợi ý lập phiếu xuất.
--   * stock_entries: mỗi dòng một mã hàng của phiếu kho. Loại: tồn đầu kỳ, nhập, xuất, chuyển vị trí.
--     Nhiều dòng cùng Số phiếu = một phiếu. Mã hàng lấy từ danh mục mã hàng có sẵn (products).
--   * stock_balance_report(): báo cáo xuất nhập tồn theo kỳ, theo vị trí (hoặc gộp cả kho).
--   * stock_shipment_suggestions: chuyến qua kho GHA chưa lập phiếu.
--   * Quyền mới inventory.* : chỉ tài khoản nội bộ GHA. Tài khoản khách hàng không có nên không thấy (chặn ở CSDL).
-- Không xóa, không sửa dữ liệu nghiệp vụ có sẵn.
-- =============================================================================

-- 1. Quyền
insert into public.permissions (code, module, action, name, description, sort_order) values
  ('inventory.view', 'inventory', 'view', 'Xem - Kho GHA (nhập xuất tồn)', 'Phiếu nhập, xuất, tồn kho GHA. Không cấp cho tài khoản khách hàng', 2731),
  ('inventory.create', 'inventory', 'create', 'Thêm - Kho GHA (nhập xuất tồn)', null, 2732),
  ('inventory.update', 'inventory', 'update', 'Sửa - Kho GHA (nhập xuất tồn)', null, 2733),
  ('inventory.delete', 'inventory', 'delete', 'Xóa - Kho GHA (nhập xuất tồn)', null, 2734),
  ('inventory.export', 'inventory', 'export', 'Xuất dữ liệu - Kho GHA (nhập xuất tồn)', null, 2735)
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
cross join (values ('inventory.view'), ('inventory.create'), ('inventory.update'), ('inventory.delete'), ('inventory.export')) p(code)
where r.code in ('super_admin', 'admin', 'director', 'ops_manager', 'dispatcher', 'accountant')
on conflict do nothing;

-- 2. Kho
create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  name text not null check (length(trim(name)) between 1 and 150),
  location_id uuid references public.locations (id),
  address text check (address is null or length(address) <= 500),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.warehouses is 'Kho nội bộ của GHA (VD: Kho GHA)';
comment on column public.warehouses.location_id is 'Địa điểm trong danh mục ứng với kho: chuyến giao tới / nhận từ địa điểm này được gợi ý lập phiếu';
select private.attach_standard_triggers('public.warehouses');
create trigger trg_warehouses_code before insert on public.warehouses
  for each row execute function private.fill_master_code('KHO', '2');
create trigger trg_warehouses_audit after insert or update or delete on public.warehouses
  for each row execute function private.audit_row_change('id');

-- 3. Vị trí trong kho
create table if not exists public.warehouse_bins (
  id uuid primary key default gen_random_uuid(),
  code text not null default '' unique,
  warehouse_id uuid not null references public.warehouses (id),
  name text not null check (length(trim(name)) between 1 and 150),
  location_id uuid references public.locations (id),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.warehouse_bins is 'Vị trí trong kho GHA (VD: GHA1, GHA2)';
comment on column public.warehouse_bins.location_id is 'Địa điểm trong danh mục ứng với vị trí này (nếu có): gợi ý đúng vị trí khi lập phiếu từ chuyến';
create index if not exists warehouse_bins_wh_idx on public.warehouse_bins (warehouse_id);
select private.attach_standard_triggers('public.warehouse_bins');
create trigger trg_warehouse_bins_code before insert on public.warehouse_bins
  for each row execute function private.fill_master_code('VT', '2');
create trigger trg_warehouse_bins_audit after insert or update or delete on public.warehouse_bins
  for each row execute function private.audit_row_change('id');

-- 4. Dòng phiếu kho
create table if not exists public.stock_entries (
  id uuid primary key default gen_random_uuid(),
  voucher_no text not null default '' check (length(voucher_no) <= 50),
  entry_date date not null default ((now() at time zone 'Asia/Ho_Chi_Minh')::date),
  kind text not null check (kind in ('opening', 'receipt', 'issue', 'transfer')),
  bin_id uuid not null references public.warehouse_bins (id),
  to_bin_id uuid references public.warehouse_bins (id),
  product_id uuid not null references public.products (id),
  quantity numeric(16,3) not null check (quantity > 0),
  unit text check (unit is null or length(unit) <= 30),
  owner_customer_id uuid references public.customers (id),
  shipment_id uuid,
  ref_no text check (ref_no is null or length(ref_no) <= 100),
  partner text check (partner is null or length(partner) <= 300),
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check ((kind = 'transfer') = (to_bin_id is not null)),
  check (to_bin_id is null or to_bin_id <> bin_id)
);
comment on table public.stock_entries is 'Phiếu kho GHA: mỗi dòng một mã hàng. Nhiều dòng cùng số phiếu = một phiếu';
comment on column public.stock_entries.kind is 'opening = tồn đầu kỳ (nhập số tồn lúc bắt đầu theo dõi); receipt = nhập kho; issue = xuất kho; transfer = chuyển từ vị trí này sang vị trí khác';
comment on column public.stock_entries.bin_id is 'Vị trí nhập vào / xuất ra. Với chuyển vị trí: vị trí chuyển đi';
comment on column public.stock_entries.to_bin_id is 'Chỉ dùng khi chuyển vị trí: vị trí nhận hàng';
comment on column public.stock_entries.shipment_id is 'Chuyến xe đã lập phiếu này (không ràng buộc khóa ngoại để chức năng xóa dữ liệu thử chuyến không xóa sổ kho)';
comment on column public.stock_entries.ref_no is 'Số chứng từ đi kèm: số PXK, phiếu chuyển kho Ecount, số shipment…';
comment on column public.stock_entries.partner is 'Người / đơn vị giao hoặc nhận hàng';
create index if not exists stock_entries_date_idx on public.stock_entries (entry_date, bin_id, product_id);
create index if not exists stock_entries_voucher_idx on public.stock_entries (voucher_no);
create index if not exists stock_entries_shipment_idx on public.stock_entries (shipment_id) where shipment_id is not null;
select private.attach_standard_triggers('public.stock_entries');
create trigger trg_stock_entries_audit after insert or update or delete on public.stock_entries
  for each row execute function private.audit_row_change('id');

-- Số phiếu tự sinh: PN-2611-001 (nhập), PX-… (xuất), CK-… (chuyển vị trí). Tồn đầu kỳ dùng chung một số theo ngày: DK-261031
create or replace function private.stock_voucher_no(p_kind text, p_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefix text := case p_kind when 'receipt' then 'PN' when 'issue' then 'PX' when 'transfer' then 'CK' else 'DK' end;
  ym text := to_char(coalesce(p_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date), 'YYMM');
  v integer;
  no text;
begin
  if p_kind = 'opening' then
    return 'DK-' || to_char(coalesce(p_date, (now() at time zone 'Asia/Ho_Chi_Minh')::date), 'YYMMDD');
  end if;
  loop
    insert into public.code_sequences as cs (scope, period, last_value)
    values ('stock:' || prefix, ym, 1)
    on conflict (scope, period) do update set last_value = cs.last_value + 1
    returning last_value into v;
    no := prefix || '-' || ym || '-' || lpad(v::text, 3, '0');
    exit when not exists (select 1 from public.stock_entries where voucher_no = no);
  end loop;
  return no;
end;
$$;
revoke all on function private.stock_voucher_no(text, date) from public, anon;
grant execute on function private.stock_voucher_no(text, date) to authenticated;

create or replace function private.stock_entry_fill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.products;
begin
  new.voucher_no := upper(btrim(coalesce(new.voucher_no, '')));
  if new.voucher_no = '' then new.voucher_no := private.stock_voucher_no(new.kind, new.entry_date); end if;
  if new.kind <> 'transfer' then new.to_bin_id := null; end if;
  select * into p from public.products where id = new.product_id;
  if btrim(coalesce(new.unit, '')) = '' then new.unit := p.unit; end if;
  if tg_op = 'INSERT' and new.owner_customer_id is null then new.owner_customer_id := p.owner_customer_id; end if;
  return new;
end;
$$;
create trigger trg_stock_entries_fill before insert or update on public.stock_entries
  for each row execute function private.stock_entry_fill();

-- 5. Quyền dòng (RLS): chỉ người có quyền inventory.*
do $$
declare t text;
begin
  foreach t in array array['warehouses', 'warehouse_bins', 'stock_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.has_perm(''inventory.view'')))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select private.has_perm(''inventory.create'')))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select private.has_perm(''inventory.update''))) with check ((select private.has_perm(''inventory.update'')))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.has_perm(''inventory.delete'')))', t || '_delete', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- 6. Dữ liệu ban đầu: Kho GHA, vị trí GHA1, GHA2 (tự gắn địa điểm có mã / tên trùng nếu chỉ có đúng một)
insert into public.warehouses (code, name, sort_order)
select 'GHA', 'Kho GHA', 10
where not exists (select 1 from public.warehouses where code = 'GHA');
insert into public.warehouse_bins (code, warehouse_id, name, sort_order)
select v.code, w.id, 'Vị trí ' || v.code, v.ord
from (values ('GHA1', 10), ('GHA2', 20)) v(code, ord)
cross join public.warehouses w
where w.code = 'GHA' and not exists (select 1 from public.warehouse_bins b where b.code = v.code);
update public.warehouse_bins b set location_id = l.id
from public.locations l
where b.location_id is null and b.code in ('GHA1', 'GHA2')
  and (upper(btrim(l.code)) = b.code or upper(btrim(l.name)) = b.code)
  and (select count(*) from public.locations l2 where upper(btrim(l2.code)) = b.code or upper(btrim(l2.name)) = b.code) = 1;
update public.warehouses w set location_id = l.id
from public.locations l
where w.code = 'GHA' and w.location_id is null
  and upper(btrim(l.name)) in ('GHA', 'KHO GHA')
  and (select count(*) from public.locations l2 where upper(btrim(l2.name)) in ('GHA', 'KHO GHA')) = 1;

-- 7. Phát sinh theo vị trí (chuyển vị trí = xuất ở vị trí đi + nhập ở vị trí nhận)
create or replace view public.stock_moves with (security_invoker = true) as
select e.id as entry_id, e.entry_date, e.kind, e.voucher_no, e.bin_id, e.product_id, e.quantity as qty_in, 0::numeric as qty_out, e.shipment_id
from public.stock_entries e where e.kind in ('opening', 'receipt')
union all
select e.id, e.entry_date, e.kind, e.voucher_no, e.bin_id, e.product_id, 0, e.quantity, e.shipment_id
from public.stock_entries e where e.kind in ('issue', 'transfer')
union all
select e.id, e.entry_date, e.kind, e.voucher_no, e.to_bin_id, e.product_id, e.quantity, 0, e.shipment_id
from public.stock_entries e where e.kind = 'transfer';
comment on view public.stock_moves is 'Phát sinh nhập / xuất từng vị trí (chuyển vị trí tách thành 2 dòng)';
revoke all on public.stock_moves from anon;
grant select on public.stock_moves to authenticated;

-- 8. Báo cáo xuất nhập tồn: tồn đầu = phát sinh trước kỳ + phiếu tồn đầu kỳ trong kỳ; nhập, xuất trong kỳ; tồn cuối.
--    p_by_bin = false: gộp cả kho (bỏ chuyển vị trí vì không làm đổi tồn của kho).
create or replace function public.stock_balance_report(
  p_from date, p_to date, p_warehouse_id uuid default null, p_bin_id uuid default null, p_by_bin boolean default true
)
returns table (
  warehouse_id uuid, warehouse_name text, bin_id uuid, bin_code text, bin_name text,
  product_id uuid, product_code text, product_name text, unit text, owner_name text,
  opening_qty numeric, in_qty numeric, out_qty numeric, closing_qty numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with m as (
    select mv.*, b.warehouse_id
    from public.stock_moves mv
    join public.warehouse_bins b on b.id = mv.bin_id
    where mv.entry_date <= p_to
      and (p_warehouse_id is null or b.warehouse_id = p_warehouse_id)
      and (p_bin_id is null or mv.bin_id = p_bin_id)
      and (p_by_bin or mv.kind <> 'transfer')
  ), g as (
    select m.warehouse_id, case when p_by_bin then m.bin_id end as bin_id, m.product_id,
           sum(m.qty_in - m.qty_out) filter (where m.entry_date < p_from or m.kind = 'opening') as opening_qty,
           sum(m.qty_in) filter (where m.entry_date >= p_from and m.kind <> 'opening') as in_qty,
           sum(m.qty_out) filter (where m.entry_date >= p_from) as out_qty
    from m
    group by 1, 2, 3
  )
  select g.warehouse_id, w.name, g.bin_id, b.code, b.name,
         g.product_id, p.code, p.name, p.unit, c.name,
         coalesce(g.opening_qty, 0), coalesce(g.in_qty, 0), coalesce(g.out_qty, 0),
         coalesce(g.opening_qty, 0) + coalesce(g.in_qty, 0) - coalesce(g.out_qty, 0)
  from g
  join public.warehouses w on w.id = g.warehouse_id
  left join public.warehouse_bins b on b.id = g.bin_id
  join public.products p on p.id = g.product_id
  left join public.customers c on c.id = p.owner_customer_id
  where coalesce(g.opening_qty, 0) <> 0 or coalesce(g.in_qty, 0) <> 0 or coalesce(g.out_qty, 0) <> 0
  order by w.name, b.sort_order nulls first, b.code, p.code;
$$;
revoke all on function public.stock_balance_report(date, date, uuid, uuid, boolean) from public, anon;
grant execute on function public.stock_balance_report(date, date, uuid, uuid, boolean) to authenticated;

-- 9. Lập một phiếu nhiều dòng trong một lần (cùng số phiếu). Trả về số phiếu.
--    p_header: {kind, entry_date, bin_id, to_bin_id, voucher_no, ref_no, partner, notes, shipment_id}
--    p_lines:  [{product_id, quantity, unit, owner_customer_id, notes}]
create or replace function public.create_stock_voucher(p_header jsonb, p_lines jsonb)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  k text := p_header ->> 'kind';
  d date := coalesce(nullif(p_header ->> 'entry_date', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  no text := upper(btrim(coalesce(p_header ->> 'voucher_no', '')));
  l jsonb;
begin
  if not private.has_perm('inventory.create') then
    raise exception 'Bạn không có quyền lập phiếu kho' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Phiếu chưa có mã hàng nào' using errcode = '23514';
  end if;
  if no = '' then no := private.stock_voucher_no(k, d); end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into public.stock_entries (voucher_no, entry_date, kind, bin_id, to_bin_id, product_id, quantity, unit,
                                      owner_customer_id, shipment_id, ref_no, partner, notes)
    values (no, d, k, (p_header ->> 'bin_id')::uuid, nullif(p_header ->> 'to_bin_id', '')::uuid,
            (l ->> 'product_id')::uuid, (l ->> 'quantity')::numeric, nullif(l ->> 'unit', ''),
            nullif(l ->> 'owner_customer_id', '')::uuid, nullif(p_header ->> 'shipment_id', '')::uuid,
            nullif(btrim(coalesce(p_header ->> 'ref_no', '')), ''), nullif(btrim(coalesce(p_header ->> 'partner', '')), ''),
            coalesce(nullif(btrim(coalesce(l ->> 'notes', '')), ''), nullif(btrim(coalesce(p_header ->> 'notes', '')), '')));
  end loop;
  return no;
end;
$$;
revoke all on function public.create_stock_voucher(jsonb, jsonb) from public, anon;
grant execute on function public.create_stock_voucher(jsonb, jsonb) to authenticated;

-- 10. Chuyến qua kho GHA chưa lập phiếu: giao tới kho = gợi ý nhập; nhận từ kho = gợi ý xuất; cả hai = chuyển vị trí
create or replace view public.stock_shipment_suggestions with (security_invoker = true) as
with gl as (
  select b.location_id, b.id as bin_id, b.warehouse_id, 1 as prio from public.warehouse_bins b where b.is_active and b.location_id is not null
  union all
  select w.location_id, null::uuid, w.id, 2 from public.warehouses w where w.is_active and w.location_id is not null
), s as (
  select s.*,
         (select gl.bin_id from gl where gl.location_id = s.pickup_location_id order by gl.prio limit 1) as from_bin_id,
         exists (select 1 from gl where gl.location_id = s.pickup_location_id) as from_gha,
         (select gl.bin_id from gl where gl.location_id = s.delivery_location_id order by gl.prio limit 1) as to_bin_id,
         exists (select 1 from gl where gl.location_id = s.delivery_location_id) as to_gha
  from public.shipments s
  where s.status not in ('cancelled', 'rejected')
    and (s.pickup_location_id in (select location_id from gl) or s.delivery_location_id in (select location_id from gl))
    and not exists (select 1 from public.stock_entries e where e.shipment_id = s.id)
)
select s.id as shipment_id, s.shipment_code, s.status,
       coalesce((s.arrived_delivery_at at time zone 'Asia/Ho_Chi_Minh')::date, (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date) as trip_date,
       case when s.from_gha and s.to_gha then 'transfer' when s.to_gha then 'receipt' else 'issue' end as kind,
       s.from_bin_id, s.to_bin_id,
       pl.name as pickup_name, dl.name as delivery_name,
       v.plate_number, s.container_no,
       o.order_code, o.voucher_no as order_voucher_no, o.ref_no as order_ref_no, c.name as customer_name,
       coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'item_code', i.item_code, 'item_name', i.item_name,
                                                     'quantity', i.quantity, 'unit', i.unit) order by i.line_no)
                 from public.shipment_items i where i.shipment_id = s.id), '[]'::jsonb) as items
from s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.customer_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicles v on v.id = s.vehicle_id;
comment on view public.stock_shipment_suggestions is 'Chuyến có điểm nhận / điểm giao là kho GHA mà chưa lập phiếu kho';
revoke all on public.stock_shipment_suggestions from anon;
grant select on public.stock_shipment_suggestions to authenticated;
