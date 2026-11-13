-- =============================================================================
-- Kiểm thử 0020: policy RLS gọi hàm quyền một lần mỗi truy vấn (bọc trong select).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
reset role;

select tests.assert(not exists (
  select 1 from pg_policies
  where schemaname = 'public'
    and coalesce(qual, '') || ' ' || coalesce(with_check, '')
        ~ '(?<!SELECT )(private\.has_perm\(|private\.is_active_user\(\)|private\.my_driver_id\(\)|auth\.uid\(\))'
), 'Mọi policy public gọi hàm quyền dạng (select ...)');

select tests.assert(private.wrap_rls_calls(private.wrap_rls_calls('private.has_perm(''a.view''::text) OR (x = auth.uid())'))
  = '(SELECT private.has_perm(''a.view''::text)) OR (x = (SELECT auth.uid()))', 'Bọc lời gọi không bị bọc hai lần');

\o
\echo 'TẤT CẢ KIỂM THỬ TỐC ĐỘ RLS ĐỀU ĐẠT'
