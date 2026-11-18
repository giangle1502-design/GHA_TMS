-- =============================================================================
-- GHA 9021: HÌNH THỨC GIAO + HÀNG HÓA TRÊN APP TÀI XẾ (18/11/2026)
--   1. Chuyến có ô "Hình thức giao" (shipments.delivery_method): Pallet / Xá…
--      Lấy từ cột "Hình thức vận chuyển" của sheet COST CONT khi nhập đơn từ Excel,
--      sửa được ở chi tiết chuyến.
--   2. App tài xế đọc thêm hình thức giao + mã hàng, số lượng của chuyến
--      (driver_link_goods) để tài xế biết xuống hàng nhanh hay chậm.
--   Không xóa, không sửa dữ liệu có sẵn. Chạy lại nhiều lần không sao.
-- =============================================================================

alter table public.shipments add column if not exists delivery_method text
  check (delivery_method is null or char_length(delivery_method) <= 100);
comment on column public.shipments.delivery_method is
  'Hình thức giao (Pallet, Xá…): hiện trên app tài xế để biết thời gian xuống hàng nhanh hay chậm';

-- Hàng hóa + hình thức giao của các chuyến tài xế đang thấy (cùng phạm vi với driver_link_trips)
create or replace function public.driver_link_goods(p_token text)
returns table (shipment_id uuid, delivery_method text, items jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.delivery_method,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'item_code', si.item_code, 'item_name', si.item_name,
                    'quantity', si.quantity, 'unit', si.unit) order by si.line_no)
           from public.shipment_items si
           where si.shipment_id = s.id
         ), '[]'::jsonb)
  from private.driver_link_session(p_token) me
  join public.shipments s on private.driver_link_visible(me.vehicle_id, s)
  where s.status in ('assigned', 'accepted', 'in_transit')
     or (s.status in ('driver_completed', 'closed') and s.pickup_at > now() - interval '3 days');
$$;
revoke all on function public.driver_link_goods(text) from public;
grant execute on function public.driver_link_goods(text) to anon, authenticated;

notify pgrst, 'reload schema';
