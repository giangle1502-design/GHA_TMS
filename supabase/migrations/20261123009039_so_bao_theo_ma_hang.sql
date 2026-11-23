-- =============================================================================
-- GHA 9039: Số bao chỉ tự chia theo thiết lập của mã hàng (LE 23/11/2026)
--   Lỗi: phiếu SNOV-0077, mã ENI1998SS 5,500 KG in 200 bao (đúng 5,500 ÷ 25 = 220).
--   Nguyên nhân: ô Số bao của dòng hàng được điền sẵn số đọc từ ảnh biên bản / dán Excel,
--   số đó được ưu tiên hơn số tự tính.
--   Từ bản này:
--     * Mã hàng có trong danh mục và có Số KG/bao: Số bao = Số lượng quy ra KG ÷ Số KG/bao (luôn luôn,
--       bỏ qua số nhập tay). ĐVT là BAO thì Số bao = Số lượng.
--     * Mã hàng chưa có trong danh mục, ĐVT KG: tạm tính 25 kg/bao.
--     * Chỉ dòng không tính được (ĐVT khác, mã ngoài danh mục) mới dùng số bao nhập tay.
--   Dữ liệu cũ: xóa số bao nhập tay của các dòng hàng tính được tự động (sao lưu trước vào
--   private.backup_9039_bag_count, lấy lại được).
-- Chạy một lần trong Supabase SQL Editor. Chạy lại không sao.
-- =============================================================================

-- Số bao tự tính theo mã hàng; null khi không tính được
create or replace function private.item_auto_bag_count(p_item public.shipment_items)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(case
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
  end
  -- Mã hàng chưa có trong danh mục, ĐVT KG: tạm tính 25 kg/bao (Số KG/bao mặc định)
  , case
    when p_item.quantity is not null
     and upper(trim(coalesce(p_item.unit, ''))) = 'KG'
     and p_item.product_id is null
     and not exists (select 1 from public.products p
                     where p_item.item_code is not null and upper(trim(p.code)) = upper(trim(p_item.item_code)))
    then round(p_item.quantity / 25, 2)
  end);
$$;
revoke all on function private.item_auto_bag_count(public.shipment_items) from public, anon, authenticated;

-- Số bao của một dòng hàng: tự tính theo mã hàng > nhập tay (chỉ khi không tự tính được)
create or replace function private.item_bag_count(p_item public.shipment_items)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.item_auto_bag_count(p_item), p_item.bag_count);
$$;
revoke all on function private.item_bag_count(public.shipment_items) from public, anon, authenticated;

-- Sao lưu rồi xóa số bao nhập tay của các dòng tính được tự động
create table if not exists private.backup_9039_bag_count (
  item_id uuid primary key,
  shipment_id uuid,
  item_code text,
  quantity numeric,
  unit text,
  bag_count numeric,
  auto_bag_count numeric,
  backed_up_at timestamptz not null default now()
);

insert into private.backup_9039_bag_count (item_id, shipment_id, item_code, quantity, unit, bag_count, auto_bag_count)
select i.id, i.shipment_id, i.item_code, i.quantity, i.unit, i.bag_count, private.item_auto_bag_count(i)
from public.shipment_items i
where i.bag_count is not null and private.item_auto_bag_count(i) is not null
on conflict (item_id) do nothing;

-- Chỉ sửa cột số bao: tạm tắt trigger đồng bộ kho để không tính lại phiếu kho
alter table public.shipment_items disable trigger trg_shipment_items_stock_sync;
update public.shipment_items i
set bag_count = null
where i.bag_count is not null and private.item_auto_bag_count(i) is not null;
alter table public.shipment_items enable trigger trg_shipment_items_stock_sync;
