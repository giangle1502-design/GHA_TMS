import type { Metadata } from "next";
import { attachDriverPay } from "@/lib/driver-pay";
import Link from "next/link";
import { Ban, FileSpreadsheet, ReceiptText } from "lucide-react";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { loadTableView } from "@/lib/entities/server";
import { SHIPMENT_ADV_FIELDS } from "@/lib/shipments";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { addDaysYMD, formatVND, startOfDayVN } from "@/lib/format";
import { SHIPMENT_STATUS } from "@/lib/status";
import { TONE_BADGE } from "@/lib/tones";
import type { ShipmentListRow } from "@/lib/shipments";
import { advRefLabels, applyShipmentFilters, parseShipmentFilters, shipmentCustomFields, type ShipmentFilters } from "@/lib/shipments-query";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TabLink } from "@/components/dispatch/tab-link";
import { ShipmentFilterBar } from "./filter-bar";
import { ShipmentGrid } from "./shipment-grid";
import { DriverInfoButton } from "@/components/dispatch/driver-info-button";
import { ExportShipmentsButton } from "./export-button";
import { ReportLinks } from "@/components/reports/report-links";

export const metadata: Metadata = { title: "Quản lý chuyến xe" };

const PAGE_SIZE = 100;

type Bucket = {
  count: number;
  freight: number;
  surcharge: number;
  fuel: number;
  revenue: number;
  transport: number;
  pass_through: number;
  declaration: number;
  loading: number;
  other: number;
};
type Summary = { total: number; by_status: Record<string, Bucket> };
const MONEY_KEYS = ["transport", "pass_through", "declaration", "loading", "other"] as const;

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("shipments.view");
  const sp = await searchParams;
  const supabase = await createClient();
  const custom = await shipmentCustomFields(supabase, me.permissions);
  const f = parseShipmentFilters(sp, custom.adv);
  const page = Math.max(1, Math.min(1000, Number(sp.trang) || 1));
  // Chuyến hủy không hiện ở Quản lý chuyến: xem và khôi phục ở danh sách Chuyến hủy
  if (f.tt === "cancelled") redirect(`/dieu-phoi/chuyen-huy?${new URLSearchParams({ tu: f.tu, den: f.den }).toString()}`);
  const canEdit = me.permissions.has("shipments.update") || me.permissions.has("dispatch.update");

  const [listRes, sumRes, view, advLabels] = await Promise.all([
    applyShipmentFilters(supabase.from("shipment_list").select("*", { count: "exact" }), f)
      .neq("status", "cancelled")
      .order("pickup_at", { ascending: false })
      .order("shipment_code", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    // Đếm theo trạng thái và cộng tiền trên toàn bộ kết quả lọc (không theo trang)
    f.adv.length
      ? summarize(supabase, f)
      : supabase.rpc("shipment_list_summary", {
          p_from: startOfDayVN(f.tu),
          p_to: startOfDayVN(addDaysYMD(f.den, 1)),
          p_customer_id: f.kh || null,
          p_q: f.q || null,
        }),
    loadTableView(supabase, "shipment_grid", me.id),
    advRefLabels(supabase, f.adv, [...SHIPMENT_ADV_FIELDS, ...custom.adv]),
  ]);
  if (listRes.error) throw listRes.error;
  if (sumRes.error) throw sumRes.error;
  const listRows = await attachDriverPay(supabase, (listRes.data ?? []) as ShipmentListRow[]);
  // Điền nhanh CCCD / GPLX còn thiếu trong hộp Thông tin tài xế
  const canFillDriver = me.permissions.has("dispatch.update") || (me.permissions.has("drivers.view_sensitive") && me.permissions.has("drivers.update"));
  // Lời/lỗ từng chuyến của trang đang xem (chỉ người có quyền xem chi phí hoặc báo cáo)
  const canSeeProfit = me.permissions.has("expenses.view") || me.permissions.has("reports.view");
  const profitRes =
    canSeeProfit && listRows.length
      ? await supabase.from("shipment_profit").select("shipment_id, trip_cost, vehicle_cost, profit").in("shipment_id", listRows.map((r) => r.id))
      : { data: [] };
  const profits = new Map(((profitRes.data ?? []) as { shipment_id: string; trip_cost: number; vehicle_cost: number; profit: number }[]).map((p) => [p.shipment_id, p]));
  const rows = listRows.map((r) => {
    const p = profits.get(r.id);
    return p ? { ...r, trip_cost: p.trip_cost, vehicle_cost: p.vehicle_cost, profit: p.profit } : r;
  });
  // Nút chép thông tin tài xế cho các chuyến đang xem (bỏ chuyến hủy, chưa có tài xế)
  const shareIds = rows.filter((r) => r.driver_id && r.status !== "cancelled").map((r) => r.id).slice(0, 500);
  const total = listRes.count ?? rows.length;
  const summary = sumRes.data as Summary;
  const cancelledCount = summary.by_status.cancelled?.count ?? 0;
  const allCount = summary.total - cancelledCount;
  const counts = Object.fromEntries(SHIPMENT_STATUS.filter((s) => s.value !== "cancelled").map((s) => [s.value, summary.by_status[s.value]?.count ?? 0]));
  // Thẻ tổng theo nhóm phí (không tính chuyến hủy)
  const money = Object.entries(summary.by_status)
    .filter(([st]) => st !== "cancelled" && (!f.tt || f.tt === "tre" || f.tt === "cho-duyet" || f.tt === st))
    .reduce(
      (a, [, v]) => {
        for (const k of MONEY_KEYS) a[k] += Number(v[k] ?? 0);
        return a;
      },
      { transport: 0, pass_through: 0, declaration: 0, loading: 0, other: 0 },
    );
  const moneyTotal = MONEY_KEYS.reduce((a, k) => a + money[k], 0);

  const href = (p: Partial<ShipmentFilters> & { trang?: number }) => {
    const merged = { ...f, ...p };
    const q = new URLSearchParams();
    for (const k of ["tu", "den", "tt", "kh", "q"] as const) if (merged[k]) q.set(k, merged[k]);
    for (const a of merged.adv) q.append("a", a);
    if (p.trang && p.trang > 1) q.set("trang", String(p.trang));
    return `/chuyen-xe?${q.toString()}`;
  };
  const cancelHref = (() => {
    const q = new URLSearchParams({ tu: f.tu, den: f.den });
    if (f.kh) q.set("kh", f.kh);
    if (f.q) q.set("q", f.q);
    for (const a of f.adv) q.append("a", a);
    return `/dieu-phoi/chuyen-huy?${q.toString()}`;
  })();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Quản lý chuyến xe"
        description="Bảng tổng hợp, mỗi dòng một chuyến. Bấm vào ô có viền chấm để sửa nhanh; mọi thay đổi được ghi vào nhật ký hệ thống."
        actions={
          <>
            <DriverInfoButton variant="outline" shipmentIds={shareIds} label={`Thông tin tài xế (${shareIds.length} chuyến)`} canFill={canFillDriver} />
            <Button variant="outline" asChild>
              <Link href={`/chuyen-xe/bang-ke?${new URLSearchParams(f.kh ? { kh: f.kh } : {}).toString()}`}>
                <ReceiptText /> Bảng kê cước
              </Link>
            </Button>
            {me.permissions.has("dispatch.create") ? (
              <Button variant="outline" asChild>
                <Link href="/dieu-phoi/nhap-excel?tu=chuyen-xe">
                  <FileSpreadsheet /> Nhập từ Excel
                </Link>
              </Button>
            ) : null}
            {me.permissions.has("shipments.export") ? <ExportShipmentsButton params={{ tu: f.tu, den: f.den, tt: f.tt, kh: f.kh, q: f.q, a: f.adv }} /> : null}
          </>
        }
      />
      {me.permissions.has("reports.view") ? <ReportLinks /> : null}
      <ShipmentFilterBar filters={f} />
      <div className={`mb-3 grid grid-cols-2 gap-2 ${money.other ? "sm:grid-cols-3 lg:grid-cols-6" : "sm:grid-cols-5"}`}>
        <Sum label="Phí vận chuyển" hint="Đơn giá × (1 + % dầu) + phụ thu vé + hạ xa, BOT + neo xe" value={money.transport} />
        <Sum label="Phí chi hộ" hint="Hạ + nâng + cược cont" value={money.pass_through} />
        <Sum label="Phí tờ khai" value={money.declaration} />
        <Sum label="Phí bốc xếp" hint="Bởi tài xế, 3-PL, bồi dưỡng" value={money.loading} />
        {money.other ? <Sum label="Phí khác (chưa xếp nhóm)" value={money.other} /> : null}
        <Sum label="Tổng khách phải trả" hint="Không tính chuyến hủy" value={moneyTotal} strong />
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-1 border-b px-4 py-3" role="tablist">
          <TabLink href={href({ tt: "", trang: 1 })} active={!f.tt} label="Tất cả" count={allCount} />
          {SHIPMENT_STATUS.filter((s) => s.value !== "cancelled" && counts[s.value] > 0).map((s) => (
            <TabLink key={s.value} href={href({ tt: s.value, trang: 1 })} active={f.tt === s.value} label={s.label} count={counts[s.value]} tone={TONE_BADGE[s.tone]} />
          ))}
          <Link
            href={cancelHref}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Chuyến đã hủy không hiện ở đây. Tìm và khôi phục ở danh sách Chuyến hủy."
          >
            <Ban className="size-4 text-destructive" /> Chuyến hủy ({cancelledCount})
          </Link>
        </div>
        <ShipmentGrid rows={rows} canEdit={canEdit} view={view} adv={f.adv} advLabels={advLabels} customDefs={custom.defs} customAdv={custom.adv} canAddField={me.permissions.has("fields.configure")} canSeeProfit={canSeeProfit} canFillDriver={canFillDriver} />
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
          <span>
            {total === 0 ? "Không có chuyến phù hợp" : `Dòng ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} / ${total} chuyến`}
          </span>
          {pages > 1 ? (
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={href({ trang: page - 1 })}>Trang trước</Link>
                </Button>
              ) : null}
              <span>
                Trang {page}/{pages}
              </span>
              {page < pages ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={href({ trang: page + 1 })}>Trang sau</Link>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
      {canSeeProfit ? <p className="mt-3 text-xs text-muted-foreground">
        Cột Lời/lỗ = doanh thu − chi phí chuyến đã duyệt − chi phí xe (sửa chữa, bảo hiểm...) chia đều theo số chuyến của xe trong tháng. Chỉ tính chuyến đang chạy hoặc đã hoàn thành.
      </p> : null}
    </>
  );
}

function Sum({ label, hint, value, strong }: { label: string; hint?: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2" title={hint}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={strong ? "font-semibold text-primary" : "font-medium"}>{formatVND(value)}</div>
      {hint ? <div className="truncate text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

type SumRow = { id: string; status: string; freight_amount: number; surcharge_amount: number; fuel_support_amount: number; total_revenue: number };
type RoleRow = { shipment_id: string; transport_fee: number; pass_through_fee: number; declaration_fee: number; loading_fee: number; other_fee: number };

/** Tổng hợp theo trạng thái khi có tìm kiếm nâng cao (hàm tổng hợp trong CSDL chỉ nhận bộ lọc cơ bản) */
async function summarize(supabase: SupabaseClient, f: ShipmentFilters): Promise<{ data: Summary; error: null }> {
  const by: Summary["by_status"] = {};
  let total = 0;
  const all: SumRow[] = [];
  for (let p = 0; p < 20; p++) {
    const { data, error } = await applyShipmentFilters(supabase.from("shipment_list").select("id, status, freight_amount, surcharge_amount, fuel_support_amount, total_revenue"), f, { status: false })
      .order("id")
      .range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    const rows = (data ?? []) as SumRow[];
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  // Tổng phí theo nhóm của các chuyến đã lọc (đọc theo lô 200 mã)
  const roles = new Map<string, RoleRow>();
  for (let i = 0; i < all.length; i += 200) {
    const { data, error } = await supabase
      .from("shipment_fee_role_totals")
      .select("shipment_id, transport_fee, pass_through_fee, declaration_fee, loading_fee, other_fee")
      .in("shipment_id", all.slice(i, i + 200).map((r) => r.id));
    if (error) throw error;
    for (const r of (data ?? []) as RoleRow[]) roles.set(r.shipment_id, r);
  }
  for (const r of all) {
    const b = (by[r.status] ??= { count: 0, freight: 0, surcharge: 0, fuel: 0, revenue: 0, transport: 0, pass_through: 0, declaration: 0, loading: 0, other: 0 });
    const x = roles.get(r.id);
    b.count++;
    b.freight += Number(r.freight_amount);
    b.surcharge += Number(r.surcharge_amount);
    b.fuel += Number(r.fuel_support_amount);
    b.revenue += Number(r.total_revenue);
    b.transport += x ? Number(x.transport_fee) : Number(r.freight_amount) + Number(r.surcharge_amount) + Number(r.fuel_support_amount);
    b.pass_through += Number(x?.pass_through_fee ?? 0);
    b.declaration += Number(x?.declaration_fee ?? 0);
    b.loading += Number(x?.loading_fee ?? 0);
    b.other += Number(x?.other_fee ?? 0);
    total++;
  }
  return { data: { total, by_status: by }, error: null };
}
