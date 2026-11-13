-- =============================================================================
-- GHA TMS - 0002: Người dùng, vai trò, quyền (RBAC) và lời mời truy cập
-- =============================================================================
-- Nguyên tắc:
--   * Đăng nhập Google qua Supabase Auth chỉ tạo hồ sơ ở trạng thái "pending".
--     Chỉ email đã được quản trị viên mời (user_invitations) mới được kích hoạt.
--   * Quyền = hợp của quyền theo vai trò + quyền cấp riêng (grant), trừ quyền bị chặn riêng (deny).
--   * Vai trò super_admin có toàn quyền; chỉ super_admin mới cấp/thu hồi được super_admin.
--   * Không ai tự thay đổi vai trò, quyền hay trạng thái của chính mình.
-- =============================================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique check (email = lower(email)),
  full_name text,
  avatar_url text,
  phone text,
  status text not null default 'pending' check (status in ('pending', 'active', 'disabled')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.profiles is 'Hồ sơ người dùng (1-1 với auth.users).';

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null,
  description text,
  is_system boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

create table public.permissions (
  code text primary key check (code ~ '^[a-z_]+\.[a-z_]+$'),
  module text not null,
  action text not null,
  name text not null,
  description text,
  sort_order integer not null default 0
);

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_code text not null references public.permissions (code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_code)
);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete restrict,
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table public.user_permission_overrides (
  user_id uuid not null references public.profiles (id) on delete cascade,
  permission_code text not null references public.permissions (code) on delete cascade,
  effect text not null check (effect in ('grant', 'deny')),
  reason text,
  granted_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (user_id, permission_code)
);

create table public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and email like '%@%'),
  role_codes text[] not null default '{}',
  driver_id uuid, -- FK thêm ở migration danh mục
  note text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references public.profiles (id),
  accepted_user_id uuid references public.profiles (id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
create unique index user_invitations_pending_email_uq on public.user_invitations (email) where status = 'pending';

select private.attach_standard_triggers('public.profiles');
select private.attach_standard_triggers('public.roles');
select private.attach_standard_triggers('public.user_invitations');

create index user_roles_role_idx on public.user_roles (role_id);
create index role_permissions_perm_idx on public.role_permissions (permission_code);

-- -----------------------------------------------------------------------------
-- Hàm kiểm tra quyền (dùng trong RLS, trigger và server)
-- -----------------------------------------------------------------------------
create or replace function private.is_system_op()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.uid() is null or coalesce(current_setting('gha.system_op', true), '') = 'on';
$$;
grant execute on function private.is_system_op() to authenticated, service_role;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active');
$$;

create or replace function private.is_super_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = uid and r.code = 'super_admin' and p.status = 'active'
  );
$$;

create or replace function private.has_perm(perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user() and (
    private.is_super_admin()
    or (
      not exists (
        select 1 from public.user_permission_overrides o
        where o.user_id = auth.uid() and o.permission_code = perm and o.effect = 'deny'
      )
      and (
        exists (
          select 1 from public.user_permission_overrides o
          where o.user_id = auth.uid() and o.permission_code = perm and o.effect = 'grant'
        )
        or exists (
          select 1
          from public.user_roles ur
          join public.role_permissions rp on rp.role_id = ur.role_id
          where ur.user_id = auth.uid() and rp.permission_code = perm
        )
      )
    )
  );
$$;

grant execute on function private.is_active_user() to authenticated, service_role;
grant execute on function private.is_super_admin(uuid) to authenticated, service_role;
grant execute on function private.has_perm(text) to authenticated, service_role;

-- RPC cho giao diện: danh sách quyền hiệu lực của chính người gọi
create or replace function public.my_permissions()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select p.code from public.permissions p
  where private.has_perm(p.code)
  order by p.code;
$$;
revoke all on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

-- -----------------------------------------------------------------------------
-- Lời mời: kích hoạt người dùng theo email đã được cho phép
-- -----------------------------------------------------------------------------
create or replace function private.apply_invitation(inv_id uuid, uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.user_invitations;
begin
  select * into inv from public.user_invitations where id = inv_id and status = 'pending' for update;
  if not found then
    return;
  end if;

  -- Đánh dấu thao tác hệ thống để trigger bảo vệ cho phép (chỉ trong phạm vi hàm này)
  perform set_config('gha.system_op', 'on', true);

  insert into public.user_roles (user_id, role_id, granted_by)
  select uid, r.id, inv.invited_by from public.roles r where r.code = any (inv.role_codes)
  on conflict do nothing;

  update public.profiles set status = 'active' where id = uid and status = 'pending';

  if inv.driver_id is not null then
    update public.drivers set profile_id = uid where id = inv.driver_id and profile_id is null;
  end if;

  update public.user_invitations
     set status = 'accepted', accepted_user_id = uid, accepted_at = now()
   where id = inv.id;

  perform set_config('gha.system_op', '', true);
end;
$$;

-- Trigger trên auth.users: tạo hồ sơ khi người dùng đăng nhập lần đầu
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv_id uuid;
  em text := lower(coalesce(new.email, ''));
begin
  if em = '' then
    return new;
  end if;

  insert into public.profiles (id, email, full_name, avatar_url, status)
  values (
    new.id,
    em,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    'pending'
  )
  on conflict (id) do nothing;

  select id into inv_id from public.user_invitations where email = em and status = 'pending' limit 1;
  if inv_id is not null then
    perform private.apply_invitation(inv_id, new.id);
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
  values (new.id, 'auth.first_sign_in', 'profiles', new.id::text,
          jsonb_build_object('email', em, 'invited', inv_id is not null));
  return new;
end;
$$;

-- RPC: mời / cấp quyền truy cập cho một email (dùng từ màn hình Người dùng và phân quyền)
create or replace function public.invite_user(p_email text, p_role_codes text[], p_driver_id uuid default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  em text := lower(trim(p_email));
  existing_uid uuid;
  inv_id uuid;
begin
  if not private.has_perm('users.create') then
    raise exception 'Bạn không có quyền mời người dùng' using errcode = '42501';
  end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email không hợp lệ' using errcode = '22023';
  end if;
  if coalesce(array_length(p_role_codes, 1), 0) = 0 then
    raise exception 'Phải chọn ít nhất một vai trò' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_role_codes) c where c not in (select code from public.roles)) then
    raise exception 'Vai trò không tồn tại' using errcode = '22023';
  end if;
  if 'super_admin' = any (p_role_codes) and not private.is_super_admin() then
    raise exception 'Chỉ Super Admin mới cấp được vai trò Super Admin' using errcode = '42501';
  end if;

  update public.user_invitations set status = 'revoked' where email = em and status = 'pending';

  insert into public.user_invitations (email, role_codes, driver_id, note, invited_by)
  values (em, p_role_codes, p_driver_id, p_note, auth.uid())
  returning id into inv_id;

  select id into existing_uid from public.profiles where email = em;
  if existing_uid is not null then
    if existing_uid = auth.uid() then
      raise exception 'Không được tự cấp quyền cho chính mình' using errcode = '42501';
    end if;
    perform private.apply_invitation(inv_id, existing_uid);
  end if;
  return inv_id;
end;
$$;
revoke all on function public.invite_user(text, text[], uuid, text) from public, anon;
grant execute on function public.invite_user(text, text[], uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Chống leo thang đặc quyền
-- -----------------------------------------------------------------------------
create or replace function private.guard_user_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.user_id, old.user_id);
  rid uuid := coalesce(new.role_id, old.role_id);
begin
  if private.is_system_op() then
    return coalesce(new, old); -- thao tác hệ thống (SQL editor / service role / hàm nội bộ)
  end if;
  if target = auth.uid() then
    raise exception 'Không được tự thay đổi vai trò của chính mình' using errcode = '42501';
  end if;
  if (select code from public.roles where id = rid) = 'super_admin' and not private.is_super_admin() then
    raise exception 'Chỉ Super Admin mới cấp/thu hồi được vai trò Super Admin' using errcode = '42501';
  end if;
  if private.is_super_admin(target) and not private.is_super_admin() then
    raise exception 'Không được thay đổi vai trò của Super Admin' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.granted_by := auth.uid();
    new.granted_at := now();
  end if;
  return coalesce(new, old);
end;
$$;
create trigger trg_user_roles_guard before insert or update or delete on public.user_roles
for each row execute function private.guard_user_roles();

create or replace function private.guard_permission_overrides()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.user_id, old.user_id);
begin
  if private.is_system_op() then
    return coalesce(new, old);
  end if;
  if target = auth.uid() then
    raise exception 'Không được tự thay đổi quyền của chính mình' using errcode = '42501';
  end if;
  if private.is_super_admin(target) and not private.is_super_admin() then
    raise exception 'Không được thay đổi quyền của Super Admin' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' then
    new.granted_by := auth.uid();
  end if;
  return coalesce(new, old);
end;
$$;
create trigger trg_user_perm_overrides_guard before insert or update or delete on public.user_permission_overrides
for each row execute function private.guard_permission_overrides();

create or replace function private.guard_profiles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_system_op() then
    return new;
  end if;
  if new.id <> old.id or new.email <> old.email then
    raise exception 'Không được đổi mã hoặc email người dùng' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if new.id = auth.uid() then
      raise exception 'Không được tự đổi trạng thái tài khoản của chính mình' using errcode = '42501';
    end if;
    if not private.has_perm('users.update') then
      raise exception 'Bạn không có quyền đổi trạng thái tài khoản' using errcode = '42501';
    end if;
    if private.is_super_admin(new.id) and not private.is_super_admin() then
      raise exception 'Không được đổi trạng thái của Super Admin' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_profiles_guard before update on public.profiles
for each row execute function private.guard_profiles();

create or replace function private.guard_system_roles()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.is_system then
    raise exception 'Không được xóa vai trò hệ thống' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.is_system and new.code <> old.code then
    raise exception 'Không được đổi mã vai trò hệ thống' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger trg_roles_guard before update or delete on public.roles
for each row execute function private.guard_system_roles();

-- Chỉ Super Admin được sửa quyền của vai trò super_admin / admin
create or replace function private.guard_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and (select code from public.roles where id = coalesce(new.role_id, old.role_id)) in ('super_admin', 'admin')
     and not private.is_super_admin() then
    raise exception 'Chỉ Super Admin được sửa quyền của vai trò Admin' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger trg_role_permissions_guard before insert or update or delete on public.role_permissions
for each row execute function private.guard_role_permissions();

-- -----------------------------------------------------------------------------
-- Dữ liệu tham chiếu bắt buộc (vai trò & quyền) - cần có ở mọi môi trường
-- -----------------------------------------------------------------------------
insert into public.roles (code, name, description, is_system, sort_order) values
  ('super_admin', 'Super Admin', 'Toàn quyền hệ thống, quản lý Admin', true, 1),
  ('admin', 'Admin', 'Quản trị hệ thống và dữ liệu', true, 2),
  ('director', 'Giám đốc', 'Xem toàn bộ, phê duyệt', true, 3),
  ('dispatcher', 'Điều phối', 'Tạo đơn, phân công chuyến', true, 4),
  ('accountant', 'Kế toán', 'Chi phí, ứng tiền, quyết toán, công nợ, thanh toán', true, 5),
  ('ops_manager', 'Quản lý vận hành', 'Quản lý xe, tài xế, chuyến, duyệt vận hành', true, 6),
  ('driver', 'Tài xế', 'Ứng dụng tài xế: chỉ chuyến được phân công', true, 7),
  ('report_viewer', 'Người chỉ xem báo cáo', 'Chỉ xem dashboard và báo cáo', true, 8);

with modules (module, module_name, actions, ord) as (
  values
    ('dashboard', 'Tổng quan', array['view'], 1),
    ('dispatch', 'Điều phối', array['view', 'create', 'update', 'delete'], 2),
    ('shipments', 'Chuyến xe', array['view', 'create', 'update', 'delete', 'export'], 3),
    ('drivers', 'Tài xế', array['view', 'create', 'update', 'delete', 'export', 'view_sensitive'], 4),
    ('vehicles', 'Phương tiện', array['view', 'create', 'update', 'delete', 'export', 'view_sensitive'], 5),
    ('customers', 'Khách hàng', array['view', 'create', 'update', 'delete', 'export'], 6),
    ('locations', 'Địa điểm', array['view', 'create', 'update', 'delete', 'export'], 7),
    ('price_lists', 'Bảng giá', array['view', 'create', 'update', 'delete', 'export'], 8),
    ('expenses', 'Chi phí chuyến', array['view', 'create', 'update', 'delete', 'approve', 'export'], 9),
    ('advances', 'Ứng tiền', array['view', 'create', 'update', 'delete', 'approve', 'pay', 'export'], 10),
    ('settlements', 'Quyết toán', array['view', 'update', 'approve', 'export'], 11),
    ('receivables', 'Công nợ', array['view', 'create', 'update', 'delete', 'pay', 'export'], 12),
    ('payments', 'Thanh toán', array['view', 'create', 'delete', 'export'], 13),
    ('approvals', 'Phê duyệt', array['view', 'approve', 'configure'], 14),
    ('reports', 'Báo cáo', array['view', 'export'], 15),
    ('catalogs', 'Danh mục hệ thống', array['view', 'create', 'update', 'delete'], 16),
    ('fields', 'Trường dữ liệu', array['view', 'configure'], 17),
    ('forms', 'Biểu mẫu', array['view', 'configure'], 18),
    ('workflows', 'Quy trình', array['view', 'configure'], 19),
    ('users', 'Người dùng và phân quyền', array['view', 'create', 'update', 'configure'], 20),
    ('audit_logs', 'Nhật ký hệ thống', array['view', 'export'], 21),
    ('settings', 'Cấu hình', array['view', 'configure'], 22),
    ('documents', 'Chứng từ', array['view', 'create', 'delete', 'view_sensitive'], 23),
    ('driver_app', 'Ứng dụng tài xế', array['use'], 24)
),
action_names (action, action_name, ord) as (
  values ('view', 'Xem', 1), ('create', 'Tạo', 2), ('update', 'Sửa', 3), ('delete', 'Xóa/Hủy', 4),
         ('approve', 'Duyệt', 5), ('pay', 'Thanh toán', 6), ('export', 'Xuất dữ liệu', 7),
         ('configure', 'Cấu hình', 8), ('view_sensitive', 'Xem trường nhạy cảm', 9), ('use', 'Sử dụng', 10)
)
insert into public.permissions (code, module, action, name, sort_order)
select m.module || '.' || a.action, m.module, a.action, a.action_name || ' - ' || m.module_name, m.ord * 100 + a.ord
from modules m
cross join lateral unnest(m.actions) as act(action)
join action_names a on a.action = act.action;

-- Gán quyền mặc định cho vai trò (super_admin có toàn quyền ngầm định, không cần gán)
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on (
  (r.code = 'admin' and p.module <> 'driver_app')
  or (r.code = 'director' and (
        p.action in ('view', 'export', 'approve', 'view_sensitive')
        and p.module not in ('driver_app')
  ))
  or (r.code = 'dispatcher' and p.code = any (array[
        'dashboard.view', 'dispatch.view', 'dispatch.create', 'dispatch.update', 'dispatch.delete',
        'shipments.view', 'shipments.create', 'shipments.update', 'shipments.delete', 'shipments.export',
        'drivers.view', 'vehicles.view', 'customers.view', 'customers.create', 'customers.update',
        'locations.view', 'locations.create', 'locations.update', 'price_lists.view',
        'expenses.view', 'expenses.create', 'advances.view', 'approvals.view',
        'documents.view', 'documents.create', 'catalogs.view', 'reports.view']))
  or (r.code = 'accountant' and p.code = any (array[
        'dashboard.view', 'shipments.view', 'shipments.update', 'shipments.export',
        'drivers.view', 'drivers.view_sensitive', 'vehicles.view', 'vehicles.view_sensitive',
        'customers.view', 'customers.create', 'customers.update', 'customers.export',
        'locations.view', 'price_lists.view', 'price_lists.create', 'price_lists.update', 'price_lists.delete', 'price_lists.export',
        'expenses.view', 'expenses.create', 'expenses.update', 'expenses.delete', 'expenses.approve', 'expenses.export',
        'advances.view', 'advances.create', 'advances.update', 'advances.approve', 'advances.pay', 'advances.export',
        'settlements.view', 'settlements.update', 'settlements.approve', 'settlements.export',
        'receivables.view', 'receivables.create', 'receivables.update', 'receivables.delete', 'receivables.pay', 'receivables.export',
        'payments.view', 'payments.create', 'payments.delete', 'payments.export',
        'approvals.view', 'approvals.approve', 'reports.view', 'reports.export',
        'documents.view', 'documents.create', 'documents.view_sensitive',
        'catalogs.view', 'catalogs.create', 'catalogs.update']))
  or (r.code = 'ops_manager' and p.code = any (array[
        'dashboard.view', 'dispatch.view', 'dispatch.create', 'dispatch.update', 'dispatch.delete',
        'shipments.view', 'shipments.create', 'shipments.update', 'shipments.delete', 'shipments.export',
        'drivers.view', 'drivers.create', 'drivers.update', 'drivers.export',
        'vehicles.view', 'vehicles.create', 'vehicles.update', 'vehicles.export',
        'customers.view', 'locations.view', 'locations.create', 'locations.update', 'price_lists.view',
        'expenses.view', 'expenses.create', 'expenses.approve', 'advances.view', 'advances.approve',
        'approvals.view', 'approvals.approve', 'reports.view', 'reports.export',
        'documents.view', 'documents.create', 'catalogs.view']))
  or (r.code = 'driver' and p.code = any (array['driver_app.use', 'documents.create']))
  or (r.code = 'report_viewer' and p.code = any (array['dashboard.view', 'reports.view', 'reports.export']))
);
