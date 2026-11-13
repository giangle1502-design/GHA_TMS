-- =============================================================================
-- GHA TMS - 0011: Giai đoạn 3 - danh mục, trường dữ liệu động, cấu hình bảng
--   * Tự sinh mã danh mục khi để trống (TX001, XE001, KH001...)
--   * Lưu cấu hình bảng theo người dùng (RPC save_table_view)
--   * Trường dữ liệu động: lịch sử phiên bản, khóa thuộc tính không được đổi,
--     phân tích ảnh hưởng trước khi sửa/xóa
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Mã danh mục tự sinh: PREFIX + số thứ tự 3 chữ số, bỏ qua mã đã nhập tay
-- -----------------------------------------------------------------------------
create or replace function private.fill_master_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prefix text := tg_argv[0];
  v integer;
  candidate text;
  taken boolean;
begin
  if new.code is not null and btrim(new.code) <> '' then
    new.code := upper(btrim(new.code));
    return new;
  end if;
  loop
    insert into public.code_sequences as cs (scope, period, last_value)
    values ('master:' || tg_table_name, 'all', 1)
    on conflict (scope, period) do update set last_value = cs.last_value + 1
    returning last_value into v;
    candidate := prefix || lpad(v::text, greatest(3, length(v::text)), '0');
    execute format('select exists (select 1 from %I.%I where code = $1)', tg_table_schema, tg_table_name)
      into taken using candidate;
    exit when not taken;
  end loop;
  new.code := candidate;
  return new;
end;
$$;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('vehicles', 'XE'), ('drivers', 'TX'), ('customers', 'KH'), ('suppliers', 'NCC'),
    ('locations', 'DD'), ('routes', 'TD'), ('transport_price_lists', 'BG'),
    ('expense_categories', 'CP'), ('vehicle_types', 'LX'), ('company_entities', 'DV')
  ) as t(tbl, prefix) loop
    execute format('alter table public.%I alter column code set default %L', r.tbl, '');
    execute format(
      'create trigger trg_%s_code before insert on public.%I for each row execute function private.fill_master_code(%L)',
      r.tbl, r.tbl, r.prefix);
  end loop;
end $$;

-- custom_fields luôn là object JSON
do $$
declare t text;
begin
  foreach t in array array['vehicles', 'drivers', 'customers', 'suppliers', 'locations', 'transport_orders', 'shipments'] loop
    execute format('alter table public.%I add constraint %I check (jsonb_typeof(custom_fields) = ''object'')', t, t || '_custom_fields_object');
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Cấu hình bảng theo người dùng
-- -----------------------------------------------------------------------------
create or replace function public.save_table_view(p_table_key text, p_config jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_active_user() then
    raise exception 'Tài khoản chưa được cấp quyền' using errcode = '42501';
  end if;
  if jsonb_typeof(p_config) <> 'object' then
    raise exception 'Cấu hình bảng không hợp lệ' using errcode = '22023';
  end if;
  update public.table_view_preferences
     set config = p_config
   where table_key = p_table_key and scope = 'user' and user_id = auth.uid() and name = 'Mặc định';
  if not found then
    insert into public.table_view_preferences (table_key, scope, user_id, name, is_default, config)
    values (p_table_key, 'user', auth.uid(), 'Mặc định', true, p_config);
  end if;
end;
$$;
revoke all on function public.save_table_view(text, jsonb) from public, anon;
grant execute on function public.save_table_view(text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Trường dữ liệu động
-- -----------------------------------------------------------------------------
-- Các module được phép thêm trường động và bảng tương ứng
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
  end;
$$;

-- Số bản ghi đang có giá trị cho một trường động
create or replace function private.custom_field_usage(p_module text, p_field_key text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tbl text := private.custom_field_table(p_module);
  n bigint;
begin
  if tbl is null then return 0; end if;
  execute format(
    'select count(*) from public.%I where custom_fields ? $1 and custom_fields -> $1 not in (''null''::jsonb, ''""''::jsonb, ''[]''::jsonb)',
    tbl) into n using p_field_key;
  return n;
end;
$$;

alter table public.field_definitions
  add constraint field_definitions_module_allowed check (private.custom_field_table(module) is not null);

create or replace function private.guard_field_definitions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  used bigint;
begin
  if tg_op = 'DELETE' then
    if old.field_kind = 'system' then
      raise exception 'Không được xóa trường hệ thống' using errcode = '42501';
    end if;
    used := private.custom_field_usage(old.module, old.field_key);
    if used > 0 then
      raise exception 'Trường "%" đang có dữ liệu ở % bản ghi. Hãy chuyển sang Ngừng sử dụng thay vì xóa.', old.label, used
        using errcode = '42501';
    end if;
    if exists (select 1 from public.field_definitions f
               where f.module = old.module and f.id <> old.id and f.status = 'active'
                 and f.formula ~ ('\m' || old.field_key || '\M')) then
      raise exception 'Trường "%" đang được dùng trong công thức của trường khác.', old.label using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.module <> old.module or new.field_key <> old.field_key then
      raise exception 'Không được đổi module hoặc mã trường sau khi tạo' using errcode = '42501';
    end if;
    if new.field_kind = 'system' or old.field_kind = 'system' then
      if new.data_type <> old.data_type or new.field_kind <> old.field_kind then
        raise exception 'Không được đổi kiểu của trường hệ thống' using errcode = '42501';
      end if;
    end if;
    if new.data_type <> old.data_type then
      used := private.custom_field_usage(old.module, old.field_key);
      if used > 0 then
        raise exception 'Không thể đổi kiểu dữ liệu: trường "%" đang có dữ liệu ở % bản ghi.', old.label, used
          using errcode = '42501';
      end if;
    end if;
    if (to_jsonb(new) - array['updated_at', 'updated_by', 'version']) is distinct from (to_jsonb(old) - array['updated_at', 'updated_by', 'version']) then
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;
  end if;
  return new;
end;
$$;
-- Thay thế trigger của 0006 (thêm kiểm tra dữ liệu đang dùng, chỉ tăng phiên bản khi nội dung đổi)
drop trigger if exists trg_field_definitions_guard on public.field_definitions;
drop trigger if exists trg_field_definitions_version on public.field_definitions;
drop function if exists private.version_field_definitions();
create trigger trg_field_definitions_guard before update or delete on public.field_definitions
for each row execute function private.guard_field_definitions();

-- Lưu ảnh chụp mỗi phiên bản (bảng phiên bản không mở ghi cho người dùng)
create or replace function private.snapshot_field_definition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into public.field_definition_versions (field_id, version, snapshot, change_note, changed_by)
    values (new.id, new.version, to_jsonb(new) - array['created_at', 'updated_at', 'created_by', 'updated_by'],
            nullif(current_setting('gha.change_note', true), ''), auth.uid());
  end if;
  return null;
end;
$$;
create trigger trg_field_definitions_snapshot after insert or update on public.field_definitions
for each row execute function private.snapshot_field_definition();

-- Ghi chú thay đổi cho phiên bản (đặt trong cùng transaction với câu lệnh sửa)
create or replace function public.save_field_definition(p_id uuid, p_values jsonb, p_change_note text default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_perm('fields.configure') then
    raise exception 'Bạn không có quyền cấu hình trường dữ liệu' using errcode = '42501';
  end if;
  perform set_config('gha.change_note', coalesce(p_change_note, ''), true);
  if p_id is null then
    insert into public.field_definitions (
      module, field_key, label, description, field_kind, data_type, is_required, is_editable, is_visible,
      is_searchable, is_filterable, is_sortable, default_value, display_format, sort_order,
      view_permission, edit_permission, validation, formula, options, reference_target, status)
    select r.module, r.field_key, r.label, r.description, coalesce(r.field_kind, 'business'), r.data_type,
           coalesce(r.is_required, false), coalesce(r.is_editable, true), coalesce(r.is_visible, true),
           coalesce(r.is_searchable, false), coalesce(r.is_filterable, false), coalesce(r.is_sortable, false),
           r.default_value, r.display_format, coalesce(r.sort_order, 0), r.view_permission, r.edit_permission,
           coalesce(r.validation, '{}'::jsonb), r.formula, coalesce(r.options, '[]'::jsonb), r.reference_target,
           coalesce(r.status, 'active')
    from jsonb_populate_record(null::public.field_definitions, p_values) r
    returning id into v_id;
  else
    update public.field_definitions f set
      label = r.label, description = r.description, data_type = r.data_type,
      is_required = coalesce(r.is_required, false), is_editable = coalesce(r.is_editable, true),
      is_visible = coalesce(r.is_visible, true), is_searchable = coalesce(r.is_searchable, false),
      is_filterable = coalesce(r.is_filterable, false), is_sortable = coalesce(r.is_sortable, false),
      default_value = r.default_value, display_format = r.display_format, sort_order = coalesce(r.sort_order, 0),
      view_permission = r.view_permission, edit_permission = r.edit_permission,
      validation = coalesce(r.validation, '{}'::jsonb), formula = r.formula, options = coalesce(r.options, '[]'::jsonb),
      reference_target = r.reference_target, status = coalesce(r.status, 'active')
    from jsonb_populate_record(null::public.field_definitions, p_values) r
    where f.id = p_id
    returning f.id into v_id;
    if v_id is null then
      raise exception 'Không tìm thấy trường dữ liệu' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_field_definition(uuid, jsonb, text) from public, anon;
grant execute on function public.save_field_definition(uuid, jsonb, text) to authenticated;

-- Phân tích ảnh hưởng trước khi sửa/ngừng/xóa trường
create or replace function public.field_impact(p_field_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  f public.field_definitions;
begin
  if not (private.has_perm('fields.view') or private.has_perm('fields.configure')) then
    raise exception 'Bạn không có quyền xem trường dữ liệu' using errcode = '42501';
  end if;
  select * into f from public.field_definitions where id = p_field_id;
  if not found then
    raise exception 'Không tìm thấy trường dữ liệu' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'records_with_value', private.custom_field_usage(f.module, f.field_key),
    'used_in_formulas', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'field_key', o.field_key) order by o.label)
      from public.field_definitions o
      where o.module = f.module and o.id <> f.id and o.formula ~ ('\m' || f.field_key || '\M')
    ), '[]'::jsonb),
    'used_in_visibility', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by o.label)
      from public.field_definitions o
      where o.module = f.module and o.id <> f.id and o.visibility_condition ~ ('\m' || f.field_key || '\M')
    ), '[]'::jsonb),
    -- Báo cáo và quy trình dùng trường động sẽ được kiểm tra khi các module đó hoàn thiện (GĐ6-7)
    'versions', (select count(*) from public.field_definition_versions v where v.field_id = f.id)
  );
end;
$$;
revoke all on function public.field_impact(uuid) from public, anon;
grant execute on function public.field_impact(uuid) to authenticated;

-- Khôi phục một phiên bản cũ (tạo phiên bản mới với nội dung cũ)
create or replace function public.restore_field_version(p_field_id uuid, p_version integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  snap jsonb;
begin
  if not private.has_perm('fields.configure') then
    raise exception 'Bạn không có quyền cấu hình trường dữ liệu' using errcode = '42501';
  end if;
  select snapshot into snap from public.field_definition_versions where field_id = p_field_id and version = p_version;
  if snap is null then
    raise exception 'Không tìm thấy phiên bản' using errcode = 'P0002';
  end if;
  perform public.save_field_definition(p_field_id, snap, 'Khôi phục phiên bản ' || p_version);
end;
$$;
revoke all on function public.restore_field_version(uuid, integer) from public, anon;
grant execute on function public.restore_field_version(uuid, integer) to authenticated;
