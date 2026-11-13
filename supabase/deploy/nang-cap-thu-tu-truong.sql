-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Sắp thứ tự trường trên biểu mẫu (Quản lý trường dữ liệu)
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.form_layouts') is not null then
    raise exception 'CSDL đã được nâng cấp Sắp thứ tự trường trên biểu mẫu (Quản lý trường dữ liệu) trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261029000021_form_layouts.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0021: Thứ tự trường trên biểu mẫu (khách hàng yêu cầu 29/10/2026)
--   Người có quyền "Cấu hình trường" kéo thả sắp xếp cả trường hệ thống lẫn trường bổ sung
--   trên từng biểu mẫu (đơn hàng, chuyến của Điều phối, các danh mục...). Một thứ tự dùng chung cho mọi người.
-- =============================================================================

create table public.form_layouts (
  module text primary key check (module ~ '^[a-z][a-z0-9_]*$'),
  field_order text[] not null default '{}' check (cardinality(field_order) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.form_layouts is 'Thứ tự hiển thị trường (hệ thống + bổ sung) trên biểu mẫu của từng màn hình';
select private.attach_standard_triggers('public.form_layouts');
alter table public.form_layouts enable row level security;
create policy form_layouts_select on public.form_layouts for select to authenticated using ((select private.is_active_user()));
revoke all on public.form_layouts from anon;
grant select on public.form_layouts to authenticated;

-- Lưu thứ tự: chỉ người có quyền cấu hình trường; ghi nhật ký
create function public.save_form_layout(p_module text, p_field_order text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text[];
  v_order text[];
begin
  if not private.has_perm('fields.configure') then
    raise exception 'Bạn không có quyền sắp xếp trường trên biểu mẫu' using errcode = '42501';
  end if;
  if p_module is null or p_module !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'Màn hình không hợp lệ' using errcode = '22023';
  end if;
  -- Bỏ trùng, bỏ khóa lạ, giữ thứ tự
  select coalesce(array_agg(k order by ord), '{}') into v_order
  from (select k, min(ord) as ord from unnest(coalesce(p_field_order, '{}')) with ordinality as t(k, ord)
        where k ~ '^[a-z][a-z0-9_]{0,62}$' group by k) x;
  if cardinality(v_order) > 300 then
    raise exception 'Quá nhiều trường' using errcode = '22023';
  end if;
  select field_order into v_old from public.form_layouts where module = p_module;
  insert into public.form_layouts (module, field_order) values (p_module, v_order)
  on conflict (module) do update set field_order = excluded.field_order;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
  values (auth.uid(), 'form_layout.save', 'form_layouts', p_module,
          case when v_old is null then null else jsonb_build_object('field_order', v_old) end,
          jsonb_build_object('field_order', v_order));
end;
$$;
revoke all on function public.save_form_layout(text, text[]) from public, anon;
grant execute on function public.save_form_layout(text, text[]) to authenticated;

commit;
