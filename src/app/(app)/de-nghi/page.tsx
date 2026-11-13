import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import { Banknote, Clock, HandCoins, Wallet } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EntityListSection, resolveEntityTabs } from "@/components/entities/entity-list-section";
import { formatVND, todayVN } from "@/lib/format";
import { toneVar, type Tone } from "@/lib/tones";

export const metadata: Metadata = { title: "Đề nghị chi, mua sắm" };

type Sum = { status: string; amount_to_pay: number; paid_amount: number; remaining_amount: number; request_date: string };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("purchase_requests.view", "purchase_requests.create", "purchase_requests.pay");
  const sp = await searchParams;
  const supabase = await createClient();
  const month = `${todayVN().slice(0, 7)}-01`;
  // Số liệu nhanh (RLS: người lập chỉ thấy phiếu của mình)
  const { data, error } = await supabase
    .from("purchase_request_list")
    .select("status, amount_to_pay, paid_amount, remaining_amount, request_date")
    .or(`status.in.(pending,approved,partial),request_date.gte.${month}`)
    .limit(5000);
  if (error) throw error;
  const rows = (data ?? []) as Sum[];
  const pending = rows.filter((r) => r.status === "pending");
  const toPay = rows.filter((r) => r.status === "approved" || r.status === "partial");
  const thisMonth = rows.filter((r) => r.request_date >= month && r.status !== "cancelled" && r.status !== "rejected");
  const sum = (xs: Sum[], k: keyof Sum) => xs.reduce((a, x) => a + Number(x[k] ?? 0), 0);

  const { active, nav } = await resolveEntityTabs({
    basePath: "/de-nghi",
    searchParams: sp,
    tabs: [
      { key: "purchase_requests", label: "Phiếu đề nghị" },
      { key: "report_purchase_requests", label: "Báo cáo theo tháng, loại" },
      { key: "purchase_request_types", label: "Loại đề nghị" },
    ],
  });
  const seesAll = me.permissions.has("purchase_requests.view") || me.permissions.has("purchase_requests.pay");
  return (
    <>
      <PageHeader
        title="Đề nghị chi, mua sắm"
        description="Mua văn phòng phẩm, sửa văn phòng, mua máy móc thiết bị… Nhân viên lập phiếu, Giám đốc duyệt (người lập không tự duyệt), Kế toán chi tiền một hoặc nhiều lần. Lọc trạng thái “Đã duyệt, chờ chi” để xem phiếu cần chi."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 [&>*]:min-w-0">
        <Kpi icon={Clock} tone="amber" label="Chờ Giám đốc duyệt" value={sum(pending, "amount_to_pay")} note={`${pending.length} phiếu`} />
        <Kpi icon={Wallet} tone="blue" label="Đã duyệt, chờ chi" value={sum(toPay, "remaining_amount")} note={`${toPay.length} phiếu còn phải chi`} />
        <Kpi icon={HandCoins} tone="purple" label="Đề nghị trong tháng" value={sum(thisMonth, "amount_to_pay")} note={`${thisMonth.length} phiếu (số duyệt hoặc số đề nghị)`} />
        <Kpi icon={Banknote} tone="green" label="Đã chi (phiếu trong tháng)" value={sum(thisMonth, "paid_amount")} note={seesAll ? "Tất cả phiếu lập trong tháng" : "Phiếu của bạn lập trong tháng"} />
      </div>
      {nav}
      {active ? <EntityListSection entityKey={active} searchParams={sp} revalidate="/de-nghi" /> : null}
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
