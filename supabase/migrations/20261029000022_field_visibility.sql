-- =============================================================================
-- KHÁNH HÀ TMS - 0022: Hiện/ẩn trường bổ sung theo giá trị trường khác (khách hàng yêu cầu 29/10/2026)
--   Ví dụ: trường "NCC" chọn "3-PL" thì mới hiện trường "3-PL"; chọn "Xe nội bộ" thì ẩn.
--   Lưu ở field_definitions.visibility_condition dạng JSON {"field": "ncc", "in": ["3-PL"]}.
--   Trường đang ẩn không bắt buộc nhập và được lưu rỗng (kiểm tra ở máy chủ).
-- =============================================================================

create or replace function private.valid_visibility_condition(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  j jsonb;
begin
  if p is null then
    return false;
  end if;
  j := p::jsonb;
  return jsonb_typeof(j) = 'object'
    and coalesce(j ->> 'field', '') ~ '^[a-z][a-z0-9_]{0,62}$'
    and jsonb_typeof(j -> 'in') = 'array'
    and jsonb_array_length(j -> 'in') between 1 and 50
    and not exists (select 1 from jsonb_array_elements(j -> 'in') x where jsonb_typeof(x) <> 'string');
exception when others then
  return false;
end;
$$;
revoke all on function private.valid_visibility_condition(text) from public, anon;
grant execute on function private.valid_visibility_condition(text) to authenticated;

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
  -- Điều kiện hiện: {"field": "<mã trường>", "in": ["giá trị", ...]}
  if nullif(p_values->>'visibility_condition', '') is not null and not private.valid_visibility_condition(p_values->>'visibility_condition') then
    raise exception 'Điều kiện hiện trường không hợp lệ' using errcode = '22023';
  end if;
  perform set_config('gha.change_note', coalesce(p_change_note, ''), true);
  if p_id is null then
    insert into public.field_definitions (
      module, field_key, label, description, field_kind, data_type, is_required, is_editable, is_visible,
      is_searchable, is_filterable, is_sortable, default_value, display_format, sort_order,
      view_permission, edit_permission, validation, formula, options, reference_target, status, visibility_condition)
    select r.module, r.field_key, r.label, r.description, coalesce(r.field_kind, 'business'), r.data_type,
           coalesce(r.is_required, false), coalesce(r.is_editable, true), coalesce(r.is_visible, true),
           coalesce(r.is_searchable, false), coalesce(r.is_filterable, false), coalesce(r.is_sortable, false),
           r.default_value, r.display_format, coalesce(r.sort_order, 0), r.view_permission, r.edit_permission,
           coalesce(r.validation, '{}'::jsonb), r.formula, coalesce(r.options, '[]'::jsonb), r.reference_target,
           coalesce(r.status, 'active'), r.visibility_condition
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
      reference_target = r.reference_target, status = coalesce(r.status, 'active'),
      visibility_condition = r.visibility_condition
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

-- Trường nào đang dùng trường này làm điều kiện hiện (so đúng mã trường, không so chữ)
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
      where o.module = f.module and o.id <> f.id and (case when private.valid_visibility_condition(o.visibility_condition) then o.visibility_condition::jsonb ->> 'field' end) = f.field_key
    ), '[]'::jsonb),
    -- Báo cáo và quy trình dùng trường động sẽ được kiểm tra khi các module đó hoàn thiện (GĐ6-7)
    'versions', (select count(*) from public.field_definition_versions v where v.field_id = f.id)
  );
end;
$$;
revoke all on function public.field_impact(uuid) from public, anon;
grant execute on function public.field_impact(uuid) to authenticated;
