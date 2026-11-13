import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadTableView } from "@/lib/entities/server";
import { resolvePeriod } from "@/lib/report-period";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import type { SpendingLine } from "@/lib/spending-report";
import { SpendingReport } from "./spending-report";

export const metadata: Metadata = { title: "Tổng chi theo nhóm" };

const COLS =
  "id, source, group_name, group_sort, item_name, report_date, amount, status, is_pass_through, code, shipment_code, plate_number, driver_name, customer_name, supplier_name, paid_by, ref_no, note";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const me = await requirePagePermission("reports.view");
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const supabase = await createClient();

  // PostgREST trả tối đa 1.000 dòng mỗi lần: đọc từng trang
  const lines: SpendingLine[] = [];
  for (let p = 0; p < 100; p++) {
    const { data, error } = await supabase
      .from("report_spending_lines")
      .select(COLS)
      .gte("report_date", period.from)
      .lte("report_date", period.to)
      .order("report_date")
      .order("id")
      .range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    lines.push(
      ...((data ?? []) as SpendingLine[]).map((l) => ({
        ...l,
        amount: Number(l.amount),
      })),
    );
    if ((data ?? []).length < 1000) break;
  }

  const [groups, vGroups, vItems, vPeriod, vLines] = await Promise.all([
    supabase
      .from("expense_groups")
      .select("name")
      .order("sort_order")
      .order("name"),
    loadTableView(supabase, "spending_groups", me.id),
    loadTableView(supabase, "spending_items", me.id),
    loadTableView(supabase, "spending_period", me.id),
    loadTableView(supabase, "spending_lines", me.id),
  ]);
  if (groups.error) throw groups.error;

  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Tổng chi theo nhóm"
        description="Tổng tiền công ty đã chi, cộng theo Nhóm phí, bấm vào nhóm hoặc khoản để xem chi tiết. Không gồm chi hộ (tiền trả thay khách rồi thu lại) và ứng tiền tài xế."
      />
      <SpendingReport
        period={period}
        lines={lines}
        groupOrder={((groups.data ?? []) as { name: string }[]).map(
          (g) => g.name,
        )}
        views={{
          groups: vGroups,
          items: vItems,
          period: vPeriod,
          lines: vLines,
        }}
      />
    </>
  );
}
