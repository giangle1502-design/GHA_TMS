-- =============================================================================
-- GHA 9026: Chọn vị trí kho GHA (GHA1 / GHA2) trên đơn hàng và chuyến (LE 18/11/2026)
--   * Đơn hàng (và từng chuyến, nếu khác đơn) có ô "Kho GHA": Không qua kho / Nhập vào GHA1, GHA2 / Xuất từ GHA1, GHA2,
--     hoặc Nhập / Xuất nhưng "chọn vị trí khi hoàn thành".
--   * Khi chuyến hoàn thành: đã chọn vị trí thì tự lập phiếu nhập / xuất vào đúng vị trí đó, không cần gắn địa điểm.
--     Chọn Nhập / Xuất mà chưa có vị trí: chưa lập phiếu, chuyến hiện ở tab "Chuyến qua kho chờ lập phiếu" với nhãn
--     "Chưa chọn vị trí"; chọn vị trí trên đơn / chuyến (kể cả sau khi đã hoàn thành) thì phiếu tự lập.
--   * Chuyến đã chọn kho trên đơn tính cả khi hoàn thành trước lúc chạy 9025, miễn là không trước ngày nhập tồn đầu kỳ của vị trí đó.
--   * Chuyến không chọn gì: giữ cách cũ (theo địa điểm nhận / giao gắn với kho). Chọn "Không qua kho" thì không lập phiếu.
-- Không xóa, không sửa dữ liệu nghiệp vụ có sẵn.
-- =============================================================================

-- 1. Cột chọn kho trên đơn hàng và chuyến (chuyến để trống thì theo đơn)
alter table public.transport_orders
  add column if not exists stock_kind text check (stock_kind in ('none', 'receipt', 'issue')),
  add column if not exists stock_bin_id uuid references public.warehouse_bins (id) on delete set null;
alter table public.shipments
  add column if not exists stock_kind text check (stock_kind in ('none', 'receipt', 'issue')),
  add column if not exists stock_bin_id uuid references public.warehouse_bins (id) on delete set null;
comment on column public.transport_orders.stock_kind is 'Kho GHA: none = không qua kho, receipt = nhập kho, issue = xuất kho; trống = theo địa điểm gắn với kho';
comment on column public.transport_orders.stock_bin_id is 'Vị trí kho GHA (GHA1 / GHA2); trống = chọn khi chuyến hoàn thành';
comment on column public.shipments.stock_kind is 'Kho GHA của riêng chuyến; trống = theo đơn hàng';
comment on column public.shipments.stock_bin_id is 'Vị trí kho GHA của riêng chuyến (chọn lúc hoàn thành); trống = theo đơn hàng';
create index if not exists transport_orders_stock_bin_idx on public.transport_orders (stock_bin_id) where stock_bin_id is not null;
create index if not exists shipments_stock_bin_idx on public.shipments (stock_bin_id) where stock_bin_id is not null;

-- 2. Kho GHA đã chọn của một chuyến (chuyến ưu tiên hơn đơn): kind, bin
create or replace function private.stock_target(p_shipment_id uuid, out kind text, out bin_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.stock_kind is not null then s.stock_kind else o.stock_kind end,
         case when s.stock_kind is not null then coalesce(s.stock_bin_id, case when s.stock_kind = o.stock_kind then o.stock_bin_id end)
              else coalesce(s.stock_bin_id, o.stock_bin_id) end
  from public.shipments s
  join public.transport_orders o on o.id = s.order_id
  where s.id = p_shipment_id
$$;
revoke all on function private.stock_target(uuid) from public, anon;
grant execute on function private.stock_target(uuid) to authenticated;

-- 3. Đồng bộ phiếu tự động của một chuyến: ưu tiên kho đã chọn trên chuyến / đơn
create or replace function private.stock_sync_shipment(p_shipment_id uuid, p_completed_now boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  t record;
  v_owner uuid;
  v_from uuid;
  v_to uuid;
  v_kind text;
  v_bin uuid;
  v_to_bin uuid;
  v_done timestamptz;
  v_since timestamptz;
  v_opening date;
  v_no text;
  v_date date;
begin
  select voucher_no into v_no from public.stock_entries where shipment_id = p_shipment_id and source = 'auto' limit 1;
  delete from public.stock_entries where shipment_id = p_shipment_id and source = 'auto';
  select * into s from public.shipments where id = p_shipment_id;
  if not found or s.status not in ('driver_completed', 'closed') then return; end if;
  if exists (select 1 from public.stock_entries where shipment_id = p_shipment_id and source = 'manual') then return; end if;
  -- Giờ hoàn thành; chuyến cũ không ghi giờ hoàn thành thì lấy giờ nhận hàng
  v_done := coalesce(s.completed_at, case when p_completed_now then now() end, s.pickup_at);
  v_date := (v_done at time zone 'Asia/Ho_Chi_Minh')::date;
  select * into t from private.stock_target(p_shipment_id);

  if t.kind = 'none' then
    return;
  elsif t.kind in ('receipt', 'issue') then
    -- Đã chọn trên đơn / chuyến: vị trí đã chọn, nếu chưa chọn thì vị trí gắn trực tiếp với điểm giao (nhập) / điểm nhận (xuất)
    v_kind := t.kind;
    v_bin := coalesce(t.bin_id, (select b.id from public.warehouse_bins b
                                 where b.is_active and b.location_id = case when t.kind = 'receipt' then s.delivery_location_id else s.pickup_location_id end
                                 order by b.sort_order, b.code limit 1));
    if v_bin is null then return; end if;  -- chờ chọn vị trí
    -- Chuyến hoàn thành trước ngày nhập tồn đầu kỳ của vị trí đã nằm trong số tồn đầu kỳ
    select min(e.entry_date) into v_opening from public.stock_entries e where e.kind = 'opening' and e.bin_id = v_bin;
    if v_opening is not null and v_date < v_opening then return; end if;
  else
    -- Không chọn: theo địa điểm gắn với kho, chỉ chuyến hoàn thành từ lúc chạy 9025
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
  end if;

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

-- 4. Đổi kho trên chuyến / đơn: lập lại phiếu tự động (chuyến đã hoàn thành)
drop trigger if exists trg_shipments_stock_sync on public.shipments;
create trigger trg_shipments_stock_sync
  after update of status, pickup_location_id, delivery_location_id, stock_kind, stock_bin_id on public.shipments
  for each row
  when (old.status is distinct from new.status or old.pickup_location_id is distinct from new.pickup_location_id
        or old.delivery_location_id is distinct from new.delivery_location_id
        or old.stock_kind is distinct from new.stock_kind or old.stock_bin_id is distinct from new.stock_bin_id)
  execute function private.stock_sync_shipment_trg();

create or replace function private.stock_sync_order_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select x.id from public.shipments x
           where x.order_id = new.id
             and (x.status in ('driver_completed', 'closed')
                  or exists (select 1 from public.stock_entries e where e.shipment_id = x.id and e.source = 'auto'))
  loop
    perform private.stock_sync_shipment(r.id);
  end loop;
  return null;
end;
$$;
drop trigger if exists trg_transport_orders_stock_sync on public.transport_orders;
create trigger trg_transport_orders_stock_sync
  after update of stock_kind, stock_bin_id on public.transport_orders
  for each row
  when (old.stock_kind is distinct from new.stock_kind or old.stock_bin_id is distinct from new.stock_bin_id)
  execute function private.stock_sync_order_trg();

-- 5. Chọn kho cho đơn hàng hoặc một chuyến (người có quyền lập phiếu kho)
create or replace function public.set_stock_target(p_order_id uuid, p_shipment_id uuid, p_kind text, p_bin_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bin uuid := p_bin_id;
begin
  if not private.has_perm('inventory.create') then
    raise exception 'Bạn không có quyền chọn vị trí kho' using errcode = '42501';
  end if;
  if p_kind is not null and p_kind not in ('none', 'receipt', 'issue') then
    raise exception 'Kiểu kho không hợp lệ' using errcode = '22023';
  end if;
  if p_kind is null or p_kind = 'none' then v_bin := null; end if;
  if v_bin is not null and not exists (select 1 from public.warehouse_bins b where b.id = v_bin and b.is_active) then
    raise exception 'Vị trí kho không tồn tại hoặc đã ngừng dùng' using errcode = '22023';
  end if;
  if p_shipment_id is not null then
    update public.shipments set stock_kind = p_kind, stock_bin_id = v_bin
    where id = p_shipment_id and (p_order_id is null or order_id = p_order_id)
      and (stock_kind, stock_bin_id) is distinct from (p_kind, v_bin);
    if not found and not exists (select 1 from public.shipments where id = p_shipment_id) then
      raise exception 'Không tìm thấy chuyến' using errcode = '22023';
    end if;
  elsif p_order_id is not null then
    update public.transport_orders set stock_kind = p_kind, stock_bin_id = v_bin
    where id = p_order_id and (stock_kind, stock_bin_id) is distinct from (p_kind, v_bin);
    if not found and not exists (select 1 from public.transport_orders where id = p_order_id) then
      raise exception 'Không tìm thấy đơn hàng' using errcode = '22023';
    end if;
  end if;
end;
$$;
revoke all on function public.set_stock_target(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.set_stock_target(uuid, uuid, text, uuid) to authenticated;

-- 6. Gợi ý lập phiếu: thêm chuyến đã chọn kho trên đơn / chuyến; cờ chưa chọn vị trí
create or replace view public.stock_shipment_suggestions with (security_invoker = true) as
with gl as (
  select b.location_id from public.warehouse_bins b where b.is_active and b.location_id is not null
  union
  select w.location_id from public.warehouses w where w.is_active and w.location_id is not null
), s as (
  select s.*, t.kind as sel_kind, t.bin_id as sel_bin,
         private.stock_bin_for_location(s.pickup_location_id) as loc_from_bin,
         s.pickup_location_id in (select location_id from gl) as from_gha,
         private.stock_bin_for_location(s.delivery_location_id) as loc_to_bin,
         s.delivery_location_id in (select location_id from gl) as to_gha
  from public.shipments s
  cross join lateral private.stock_target(s.id) t
  where s.status not in ('cancelled', 'rejected')
    and not exists (select 1 from public.stock_entries e where e.shipment_id = s.id)
), k as (
  select s.*,
         case when sel_kind in ('receipt', 'issue') then sel_kind
              when from_gha and to_gha then 'transfer' when to_gha then 'receipt' else 'issue' end as kind2,
         -- Vị trí đã chọn (nhập: vị trí nhận; xuất: vị trí xuất) hoặc vị trí gắn trực tiếp với địa điểm
         case when sel_kind = 'issue' then coalesce(sel_bin, (select b.id from public.warehouse_bins b where b.is_active and b.location_id = s.pickup_location_id order by b.sort_order, b.code limit 1))
              when sel_kind = 'receipt' then null else loc_from_bin end as from_bin2,
         case when sel_kind = 'receipt' then coalesce(sel_bin, (select b.id from public.warehouse_bins b where b.is_active and b.location_id = s.delivery_location_id order by b.sort_order, b.code limit 1))
              when sel_kind = 'issue' then null else loc_to_bin end as to_bin2
  from s
  where coalesce(sel_kind, '') <> 'none'
    and (sel_kind in ('receipt', 'issue') or from_gha or to_gha)
)
select k.id as shipment_id, k.shipment_code, k.status,
       coalesce((k.arrived_delivery_at at time zone 'Asia/Ho_Chi_Minh')::date, (k.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date) as trip_date,
       k.kind2 as kind,
       k.from_bin2 as from_bin_id, k.to_bin2 as to_bin_id,
       pl.name as pickup_name, dl.name as delivery_name,
       v.plate_number, k.container_no,
       o.order_code, o.voucher_no as order_voucher_no, o.ref_no as order_ref_no, c.name as customer_name,
       coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'item_code', i.item_code, 'item_name', i.item_name,
                                                     'quantity', i.quantity, 'unit', i.unit) order by i.line_no)
                 from public.shipment_items i where i.shipment_id = k.id), '[]'::jsonb) as items,
       k.status in ('driver_completed', 'closed') as is_completed,
       o.customer_id,
       (k.sel_kind in ('receipt', 'issue') and case k.sel_kind when 'receipt' then k.to_bin2 else k.from_bin2 end is null) as needs_bin
from k
join public.transport_orders o on o.id = k.order_id
left join public.customers c on c.id = o.customer_id
left join public.locations pl on pl.id = k.pickup_location_id
left join public.locations dl on dl.id = k.delivery_location_id
left join public.vehicles v on v.id = k.vehicle_id;
revoke all on public.stock_shipment_suggestions from anon;
grant select on public.stock_shipment_suggestions to authenticated;
