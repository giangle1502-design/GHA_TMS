-- =============================================================================
-- GHA TMS - 0006: Cấu hình động (trường, biểu mẫu, quy trình, bảng), thông báo,
--                 nhật ký hệ thống, cấu hình hệ thống
-- =============================================================================

-- Định nghĩa trường dữ liệu (trường hệ thống + trường động lưu trong custom_fields JSONB)
create table public.field_definitions (
  id uuid primary key default gen_random_uuid(),
  module text not null check (module ~ '^[a-z][a-z0-9_]*$'),
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label text not null,
  description text,
  field_kind text not null default 'business' check (field_kind in ('system', 'business', 'formula')),
  data_type text not null check (data_type in (
    'short_text', 'long_text', 'integer', 'decimal', 'currency', 'percent', 'date', 'datetime',
    'single_select', 'multi_select', 'boolean', 'email', 'phone', 'url', 'reference', 'formula',
    'file', 'image', 'gps')),
  is_required boolean not null default false,
  is_editable boolean not null default true,
  is_visible boolean not null default true,
  is_searchable boolean not null default false,
  is_filterable boolean not null default false,
  is_sortable boolean not null default false,
  default_value jsonb,
  display_format text,
  sort_order integer not null default 0,
  view_permission text references public.permissions (code),
  edit_permission text references public.permissions (code),
  validation jsonb not null default '{}'::jsonb,
  formula text,
  visibility_condition text,
  options jsonb not null default '[]'::jsonb,
  reference_target text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (module, field_key),
  check (data_type <> 'formula' or formula is not null),
  check (data_type <> 'reference' or reference_target is not null)
);

create table public.field_definition_versions (
  id bigint generated always as identity primary key,
  field_id uuid not null references public.field_definitions (id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  change_note text,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  unique (field_id, version)
);

create table public.form_definitions (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  code text not null unique,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  current_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.form_definitions (id) on delete cascade,
  version integer not null,
  layout jsonb not null,
  change_note text,
  published_by uuid,
  published_at timestamptz not null default now(),
  unique (form_id, version)
);

create table public.workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  entity_type text not null,
  approval_type_id uuid references public.approval_types (id),
  description text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  current_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflow_definitions (id) on delete cascade,
  version integer not null,
  definition jsonb not null,
  change_note text,
  published_by uuid,
  published_at timestamptz not null default now(),
  unique (workflow_id, version)
);

alter table public.approval_requests
  add constraint approval_requests_workflow_version_fk foreign key (workflow_version_id) references public.workflow_versions (id);

-- Cấu hình hiển thị bảng: hệ thống, theo vai trò, theo người dùng
create table public.table_view_preferences (
  id uuid primary key default gen_random_uuid(),
  table_key text not null check (table_key ~ '^[a-z][a-z0-9_.]*$'),
  scope text not null check (scope in ('system', 'role', 'user')),
  role_id uuid references public.roles (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  name text not null default 'Mặc định',
  is_default boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'system' and role_id is null and user_id is null)
    or (scope = 'role' and role_id is not null and user_id is null)
    or (scope = 'user' and user_id is not null and role_id is null)
  ),
  check (pg_column_size(config) < 65536)
);
create unique index table_view_pref_uq on public.table_view_preferences (
  table_key, scope, coalesce(role_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
create trigger trg_table_view_preferences_updated_at before update on public.table_view_preferences
for each row execute function private.set_updated_at();

-- Thông báo trong ứng dụng
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;

-- Nhật ký hệ thống (chỉ ghi thêm)
create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  changed_fields text[],
  reason text
);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, occurred_at desc);
create index audit_logs_time_idx on public.audit_logs (occurred_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, occurred_at desc);

-- Cấu hình hệ thống dạng key-value
create table public.system_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]*$'),
  value jsonb not null,
  description text,
  is_public boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['field_definitions', 'form_definitions', 'workflow_definitions'] loop
    perform private.attach_standard_triggers(('public.' || t)::regclass);
  end loop;
end $$;

-- Trường dữ liệu: mã không đổi, trường hệ thống không xóa, lưu phiên bản mỗi lần sửa
create or replace function private.guard_field_definitions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.field_kind = 'system' then
      raise exception 'Không được xóa trường hệ thống' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.field_key <> old.field_key or new.module <> old.module then
      raise exception 'Mã trường và module không được thay đổi' using errcode = '42501';
    end if;
    if old.field_kind = 'system' and (new.field_kind <> old.field_kind or new.data_type <> old.data_type) then
      raise exception 'Không được đổi loại của trường hệ thống' using errcode = '42501';
    end if;
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;
create trigger trg_field_definitions_guard before update or delete on public.field_definitions
for each row execute function private.guard_field_definitions();

create or replace function private.version_field_definitions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.field_definition_versions (field_id, version, snapshot, changed_by)
  values (new.id, new.version, to_jsonb(new), auth.uid());
  return new;
end;
$$;
create trigger trg_field_definitions_version after insert or update on public.field_definitions
for each row execute function private.version_field_definitions();

-- -----------------------------------------------------------------------------
-- Ghi nhật ký tự động cho bảng nghiệp vụ
-- -----------------------------------------------------------------------------
create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_j jsonb;
  new_j jsonb;
  changed text[];
  rid text;
begin
  if tg_op in ('UPDATE', 'DELETE') then old_j := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then new_j := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into changed
    from jsonb_object_keys(new_j) k
    where k not in ('updated_at', 'updated_by', 'version')
      and (old_j -> k) is distinct from (new_j -> k);
    if changed is null then
      return new; -- không có thay đổi thực sự
    end if;
  end if;

  -- Không ghi giá trị nhạy cảm vào nhật ký dạng rõ
  if tg_table_name = 'driver_sensitive' then
    old_j := case when old_j is null then null else jsonb_build_object('driver_id', old_j -> 'driver_id', 'redacted', true) end;
    new_j := case when new_j is null then null else jsonb_build_object('driver_id', new_j -> 'driver_id', 'redacted', true) end;
  end if;

  rid := coalesce(new_j, old_j) ->> 'id';
  if rid is null then
    rid := coalesce(new_j, old_j) ->> coalesce(tg_argv[0], 'id');
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data, changed_fields, reason)
  values (auth.uid(), lower(tg_op), tg_table_name, rid, old_j, new_j, changed,
          nullif(current_setting('gha.audit_reason', true), ''));
  return coalesce(new, old);
end;
$$;

do $$
declare t text; key_col text;
begin
  foreach t in array array[
    'profiles', 'roles', 'role_permissions', 'user_roles', 'user_permission_overrides', 'user_invitations',
    'catalogs', 'catalog_items', 'company_entities', 'banks', 'payment_methods', 'vehicle_types', 'salary_rules',
    'drivers', 'driver_sensitive', 'suppliers', 'customers', 'bank_accounts', 'vehicles', 'vehicle_financials', 'loan_schedules',
    'maintenance_records', 'locations', 'routes', 'transport_price_lists', 'expense_categories', 'fuel_support_rules',
    'transport_orders', 'shipments', 'shipment_assignments',
    'documents', 'approval_types', 'approval_rules', 'approval_requests', 'approval_steps', 'shipment_expenses',
    'advance_requests', 'advance_transactions', 'payments', 'receivables', 'payables',
    'field_definitions', 'form_definitions', 'form_versions', 'workflow_definitions', 'workflow_versions', 'system_settings'
  ] loop
    key_col := case t
      when 'role_permissions' then 'role_id'
      when 'user_roles' then 'user_id'
      when 'user_permission_overrides' then 'user_id'
      when 'driver_sensitive' then 'driver_id'
      when 'vehicle_financials' then 'vehicle_id'
      when 'system_settings' then 'key'
      else 'id' end;
    execute format('create trigger trg_%s_audit after insert or update or delete on public.%I for each row execute function private.audit_row_change(%L)', t, t, key_col);
  end loop;
end $$;

-- Nhật ký: không ai (kể cả Super Admin qua API) được sửa hoặc xóa
create or replace function private.block_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Nhật ký hệ thống không được sửa hoặc xóa' using errcode = '42501';
end;
$$;
create trigger trg_audit_logs_immutable before update or delete on public.audit_logs
for each row execute function private.block_audit_mutation();
revoke update, delete, truncate on public.audit_logs from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Thông báo: hàm tạo thông báo cho người dùng có quyền (dùng ở các giai đoạn sau)
-- -----------------------------------------------------------------------------
create or replace function private.notify_permission_holders(perm text, n_type text, n_title text, n_body text, n_entity_type text, n_entity_id uuid, n_link text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
  select distinct p.id, n_type, n_title, n_body, n_entity_type, n_entity_id, n_link
  from public.profiles p
  where p.status = 'active' and (
    exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p.id and r.code = 'super_admin')
    or exists (select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id = ur.role_id where ur.user_id = p.id and rp.permission_code = perm)
    or exists (select 1 from public.user_permission_overrides o where o.user_id = p.id and o.permission_code = perm and o.effect = 'grant')
  )
  and not exists (select 1 from public.user_permission_overrides o where o.user_id = p.id and o.permission_code = perm and o.effect = 'deny');
$$;

-- Thông báo cho người quản lý người dùng khi có tài khoản mới chờ cấp quyền
create or replace function private.notify_pending_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' then
    perform private.notify_permission_holders('users.update', 'user.pending', 'Tài khoản mới chờ cấp quyền',
      new.email || ' vừa đăng nhập và đang chờ cấp quyền.', 'profiles', new.id, '/nguoi-dung');
  end if;
  return new;
end;
$$;
create trigger trg_profiles_notify_pending after insert on public.profiles
for each row execute function private.notify_pending_profile();

-- Kích hoạt trigger tạo hồ sơ khi đăng nhập lần đầu
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function private.handle_new_auth_user();
