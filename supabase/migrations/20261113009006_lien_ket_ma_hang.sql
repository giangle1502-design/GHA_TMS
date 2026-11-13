-- =============================================================================
-- 9006: Liên kết dòng hàng hóa với Danh mục mã hàng theo Mã hàng
--  - Dòng hàng (của đơn / của chuyến) có Mã hàng trùng mã trong danh mục thì tự gắn product_id
--  - ĐVT luôn theo thiết lập của mã hàng; Tên hàng trống thì lấy tên trong danh mục; tự quy ra kg
--  - Gắn lại các dòng đã nhập tay trước đây (chỉ dòng chưa gắn mã hàng)
-- =============================================================================
create or replace function private.fill_item_from_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.products;
begin
  if new.product_id is null and nullif(trim(new.item_code), '') is not null then
    select * into p from public.products where upper(code) = upper(trim(new.item_code)) order by (status = 'active') desc limit 1;
    new.product_id := p.id;
  elsif new.product_id is not null then
    select * into p from public.products where id = new.product_id;
  end if;
  if p.id is not null then
    new.item_code := p.code;
    new.item_name := coalesce(nullif(trim(new.item_name), ''), p.name);
    new.unit := p.unit;
    if tg_table_name = 'shipment_items' and new.weight_kg is null and p.kg_per_unit is not null and new.quantity is not null then
      new.weight_kg := round(new.quantity * p.kg_per_unit, 3);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_items_product on public.transport_order_items;
create trigger trg_order_items_product before insert or update of product_id, item_code, unit, quantity on public.transport_order_items
  for each row execute function private.fill_item_from_product();
drop trigger if exists trg_shipment_items_product on public.shipment_items;
create trigger trg_shipment_items_product before insert or update of product_id, item_code, unit, quantity on public.shipment_items
  for each row execute function private.fill_item_from_product();

-- Gắn mã hàng cho các dòng nhập tay trước đây (không đụng dòng đã gắn)
update public.transport_order_items set item_code = item_code
where product_id is null and exists (select 1 from public.products p where upper(p.code) = upper(trim(item_code)));
update public.shipment_items set item_code = item_code
where product_id is null and exists (select 1 from public.products p where upper(p.code) = upper(trim(item_code)));
