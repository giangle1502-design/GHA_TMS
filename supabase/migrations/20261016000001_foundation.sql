-- =============================================================================
-- GHA TMS - 0001: Nền tảng (schema, extension, hàm tiện ích)
-- =============================================================================
-- Quy ước:
--   * Bảng nghiệp vụ nằm ở schema public (được PostgREST/Supabase API phục vụ, luôn bật RLS).
--   * Hàm nội bộ dùng trong RLS/trigger nằm ở schema private (không được API phục vụ).
--   * Tiền tệ: numeric(18,2) theo VND. Thời gian: timestamptz (hiển thị Asia/Ho_Chi_Minh).
--   * Không xóa cứng dữ liệu đã phát sinh giao dịch: dùng status / archived_at.
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Cập nhật updated_at tự động
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Ghi created_by / updated_by theo người dùng hiện tại (nếu có)
create or replace function private.set_actor_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

-- Gắn trigger updated_at + actor cho một bảng có các cột created_by, updated_by, updated_at
create or replace function private.attach_standard_triggers(tbl regclass)
returns void
language plpgsql
set search_path = ''
as $$
declare
  t text := tbl::text;
  n text := replace(replace(tbl::text, 'public.', ''), '"', '');
begin
  execute format('create trigger trg_%s_updated_at before update on %s for each row execute function private.set_updated_at()', n, t);
  execute format('create trigger trg_%s_actor before insert or update on %s for each row execute function private.set_actor_columns()', n, t);
end;
$$;

-- Bộ đếm mã chứng từ theo ngày, an toàn khi nhiều người cùng tạo (một câu lệnh, khóa dòng)
create table public.code_sequences (
  scope text not null,
  period text not null,
  last_value integer not null default 0,
  primary key (scope, period)
);
alter table public.code_sequences enable row level security;
-- Không có policy: chỉ hàm security definer mới truy cập được.

-- Sinh mã dạng PREFIX-YYYYMMDD-0001 theo ngày giờ Việt Nam
create or replace function private.next_code(prefix text, at_time timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d text := to_char(at_time at time zone 'Asia/Ho_Chi_Minh', 'YYYYMMDD');
  v integer;
begin
  insert into public.code_sequences as cs (scope, period, last_value)
  values (prefix, d, 1)
  on conflict (scope, period) do update set last_value = cs.last_value + 1
  returning last_value into v;
  return prefix || '-' || d || '-' || lpad(v::text, greatest(4, length(v::text)), '0');
end;
$$;
revoke all on function private.next_code(text, timestamptz) from public;
grant execute on function private.next_code(text, timestamptz) to authenticated, service_role;
