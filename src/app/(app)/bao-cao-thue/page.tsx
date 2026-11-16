import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadTableView } from "@/lib/entities/server";
import { resolvePeriod } from "@/lib/report-period";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import type { TaxInvoiceRow } from "@/lib/tax-balance";
import { TaxBalanceReport } from "./tax-balance-report";

export const metadata: Metadata = { title: "Cân đối thuế" };

type Raw = {
  id: string;
  direction: "sale" | "purchase";
  invoice_date: string;
  amount: number;
  vat_amount: number | null;
  tax_deductible: boolean;
  tax_invoice_categories: { name: string; group_name: string | null } | null;
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("overhead.view");
  const sp = await searchParams;
  const period = resolvePeriod({ ky: "quy", ...sp });
  const supabase = await createClient();
  // Đọc hết hóa đơn trong kỳ (PostgREST trả tối đa 1.000 dòng mỗi lần)
  const rows: Raw[] = [];
  for (let p = 0; p < 100; p++) {
    const { data, error } = await supabase
      .from("tax_invoices")
      .select("id, direction, invoice_date, amount, vat_amount, tax_deductible, tax_invoice_categories(name, group_name)")
      .gte("invoice_date", period.from)
      .lte("invoice_date", period.to)
      .order("invoice_date")
      .order("id")
      .range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as Raw[]));
    if ((data ?? []).length < 1000) break;
  }
  const view = await loadTableView(supabase, "tax_balance_months", me.id);
  const invoices: TaxInvoiceRow[] = rows.map((r) => ({
    direction: r.direction,
    invoice_date: r.invoice_date,
    amount: Number(r.amount),
    vat_amount: Number(r.vat_amount ?? 0),
    tax_deductible: r.tax_deductible,
    category_name: r.tax_invoice_categories?.name ?? "",
    group_name: r.tax_invoice_categories?.group_name ?? "",
  }));

  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Cân đối thuế"
        description="Tính từ Sổ hóa đơn, tách riêng với chi phí chuyến: hóa đơn bán ra (GHA xuất cho khách) là doanh thu và VAT đầu ra; hóa đơn mua vào (3PL, xăng dầu, điện, ăn uống, taxi, vé máy bay…) là chi phí và VAT đầu vào. Mặc định theo quý hiện tại. Số liệu để đối chiếu với kế toán, không thay tờ khai thuế."
      />
      <TaxBalanceReport period={period} invoices={invoices} view={view} />
    </>
  );
}
