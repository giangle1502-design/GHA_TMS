import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadTableView } from "@/lib/entities/server";
import { resolvePeriod } from "@/lib/report-period";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import { CostGroupReport, type CostLine, type FeeGroupLine } from "./cost-group-report";

export const metadata: Metadata = { title: "Báo cáo chi phí theo nhóm" };

/** Đọc hết các dòng trong kỳ (PostgREST trả tối đa 1.000 dòng mỗi lần) */
async function fetchAll<T>(supabase: SupabaseClient, table: string, cols: string, from: string, to: string): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < 50; p++) {
    const { data, error } = await supabase
      .from(table)
      .select(cols)
      .gte("report_date", from)
      .lte("report_date", to)
      .order("report_date")
      .order("id")
      .range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("reports.view");
  const sp = await searchParams;
  const period = resolvePeriod(sp);
  const supabase = await createClient();
  const [fees, costs, groups, expenseGroups, viewPeriod, viewShip, viewFee, viewCost] = await Promise.all([
    fetchAll<FeeGroupLine>(
      supabase,
      "report_fee_group_lines",
      "id, shipment_id, shipment_code, order_code, report_date, customer_code, customer_name, plate_number, driver_name, group_id, group_name, group_role, group_sort, fee_name, fee_sort, fee_kind, amount, declaration_type_name, note",
      period.from,
      period.to,
    ),
    fetchAll<CostLine>(
      supabase,
      "report_cost_lines",
      "id, cost_kind, cost_group, cost_item, report_date, code, driver_name, plate_number, shipment_code, paid_by, supplier_name, amount, status, note, group_sort, ref_no",
      period.from,
      period.to,
    ),
    supabase.from("fee_groups").select("id, name, report_role, sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("expense_groups").select("name, sort_order").eq("is_active", true).order("sort_order").order("name"),
    loadTableView(supabase, "report_group_period", me.id),
    loadTableView(supabase, "report_group_shipments", me.id),
    loadTableView(supabase, "report_group_fee_types", me.id),
    loadTableView(supabase, "report_group_costs", me.id),
  ]);
  if (groups.error) throw groups.error;
  if (expenseGroups.error) throw expenseGroups.error;

  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Báo cáo chi phí theo nhóm"
        description="Bên thu khách: Phí vận chuyển (Tổng cước), Phí chi hộ, Phí tờ khai, Phí bốc xếp. Bên chi: ứng tiền, bốc xếp, bảo trì sửa chữa, kiểm định bảo hiểm, nhiên liệu… Tính theo ngày chuyến chạy / hoàn thành (chuyến đang chạy trở đi)."
      />
      <CostGroupReport
        period={period}
        fees={fees.map((f) => ({ ...f, amount: Number(f.amount) }))}
        costs={costs.map((c) => ({ ...c, amount: Number(c.amount) }))}
        groups={(groups.data ?? []) as { id: string; name: string; report_role: string; sort_order: number }[]}
        expenseGroups={(expenseGroups.data ?? []) as { name: string; sort_order: number }[]}
        views={{ period: viewPeriod, ships: viewShip, feeTypes: viewFee, costs: viewCost }}
      />
    </>
  );
}
