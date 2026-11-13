#!/usr/bin/env node
// Chuyển file sao lưu JSON của app QLVT cũ vào CSDL GHA-TMS (Supabase/Postgres).
//
// Cách chạy:
//   npm i pg
//   DATABASE_URL="postgresql://postgres:<mật khẩu>@db.<project>.supabase.co:5432/postgres" \
//     node scripts/import-legacy.mjs qlvt_backup_2026-11-13.json            # chạy thử: làm hết rồi HỦY, chỉ in báo cáo
//   ... node scripts/import-legacy.mjs qlvt_backup_2026-11-13.json --commit   # ghi thật
//
// Yêu cầu: đã chạy migration 9001 (xe tải/mã hàng) và 9002 (schema legacy) trên CSDL đích.
// Dùng chuỗi kết nối trực tiếp (cổng 5432, tài khoản postgres), không dùng khóa anon/service của API.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const commit = args.includes("--commit");
if (!file || !process.env.DATABASE_URL) {
  console.error("Cách dùng: DATABASE_URL=... node scripts/import-legacy.mjs <file.json> [--commit]");
  process.exit(1);
}

const raw = readFileSync(file, "utf8");
const json = JSON.parse(raw);
if (!json.collections) {
  console.error("File không phải bản sao lưu QLVT (thiếu \"collections\").");
  process.exit(1);
}

const fmt = (n) => (n === null || n === undefined ? "" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 }));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "off" ? false : { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("begin");
  const { rows: [b] } = await client.query(
    "insert into legacy.backup_files (file_name, content) values ($1, $2::jsonb) returning id",
    [basename(file), raw]
  );
  const loaded = await client.query("select * from legacy.load_backup($1)", [b.id]);
  console.log("\n== Đã đọc file ==");
  console.table(loaded.rows);

  const rep = await client.query("select * from legacy.run_import()");
  console.log("\n== Kết quả chuyển ==");
  console.table(rep.rows.map((r) => ({ "Bước": r.buoc, "Nguồn": r.nguon, "Đã chuyển": r.da_chuyen, "Ghi chú": r.ghi_chu })));

  const rec = await client.query("select * from legacy.reconcile");
  console.log("\n== Đối chiếu cũ ↔ mới ==");
  console.table(rec.rows.map((r) => ({ "Chỉ tiêu": r.chi_tieu, "App cũ": fmt(r.cu), "GHA-TMS": fmt(r.moi), "Khớp": Math.abs(Number(r.cu) - Number(r.moi)) < 1 ? "✓" : "✗" })));

  const warn = await client.query("select level, collection, doc_id, message from legacy.import_log order by id");
  if (warn.rows.length) {
    console.log(`\n== Cảnh báo / ghi chú (${warn.rows.length}) ==`);
    for (const w of warn.rows) console.log(`[${w.level}] ${w.collection}${w.doc_id ? " " + w.doc_id : ""}: ${w.message}`);
  }

  if (commit) {
    await client.query("commit");
    console.log("\nĐÃ GHI vào CSDL.");
  } else {
    await client.query("rollback");
    console.log("\nCHẠY THỬ: đã hủy, chưa ghi gì. Thêm --commit để ghi thật.");
  }
} catch (e) {
  await client.query("rollback").catch(() => {});
  console.error("\nLỖI, đã hủy toàn bộ:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
