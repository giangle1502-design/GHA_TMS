import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, MODULE_ACTIONS, hasAny } from "@/lib/permissions";
import { NAV_GROUPS } from "@/lib/navigation";

const sql = readFileSync(path.resolve(__dirname, "../supabase/migrations/20261016000002_rbac.sql"), "utf8");

/** Đọc danh sách module/hành động từ migration SQL */
function permissionsFromSql(): string[] {
  const block = sql.slice(sql.indexOf("with modules"), sql.indexOf("action_names"));
  const re = /\('([a-z_]+)',\s*'[^']*',\s*array\[([^\]]*)\]/g;
  const out: string[] = [];
  for (const m of block.matchAll(re)) {
    const actions = m[2].split(",").map((a) => a.trim().replace(/'/g, ""));
    actions.forEach((a) => out.push(`${m[1]}.${a}`));
  }
  // Quyền thêm ở migration sau: insert into public.permissions (code, module, action, ...) values ('x.y', ...)
  const dir = path.resolve(__dirname, "../supabase/migrations");
  for (const f of readdirSync(dir).filter((n) => n > "20261016000002_rbac.sql")) {
    const text = readFileSync(path.join(dir, f), "utf8");
    for (const blk of text.matchAll(/insert into public\.permissions[^;]*;/g)) {
      for (const m of blk[0].matchAll(/\('([a-z_]+\.[a-z_]+)',/g)) out.push(m[1]);
    }
  }
  return out.sort();
}

describe("Danh mục quyền", () => {
  it("khớp giữa mã TypeScript và migration SQL", () => {
    expect([...ALL_PERMISSIONS].sort()).toEqual(permissionsFromSql());
  });
  it("có 105 quyền", () => {
    expect(ALL_PERMISSIONS).toHaveLength(105);
  });
  it("mọi quyền dùng trong menu đều tồn tại", () => {
    const all = new Set<string>(ALL_PERMISSIONS);
    for (const g of NAV_GROUPS) for (const i of g.items) for (const p of i.anyOf) expect(all.has(p)).toBe(true);
  });
  it("mọi module đều có quyền xem hoặc sử dụng", () => {
    for (const [m, acts] of Object.entries(MODULE_ACTIONS)) {
      expect(acts.includes("view" as never) || acts.includes("use" as never), m).toBe(true);
    }
  });
  it("hasAny", () => {
    const perms = new Set(["shipments.view"]);
    expect(hasAny(perms, ["dispatch.view", "shipments.view"])).toBe(true);
    expect(hasAny(perms, ["dispatch.view"])).toBe(false);
    expect(hasAny(perms, [])).toBe(true);
  });
});
