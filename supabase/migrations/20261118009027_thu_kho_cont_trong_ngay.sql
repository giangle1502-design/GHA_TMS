-- =============================================================================
-- GHA 9027: Vai trò Thủ kho + danh sách cont về / đi kho GHA trong ngày (LE 18/11/2026)
--   * Vai trò "Thủ kho GHA" (warehouse_keeper): chỉ trang Kho GHA (xem tồn, lập phiếu, xuất Excel), xem danh mục mã hàng.
--     Không có quyền chuyến xe, điều phối, bảng giá, công nợ: không thấy cước.
--   * Hàm stock_trips_by_date(từ, đến, số cont): gõ số cont thì tìm theo cont (mọi ngày); không thì chuyến nhập về / xuất đi kho GHA theo ngày, mọi trạng thái (trừ hủy):
--     số cont, số xe, mã hàng, số lượng, vị trí, trạng thái, đã lập phiếu kho chưa. Không trả cột tiền nào.
-- Không xóa, không sửa dữ liệu nghiệp vụ có sẵn.
-- =============================================================================

-- 1. Vai trò Thủ kho GHA
insert into public.roles (code, name, description, is_system, sort_order)
values ('warehouse_keeper', 'Thủ kho GHA', 'Thủ kho GHA: xem cont về / đi trong ngày, tồn kho, lập phiếu nhập / xuất; không thấy cước, chuyến xe, công nợ', true, 90)
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, p from public.roles r,
  unnest(array['inventory.view', 'inventory.create', 'inventory.update', 'inventory.export', 'products.view']) p
where r.code = 'warehouse_keeper'
on conflict do nothing;

-- 2. Cont về / đi kho GHA theo ngày, hoặc tìm theo số cont (bỏ khoảng trắng, gạch, chữ hoa / thường)
create or replace function private.cont_key(p text) returns text
language sql immutable set search_path = '' as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;
grant execute on function private.cont_key(text) to authenticated;

create or replace function public.stock_trips_by_date(p_from date, p_to date, p_container text default null)
returns table (
  shipment_id uuid, shipment_code text, status text, trip_date date, kind text,
  bin_code text, to_bin_code text, needs_bin boolean,
  pickup_name text, delivery_name text, plate_number text, container_no text,
  order_code text, customer_name text, pickup_at timestamptz, arrived_at timestamptz, completed_at timestamptz,
  items jsonb, voucher_no text, customer_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with gl as (
    select b.location_id from public.warehouse_bins b where b.is_active and b.location_id is not null
    union
    select w.location_id from public.warehouses w where w.is_active and w.location_id is not null
  ), s as (
    select s.*, t.kind as sel_kind, t.bin_id as sel_bin,
           s.pickup_location_id in (select location_id from gl) as from_gha,
           s.delivery_location_id in (select location_id from gl) as to_gha
    from public.shipments s
    cross join lateral private.stock_target(s.id) t
    where private.has_perm('inventory.view') and not private.is_supplier_scoped()
      and s.status not in ('cancelled', 'rejected')
      and case when length(private.cont_key(p_container)) >= 3
               -- Tìm theo số cont: không giới hạn ngày, chỉ trong 1 năm gần nhất
               then private.cont_key(s.container_no) like '%' || private.cont_key(p_container) || '%'
                    and s.pickup_at >= now() - interval '1 year'
               else p_to - p_from between 0 and 92
                    and s.pickup_at >= (p_from - 15)::timestamp at time zone 'Asia/Ho_Chi_Minh'
                    and s.pickup_at < (p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' end
  ), k as (
    select s.*,
           case when sel_kind in ('receipt', 'issue') then sel_kind
                when from_gha and to_gha then 'transfer' when to_gha then 'receipt' else 'issue' end as kind2
    from s
    where coalesce(sel_kind, '') <> 'none' and (sel_kind in ('receipt', 'issue') or from_gha or to_gha)
  ), b as (
    select k.*,
           case when kind2 = 'receipt' then null
                when sel_kind = 'issue' then coalesce(sel_bin, (select x.id from public.warehouse_bins x where x.is_active and x.location_id = k.pickup_location_id order by x.sort_order, x.code limit 1))
                else private.stock_bin_for_location(k.pickup_location_id) end as from_bin,
           case when kind2 = 'issue' then null
                when sel_kind = 'receipt' then coalesce(sel_bin, (select x.id from public.warehouse_bins x where x.is_active and x.location_id = k.delivery_location_id order by x.sort_order, x.code limit 1))
                else private.stock_bin_for_location(k.delivery_location_id) end as to_bin,
           -- Ngày về kho: giờ tới điểm giao, nếu chưa tới thì giờ giao dự kiến; xuất kho: ngày lấy hàng
           (case when kind2 = 'issue' then k.pickup_at
                 else coalesce(k.arrived_delivery_at, k.expected_delivery_at, k.pickup_at) end at time zone 'Asia/Ho_Chi_Minh')::date as d
    from k
  )
  select b.id, b.shipment_code, b.status, b.d, b.kind2,
         coalesce(fb.code, tb.code), case when b.kind2 = 'transfer' then tb.code end,
         (b.sel_kind in ('receipt', 'issue') and case b.sel_kind when 'receipt' then b.to_bin else b.from_bin end is null),
         pl.name, dl.name, v.plate_number, b.container_no,
         o.order_code, c.name, b.pickup_at, b.arrived_delivery_at, b.completed_at,
         coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'item_code', coalesce(p.code, i.item_code),
                                                       'item_name', coalesce(p.name, i.item_name), 'quantity', i.quantity,
                                                       'unit', coalesce(i.unit, p.unit)) order by i.line_no)
                   from public.shipment_items i left join public.products p on p.id = i.product_id
                   where i.shipment_id = b.id), '[]'::jsonb),
         (select string_agg(distinct e.voucher_no, ', ') from public.stock_entries e where e.shipment_id = b.id),
         o.customer_id
  from b
  join public.transport_orders o on o.id = b.order_id
  left join public.customers c on c.id = o.customer_id
  left join public.locations pl on pl.id = b.pickup_location_id
  left join public.locations dl on dl.id = b.delivery_location_id
  left join public.vehicles v on v.id = b.vehicle_id
  left join public.warehouse_bins fb on fb.id = b.from_bin
  left join public.warehouse_bins tb on tb.id = b.to_bin
  where length(private.cont_key(p_container)) >= 3 or b.d between p_from and p_to
  order by b.d desc, b.kind2, coalesce(b.arrived_delivery_at, b.expected_delivery_at, b.pickup_at), b.shipment_code
$$;
revoke all on function public.stock_trips_by_date(date, date, text) from public, anon;
grant execute on function public.stock_trips_by_date(date, date, text) to authenticated;
