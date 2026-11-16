import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/entities/record";
import { todayVN } from "@/lib/format";
import { isStatementPortal, loadStatement, loadStatementCustomers, STATEMENT_MAX_ROWS } from "@/lib/freight-statement-data";
import { STATEMENT_ALL_CUSTOMERS, STATEMENT_STATUS_OPTIONS, STATEMENT_TABLE_KEY, monthRange, parseStatementConfig, type StatementStatusFilter } from "@/lib/freight-statement";
import { CompactDensity } from "@/components/layout/compact-density";
import { StatementBuilder, type StatementTemplate } from "./statement-builder";

export const metadata: Metadata = { title: "Bảng kê cước" };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Nhân viên GHA (xem chuyến) hoặc tài khoản khách chỉ xem bảng kê
  const me = await requirePagePermission("shipments.view", "statements.view");
  const portal = isStatementPortal(me.permissions);
  const sp = await searchParams;
  const month = monthRange(todayVN());
  let tu = YMD.test(one(sp.tu)) ? one(sp.tu) : month.tu;
  let den = YMD.test(one(sp.den)) ? one(sp.den) : month.den;
  if (den < tu) [tu, den] = [den, tu];
  const supabase = await createClient();
  const customers = await loadStatementCustomers(supabase, me.permissions);
  // Tài khoản khách gắn nhiều công ty: chọn được "Tất cả" (mặc định) hoặc từng công ty
  const allowAll = portal && customers.length > 1;
  let kh = isUuid(one(sp.kh)) || (allowAll && one(sp.kh) === STATEMENT_ALL_CUSTOMERS) ? one(sp.kh) : "";
  if (!kh && portal && customers.length) kh = allowAll ? STATEMENT_ALL_CUSTOMERS : customers[0].id;
  const tt = (STATEMENT_STATUS_OPTIONS.some((o) => o.value === one(sp.tt)) ? one(sp.tt) : "giao") as StatementStatusFilter;

  const [data, tplRes] = await Promise.all([
    loadStatement(supabase, me.permissions, { kh, tu, den, tt }),
    supabase.from("table_view_preferences").select("id, name, scope, user_id, config").eq("table_key", STATEMENT_TABLE_KEY).order("name"),
  ]);
  if (tplRes.error) throw tplRes.error;
  const templates: StatementTemplate[] = ((tplRes.data ?? []) as { id: string; name: string; scope: string; user_id: string | null; config: unknown }[])
    // Tài khoản khách chỉ dùng mẫu dùng chung do GHA lập
    .filter((t) => t.scope === "system" || (!portal && t.user_id === me.id))
    .map((t) => ({ id: t.id, name: t.name, shared: t.scope === "system", config: parseStatementConfig(t.config, data.catalog) }));

  return (
    <>
      <CompactDensity />
      <StatementBuilder
        filters={{ kh, tu, den, tt }}
        customers={customers.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
        allowAll={allowAll}
        readOnly={portal}
        data={data}
        templates={templates}
        initialTemplateId={one(sp.mau)}
        canExport={me.permissions.has("shipments.export") || (portal && me.permissions.has("statements.export"))}
        canShare={!portal && me.permissions.has("settings.configure")}
        maxRows={STATEMENT_MAX_ROWS}
        today={todayVN()}
      />
    </>
  );
}
