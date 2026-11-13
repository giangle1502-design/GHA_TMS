-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Tăng tốc tìm kiếm (RLS tính quyền một lần mỗi truy vấn)
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('private.wrap_rls_calls(text)') is not null then
    raise exception 'CSDL đã được nâng cấp Tăng tốc tìm kiếm (RLS tính quyền một lần mỗi truy vấn) trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261029000020_rls_performance.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0020: Tăng tốc RLS (tìm kiếm / danh sách chậm)
-- =============================================================================
-- Policy gọi private.has_perm(...), private.is_active_user(), private.my_driver_id(),
-- auth.uid() trực tiếp thì Postgres chạy lại hàm cho TỪNG DÒNG của mọi bảng trong truy vấn
-- (view shipment_list nối 7 bảng -> hàng chục nghìn lần gọi khi tìm kiếm).
-- Bọc trong (select ...) để Postgres tính một lần mỗi truy vấn (InitPlan), kết quả không đổi
-- vì các hàm này chỉ phụ thuộc người đang đăng nhập, không phụ thuộc dòng.
-- Chạy lại nhiều lần an toàn: lời gọi đã bọc thì bỏ qua.
-- =============================================================================

create or replace function private.wrap_rls_calls(expr text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(
      expr,
      '(?<!SELECT )(private\.has_perm\(''[a-z_.]+''::text\))', '(SELECT \1)', 'g'),
    '(?<!SELECT )((private\.is_active_user|private\.my_driver_id|private\.is_super_admin|auth\.uid)\(\))', '(SELECT \1)', 'g');
$$;

do $$
declare
  p record;
  new_qual text;
  new_check text;
  sql text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    new_qual := private.wrap_rls_calls(p.qual);
    new_check := private.wrap_rls_calls(p.with_check);
    if new_qual is distinct from p.qual or new_check is distinct from p.with_check then
      sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
      if p.qual is not null then sql := sql || format(' using (%s)', new_qual); end if;
      if p.with_check is not null then sql := sql || format(' with check (%s)', new_check); end if;
      execute sql;
    end if;
  end loop;
end $$;

-- Policy tạo về sau bằng hàm sinh chuẩn cũng dùng dạng đã bọc
create or replace function private.apply_module_policies(
  tbl text, module text,
  select_expr text default null,
  with_delete boolean default true
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('create policy %I on public.%I for select to authenticated using (%s)',
    tbl || '_select', tbl, coalesce(select_expr, format('(select private.has_perm(%L))', module || '.view')));
  execute format('create policy %I on public.%I for insert to authenticated with check ((select private.has_perm(%L)))',
    tbl || '_insert', tbl, module || '.create');
  execute format('create policy %I on public.%I for update to authenticated using ((select private.has_perm(%L))) with check ((select private.has_perm(%L)))',
    tbl || '_update', tbl, module || '.update', module || '.update');
  if with_delete then
    execute format('create policy %I on public.%I for delete to authenticated using ((select private.has_perm(%L)))',
      tbl || '_delete', tbl, module || '.delete');
  end if;
end;
$$;

commit;
