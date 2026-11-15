-- =============================================================================
-- 9010: Tên gọi khác (alias) cho "Dán từ Excel"
--  - Bảng theo dõi hàng của GHA ghi tên địa điểm / khách / mã hàng không theo tên chuẩn
--    (VD "SP-ITC", "SPITC", "SP - ITC", "KNQ LONG BINH"). KHÔNG thêm các tên đó vào danh mục.
--  - Khi người dùng chọn tay "tên trong Excel → địa điểm chuẩn", phần mềm ghi nhớ ở đây
--    để lần dán sau tự ghép. Xóa/đổi lại được ở màn hình Dán từ Excel.
--  - alias_key: tên đã bỏ dấu, bỏ ký tự đặc biệt, chữ thường (do ứng dụng tính).
-- =============================================================================
create table if not exists public.name_aliases (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('location', 'customer', 'product')),
  alias text not null check (length(trim(alias)) between 1 and 300),
  alias_key text not null check (alias_key ~ '^[a-z0-9]{1,300}$'),
  target_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (kind, alias_key)
);
comment on table public.name_aliases is 'Tên gọi khác trong file Excel → địa điểm / khách hàng / mã hàng chuẩn (dùng khi Dán từ Excel)';
create index if not exists name_aliases_target_idx on public.name_aliases (kind, target_id);

alter table public.name_aliases enable row level security;
drop policy if exists name_aliases_select on public.name_aliases;
create policy name_aliases_select on public.name_aliases for select to authenticated
  using ((select private.has_perm('dispatch.create')) or (select private.has_perm('dispatch.view')));
drop policy if exists name_aliases_write on public.name_aliases;
create policy name_aliases_write on public.name_aliases for all to authenticated
  using ((select private.has_perm('dispatch.create')))
  with check ((select private.has_perm('dispatch.create')));
revoke all on public.name_aliases from anon;
grant select, insert, update, delete on public.name_aliases to authenticated;

-- Tìm chuyến theo số cont (cảnh báo dán trùng)
create index if not exists shipments_container_no_idx on public.shipments (container_no) where container_no is not null;
