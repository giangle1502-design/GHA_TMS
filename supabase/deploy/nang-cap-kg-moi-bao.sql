-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Số KG/bao trong danh mục mã hàng, số bao trên phiếu = số lượng KG ÷ số KG/bao
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'kg_per_bag') then
    raise exception 'CSDL đã được nâng cấp Số KG/bao trong danh mục mã hàng, số bao trên phiếu = số lượng KG ÷ số KG/bao trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261116009015_kg_moi_bao.sql
-- =============================================================================
-- GHA 9015: Số KG/bao trong danh mục mã hàng (LE 16/11/2026)
--   * products.kg_per_bag: số kg trong một bao. Mặc định 25; riêng PETYSY01 = 1150. Sửa được trong Danh mục mã hàng.
--   * Số bao trên phiếu giao hàng (khi ô Số bao ở dòng hàng để trống)
--       = Số lượng quy ra KG ÷ Số KG/bao của mã hàng
--     (ĐVT KG: lấy số lượng; ĐVT khác: số lượng × Quy đổi kg/đơn vị; ĐVT BAO: số bao = số lượng).
--   * Bỏ cách tính theo Quy cách đóng gói của bản 9014.
-- Chỉ thêm cột và điền số KG/bao cho mã hàng có sẵn; không sửa dữ liệu khác.
-- =============================================================================

alter table public.products
  add column if not exists kg_per_bag numeric(14,3) default 25 check (kg_per_bag is null or kg_per_bag > 0);
comment on column public.products.kg_per_bag is 'Số kg trong 1 bao (tính số bao trên phiếu giao hàng). Mặc định 25';

update public.products set kg_per_bag = 1150 where upper(trim(code)) = 'PETYSY01';
update public.products set kg_per_bag = 25 where kg_per_bag is null;

-- Số bao của một dòng hàng: nhập tay > ĐVT bao > số lượng (KG) ÷ Số KG/bao. Null khi không tính được
create or replace function private.item_bag_count(p_item public.shipment_items)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_item.bag_count is not null then p_item.bag_count
    when p_item.quantity is null then null
    when upper(trim(coalesce(p_item.unit, ''))) in ('BAO', 'BAG', 'BAGS') then p_item.quantity
    else (
      select round(p_item.quantity
                   * case when upper(trim(coalesce(nullif(p_item.unit, ''), p.unit))) = 'KG' then 1 else p.kg_per_unit end
                   / p.kg_per_bag, 2)
      from public.products p
      where p.kg_per_bag > 0
        and (p.id = p_item.product_id
             or (p_item.product_id is null and p_item.item_code is not null and upper(trim(p.code)) = upper(trim(p_item.item_code))))
      order by (p.id = p_item.product_id) desc nulls last
      limit 1)
  end;
$$;
revoke all on function private.item_bag_count(public.shipment_items) from public, anon, authenticated;

commit;
