import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/entities/record";
import { todayVN } from "@/lib/format";
import { loadStatement, STATEMENT_MAX_ROWS } from "@/lib/freight-statement-data";
import { STATEMENT_STATUS_OPTIONS, STATEMENT_TABLE_KEY, monthRange, parseStatementConfig, type StatementStatusFilter } from "@/lib/freight-statement";
import { CompactDensity } from "@/components/layout/compact-density";
import { StatementBuilder, type StatementTemplate } from "./statement-builder";

export const metadata: Metadata = { title: "Bảng kê cước" };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("shipments.view");
  const sp = await searchParams;
  const month = monthRange(todayVN());
  let tu = YMD.test(one(sp.tu)) ? one(sp.tu) : month.tu;
  let den = YMD.test(one(sp.den)) ? one(sp.den) : month.den;
  if (den < tu) [tu, den] = [den, tu];
  const kh = isUuid(one(sp.kh)) ? one(sp.kh) : "";
  const tt = (STATEMENT_STATUS_OPTIONS.some((o) => o.value === one(sp.tt)) ? one(sp.tt) : "giao") as StatementStatusFilter;

  const supabase = await createClient();
  const [data, custRes, tplRes] = await Promise.all([
    loadStatement(supabase, me.permissions, { kh, tu, den, tt }),
    supabase.from("customers").select("id, code, name").eq("status", "active").order("name").limit(3000),
    supabase.from("table_view_preferences").select("id, name, scope, user_id, config").eq("table_key", STATEMENT_TABLE_KEY).order("name"),
  ]);
  if (custRes.error) throw custRes.error;
  if (tplRes.error) throw tplRes.error;
  const templates: StatementTemplate[] = ((tplRes.data ?? []) as { id: string; name: string; scope: string; user_id: string | null; config: unknown }[])
    .filter((t) => t.scope === "system" || t.user_id === me.id)
    .map((t) => ({ id: t.id, name: t.name, shared: t.scope === "system", config: parseStatementConfig(t.config, data.catalog) }));

  return (
    <>
      <CompactDensity />
      <StatementBuilder
        filters={{ kh, tu, den, tt }}
        customers={(custRes.data ?? []) as { id: string; code: string; name: string }[]}
        data={data}
        templates={templates}
        initialTemplateId={one(sp.mau)}
        canExport={me.permissions.has("shipments.export")}
        canShare={me.permissions.has("settings.configure")}
        maxRows={STATEMENT_MAX_ROWS}
        today={todayVN()}
      />
    </>
  );
}
