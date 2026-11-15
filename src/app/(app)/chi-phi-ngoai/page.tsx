import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Coins, Fuel, Printer, Receipt, Scale, UserRound } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EntityListSection, resolveEntityTabs } from "@/components/entities/entity-list-section";
import { formatNumber, formatVND, todayVN } from "@/lib/format";
import { toneVar, type Tone } from "@/lib/tones";

export const metadata: Metadata = { title: "Chi phí ngoài chuyến" };

type Row = {
  expense_date: string;
  amount: number;
  vat_amount: number;
  total_amount: number;
  quantity: number | null;
  paid_by: string;
  payment_status: string;
  has_invoice: boolean;
  overhead_categories: { kind: string } | null;
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("overhead.view");
  const sp = await searchParams;
  const supabase = await createClient();
  const month = todayVN().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const [cur, unpaid] = await Promise.all([
    supabase
      .from("overhead_expenses")
      .select("expense_date, amount, vat_amount, total_amount, quantity, paid_by, payment_status, has_invoice, overhead_categories(kind)")
      .gte("expense_date", `${month}-01`)
      .lt("expense_date", nextMonth)
      .limit(10000),
    supabase.from("overhead_expenses").select("total_amount").eq("paid_by", "personal").eq("payment_status", "unpaid").limit(10000),
  ]);
  if (cur.error) throw cur.error;
  if (unpaid.error) throw unpaid.error;
  const rows = (cur.data ?? []) as unknown as Row[];
  const sum = (rs: Row[], k: "amount" | "vat_amount" | "total_amount" | "quantity") => rs.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const fuel = rows.filter((r) => r.overhead_categories?.kind === "fuel");
  const invoiced = rows.filter((r) => r.has_invoice);
  const unpaidTotal = (unpaid.data ?? []).reduce((a, r) => a + Number(r.total_amount ?? 0), 0);

  const { active, nav } = await resolveEntityTabs({
    basePath: "/chi-phi-ngoai",
    searchParams: sp,
    tabs: [
      { key: "overhead_expenses", label: "Khoản chi" },
      { key: "report_overhead_vehicle_month", label: "Dầu, chi phí theo xe hàng tháng" },
      { key: "report_overhead_by_category", label: "Theo loại phí, tháng" },
      { key: "overhead_categories", label: "Loại phí" },
    ],
  });
  const label = `${month.slice(5)}/${month.slice(0, 4)}`;
  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Chi phí ngoài chuyến"
        description="Các khoản chi không gắn với chuyến: thuê kế toán, báo cáo thuế, dầu theo xe, xăng đi lại, sửa chữa, văn phòng… Loại phí thêm được ngay ở ô chọn. Chỉ nội bộ GHA thấy (tài khoản khách hàng không thấy)."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/in-phieu">
                <Printer /> In đề nghị thanh toán, tạm ứng
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/bao-cao-thue">
                <Scale /> Cân đối thu chi, thuế
              </Link>
            </Button>
            {me.permissions.has("fuel.view") ? (
              <Button asChild variant="outline">
                <Link href="/dau-xe">
                  <Fuel /> Dầu theo xe (định mức)
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 [&>*]:min-w-0">
        <Kpi icon={Coins} tone="blue" label={`Chi ngoài chuyến tháng ${label}`} value={formatVND(sum(rows, "amount"))} note={`${rows.length} khoản · tiền trước thuế`} />
        <Kpi icon={Fuel} tone="amber" label="Dầu, xăng trong tháng" value={formatVND(sum(fuel, "amount"))} note={`${formatNumber(sum(fuel, "quantity"))} lít · ${fuel.length} lần đổ`} />
        <Kpi icon={Receipt} tone="green" label="VAT đầu vào trong tháng" value={formatVND(sum(invoiced, "vat_amount"))} note={`${invoiced.length} khoản có hóa đơn`} />
        <Kpi icon={UserRound} tone="purple" label="Cá nhân chi, chưa hoàn" value={formatVND(unpaidTotal)} note={`${(unpaid.data ?? []).length} khoản (mọi tháng)`} />
      </div>
      {nav}
      {active ? <EntityListSection entityKey={active} searchParams={sp} revalidate="/chi-phi-ngoai" /> : null}
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
