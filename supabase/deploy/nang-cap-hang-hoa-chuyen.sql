-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Hàng hóa (nhiều mã hàng) của chuyến
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.shipment_items') is not null then
    raise exception 'CSDL đã được nâng cấp Hàng hóa (nhiều mã hàng) của chuyến trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261030000027_shipment_items.sql
-- =============================================================================
-- 0027: Hàng hóa của chuyến (mã hàng, tên hàng, số lượng, ĐVT, ghi chú, cột bổ sung).
-- Nhiều dòng cho mỗi chuyến; ghi qua hàm set_shipment_items (thay toàn bộ danh sách).
-- =============================================================================

create table if not exists public.shipment_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  line_no smallint not null check (line_no between 1 and 500),
  item_code text check (item_code is null or length(item_code) <= 100),
  item_name text check (item_name is null or length(item_name) <= 300),
  quantity numeric(16, 3) check (quantity is null or quantity >= 0),
  unit text check (unit is null or length(unit) <= 30),
  note text check (note is null or length(note) <= 500),
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  updated_by uuid references public.profiles (id),
  unique (shipment_id, line_no)
);
comment on table public.shipment_items is 'Hàng hóa của chuyến: mỗi dòng một mã hàng';
select private.attach_standard_triggers('public.shipment_items');
alter table public.shipment_items enable row level security;
-- Xem được hàng hóa khi xem được chuyến (dựa vào chính sách của bảng shipments)
create policy shipment_items_select on public.shipment_items for select to authenticated
  using (exists (select 1 from public.shipments s where s.id = shipment_id));
revoke all on public.shipment_items from anon;
grant select on public.shipment_items to authenticated;

-- Cho phép trường bổ sung (cột riêng, cột công thức) cho bảng hàng hóa
create or replace function private.custom_field_table(p_module text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_module
    when 'vehicles' then 'vehicles'
    when 'drivers' then 'drivers'
    when 'customers' then 'customers'
    when 'suppliers' then 'suppliers'
    when 'locations' then 'locations'
    when 'shipments' then 'shipments'
    when 'transport_orders' then 'transport_orders'
    when 'vehicle_types' then 'vehicle_types'
    when 'routes' then 'routes'
    when 'price_lists' then 'transport_price_lists'
    when 'fuel_rules' then 'fuel_support_rules'
    when 'expense_categories' then 'expense_categories'
    when 'banks' then 'banks'
    when 'payment_methods' then 'payment_methods'
    when 'company_entities' then 'company_entities'
    when 'salary_rules' then 'salary_rules'
    when 'maintenance_records' then 'maintenance_records'
    when 'catalog_items' then 'catalog_items'
    when 'advances' then 'advance_requests'
    when 'expenses' then 'shipment_expenses'
    when 'payrolls' then 'driver_payrolls'
    when 'receivables' then 'receivables'
    when 'payables' then 'payables'
    when 'shipment_items' then 'shipment_items'
  end;
$$;

-- Thay toàn bộ danh sách hàng hóa của chuyến (dòng trống bị bỏ qua)
create or replace function public.set_shipment_items(p_shipment_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  it jsonb;
  n int := 0;
  v_code text; v_name text; v_qty numeric; v_unit text; v_note text; v_custom jsonb;
begin
  if not (private.has_perm('dispatch.create') or private.has_perm('dispatch.update')) then
    raise exception 'Bạn không có quyền nhập hàng hóa của chuyến' using errcode = '42501';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = '22023';
  end if;
  if s.status in ('closed', 'cancelled') then
    raise exception 'Chuyến đã đóng hoặc đã hủy, không sửa hàng hóa' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Danh sách hàng hóa không hợp lệ' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 500 then
    raise exception 'Mỗi chuyến tối đa 500 dòng hàng hóa' using errcode = '22023';
  end if;
  delete from public.shipment_items where shipment_id = s.id;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_code := nullif(trim(coalesce(it ->> 'item_code', '')), '');
    v_name := nullif(trim(coalesce(it ->> 'item_name', '')), '');
    v_qty := nullif(trim(coalesce(it ->> 'quantity', '')), '')::numeric;
    v_unit := nullif(trim(coalesce(it ->> 'unit', '')), '');
    v_note := nullif(trim(coalesce(it ->> 'note', '')), '');
    v_custom := case when jsonb_typeof(it -> 'custom_fields') = 'object' then it -> 'custom_fields' else '{}'::jsonb end;
    continue when v_code is null and v_name is null and v_qty is null and v_note is null and v_custom = '{}'::jsonb;
    n := n + 1;
    insert into public.shipment_items (shipment_id, line_no, item_code, item_name, quantity, unit, note, custom_fields)
    values (s.id, n, v_code, v_name, v_qty, v_unit, v_note, v_custom);
  end loop;
  return n;
exception
  when invalid_text_representation then
    raise exception 'Số lượng hàng hóa phải là số' using errcode = '22023';
end;
$$;
revoke all on function public.set_shipment_items(uuid, jsonb) from public, anon;
grant execute on function public.set_shipment_items(uuid, jsonb) to authenticated;

commit;
