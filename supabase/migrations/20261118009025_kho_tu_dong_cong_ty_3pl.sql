-- =============================================================================
-- GHA 9025: Kho GHA – tự lập phiếu khi chuyến hoàn thành, tồn theo công ty chủ hàng, 3PL xem tồn (LE 18/11/2026)
--   * Chuyến có điểm giao là kho GHA: khi chuyến HOÀN THÀNH (tài xế đã xong / đã đóng) tự lập phiếu nhập;
--     điểm nhận là kho GHA: tự lập phiếu xuất; cả hai: chuyển vị trí. Chuyến chưa hoàn thành chưa cộng / trừ tồn.
--     Mở lại / hủy chuyến thì phiếu tự động bị xóa; sửa hàng trên chuyến đã hoàn thành thì phiếu tự cập nhật.
--     Chỉ áp dụng cho chuyến hoàn thành từ lúc chạy tệp này (chuyến cũ đã nằm trong số tồn đầu kỳ).
--     Chuyến đã lập phiếu tay thì không tự lập nữa.
--   * Tồn kho tách theo công ty chủ hàng (khách hàng trên đơn: Việt An Pha, …).
--   * Tài khoản nhà xe 3PL (vai trò carrier_3pl, gắn nhà xe qua user_suppliers) chỉ xem tồn của vị trí được gán cho nhà xe đó.
-- Không xóa, không sửa dữ liệu nghiệp vụ có sẵn.
-- =============================================================================

-- 1. Nguồn phiếu: tay / tự động từ chuyến
alter table public.stock_entries add column if not exists source text not null default 'manual'
  check (source in ('manual', 'auto'));
comment on column public.stock_entries.source is 'manual = lập tay / nhập Excel; auto = tự lập khi chuyến qua kho GHA hoàn thành';

insert into public.system_settings (key, value, description)
values ('inventory.auto_from', to_jsonb(now()), 'Kho GHA: chỉ tự lập phiếu cho chuyến hoàn thành từ thời điểm này (chuyến trước đó đã nằm trong tồn đầu kỳ)')
on conflict (key) do nothing;

-- 2. Vị trí kho ứng với một địa điểm: vị trí gắn trực tiếp, nếu không thì vị trí đầu tiên của kho gắn địa điểm đó
create or replace function private.stock_bin_for_location(p_location_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select b.id from public.warehouse_bins b where b.is_active and b.location_id = p_location_id order by b.sort_order, b.code limit 1),
    (select b.id from public.warehouses w join public.warehouse_bins b on b.warehouse_id = w.id and b.is_active
     where w.is_active and w.location_id = p_location_id order by b.sort_order, b.code limit 1)
  )
$$;
revoke all on function private.stock_bin_for_location(uuid) from public, anon;
grant execute on function private.stock_bin_for_location(uuid) to authenticated;

-- 3. Đồng bộ phiếu tự động của một chuyến
create or replace function private.stock_sync_shipment(p_shipment_id uuid, p_completed_now boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  v_owner uuid;
  v_from uuid;
  v_to uuid;
  v_kind text;
  v_bin uuid;
  v_to_bin uuid;
  v_done timestamptz;
  v_since timestamptz;
  v_no text;
  v_date date;
begin
  select voucher_no into v_no from public.stock_entries where shipment_id = p_shipment_id and source = 'auto' limit 1;
  delete from public.stock_entries where shipment_id = p_shipment_id and source = 'auto';
  select * into s from public.shipments where id = p_shipment_id;
  if not found or s.status not in ('driver_completed', 'closed') then return; end if;
  if exists (select 1 from public.stock_entries where shipment_id = p_shipment_id and source = 'manual') then return; end if;
  -- Giờ hoàn thành; chuyến cũ không ghi giờ hoàn thành thì lấy giờ nhận hàng (để không tự lập phiếu cho chuyến cũ)
  v_done := coalesce(s.completed_at, case when p_completed_now then now() end, s.pickup_at);
  select (value #>> '{}')::timestamptz into v_since from public.system_settings where key = 'inventory.auto_from';
  if v_since is not null and v_done < v_since then return; end if;
  v_from := private.stock_bin_for_location(s.pickup_location_id);
  v_to := private.stock_bin_for_location(s.delivery_location_id);
  if v_from is null and v_to is null then return; end if;
  if v_from is not null and v_to is not null then
    if v_from = v_to then return; end if;
    v_kind := 'transfer'; v_bin := v_from; v_to_bin := v_to;
  elsif v_to is not null then
    v_kind := 'receipt'; v_bin := v_to;
  else
    v_kind := 'issue'; v_bin := v_from;
  end if;
  v_date := (v_done at time zone 'Asia/Ho_Chi_Minh')::date;
  if not exists (select 1 from public.shipment_items i where i.shipment_id = p_shipment_id and i.product_id is not null and coalesce(i.quantity, 0) > 0) then
    return;
  end if;
  if v_no is null or v_no !~ ('^' || case v_kind when 'receipt' then 'PN' when 'issue' then 'PX' else 'CK' end || '-') then
    v_no := private.stock_voucher_no(v_kind, v_date);
  end if;
  select o.customer_id into v_owner from public.transport_orders o where o.id = s.order_id;
  insert into public.stock_entries (voucher_no, entry_date, kind, bin_id, to_bin_id, product_id, quantity, unit,
                                    owner_customer_id, shipment_id, ref_no, partner, notes, source)
  select v_no, v_date, v_kind, v_bin, v_to_bin, i.product_id, i.quantity, null,
         coalesce(v_owner, p.owner_customer_id), s.id, s.shipment_code,
         nullif(concat_ws(' · ', v.plate_number, s.container_no), ''),
         'Tự lập khi chuyến hoàn thành', 'auto'
  from public.shipment_items i
  join public.products p on p.id = i.product_id
  left join public.vehicles v on v.id = s.vehicle_id
  where i.shipment_id = p_shipment_id and coalesce(i.quantity, 0) > 0
  order by i.line_no;
end;
$$;
revoke all on function private.stock_sync_shipment(uuid, boolean) from public, anon, authenticated;

create or replace function private.stock_sync_shipment_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'shipments' then
    perform private.stock_sync_shipment(new.id,
      old.status not in ('driver_completed', 'closed') and new.status in ('driver_completed', 'closed'));
  elsif tg_op = 'DELETE' then
    if exists (select 1 from public.shipments x where x.id = old.shipment_id and x.status in ('driver_completed', 'closed'))
       or exists (select 1 from public.stock_entries e where e.shipment_id = old.shipment_id and e.source = 'auto') then
      perform private.stock_sync_shipment(old.shipment_id);
    end if;
  else
    if exists (select 1 from public.shipments x where x.id = new.shipment_id and x.status in ('driver_completed', 'closed'))
       or exists (select 1 from public.stock_entries e where e.shipment_id = new.shipment_id and e.source = 'auto') then
      perform private.stock_sync_shipment(new.shipment_id);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_shipments_stock_sync on public.shipments;
create trigger trg_shipments_stock_sync
  after update of status, pickup_location_id, delivery_location_id on public.shipments
  for each row
  when (old.status is distinct from new.status or old.pickup_location_id is distinct from new.pickup_location_id
        or old.delivery_location_id is distinct from new.delivery_location_id)
  execute function private.stock_sync_shipment_trg();
drop trigger if exists trg_shipment_items_stock_sync on public.shipment_items;
create trigger trg_shipment_items_stock_sync
  after insert or update or delete on public.shipment_items
  for each row execute function private.stock_sync_shipment_trg();

-- 4. Tài khoản nhà xe 3PL (dùng chung với cổng 3PL tự đăng ký xe – 9030; tạo nếu chưa có)
create table if not exists public.user_suppliers (
  user_id uuid not null references public.profiles (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) default auth.uid(),
  primary key (user_id, supplier_id)
);
comment on table public.user_suppliers is 'Tài khoản nhà xe 3PL gắn với nhà cung cấp nào';
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_suppliers') then
    alter table public.user_suppliers enable row level security;
    create policy user_suppliers_select on public.user_suppliers for select to authenticated
      using (user_id = (select auth.uid()) or (select private.has_perm('users.view')));
    create policy user_suppliers_insert on public.user_suppliers for insert to authenticated
      with check ((select private.has_perm('users.configure')) and user_id <> (select auth.uid()));
    create policy user_suppliers_delete on public.user_suppliers for delete to authenticated
      using ((select private.has_perm('users.configure')) and user_id <> (select auth.uid()));
    revoke all on public.user_suppliers from anon;
    grant select, insert, delete on public.user_suppliers to authenticated;
  end if;
end $$;

insert into public.roles (code, name, description, is_system, sort_order)
values ('carrier_3pl', 'Nhà xe 3PL', 'Tài khoản của nhà xe 3PL: chỉ thấy phần được cấp (VD tồn kho vị trí GHA được gán); không thấy cước, dữ liệu khác', true, 95)
on conflict (code) do nothing;

do $$
begin
  if to_regprocedure('private.my_supplier_ids()') is null then
    execute $f$
      create function private.my_supplier_ids() returns setof uuid
      language sql stable security definer set search_path = '' as $b$
        select us.supplier_id from public.user_suppliers us where us.user_id = auth.uid()
      $b$ $f$;
    revoke all on function private.my_supplier_ids() from public, anon;
    grant execute on function private.my_supplier_ids() to authenticated;
  end if;
  if to_regprocedure('private.is_supplier_scoped()') is null then
    execute $f$
      create function private.is_supplier_scoped() returns boolean
      language sql stable security definer set search_path = '' as $b$
        select auth.uid() is not null
           and not private.is_super_admin(auth.uid())
           and (
             exists (select 1 from public.user_suppliers us where us.user_id = auth.uid())
             or exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                        where ur.user_id = auth.uid() and r.code = 'carrier_3pl')
           )
      $b$ $f$;
    revoke all on function private.is_supplier_scoped() from public, anon;
    grant execute on function private.is_supplier_scoped() to authenticated;
  end if;
end $$;

-- 5. Vị trí kho nào cho nhà xe 3PL nào xem tồn
create table if not exists public.warehouse_bin_suppliers (
  id uuid primary key default gen_random_uuid(),
  bin_id uuid not null references public.warehouse_bins (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (bin_id, supplier_id)
);
comment on table public.warehouse_bin_suppliers is 'Nhà xe 3PL được xem tồn kho của vị trí GHA nào (VD Hải Quân xem GHA1)';
select private.attach_standard_triggers('public.warehouse_bin_suppliers');
create trigger trg_warehouse_bin_suppliers_audit after insert or update or delete on public.warehouse_bin_suppliers
  for each row execute function private.audit_row_change('id');
alter table public.warehouse_bin_suppliers enable row level security;
create policy warehouse_bin_suppliers_select on public.warehouse_bin_suppliers for select to authenticated
  using ((select private.has_perm('inventory.view')));
create policy warehouse_bin_suppliers_insert on public.warehouse_bin_suppliers for insert to authenticated
  with check ((select private.has_perm('inventory.update')));
create policy warehouse_bin_suppliers_update on public.warehouse_bin_suppliers for update to authenticated
  using ((select private.has_perm('inventory.update'))) with check ((select private.has_perm('inventory.update')));
create policy warehouse_bin_suppliers_delete on public.warehouse_bin_suppliers for delete to authenticated
  using ((select private.has_perm('inventory.update')));
revoke all on public.warehouse_bin_suppliers from anon;
grant select, insert, update, delete on public.warehouse_bin_suppliers to authenticated;

-- Vị trí tài khoản hiện tại được xem: mọi vị trí, trừ tài khoản nhà xe 3PL chỉ thấy vị trí gán cho nhà xe của mình
create or replace function private.my_stock_bin_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select case when not private.is_supplier_scoped() then null
    else coalesce((select array_agg(distinct x.bin_id) from public.warehouse_bin_suppliers x
                   where x.supplier_id in (select private.my_supplier_ids())), '{}'::uuid[]) end
$$;
revoke all on function private.my_stock_bin_ids() from public, anon;
grant execute on function private.my_stock_bin_ids() to authenticated;

create policy warehouse_bins_supplier_scope on public.warehouse_bins as restrictive for all to authenticated
  using ((select private.my_stock_bin_ids()) is null or id = any((select private.my_stock_bin_ids())::uuid[]));
create policy warehouses_supplier_scope on public.warehouses as restrictive for all to authenticated
  using ((select private.my_stock_bin_ids()) is null
         or exists (select 1 from public.warehouse_bins b where b.warehouse_id = warehouses.id and b.id = any((select private.my_stock_bin_ids())::uuid[])));
create policy stock_entries_supplier_scope on public.stock_entries as restrictive for all to authenticated
  using ((select private.my_stock_bin_ids()) is null or bin_id = any((select private.my_stock_bin_ids())::uuid[])
         or to_bin_id = any((select private.my_stock_bin_ids())::uuid[]));
create policy warehouse_bin_suppliers_supplier_scope on public.warehouse_bin_suppliers as restrictive for all to authenticated
  using (not (select private.is_supplier_scoped()));

-- Nhà xe 3PL: chỉ quyền xem tồn kho (giới hạn theo vị trí ở trên)
insert into public.role_permissions (role_id, permission_code)
select r.id, 'inventory.view' from public.roles r where r.code = 'carrier_3pl'
on conflict do nothing;

-- 6. Phát sinh kèm công ty chủ hàng; báo cáo tồn theo công ty
create or replace view public.stock_moves with (security_invoker = true) as
select e.id as entry_id, e.entry_date, e.kind, e.voucher_no, e.bin_id, e.product_id, e.quantity as qty_in, 0::numeric as qty_out, e.shipment_id, e.owner_customer_id
from public.stock_entries e where e.kind in ('opening', 'receipt')
union all
select e.id, e.entry_date, e.kind, e.voucher_no, e.bin_id, e.product_id, 0, e.quantity, e.shipment_id, e.owner_customer_id
from public.stock_entries e where e.kind in ('issue', 'transfer')
union all
select e.id, e.entry_date, e.kind, e.voucher_no, e.to_bin_id, e.product_id, e.quantity, 0, e.shipment_id, e.owner_customer_id
from public.stock_entries e where e.kind = 'transfer';

drop function if exists public.stock_balance_report(date, date, uuid, uuid, boolean);
create or replace function public.stock_balance_report(
  p_from date, p_to date, p_warehouse_id uuid default null, p_bin_id uuid default null, p_by_bin boolean default true,
  p_customer_id uuid default null
)
returns table (
  warehouse_id uuid, warehouse_name text, bin_id uuid, bin_code text, bin_name text,
  owner_customer_id uuid, owner_name text,
  product_id uuid, product_code text, product_name text, unit text,
  opening_qty numeric, in_qty numeric, out_qty numeric, closing_qty numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (select private.my_stock_bin_ids() as bins),
  m as (
    select mv.*, b.warehouse_id
    from public.stock_moves mv
    join public.warehouse_bins b on b.id = mv.bin_id
    cross join allowed a
    where private.has_perm('inventory.view')
      and (a.bins is null or mv.bin_id = any(a.bins))
      and mv.entry_date <= p_to
      and (p_warehouse_id is null or b.warehouse_id = p_warehouse_id)
      and (p_bin_id is null or mv.bin_id = p_bin_id)
      and (p_customer_id is null or mv.owner_customer_id = p_customer_id)
      and (p_by_bin or mv.kind <> 'transfer')
  ), g as (
    select m.warehouse_id, case when p_by_bin then m.bin_id end as bin_id, m.owner_customer_id, m.product_id,
           sum(m.qty_in - m.qty_out) filter (where m.entry_date < p_from or m.kind = 'opening') as opening_qty,
           sum(m.qty_in) filter (where m.entry_date >= p_from and m.kind <> 'opening') as in_qty,
           sum(m.qty_out) filter (where m.entry_date >= p_from) as out_qty
    from m
    group by 1, 2, 3, 4
  )
  select g.warehouse_id, w.name, g.bin_id, b.code, b.name,
         g.owner_customer_id, coalesce(c.name, 'Chưa ghi công ty'),
         g.product_id, p.code, p.name, p.unit,
         coalesce(g.opening_qty, 0), coalesce(g.in_qty, 0), coalesce(g.out_qty, 0),
         coalesce(g.opening_qty, 0) + coalesce(g.in_qty, 0) - coalesce(g.out_qty, 0)
  from g
  join public.warehouses w on w.id = g.warehouse_id
  left join public.warehouse_bins b on b.id = g.bin_id
  join public.products p on p.id = g.product_id
  left join public.customers c on c.id = g.owner_customer_id
  where coalesce(g.opening_qty, 0) <> 0 or coalesce(g.in_qty, 0) <> 0 or coalesce(g.out_qty, 0) <> 0
  order by w.name, b.sort_order nulls first, b.code, c.name nulls last, p.code;
$$;
revoke all on function public.stock_balance_report(date, date, uuid, uuid, boolean, uuid) from public, anon;
grant execute on function public.stock_balance_report(date, date, uuid, uuid, boolean, uuid) to authenticated;

-- 7. Gợi ý lập phiếu: chỉ chuyến chưa có phiếu (tự động hoặc tay); thêm cờ đã hoàn thành
create or replace view public.stock_shipment_suggestions with (security_invoker = true) as
with gl as (
  select b.location_id, b.id as bin_id, b.warehouse_id, 1 as prio from public.warehouse_bins b where b.is_active and b.location_id is not null
  union all
  select w.location_id, null::uuid, w.id, 2 from public.warehouses w where w.is_active and w.location_id is not null
), s as (
  select s.*,
         private.stock_bin_for_location(s.pickup_location_id) as from_bin_id,
         exists (select 1 from gl where gl.location_id = s.pickup_location_id) as from_gha,
         private.stock_bin_for_location(s.delivery_location_id) as to_bin_id,
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
                 from public.shipment_items i where i.shipment_id = s.id), '[]'::jsonb) as items,
       s.status in ('driver_completed', 'closed') as is_completed,
       o.customer_id
from s
join public.transport_orders o on o.id = s.order_id
left join public.customers c on c.id = o.customer_id
left join public.locations pl on pl.id = s.pickup_location_id
left join public.locations dl on dl.id = s.delivery_location_id
left join public.vehicles v on v.id = s.vehicle_id;
revoke all on public.stock_shipment_suggestions from anon;
grant select on public.stock_shipment_suggestions to authenticated;

-- 8. Lập phiếu tay nhiều dòng: thêm công ty chủ hàng ở đầu phiếu
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
            coalesce(nullif(l ->> 'owner_customer_id', ''), nullif(p_header ->> 'owner_customer_id', ''))::uuid,
            nullif(p_header ->> 'shipment_id', '')::uuid,
            nullif(btrim(coalesce(p_header ->> 'ref_no', '')), ''), nullif(btrim(coalesce(p_header ->> 'partner', '')), ''),
            coalesce(nullif(btrim(coalesce(l ->> 'notes', '')), ''), nullif(btrim(coalesce(p_header ->> 'notes', '')), '')));
  end loop;
  return no;
end;
$$;

-- Lập phiếu tay cho chuyến đã có phiếu tự động: bỏ phiếu tự động để không tính hai lần
create or replace function private.stock_manual_replaces_auto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'manual' and new.shipment_id is not null then
    delete from public.stock_entries where shipment_id = new.shipment_id and source = 'auto';
  end if;
  return null;
end;
$$;
drop trigger if exists trg_stock_entries_manual_replaces_auto on public.stock_entries;
create trigger trg_stock_entries_manual_replaces_auto after insert on public.stock_entries
  for each row execute function private.stock_manual_replaces_auto();
