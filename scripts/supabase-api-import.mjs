#!/usr/bin/env node
// Dựng CSDL và chuyển dữ liệu app QLVT cũ vào GHA-TMS qua API quản lý của Supabase (HTTPS),
// dùng khi không kết nối thẳng được tới Postgres (cổng 5432).
//
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/supabase-api-import.mjs --ref <mã dự án> --install
//       chạy lần lượt mọi file trong supabase/migrations (CHỈ trên dự án mới, trống)
//   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/supabase-api-import.mjs --ref <mã dự án> --file qlvt_backup.json
//       nạp bản gốc vào legacy.raw_docs rồi CHẠY THỬ (hủy, không ghi), in đối chiếu
//   ... --file qlvt_backup.json --commit     ghi thật
//
// Token: Supabase → Account → Access Tokens. Nếu môi trường tự gắn header Authorization thì không cần biến.
// Sau proxy HTTPS: chạy với NODE_USE_ENV_PROXY=1.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const ref = arg("--ref");
const file = arg("--file");
const install = args.includes("--install");
const commit = args.includes("--commit");
if (!ref || (!install && !file)) {
  console.error("Cách dùng: node scripts/supabase-api-import.mjs --ref <mã dự án> (--install | --file <backup.json> [--commit])");
  process.exit(1);
}
const token = process.env.SUPABASE_ACCESS_TOKEN;

async function sql(query, label) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${process.env.SUPABASE_API_URL || "https://api.supabase.com"}/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : [];
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    throw new Error(`${label || "SQL"}: HTTP ${res.status} ${text.slice(0, 800)}`);
  }
}

const fmt = (n) => (n === null || n === undefined ? "" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 }));
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

if (install) {
  const [{ n }] = await sql("select count(*)::int as n from information_schema.tables where table_schema = 'public'", "kiểm tra");
  if (n > 0) {
    console.error(`Dự án đã có ${n} bảng trong schema public. --install chỉ dùng cho dự án mới, trống. Dừng lại.`);
    process.exit(1);
  }
  const dir = path.join(root, "supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    process.stdout.write(`${f} ... `);
    await sql(readFileSync(path.join(dir, f), "utf8"), f);
    console.log("xong");
  }
  console.log("Đã dựng CSDL.");
}

if (file) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  if (!json.collections) throw new Error('File không phải bản sao lưu QLVT (thiếu "collections")');
  const docs = Object.entries(json.collections).flatMap(([c, list]) =>
    list.filter((d) => d._id).map(({ _id, ...data }) => ({ collection: c, doc_id: _id, data })));
  // Lô ~1.5 MB
  let batch = [], size = 0, loaded = 0;
  const flush = async () => {
    if (!batch.length) return;
    const payload = JSON.stringify(batch);
    const tag = "$gha_json$";
    const r = await sql(`select legacy.load_docs(${tag}${payload}${tag}::jsonb) as n`, "nạp bản gốc");
    loaded += r[0].n; batch = []; size = 0;
    process.stdout.write(`\rĐã nạp ${loaded}/${docs.length} bản ghi`);
  };
  for (const d of docs) {
    const s = JSON.stringify(d).length;
    if (size + s > 1_500_000) await flush();
    batch.push(d); size += s;
  }
  await flush();
  console.log();
  const skipped = Object.entries(json._skipped || {});
  for (const [c, msg] of skipped) {
    console.log(`[cảnh báo] File sao lưu KHÔNG có ${c} (thiếu quyền khi xuất): ${msg}`);
  }

  let rep, rec, warn;
  if (commit) {
    rep = await sql("select * from legacy.run_import()", "chuyển dữ liệu");
    rec = await sql("select * from legacy.reconcile", "đối chiếu");
    warn = await sql("select level, collection, doc_id, message from legacy.import_log order by id", "cảnh báo");
  } else {
    const [{ r }] = await sql("select legacy.dry_run() as r", "chạy thử");
    rep = r.buoc || []; rec = r.doi_chieu || []; warn = r.canh_bao || [];
  }
  console.log("\n== Kết quả chuyển ==");
  console.table(rep.map((r) => ({ "Bước": r.buoc, "Nguồn": r.nguon, "Đã chuyển": r.da_chuyen, "Ghi chú": r.ghi_chu })));
  console.log("\n== Đối chiếu cũ ↔ mới ==");
  console.table(rec.map((r) => ({ "Chỉ tiêu": r.chi_tieu, "App cũ": fmt(r.cu), "GHA-TMS": fmt(r.moi), "Khớp": Math.abs(Number(r.cu) - Number(r.moi)) < 1 ? "✓" : "✗" })));
  if (warn.length) {
    console.log(`\n== Cảnh báo / ghi chú (${warn.length}) ==`);
    for (const w of warn) console.log(`[${w.level}] ${w.collection}${w.doc_id ? " " + w.doc_id : ""}: ${w.message}`);
  }
  console.log(commit ? "\nĐÃ GHI vào CSDL." : "\nCHẠY THỬ: đã hủy phần chuyển (bản gốc vẫn nằm trong legacy.raw_docs). Thêm --commit để ghi thật.");
}
