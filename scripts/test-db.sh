#!/usr/bin/env bash
# Chạy toàn bộ migration + kiểm thử bảo mật trên một CSDL Postgres TẠM (không bao giờ trỏ vào CSDL thật).
# Yêu cầu: PostgreSQL 15+ cục bộ; dùng biến môi trường PGHOST/PGPORT/PGUSER nếu cần.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-gha_tms_test}"
dropdb --if-exists "$DB" 2>/dev/null
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/00_supabase_stub.sql > /dev/null
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" > /dev/null 2> >(grep -v NOTICE >&2)
done
# Kiểm thử cũ viết trước khi có "Giám đốc duyệt chuyến": tắt tham số; tệp 21 tự bật lại
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval'" > /dev/null
# Kiểm thử cũ viết trước khi có "phiếu chi phí": tài xế nhập từng khoản; tệp 37 tự bật lại
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "update public.system_settings set value = 'false' where key = 'driver.expense_sheet_photo'" > /dev/null
# 0058 đánh lại mã danh mục phí (TK0001, CP0001): kiểm tra rồi trả mã cũ cho các kiểm thử viết trước và bỏ Tính vào theo nhóm (tệp 41 kiểm tra)
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "do \$\$ begin
  if exists (select 1 from public.fee_types where code !~ '^TK[0-9]{4}\$') or exists (select 1 from public.expense_categories where code !~ '^CP[0-9]{4}\$')
     or exists (select 1 from public.fee_groups where code !~ '^NTK[0-9]{3}\$') or exists (select 1 from public.expense_groups where code !~ '^NCP[0-9]{3}\$') then
    raise exception 'FAIL: 0058 chưa đánh lại mã danh mục phí';
  end if;
  update public.fee_groups set code = legacy_code, counts_as = null; update public.fee_types set code = legacy_code;
  update public.expense_groups set code = legacy_code; update public.expense_categories set code = legacy_code;
end \$\$" > /dev/null
# 0060 tắt % dầu mặc định 39%: kiểm tra rồi bật lại cho các kiểm thử viết trước (tệp 43 kiểm tra không còn mặc định)
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "do \$\$ begin
  if exists (select 1 from public.fuel_support_rules where scope_type = 'default' and is_active) then
    raise exception 'FAIL: 0060 chưa tắt quy tắc hỗ trợ dầu mặc định';
  end if;
  update public.fuel_support_rules set is_active = true where scope_type = 'default';
end \$\$" > /dev/null
for t in supabase/tests/0[1-9]_*.sql supabase/tests/[1-9][0-9]_*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$t" 2>&1 | sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /\1: /'
  [ "${PIPESTATUS[0]}" -eq 0 ] || exit 1
done
