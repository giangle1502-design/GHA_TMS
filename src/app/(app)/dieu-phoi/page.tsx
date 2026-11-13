import type { Metadata } from "next";
import { attachDriverPay } from "@/lib/driver-pay";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Ban, Plus, Truck, ListChecks, ListOrdered, FileSpreadsheet } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { addDaysYMD, formatDate, startOfDayVN, todayVN } from "@/lib/format";
import { SHIPMENT_STATUS } from "@/lib/status";
import { TONE_BADGE } from "@/lib/tones";
import { isLate, SHIPMENT_ADV_FIELDS, type ShipmentListRow } from "@/lib/shipments";
import { isUuid } from "@/lib/entities/record";
import { loadTableView } from "@/lib/entities/server";
import { advRefLabels, applyShipmentFilters, parseShipmentFilters, shipmentCustomFields } from "@/lib/shipments-query";
import { loadFreeVehicles } from "@/lib/free-vehicles";
import { dispatchExtraColumns } from "@/lib/dispatch-columns";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DispatchTable } from "@/components/dispatch/dispatch-table";
import { TabLink } from "@/components/dispatch/tab-link";
import { DispatchFilterBar } from "@/components/dispatch/dispatch-filter-bar";
import { FreeVehiclesGrid } from "@/components/dispatch/free-vehicles-grid";
import { cn } from "@/lib/utils";
import { ReportLinks } from "@/components/reports/report-links";
import { TripApprovalButtons } from "@/components/dispatch/trip-approval";
import { DriverInfoButton } from "@/components/dispatch/driver-info-button";
import { DayPlanButton } from "@/components/dispatch/day-plan-button";
import { DelegateNotice, TripDelegationManager, type DelegationInfo } from "@/components/dispatch/trip-delegation";

export const metadata: Metadata = { title: "Điều phối" };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 1000;
/** Khoảng ngày tối đa của màn hình điều phối */
const MAX_SPAN = 92;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePagePermission("dispatch.view");
  const raw = await searchParams;
  const today = todayVN();
  // Mặc định hôm nay; ?ngay= (liên kết cũ) = một ngày
  const ngay = one(raw.ngay);
  const tuRaw = one(raw.tu) ?? (ngay && YMD.test(ngay) ? ngay : today);
  const denRaw = one(raw.den) ?? tuRaw;
  const supabase = await createClient();
  const custom = await shipmentCustomFields(supabase, me.permissions);
  const f = parseShipmentFilters({ ...raw, tu: tuRaw, den: denRaw }, custom.adv);
  if (f.den > addDaysYMD(f.tu, MAX_SPAN - 1)) f.den = addDaysYMD(f.tu, MAX_SPAN - 1);
  const xe = isUuid(one(raw.xe) ?? "") ? one(raw.xe)! : "";
  // Liên kết cũ tới tab Đã hủy: chuyển sang danh sách Chuyến hủy
  if (f.tt === "cancelled") redirect(`/dieu-phoi/chuyen-huy?${new URLSearchParams({ tu: f.tu, den: f.den }).toString()}`);
  const tx = isUuid(one(raw.tx) ?? "") ? one(raw.tx)! : "";
  const xem = one(raw.xem) === "xe-trong" ? "xe-trong" : "";
  const tab = f.tt;
  const single = f.tu === f.den;
  const totalDays = Math.round((Date.parse(f.den) - Date.parse(f.tu)) / 86400000) + 1;
  const advFields = [...SHIPMENT_ADV_FIELDS, ...custom.adv];

  // Chuyến hủy không hiện ở Điều phối: xem và khôi phục ở danh sách Chuyến hủy
  let listQ = applyShipmentFilters(supabase.from("shipment_list").select("*"), { ...f, tt: "" }).neq("status", "cancelled");
  if (xe) listQ = listQ.eq("vehicle_id", xe);
  if (tx) listQ = listQ.eq("driver_id", tx);
  let cancelQ = applyShipmentFilters(supabase.from("shipment_list").select("id", { count: "exact", head: true }), { ...f, tt: "" }).eq("status", "cancelled");
  if (xe) cancelQ = cancelQ.eq("vehicle_id", xe);
  if (tx) cancelQ = cancelQ.eq("driver_id", tx);
  const [listRes, upcomingRes, free, view, advLabels, approvalRes, delegationRes, attPendingRes, routeGapRes, cancelRes] = await Promise.all([
    listQ.order("pickup_at").order("shipment_code").limit(MAX_ROWS),
    // Chuyến chưa phân công ở ngoài khoảng ngày đang xem (từ hôm nay trở đi)
    supabase
      .from("shipment_list")
      .select("*")
      .eq("status", "draft")
      .gte("pickup_at", startOfDayVN(today))
      .or(`pickup_at.lt.${startOfDayVN(f.tu)},pickup_at.gte.${startOfDayVN(addDaysYMD(f.den, 1))}`)
      .order("pickup_at")
      .limit(30),
    loadFreeVehicles(supabase, f.tu, f.den, { vehicleId: xe, driverId: tx }),
    loadTableView(supabase, xem ? "dispatch_free_vehicles" : "dispatch_list", me.id),
    advRefLabels(supabase, f.adv, advFields),
    // Chuyến chờ Giám đốc duyệt ở mọi ngày (tài xế chưa thấy)
    supabase
      .from("shipment_list")
      .select("id, dispatch_approval_request_id, can_approve_dispatch")
      .eq("dispatch_approval", "pending")
      .neq("status", "cancelled")
      .order("pickup_at")
      .limit(200),
    supabase.rpc("trip_delegation_info"),
    supabase.rpc("attendance_pending_count"),
    supabase.rpc("route_pay_gap_count"),
    cancelQ,
  ]);
  const cancelledCount = cancelRes.count ?? 0;
  // Lỗi (ví dụ DB chưa nâng cấp chấm công) thì bỏ qua, không chặn màn Điều phối
  const attPending = attPendingRes.error ? 0 : Number(attPendingRes.data ?? 0);
  const routeGaps = routeGapRes.error ? 0 : Number(routeGapRes.data ?? 0);
  const delegation = (delegationRes.data ?? null) as DelegationInfo | null;
  if (listRes.error) throw listRes.error;
  if (upcomingRes.error) throw upcomingRes.error;
  const all = await attachDriverPay(supabase, (listRes.data ?? []) as ShipmentListRow[]);
  const term = f.q.toLowerCase();
  const upcoming = ((upcomingRes.data ?? []) as ShipmentListRow[]).filter(
    (r) =>
      (!f.kh || r.customer_id === f.kh) &&
      (!term || [r.shipment_code, r.order_code, r.customer_name, r.pickup_name, r.delivery_name, r.notes].some((v) => v?.toLowerCase().includes(term))),
  );
  // Chuyến đã giao (chờ quyết toán, đã đóng) không còn việc điều phối: ẩn khỏi danh sách mặc định, xem ở tab trạng thái
  const DONE = ["driver_completed", "closed"];
  const active = all.filter((r) => !DONE.includes(r.status));
  const now = new Date().getTime();
  const lateCount = all.filter((r) => isLate(r, now)).length;
  const rows =
    tab === "tre"
      ? all.filter((r) => isLate(r, now))
      : tab === "tat-ca"
        ? all
        : tab === "cho-duyet"
        ? all.filter((r) => r.dispatch_approval === "pending" || r.dispatch_approval === "rejected")
        : tab
          ? all.filter((r) => r.status === tab)
          : active;
  const approvalCount = all.filter((r) => r.dispatch_approval === "pending" || r.dispatch_approval === "rejected").length;
  const pendingAll = (approvalRes.data ?? []) as { id: string; dispatch_approval_request_id: string | null; can_approve_dispatch: boolean }[];
  const myApprovals = pendingAll.filter((r) => r.can_approve_dispatch && r.dispatch_approval_request_id).map((r) => r.dispatch_approval_request_id!);
  const extras = xem ? { columns: [], values: {} } : await dispatchExtraColumns(supabase, me.permissions, [...all, ...upcoming]);
  const tableProps = { view, extraColumns: extras.columns, extraValues: extras.values, canAddField: me.permissions.has("fields.configure") };
  const counts = Object.fromEntries(SHIPMENT_STATUS.filter((s) => s.value !== "cancelled").map((s) => [s.value, all.filter((r) => r.status === s.value).length]));
  const freeCount = free.filter((v) => v.free_days > 0).length;
  const filtered = Boolean(f.kh || xe || tx || f.q || f.adv.length);

  const canCreate = me.permissions.has("dispatch.create");
  const canAssign = me.permissions.has("dispatch.update");
  const canCancel = me.permissions.has("dispatch.delete") || me.permissions.has("shipments.delete");
  const canFillDriver = canAssign || (me.permissions.has("drivers.view_sensitive") && me.permissions.has("drivers.update"));
  // Chép thông tin tài xế của các chuyến trong tab đang xem (bỏ chuyến hủy, chưa có tài xế)
  const shareIds = rows.filter((r) => r.driver_id && r.status !== "cancelled").map((r) => r.id).slice(0, 500);
  const href = (p: { tt?: string; xem?: string }) => {
    const q = new URLSearchParams();
    if (f.tu !== today || f.den !== today) {
      q.set("tu", f.tu);
      q.set("den", f.den);
    }
    if (f.kh) q.set("kh", f.kh);
    if (xe) q.set("xe", xe);
    if (tx) q.set("tx", tx);
    if (f.q) q.set("q", f.q);
    for (const a of f.adv) q.append("a", a);
    const t = p.tt ?? tab;
    if (t) q.set("tt", t);
    const x = p.xem ?? xem;
    if (x) q.set("xem", x);
    const s = q.toString();
    return s ? `/dieu-phoi?${s}` : "/dieu-phoi";
  };
  // Danh sách Chuyến hủy giữ khoảng ngày và bộ lọc đang xem
  const cancelHref = (() => {
    const q = new URLSearchParams({ tu: f.tu, den: f.den });
    if (f.kh) q.set("kh", f.kh);
    if (xe) q.set("xe", xe);
    if (tx) q.set("tx", tx);
    if (f.q) q.set("q", f.q);
    for (const a of f.adv) q.append("a", a);
    return `/dieu-phoi/chuyen-huy?${q.toString()}`;
  })();
  const tabLabel =
    tab === "tat-ca" ? "Tất cả" : tab === "tre" ? "Trễ giờ giao" : tab === "cho-duyet" ? "Chờ GĐ duyệt / bị từ chối" : (SHIPMENT_STATUS.find((s) => s.value === tab)?.label ?? tab);
  const rangeText = single ? `ngày ${formatDate(f.tu)}${f.tu === today ? " (hôm nay)" : ""}` : `từ ${formatDate(f.tu)} đến ${formatDate(f.den)} (${totalDays} ngày)`;

  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Điều phối"
        description={`Chuyến nhận hàng ${rangeText}`}
        actions={
          <>
            <TripDelegationManager info={delegation} />
            <DayPlanButton />
            {!xem ? (
              <DriverInfoButton variant="outline" shipmentIds={shareIds} label={`Thông tin tài xế (${shareIds.length} chuyến)`} canFill={canFillDriver} />
            ) : null}
            {canCreate ? (
              <Button variant="outline" asChild>
                <Link href="/dieu-phoi/nhap-excel">
                  <FileSpreadsheet /> Nhập từ Excel
                </Link>
              </Button>
            ) : null}
            {canCreate ? (
              <Button asChild>
                <Link href="/dieu-phoi/tao-don">
                  <Plus /> Tạo đơn hàng
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {me.permissions.has("reports.view") ? <ReportLinks /> : null}

      <DelegateNotice info={delegation} />
      {routeGaps > 0 ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <span>
            <b>{routeGaps}</b> tuyến mới (có chuyến trong 30 ngày) chưa có giá lương chuyến riêng, đang lấy giá mặc định hoặc chưa có giá.
          </span>
          <Link href="/dieu-phoi/tuyen-chua-gia" className="font-medium text-primary hover:underline">
            Điền giá lương chuyến
          </Link>
        </div>
      ) : null}
      {attPending > 0 ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <span>
            <b>{attPending}</b> ngày công tài xế chờ xác nhận: tài xế không có chuyến và không có đơn xin nghỉ.
          </span>
          <Link href="/cham-cong" className="font-medium text-primary hover:underline">
            Mở Chấm công tài xế để xác nhận
          </Link>
        </div>
      ) : null}
      {pendingAll.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <span>
            <b>{pendingAll.length}</b> chuyến đang chờ Giám đốc duyệt (mọi ngày). Tài xế chỉ thấy chuyến sau khi được duyệt.
            {approvalCount > 0 && tab !== "cho-duyet" ? (
              <>
                {" "}
                <Link href={href({ tt: "cho-duyet", xem: "" })} className="font-medium text-primary hover:underline">
                  Xem chuyến chờ duyệt trong ngày đang lọc
                </Link>
              </>
            ) : null}
          </span>
          {myApprovals.length > 0 ? <TripApprovalButtons bulk requestIds={myApprovals} label="" /> : null}
        </div>
      ) : null}

      <DispatchFilterBar filters={{ tu: f.tu, den: f.den, kh: f.kh, xe, tx, q: f.q, adv: f.adv, xem }} today={today} advFields={advFields} advLabels={advLabels} />

      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Chế độ xem">
        <ViewLink href={href({ xem: "", tt: "" })} active={!xem} icon={<ListChecks className="size-4" />} label="Chuyến" count={active.length} />
        <ViewLink href={href({ xem: "xe-trong", tt: "" })} active={xem === "xe-trong"} icon={<Truck className="size-4" />} label="Xe trống, giao thêm được" count={freeCount} warn={freeCount > 0} />
        <Link href={`/so-chuyen?thang=${f.tu.slice(0, 7)}`} className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-primary hover:bg-muted">
          <ListOrdered className="size-4" /> Số chuyến xe, tài xế trong tháng
        </Link>
        <Link
          href={cancelHref}
          className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
          title="Chuyến đã hủy không hiện ở đây. Tìm và khôi phục ở danh sách Chuyến hủy."
        >
          <Ban className="size-4 text-destructive" /> Chuyến hủy
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{cancelledCount}</span>
        </Link>
      </div>

      {xem ? (
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Xe công ty còn trống {rangeText}</CardTitle>
            <CardDescription>
              Chỉ tính xe công ty đang hoạt động (không tính xe thuê ngoài 3PL, xe bảo dưỡng hoặc ngừng hoạt động). Xe bận khi đang có chuyến chưa giao xong (từ ngày nhận hàng đến ngày giao dự kiến). Chuyến đã giao (kể cả đang chờ quyết toán) thì xe trống ngay từ ngày giao, giao thêm đơn được. Chuyến đã hủy không tính. Cột Số chuyến nhận đếm cả chuyến đã giao.
              {tx || xe ? " Đang lọc theo xe/tài xế phụ trách đã chọn." : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="border-t p-0">
            <FreeVehiclesGrid rows={free} view={view} totalDays={totalDays} />
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap gap-1 border-b px-4 py-3" role="tablist">
            <TabLink href={href({ tt: "tat-ca" })} active={tab === "tat-ca"} label={single ? "Tổng chuyến trong ngày" : "Tổng chuyến"} count={all.length} tone="default" />
            <TabLink href={href({ tt: "" })} active={!tab} label="Cần điều phối" count={active.length} />
            {SHIPMENT_STATUS.filter((s) => s.value !== "cancelled" && (counts[s.value] > 0 || ["draft", "assigned"].includes(s.value))).map((s) => (
              <TabLink key={s.value} href={href({ tt: s.value })} active={tab === s.value} label={s.label} count={counts[s.value]} tone={TONE_BADGE[s.tone]} />
            ))}
            {approvalCount > 0 || tab === "cho-duyet" ? (
              <TabLink href={href({ tt: "cho-duyet" })} active={tab === "cho-duyet"} label="Chờ GĐ duyệt / bị từ chối" count={approvalCount} tone="warning" />
            ) : null}
            {lateCount > 0 ? <TabLink href={href({ tt: "tre" })} active={tab === "tre"} label="Trễ giờ giao" count={lateCount} tone="destructive" /> : null}
          </div>
          {all.length >= MAX_ROWS ? (
            <p className="border-b bg-warning/10 px-4 py-2 text-xs">Chỉ hiển thị {MAX_ROWS} chuyến đầu tiên. Thu hẹp khoảng ngày hoặc thêm điều kiện lọc để xem đủ.</p>
          ) : null}
          <DispatchTable
            {...tableProps}
            rows={rows}
            canAssign={canAssign}
            canCancel={canCancel}
            canFillDriver={canFillDriver}
            showDate={!single}
            exportName={{
              filename: `dieu-phoi-${single ? f.tu : `${f.tu}_${f.den}`}`,
              title: `ĐIỀU PHỐI – Chuyến nhận hàng ${rangeText}${tab ? ` – ${tabLabel}` : ""}`,
            }}
            emptyText={f.q ? "Không có chuyến phù hợp với từ khóa." : filtered ? "Không có chuyến phù hợp với bộ lọc." : all.length === 0 ? `Chưa có chuyến nào nhận hàng ${rangeText}.` : !tab ? "Các chuyến đã giao xong, xem ở tab Đã giao – chờ quyết toán hoặc Đã đóng." : "Không có chuyến ở trạng thái này."}
          />
        </Card>
      )}

      {!xem && upcoming.length > 0 ? (
        <Card className="mt-4 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-base">Chuyến chưa phân công ở các ngày khác</CardTitle>
            <CardDescription>Ngoài khoảng ngày đang xem, từ hôm nay trở đi, tối đa 30 chuyến gần nhất.</CardDescription>
          </CardHeader>
          <CardContent className="mt-4 border-t p-0">
            <DispatchTable {...tableProps} toolbar={false} rows={upcoming} canAssign={canAssign} canCancel={canCancel} showDate />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function ViewLink({ href, active, icon, label, count, warn }: { href: string; active: boolean; icon: React.ReactNode; label: string; count: number; warn?: boolean }) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted",
      )}
    >
      {icon}
      {label}
      <span className={cn("rounded-full px-2 py-0.5 text-xs", active ? "bg-primary-foreground/20" : warn ? "bg-warning/20 text-[oklch(0.47_0.12_65)]" : "bg-muted text-muted-foreground")}>{count}</span>
    </Link>
  );
}
