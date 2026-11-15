import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadTableView } from "@/lib/entities/server";
import { resolvePeriod } from "@/lib/report-period";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import type { SpendingLine } from "@/lib/spending-report";
import type { TaxOverheadRow, TaxPayrollRow, TaxRevenueRow } from "@/lib/tax-balance";
import { TaxBalanceReport } from "./tax-balance-report";

export const metadata: Metadata = { title: "Cân đối thu chi, thuế" };

/** Đọc hết các dòng trong kỳ (PostgREST trả tối đa 1.000 dòng mỗi lần) */
async function fetchAll<T>(supabase: SupabaseClient, table: string, cols: string, dateCol: string, from: string, to: string): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < 100; p++) {
    const { data, error } = await supabase
      .from(table)
      .select(cols)
      .gte(dateCol, from)
      .lte(dateCol, to)
      .order(dateCol)
      .order("id")
      .range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("overhead.view");
  const sp = await searchParams;
  const period = resolvePeriod({ ky: "quy", ...sp });
  const supabase = await createClient();
  const canReports = me.permissions.has("reports.view");
  const [revenue, spending, overhead, payroll, viewMonths] = await Promise.all([
    canReports
      ? fetchAll<TaxRevenueRow>(
          supabase,
          "report_shipment_profit",
          "id, report_date, freight_amount, surcharge_amount, fuel_support_amount, extra_fee_amount, pass_through_amount",
          "report_date",
          period.from,
          period.to,
        )
      : Promise.resolve([] as TaxRevenueRow[]),
    canReports
      ? fetchAll<SpendingLine>(
          supabase,
          "report_spending_lines",
          "id, source, group_name, group_sort, item_name, report_date, amount, status, is_pass_through",
          "report_date",
          period.from,
          period.to,
        )
      : Promise.resolve([] as SpendingLine[]),
    fetchAll<{ expense_date: string; amount: number; vat_amount: number; has_invoice: boolean; tax_deductible: boolean | null; overhead_categories: { group_name: string | null } | null }>(
      supabase,
      "overhead_expenses",
      "id, expense_date, amount, vat_amount, has_invoice, tax_deductible, overhead_categories(group_name)",
      "expense_date",
      period.from,
      period.to,
    ),
    canReports
      ? supabase
          .from("report_monthly")
          .select("report_month, payroll")
          .gte("report_month", `${period.from.slice(0, 7)}-01`)
          .lte("report_month", period.to)
      : Promise.resolve({ data: [], error: null }),
    loadTableView(supabase, "tax_balance_months", me.id),
  ]);
  if (payroll.error) throw payroll.error;

  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Cân đối thu chi, thuế"
        description="Doanh thu cước vận chuyển so với toàn bộ chi phí trong kỳ (chi phí chuyến, 3PL, chi phí xe, đề nghị chi, lương tài xế, chi phí ngoài chuyến), lợi nhuận, thuế TNDN và VAT tạm tính. Mặc định theo quý hiện tại. Số liệu để đối chiếu với kế toán, không thay tờ khai thuế."
      />
      <TaxBalanceReport
        period={period}
        noReports={!canReports}
        revenue={revenue.map((r) => ({
          report_date: r.report_date,
          freight_amount: Number(r.freight_amount),
          surcharge_amount: Number(r.surcharge_amount),
          fuel_support_amount: Number(r.fuel_support_amount),
          extra_fee_amount: Number(r.extra_fee_amount),
          pass_through_amount: Number(r.pass_through_amount),
        }))}
        spending={spending.map((l) => ({ ...l, amount: Number(l.amount) }))}
        overhead={overhead.map(
          (o): TaxOverheadRow => ({
            expense_date: o.expense_date,
            amount: Number(o.amount),
            vat_amount: Number(o.vat_amount),
            has_invoice: o.has_invoice,
            tax_deductible: o.tax_deductible,
            group_name: o.overhead_categories?.group_name?.trim() || "Khác",
          }),
        )}
        payroll={((payroll.data ?? []) as TaxPayrollRow[]).map((p) => ({ report_month: p.report_month, payroll: Number(p.payroll) }))}
        view={viewMonths}
      />
    </>
  );
}
