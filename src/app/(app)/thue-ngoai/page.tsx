import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Banknote, HandCoins, Receipt, Truck } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import { Card, CardContent } from "@/components/ui/card";
import { EntityListSection, resolveEntityTabs } from "@/components/entities/entity-list-section";
import { BulkCarrierPayDialog } from "@/components/finance/carrier-dialogs";
import { formatNumber, formatVND, todayVN } from "@/lib/format";
import { toneVar, type Tone } from "@/lib/tones";

export const metadata: Metadata = { title: "Xe thuê ngoài 3PL" };

type Row = {
  report_month: string;
  pay_status: string;
  carrier_freight: number;
  carrier_pass_through: number;
  carrier_total: number;
  paid_amount: number;
  remaining_amount: number;
  overdue_days: number;
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("reports.view", "receivables.view");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("report_carrier_trips")
    .select("report_month, pay_status, carrier_freight, carrier_pass_through, carrier_total, paid_amount, remaining_amount, overdue_days")
    .limit(20000);
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const month = `${todayVN().slice(0, 7)}-01`;
  const cur = rows.filter((r) => r.report_month === month);
  const sum = (rs: Row[], k: keyof Row) => rs.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const overdue = rows.filter((r) => Number(r.overdue_days) > 0);
  const noCost = rows.filter((r) => r.pay_status === "no_cost").length;

  const { active, nav } = await resolveEntityTabs({
    basePath: "/thue-ngoai",
    searchParams: sp,
    tabs: [{ key: "report_carrier_trips" }, { key: "report_carrier_by_supplier" }],
  });

  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Xe thuê ngoài 3PL"
        description="Các chuyến chạy xe thuê ngoài: cước và phí chi hộ phải trả nhà xe, đã trả, còn nợ. Nhập chi phí 3PL ở chi tiết chuyến (nút Chi phí ở từng dòng). Mọi bảng tìm kiếm nâng cao, chọn cột, xuất Excel được."
        actions={me.permissions.has("receivables.pay") ? <BulkCarrierPayDialog /> : null}
      />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5 [&>*]:min-w-0">
        <Kpi icon={Truck} tone="blue" label="Chuyến 3PL tháng này" value={formatNumber(cur.length)} note={`Cước ${formatVND(sum(cur, "carrier_freight"))}`} />
        <Kpi icon={Receipt} tone="amber" label="Phải trả 3PL tháng này" value={formatVND(sum(cur, "carrier_total"))} note={`Gồm chi hộ ${formatVND(sum(cur, "carrier_pass_through"))}`} />
        <Kpi icon={Banknote} tone="green" label="Đã trả 3PL (tất cả)" value={formatVND(sum(rows, "paid_amount"))} note="Theo phiếu chi đã ghi" />
        <Kpi icon={HandCoins} tone="red" label="Còn nợ nhà xe" value={formatVND(sum(rows, "remaining_amount"))} note={`${rows.filter((r) => Number(r.remaining_amount) > 0).length} chuyến chưa trả đủ`} />
        <Kpi
          icon={AlertTriangle}
          tone="purple"
          label="Quá hạn / chưa nhập"
          value={formatVND(sum(overdue, "remaining_amount"))}
          note={`${overdue.length} chuyến quá hạn · ${noCost} chuyến chưa nhập chi phí`}
        />
      </div>
      <div className="mt-6">
        {nav}
        {active ? <EntityListSection entityKey={active} searchParams={sp} revalidate="/thue-ngoai" /> : null}
      </div>
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
