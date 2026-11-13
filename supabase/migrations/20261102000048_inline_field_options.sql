-- =============================================================================
-- KHÁNH HÀ TMS - 0048: Thêm lựa chọn ngay tại biểu mẫu (02/11/2026)
--   Trường bổ sung kiểu "Danh sách chọn" có nút + cạnh ô chọn: gõ tên lựa chọn mới, lưu vào trường và chọn luôn,
--   không phải sang Quản lý trường dữ liệu. Người có quyền "Cấu hình trường" hoặc người nhập liệu
--   (có quyền Thêm/Sửa ở một màn hình nghiệp vụ, không tính quyền nộp chứng từ của tài xế) đều thêm được. Chỉ THÊM lựa chọn, không sửa/xóa lựa chọn cũ.
--   Mỗi lần thêm tạo một phiên bản mới của trường (xem/khôi phục ở Quản lý trường dữ liệu).
-- =============================================================================

create or replace function public.add_field_option(p_field_id uuid, p_label text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label text := btrim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g'));
  v_type text;
  v_options jsonb;
  v_found jsonb;
  v_opt jsonb;
begin
  if not (
    private.has_perm('fields.configure')
    or exists (select 1 from public.permissions p where p.action in ('create', 'update') and p.module not in ('driver_app', 'documents') and private.has_perm(p.code))
  ) then
    raise exception 'Bạn không có quyền thêm lựa chọn' using errcode = '42501';
  end if;
  if v_label = '' then
    raise exception 'Nhập tên lựa chọn' using errcode = '22023';
  end if;
  if length(v_label) > 200 then
    raise exception 'Tên lựa chọn tối đa 200 ký tự' using errcode = '22023';
  end if;

  select f.data_type, coalesce(f.options, '[]'::jsonb) into v_type, v_options
  from public.field_definitions f
  where f.id = p_field_id and f.status = 'active'
  for update;
  if not found then
    raise exception 'Không tìm thấy trường dữ liệu' using errcode = 'P0002';
  end if;
  if v_type not in ('single_select', 'multi_select') then
    raise exception 'Trường này không phải danh sách chọn' using errcode = '22023';
  end if;

  -- Đã có (trùng mã hoặc tên, không phân biệt hoa thường) thì trả về lựa chọn cũ
  select o into v_found
  from jsonb_array_elements(v_options) o
  where lower(case when jsonb_typeof(o) = 'string' then o #>> '{}' else o ->> 'value' end) = lower(v_label)
     or lower(case when jsonb_typeof(o) = 'string' then o #>> '{}' else o ->> 'label' end) = lower(v_label)
  limit 1;
  if v_found is not null then
    if jsonb_typeof(v_found) = 'string' then
      return jsonb_build_object('value', v_found #>> '{}', 'label', v_found #>> '{}', 'existed', true);
    end if;
    return v_found || jsonb_build_object('existed', true);
  end if;

  v_opt := jsonb_build_object('value', v_label, 'label', v_label);
  perform set_config('gha.change_note', 'Thêm lựa chọn "' || v_label || '" ngay tại biểu mẫu', true);
  update public.field_definitions set options = v_options || jsonb_build_array(v_opt) where id = p_field_id;
  return v_opt || jsonb_build_object('existed', false);
end;
$$;
revoke all on function public.add_field_option(uuid, text) from public, anon;
grant execute on function public.add_field_option(uuid, text) to authenticated;
