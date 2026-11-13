#!/usr/bin/env bash
# Chạy thử chuyển dữ liệu app QLVT cũ trên một CSDL Postgres TẠM (không bao giờ trỏ vào CSDL thật):
# dựng CSDL từ toàn bộ migration, nhập file sao lưu JSON, in đối chiếu, chạy kiểm thử ẩn 3-PL.
# Cách dùng: bash scripts/test-gha-import.sh <qlvt_backup.json>
# File sao lưu chứa dữ liệu thật: KHÔNG đưa vào repo.
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?Cần đường dẫn file sao lưu JSON}"
DB="${TEST_DB:-gha_import_test}"
dropdb --if-exists "$DB" 2>/dev/null
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/00_supabase_stub.sql > /dev/null
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" > /dev/null 2> >(grep -v NOTICE >&2)
done
PGSSL=off DATABASE_URL="postgresql:///$DB?host=${PGHOST:-/var/run/postgresql}&user=${PGUSER:-postgres}" \
  node scripts/import-legacy.mjs "$FILE" --commit
for t in supabase/tests/gha/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$t" 2>&1 | sed -E 's/^psql:[^:]+:[0-9]+: (NOTICE|ERROR):  /\1: /'
  [ "${PIPESTATUS[0]}" -eq 0 ] || exit 1
done
