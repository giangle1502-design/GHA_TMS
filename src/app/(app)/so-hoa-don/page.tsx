import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowDownToLine, ArrowUpFromLine, Landmark, Printer, Scale } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EntityListSection, resolveEntityTabs } from "@/components/entities/entity-list-section";
import { formatVND, todayVN } from "@/lib/format";
import { toneVar, type Tone } from "@/lib/tones";

export const metadata: Metadata = { title: "Sổ hóa đơn" };

type Row = { direction: string; amount: number; vat_amount: number; total_amount: number; tax_deductible: boolean; payment_status: string };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePagePermission("overhead.view");
  const sp = await searchParams;
  const supabase = await createClient();
  const month = todayVN().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const [cur, unpaid] = await Promise.all([
    supabase
      .from("tax_invoices")
      .select("direction, amount, vat_amount, total_amount, tax_deductible, payment_status")
      .gte("invoice_date", `${month}-01`)
      .lt("invoice_date", nextMonth)
      .limit(10000),
    supabase.from("tax_invoices").select("total_amount").eq("direction", "purchase").eq("payment_status", "unpaid").limit(10000),
  ]);
  if (cur.error) throw cur.error;
  if (unpaid.error) throw unpaid.error;
  const rows = (cur.data ?? []) as Row[];
  const sale = rows.filter((r) => r.direction === "sale");
  const buy = rows.filter((r) => r.direction === "purchase");
  const sum = (rs: Row[], k: "amount" | "vat_amount") => rs.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const vatIn = sum(buy.filter((r) => r.tax_deductible), "vat_amount");
  const vatOut = sum(sale, "vat_amount");
  const unpaidTotal = (unpaid.data ?? []).reduce((a, r) => a + Number(r.total_amount ?? 0), 0);

  const { active, nav } = await resolveEntityTabs({
    basePath: "/so-hoa-don",
    searchParams: sp,
    tabs: [
      { key: "sale_invoices", label: "Hóa đơn bán ra (xuất cho khách)" },
      { key: "purchase_invoices", label: "Hóa đơn mua vào (chi phí)" },
      { key: "report_tax_invoice_month", label: "Theo tháng, loại" },
      { key: "sale_invoice_categories", label: "Loại hóa đơn bán ra" },
      { key: "purchase_invoice_categories", label: "Hạng mục chi phí" },
    ],
  });
  const label = `${month.slice(5)}/${month.slice(0, 4)}`;
  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Sổ hóa đơn bán ra, mua vào"
        description="Hóa đơn bán ra: hóa đơn GHA xuất cho khách hàng (doanh thu). Hóa đơn mua vào: hóa đơn nhà cung cấp xuất cho GHA (3PL, xăng dầu, điện, ăn uống, taxi, vé máy bay…). Dán ảnh hóa đơn (Ctrl+V) trong ô Thêm để tự điền. Cân đối thuế tính từ hai sổ này, tách riêng với chi phí chuyến."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/bao-cao-thue">
                <Scale /> Cân đối thuế
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/in-phieu">
                <Printer /> Đề nghị thanh toán
              </Link>
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 [&>*]:min-w-0">
        <Kpi icon={ArrowUpFromLine} tone="green" label={`Bán ra tháng ${label}`} value={formatVND(sum(sale, "amount"))} note={`${sale.length} hóa đơn · VAT ${formatVND(vatOut)}`} />
        <Kpi icon={ArrowDownToLine} tone="amber" label={`Mua vào tháng ${label}`} value={formatVND(sum(buy, "amount"))} note={`${buy.length} hóa đơn · VAT ${formatVND(sum(buy, "vat_amount"))}`} />
        <Kpi icon={Landmark} tone="blue" label="VAT phải nộp tháng này (tạm tính)" value={formatVND(vatOut - vatIn)} note="VAT bán ra − VAT mua vào được khấu trừ" />
        <Kpi icon={Printer} tone="purple" label="Hóa đơn mua vào chưa trả" value={formatVND(unpaidTotal)} note={`${(unpaid.data ?? []).length} hóa đơn (mọi tháng)`} />
      </div>
      {nav}
      {active ? <EntityListSection entityKey={active} searchParams={sp} revalidate="/so-hoa-don" /> : null}
    </>
  );
}

function Kpi({ icon: Icon, tone, label, value, note }: { icon: LucideIcon; tone: Tone; label: string; value: string; note: string }) {
  return (
    <Card className="h-full">
      <CardContent>
        <div className="flex items-start justify-between gap-2">
          <div className="pt-0.5 text-sm text-muted-foreground">{label}</div>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm sm:size-10" style={{ background: toneVar(tone) }}>
            <Icon className="size-5" />
          </div>
        </div>
        <div className="-mt-1 text-xl font-bold tabular-nums sm:text-2xl">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{note}</div>
      </CardContent>
    </Card>
  );
}
