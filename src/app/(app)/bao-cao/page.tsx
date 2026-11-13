import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Banknote, HandCoins, Layers, PiggyBank, Receipt, TrendingUp } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart } from "@/components/charts/line-chart";
import { EntityListSection, resolveEntityTabs } from "@/components/entities/entity-list-section";
import { formatVND, todayVN } from "@/lib/format";
import { toneVar, type Tone } from "@/lib/tones";

export const metadata: Metadata = { title: "Báo cáo" };

type Month = {
  report_month: string;
  month_label: string;
  trips: number;
  revenue: number;
  cost: number;
  profit: number;
  cash_in: number;
  cash_out: number;
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("reports.view");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("report_monthly")
    .select("report_month, month_label, trips, revenue, cost, profit, cash_in, cash_out")
    .order("report_month", { ascending: false })
    .limit(12);
  if (error) throw error;
  const months = ((data ?? []) as Month[]).map((m) => ({
    ...m,
    revenue: Number(m.revenue),
    cost: Number(m.cost),
    profit: Number(m.profit),
    cash_in: Number(m.cash_in),
  }));
  const current = `${todayVN().slice(0, 7)}-01`;
  const cur = months.find((m) => m.report_month === current);
  let receivable: number | null = null;
  if (me.permissions.has("receivables.view")) {
    const r = await supabase.from("receivable_list").select("remaining_amount").in("status", ["open", "partial"]);
    if (r.error) throw r.error;
    receivable = (r.data ?? []).reduce((a, x) => a + Number(x.remaining_amount), 0);
  }
  const chart = months.slice(0, 6).reverse();
  const mil = (v: number) => Math.round(v / 100_000) / 10;

  const { active, nav } = await resolveEntityTabs({
    basePath: "/bao-cao",
    searchParams: sp,
    tabs: [
      { key: "report_shipments" },
      { key: "report_freight" },
      { key: "report_pass_through" },
      { key: "report_loading" },
      { key: "report_carrier_trips" },
      { key: "report_carrier_by_supplier" },
      { key: "report_fee_type" },
      { key: "report_fee_lines" },
      { key: "report_monthly" },
      { key: "report_vehicle" },
      { key: "report_driver" },
      { key: "report_customer" },
      { key: "report_expense" },
      { key: "report_advance" },
      { key: "report_purchase_requests" },
    ],
  });

  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Báo cáo"
        description="Số liệu thật tính trực tiếp từ chuyến, chi phí đã duyệt và phiếu thu chi. Mọi bảng đều tìm kiếm nâng cao, chọn cột và xuất Excel được."
        actions={
          <Link href="/bao-cao/nhom-phi" className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium text-primary hover:bg-muted">
            <Layers className="size-4" /> Chi phí theo nhóm (ngày, tuần, tháng, năm)
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5 [&>*]:min-w-0">
        <Kpi icon={TrendingUp} tone="blue" label="Doanh thu tháng này" value={cur?.revenue ?? 0} note={`${cur?.trips ?? 0} chuyến`} />
        <Kpi icon={Receipt} tone="amber" label="Chi phí chuyến tháng này" value={cur?.cost ?? 0} note="Chỉ tính chi phí đã duyệt" />
        <Kpi icon={PiggyBank} tone="green" label="Lợi nhuận gộp tháng này" value={cur?.profit ?? 0} note="Doanh thu trừ chi phí chuyến" />
        <Kpi icon={Banknote} tone="teal" label="Tiền thu thực tế tháng này" value={cur?.cash_in ?? 0} note="Theo phiếu thu đã ghi sổ" />
        {receivable !== null ? <Kpi icon={HandCoins} tone="red" label="Khách còn nợ" value={receivable} note="Tổng phải thu chưa thu" /> : null}
      </div>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Doanh thu, chi phí, lợi nhuận 6 tháng gần đây</CardTitle>
          <CardDescription>Đơn vị: triệu đồng. Doanh thu gồm cước, phụ phí, hỗ trợ dầu và phí khác; không gồm tiền chi hộ.</CardDescription>
        </CardHeader>
        <CardContent>
          {chart.length ? (
            <LineChart
              unit="triệu đồng"
              labels={chart.map((m) => m.month_label)}
              series={[
                { name: "Doanh thu", tone: "blue", values: chart.map((m) => mil(m.revenue)) },
                { name: "Chi phí", tone: "amber", values: chart.map((m) => mil(m.cost)) },
                { name: "Lợi nhuận", tone: "green", values: chart.map((m) => mil(m.profit)) },
              ]}
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">Chưa có chuyến nào đang chạy hoặc đã hoàn thành.</p>
          )}
        </CardContent>
      </Card>
      <div className="mt-6">
        {nav}
        {active ? <EntityListSection entityKey={active} searchParams={sp} revalidate="/bao-cao" /> : null}
      </div>
    </>
  );
}

function Kpi({ icon: Icon, tone, label, value, note }: { icon: LucideIcon; tone: Tone; label: string; value: number; note: string }) {
  return (
    <Card className="h-full">
      <CardContent>
        <div className="flex items-start justify-between gap-2">
          <div className="pt-0.5 text-sm text-muted-foreground">{label}</div>
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm sm:size-10" style={{ background: toneVar(tone) }}>
            <Icon className="size-5" />
          </div>
        </div>
        <div className="-mt-1 text-xl font-bold tabular-nums sm:text-2xl">{formatVND(value)}</div>
        <div className="mt-1 text-xs text-muted-foreground">{note}</div>
      </CardContent>
    </Card>
  );
}
