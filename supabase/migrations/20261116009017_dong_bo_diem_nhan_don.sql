-- =============================================================================
-- GHA 9017: ĐỒNG BỘ ĐIỂM NHẬN / ĐIỂM GIAO CỦA ĐƠN THEO CHUYẾN
--   * Đơn cha (transport_orders) có bản sao điểm nhận / điểm giao riêng (từ dữ liệu cũ
--     và lúc dán từ Excel). Sửa điểm trên chuyến không cập nhật bản sao này nên đơn và
--     chuyến lệch nhau (VD chuyến SNOV-0004: sửa Cát Lái → SP-ITC).
--   * Từ nay: mỗi khi thêm chuyến, sửa điểm nhận / điểm giao hoặc hủy chuyến, đơn cha tự
--     lấy lại điểm chung của các chuyến còn hiệu lực (các chuyến khác tuyến nhau thì để trống,
--     giống lúc dán Excel). Đơn không còn chuyến nào hiệu lực thì giữ nguyên.
--   * Chạy một lần: sửa lại các đơn đang lệch.
--   App tài xế, bảng kê, phiếu giao hàng vẫn đọc điểm trên CHUYẾN như trước.
-- =============================================================================

create or replace function private.order_route_from_shipments(p_order_id uuid)
returns table (pickup_location_id uuid, delivery_location_id uuid, active_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(distinct s.pickup_location_id) = 1 then (array_agg(s.pickup_location_id))[1] end,
         case when count(distinct s.delivery_location_id) = 1 then (array_agg(s.delivery_location_id))[1] end,
         count(*)
  from public.shipments s
  where s.order_id = p_order_id and s.status <> 'cancelled';
$$;

create or replace function private.sync_order_route()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select * into r from private.order_route_from_shipments(new.order_id);
  if r.active_count > 0 then
    update public.transport_orders o
       set pickup_location_id = r.pickup_location_id,
           delivery_location_id = r.delivery_location_id
     where o.id = new.order_id
       and (o.pickup_location_id, o.delivery_location_id) is distinct from (r.pickup_location_id, r.delivery_location_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_shipments_sync_order_route on public.shipments;
create trigger trg_shipments_sync_order_route
after insert or update of pickup_location_id, delivery_location_id, status, order_id on public.shipments
for each row execute function private.sync_order_route();

-- Sửa một lần các đơn đang lệch (chỉ đơn đã có bản sao điểm, tức dữ liệu cũ / dán Excel)
do $$
declare
  n integer := 0;
  o record;
  r record;
begin
  for o in
    select t.id, t.pickup_location_id, t.delivery_location_id
    from public.transport_orders t
    where t.pickup_location_id is not null or t.delivery_location_id is not null
  loop
    select * into r from private.order_route_from_shipments(o.id);
    if r.active_count > 0
       and (o.pickup_location_id, o.delivery_location_id) is distinct from (r.pickup_location_id, r.delivery_location_id) then
      update public.transport_orders
         set pickup_location_id = r.pickup_location_id,
             delivery_location_id = r.delivery_location_id
       where id = o.id;
      n := n + 1;
    end if;
  end loop;
  raise notice 'Đã đồng bộ điểm nhận / điểm giao cho % đơn', n;
end;
$$;
