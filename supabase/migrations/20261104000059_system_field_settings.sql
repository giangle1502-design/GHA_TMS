-- =============================================================================
-- KHÁNH HÀ TMS - 0059: Cho sửa trường hệ thống (khách hàng yêu cầu 04/11/2026)
--   Người có quyền "Cấu hình trường" đổi được tên hiển thị, gợi ý, bắt buộc, ẩn khỏi biểu mẫu,
--   hiện thành cột trên bảng và tên các lựa chọn của trường hệ thống.
--   Mã trường, kiểu dữ liệu và giá trị lưu trong CSDL giữ nguyên để phần mềm chạy đúng.
--   Lưu ở form_layouts.system_fields: {"<mã trường>": {"label": "...", "help": "...", "required": true, ...}}
-- =============================================================================

alter table public.form_layouts add column system_fields jsonb not null default '{}'::jsonb
  check (jsonb_typeof(system_fields) = 'object' and pg_column_size(system_fields) <= 200000);
comment on column public.form_layouts.system_fields is 'Tùy chỉnh trường hệ thống: tên hiển thị, gợi ý, bắt buộc, ẩn, cột bảng, tên lựa chọn';

-- Lưu tùy chỉnh của MỘT trường hệ thống (p_values rỗng = trả về mặc định); ghi nhật ký
create function public.save_system_field(p_module text, p_field_key text, p_values jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  k text;
begin
  if not private.has_perm('fields.configure') then
    raise exception 'Bạn không có quyền sửa trường hệ thống' using errcode = '42501';
  end if;
  if p_module is null or p_module !~ '^[a-z][a-z0-9_]*$' or p_field_key is null or p_field_key !~ '^[a-z][a-z0-9_]{0,62}$' then
    raise exception 'Màn hình hoặc mã trường không hợp lệ' using errcode = '22023';
  end if;
  v_new := coalesce(p_values, '{}'::jsonb);
  if jsonb_typeof(v_new) <> 'object' then
    raise exception 'Dữ liệu không hợp lệ' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(v_new) loop
    if k not in ('label', 'help', 'required', 'hidden', 'list', 'options') then
      raise exception 'Thuộc tính "%" không sửa được', k using errcode = '22023';
    end if;
  end loop;
  if (v_new ? 'label' and (jsonb_typeof(v_new->'label') <> 'string' or length(v_new->>'label') not between 1 and 150))
     or (v_new ? 'help' and (jsonb_typeof(v_new->'help') <> 'string' or length(v_new->>'help') > 500))
     or (v_new ? 'required' and jsonb_typeof(v_new->'required') <> 'boolean')
     or (v_new ? 'hidden' and jsonb_typeof(v_new->'hidden') <> 'boolean')
     or (v_new ? 'list' and jsonb_typeof(v_new->'list') <> 'boolean')
     or (v_new ? 'options' and (jsonb_typeof(v_new->'options') <> 'object' or pg_column_size(v_new->'options') > 20000)) then
    raise exception 'Giá trị không hợp lệ' using errcode = '22023';
  end if;

  select system_fields -> p_field_key into v_old from public.form_layouts where module = p_module;
  insert into public.form_layouts (module, system_fields)
  values (p_module, case when v_new = '{}'::jsonb then '{}'::jsonb else jsonb_build_object(p_field_key, v_new) end)
  on conflict (module) do update
    set system_fields = case when v_new = '{}'::jsonb then public.form_layouts.system_fields - p_field_key
                             else public.form_layouts.system_fields || jsonb_build_object(p_field_key, v_new) end;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
  values (auth.uid(), 'system_field.save', 'form_layouts', p_module || '.' || p_field_key, v_old, v_new);
end;
$$;
revoke all on function public.save_system_field(text, text, jsonb) from public, anon;
grant execute on function public.save_system_field(text, text, jsonb) to authenticated;
