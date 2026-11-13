import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BadgeCheck, Ban, CheckCircle2, ChevronRight, Clock, FileWarning,
  Navigation, ShieldAlert, Truck, UserCheck, Wallet,
} from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { addDaysYMD, formatDate, formatVND, startOfDayVN, todayVN } from "@/lib/format";
import { bucketOf } from "@/lib/report-period";
import { bucketForRange, dashFilterQuery, dmy, monthsForTrend, parseDashFilter, previousRange, vnDate } from "@/lib/dashboard-filter";
import { DashboardFilterBar } from "./filter-bar";
import { SHIPMENT_STATUS, shipmentStatus } from "@/lib/status";
import { TONE_BADGE, toneVar, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Tổng quan" };

type Row = {
  id: string;
  pickup_at: string;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  driver_id: string | null;
  driver_name: string | null;
  vehicle_id: string | null;
  plate_number: string | null;
};

type Recent = {
  id: string;
  shipment_code: string;
  status: string;
  pickup_at: string;
  plate_number: string | null;
  driver_name: string | null;
  customer_name: string | null;
  pickup_name: string | null;
  delivery_name: string | null;
};

type RouteRow = { name: string; pickup_location_id: string; delivery_location_id: string; pickup: { name: string } | null; delivery: { name: string } | null };

const DONE = new Set(["driver_completed", "closed"]);
const PAGE = 1000;

/** Đọc hết các dòng của một truy vấn (PostgREST trả tối đa 1.000 dòng mỗi lần): trang đầu lấy tổng số, các trang sau tải song song */
async function fetchAll<T>(build: () => { range: (a: number, b: number) => PromiseLike<{ data: unknown; error: unknown; count?: number | null }> }, maxRows = 50000) {
  const first = await build().range(0, PAGE - 1);
  if (first.error) throw first.error;
  const rows = [...((first.data ?? []) as T[])];
  const total = Math.min(first.count ?? rows.length, maxRows);
  const rest = [];
  for (let off = PAGE; off < total; off += PAGE) rest.push(build().range(off, off + PAGE - 1));
  for (const r of await Promise.all(rest)) {
    if (r.error) throw r.error;
    rows.push(...((r.data ?? []) as T[]));
  }
  return { rows, truncated: (first.count ?? 0) > maxRows };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePagePermission("dashboard.view");
  const sp = await searchParams;
  const supabase = await createClient();
  const perms = user.permissions;
  const canShip = perms.has("shipments.view") || perms.has("dispatch.view");

  const nowIso = new Date().toISOString();
  const today = todayVN();
  const in30 = addDaysYMD(today, 30);

  const f = parseDashFilter(sp, today);
  const range = { from: f.tu, to: f.den };
  const prev = previousRange(range, f.ky);
  const months = monthsForTrend(range);
  const bucketBy = bucketForRange(range);
  const hasEntity = !!(f.kh || f.tx || f.xe || f.tuyen);
  const rangeLabel = f.tu === f.den ? dmy(f.tu) : `${dmy(f.tu)} – ${dmy(f.den)}`;

  // Tuyến = cặp điểm nhận – điểm giao (chuyến cũ chưa gắn mã tuyến vẫn khớp)
  let route = null as RouteRow | null;
  if (f.tuyen) {
    const { data, error } = await supabase
      .from("routes")
      .select("name, pickup_location_id, delivery_location_id, pickup:locations!routes_pickup_location_id_fkey(name), delivery:locations!routes_delivery_location_id_fkey(name)")
      .eq("id", f.tuyen)
      .maybeSingle();
    if (error) throw error;
    route = data as unknown as RouteRow | null;
  }

  // Áp bộ lọc khách hàng / tài xế / xe / tuyến lên truy vấn shipment_list
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scope = (q: any) => {
    if (f.kh) q = q.eq("customer_id", f.kh);
    if (f.tx) q = q.eq("driver_id", f.tx);
    if (f.xe) q = q.eq("vehicle_id", f.xe);
    if (f.tuyen) {
      q = q.eq("pickup_location_id", route?.pickup_location_id ?? "00000000-0000-0000-0000-000000000000");
      q = q.eq("delivery_location_id", route?.delivery_location_id ?? "00000000-0000-0000-0000-000000000000");
    }
    return q;
  };

  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count: c, error } = await q;
    if (error) throw error;
    return c ?? 0;
  };
  const head = { count: "exact" as const, head: true };

  let rows: Row[] = [];
  let truncated = false;
  let recent: Recent[] = [];
  let inTransit = 0;
  let lateCount = 0;
  let waitingAccept = 0;
  let waitingSettle = 0;
  if (canShip) {
    // Một lần đọc đủ dữ liệu cho kỳ đang xem, kỳ trước và biểu đồ theo tháng
    const loadFrom = [prev.range.from, `${months[0]}-01`, f.tu].sort()[0];
    const [all, recentRes, a, b, c, d] = await Promise.all([
      fetchAll<Row>(() =>
        scope(
          supabase
            .from("shipment_list")
            .select("id, pickup_at, status, customer_id, customer_name, driver_id, driver_name, vehicle_id, plate_number", { count: "exact" })
            .gte("pickup_at", startOfDayVN(loadFrom))
            .lt("pickup_at", startOfDayVN(addDaysYMD(f.den, 1))),
        )
          .order("pickup_at")
          .order("id"),
      ),
      scope(
        supabase
          .from("shipment_list")
          .select("id, shipment_code, status, pickup_at, plate_number, driver_name, customer_name, pickup_name, delivery_name")
          .gte("pickup_at", startOfDayVN(f.tu))
          .lt("pickup_at", startOfDayVN(addDaysYMD(f.den, 1))),
      )
        .order("pickup_at", { ascending: false })
        .limit(6),
      count(scope(supabase.from("shipment_list").select("id", head).in("status", ["accepted", "in_transit"]))),
      count(scope(supabase.from("shipment_list").select("id", head).in("status", ["assigned", "accepted", "in_transit"]).lt("expected_delivery_at", nowIso))),
      count(scope(supabase.from("shipment_list").select("id", head).eq("status", "assigned"))),
      count(scope(supabase.from("shipment_list").select("id", head).eq("status", "driver_completed"))),
    ]);
    if (recentRes.error) throw recentRes.error;
    rows = all.rows;
    truncated = all.truncated;
    recent = (recentRes.data ?? []) as Recent[];
    [inTransit, lateCount, waitingAccept, waitingSettle] = [a, b, c, d];
  }

  // Tính số liệu từ các dòng đã đọc
  const withDay = rows.map((r) => ({ ...r, d: vnDate(r.pickup_at) }));
  const inRange = withDay.filter((r) => r.d >= f.tu && r.d <= f.den);
  const inPrev = withDay.filter((r) => r.d >= prev.range.from && r.d <= prev.range.to);
  const live = inRange.filter((r) => r.status !== "cancelled");
  const livePrev = inPrev.filter((r) => r.status !== "cancelled");
  const stats = {
    total: live.length,
    totalPrev: livePrev.length,
    done: live.filter((r) => DONE.has(r.status)).length,
    donePrev: livePrev.filter((r) => DONE.has(r.status)).length,
    cancelled: inRange.length - live.length,
  };

  // Biểu đồ cột: chia theo ngày / tuần / tháng tùy độ dài kỳ
  const buckets = new Map<string, { label: string; title: string; value: number }>();
  for (let day = f.tu; day <= f.den; day = addDaysYMD(day, 1)) {
    const b = bucketOf(day, bucketBy);
    if (!buckets.has(b.key)) {
      const short = bucketBy === "ngay" ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : bucketBy === "thang" ? `T${Number(day.slice(5, 7))}/${day.slice(2, 4)}` : `${day.slice(8, 10)}/${day.slice(5, 7)}`;
      buckets.set(b.key, { label: short, title: b.label, value: 0 });
    }
  }
  for (const r of live) {
    const b = buckets.get(bucketOf(r.d, bucketBy).key);
    if (b) b.value++;
  }
  const bucketName = bucketBy === "ngay" ? "ngày" : bucketBy === "tuan" ? "tuần" : "tháng";

  const monthly = months.map((m) => {
    const list = withDay.filter((r) => r.d.startsWith(m) && r.d <= f.den && r.status !== "cancelled");
    return { month: m, total: list.length, completed: list.filter((r) => DONE.has(r.status)).length };
  });

  // Xếp hạng: chưa chọn khách hàng → top khách hàng; đã chọn → top tài xế; đã chọn cả tài xế → top xe
  const rankBy: { key: "customer" | "driver" | "vehicle"; title: string } = !f.kh
    ? { key: "customer", title: "Khách hàng nhiều chuyến nhất" }
    : !f.tx
      ? { key: "driver", title: "Tài xế chạy nhiều chuyến nhất" }
      : { key: "vehicle", title: "Xe chạy nhiều chuyến nhất" };
  const rankMap = new Map<string, { id: string; name: string; total: number }>();
  for (const r of live) {
    const [id, name] =
      rankBy.key === "customer" ? [r.customer_id, r.customer_name ?? "Khách hàng"] : rankBy.key === "driver" ? [r.driver_id, r.driver_name] : [r.vehicle_id, r.plate_number];
    if (!id) continue;
    const e = rankMap.get(id) ?? { id, name: name ?? "—", total: 0 };
    e.total++;
    rankMap.set(id, e);
  }
  const top = [...rankMap.values()].sort((x, y) => y.total - x.total || x.name.localeCompare(y.name, "vi")).slice(0, 5);
  const topMax = Math.max(1, ...top.map((c) => c.total));

  const byStatus: Record<string, number> = {};
  for (const r of inRange) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const statusItems = SHIPMENT_STATUS.map((s) => ({ label: s.label, tone: s.tone, value: byStatus[s.value] ?? 0 })).filter((i) => i.value > 0);

  const pendingApprovals = perms.has("approvals.view")
    ? await count(supabase.from("approval_requests").select("id", head).eq("status", "pending"))
    : null;
  const pendingUsers = perms.has("users.view") ? await count(supabase.from("profiles").select("id", head).eq("status", "pending")) : null;

  let expiring: { id: string; plate_number: string; registration_expiry: string | null; insurance_expiry: string | null }[] = [];
  if (perms.has("vehicles.view")) {
    let q = supabase
      .from("vehicles")
      .select("id, plate_number, registration_expiry, insurance_expiry")
      .is("archived_at", null)
      .or(`registration_expiry.lte.${in30},insurance_expiry.lte.${in30}`);
    if (f.xe) q = q.eq("id", f.xe);
    const { data, error } = await q.order("registration_expiry", { ascending: true, nullsFirst: false }).limit(6);
    if (error) throw error;
    expiring = data ?? [];
  }

  // Chỉ tiêu tài chính (người có quyền xem báo cáo); khoản nào không có quyền thì ghi rõ
  let finance: { label: string; value: number | null; note?: string }[] | null = null;
  if (perms.has("reports.view")) {
    const sum = async (q: PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>, col: string) => {
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).reduce((a, r) => a + Number(r[col] ?? 0), 0);
    };
    const profitQuery = () => {
      let q = supabase
        .from("report_shipment_profit")
        .select("id, revenue, cost", { count: "exact" })
        .gte("report_date", f.tu)
        .lte("report_date", f.den);
      if (f.kh) q = q.eq("customer_id", f.kh);
      if (f.tx) q = q.eq("driver_id", f.tx);
      if (f.xe) q = q.eq("vehicle_id", f.xe);
      if (f.tuyen) q = q.eq("pickup_name", route?.pickup?.name ?? "").eq("delivery_name", route?.delivery?.name ?? "");
      return q.order("id");
    };
    const ar = () => {
      let q = supabase.from("receivable_list").select("remaining_amount").in("status", ["open", "partial"]);
      if (f.kh) q = q.eq("customer_id", f.kh);
      return q;
    };
    const ap = () => {
      let q = supabase.from("payable_list").select("remaining_amount").in("status", ["open", "partial"]);
      if (f.tx) q = q.eq("driver_id", f.tx);
      return q;
    };
    const adv = () => {
      let q = supabase.from("report_advance_balance").select("balance");
      if (f.tx) q = q.eq("driver_id", f.tx);
      return q;
    };
    const [pr, arSum, apSum, advSum] = await Promise.all([
      fetchAll<{ revenue: number; cost: number }>(profitQuery),
      perms.has("receivables.view") ? sum(ar(), "remaining_amount") : null,
      perms.has("receivables.view") ? sum(ap(), "remaining_amount") : null,
      sum(adv(), "balance"),
    ]);
    const revenue = pr.rows.reduce((a, r) => a + Number(r.revenue ?? 0), 0);
    const cost = pr.rows.reduce((a, r) => a + Number(r.cost ?? 0), 0);
    finance = [
      { label: "Doanh thu", value: revenue },
      { label: "Chi phí chuyến", value: cost },
      { label: "Lợi nhuận gộp", value: revenue - cost },
      { label: f.kh ? "Khách này còn nợ" : "Công nợ phải thu", value: arSum, note: "Số dư hiện tại" },
      { label: f.tx ? "Phải trả tài xế này" : "Công nợ phải trả", value: apSum, note: "Số dư hiện tại" },
      { label: f.tx ? "Tạm ứng tài xế này đang giữ" : "Tạm ứng tài xế đang giữ", value: advSum, note: "Số dư hiện tại" },
    ];
  }

  const todoHref = (tt: string) =>
    `/chuyen-xe?${new URLSearchParams({ tt, tu: addDaysYMD(today, -365), den: addDaysYMD(today, 30), ...(f.kh ? { kh: f.kh } : {}) }).toString()}`;
  const todos: { icon: LucideIcon; tone: Tone; label: string; value: number; href?: string }[] = [];
  if (canShip) {
    todos.push({ icon: Clock, tone: "amber", label: "Chờ tài xế nhận chuyến", value: waitingAccept, href: todoHref("assigned") });
    todos.push({ icon: FileWarning, tone: "teal", label: "Đã giao, chờ chứng từ / quyết toán", value: waitingSettle, href: todoHref("driver_completed") });
  }
  if (pendingApprovals !== null) todos.push({ icon: BadgeCheck, tone: "purple", label: "Yêu cầu phê duyệt đang chờ", value: pendingApprovals, href: "/phe-duyet" });
  if (pendingUsers !== null) todos.push({ icon: UserCheck, tone: "blue", label: "Tài khoản chờ cấp quyền", value: pendingUsers, href: "/nguoi-dung" });

  const listHref = `/chuyen-xe?${new URLSearchParams({ tu: f.tu, den: f.den, ...(f.kh ? { kh: f.kh } : {}) }).toString()}`;
  const prevName = prev.label.charAt(0).toUpperCase() + prev.label.slice(1);

  const entityNote = hasEntity ? " · theo bộ lọc" : "";

  return (
    <>
      <PageHeader title="Tổng quan" description={`Hôm nay ${formatDate(today)} · Xin chào ${user.fullName || user.email}`} />
      <DashboardFilterBar key={dashFilterQuery(f)} filter={f} />
      {truncated ? (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Kỳ đang xem có quá nhiều chuyến, số liệu chỉ tính 50,000 chuyến đầu. Hãy chọn khoảng thời gian ngắn hơn.
        </p>
      ) : null}

      {canShip ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5 [&>*]:min-w-0">
            <Kpi icon={Truck} tone="blue" label={`Chuyến trong kỳ (${rangeLabel})`} value={stats.total} prev={stats.totalPrev} prevLabel={`so với ${prev.label}`} prevName={prevName} />
            <Kpi icon={CheckCircle2} tone="green" label="Hoàn thành trong kỳ" value={stats.done} prev={stats.donePrev} prevLabel={`so với ${prev.label}`} prevName={prevName} />
            <Kpi icon={Ban} tone="purple" label="Đã hủy trong kỳ" value={stats.cancelled} note="Không tính vào số chuyến và biểu đồ" />
            <Kpi icon={Navigation} tone="amber" label="Đang thực hiện" value={inTransit} note={`Hiện tại, tài xế đã nhận hoặc đang chạy${entityNote}`} />
            <Kpi icon={AlertTriangle} tone="red" label="Đang trễ giờ giao" value={lateCount} note={`Hiện tại, quá giờ giao dự kiến${entityNote}`} />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Số chuyến theo {bucketName}</CardTitle>
                <CardDescription>{rangeLabel} · theo ngày nhận hàng, không tính chuyến đã hủy</CardDescription>
              </CardHeader>
              <CardContent>
                <BarChart unit="chuyến" data={[...buckets.values()]} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Trạng thái chuyến trong kỳ</CardTitle>
                <CardDescription>Tính cả chuyến đã hủy</CardDescription>
              </CardHeader>
              <CardContent>
                {statusItems.length ? (
                  <DonutChart items={statusItems} centerLabel="Tổng chuyến" />
                ) : (
                  <p className="py-10 text-center text-sm text-muted-foreground">Không có chuyến nào trong kỳ.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
            <Card className="xl:col-span-2">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">Chuyến gần đây</CardTitle>
                  <CardDescription>6 chuyến có ngày nhận hàng mới nhất trong kỳ</CardDescription>
                </div>
                <Link href={listHref} className="text-xs text-primary hover:underline">
                  Xem tất cả
                </Link>
              </CardHeader>
              <CardContent className="px-0">
                {recent.length === 0 ? (
                  <p className="px-6 py-8 text-center text-sm text-muted-foreground">Không có chuyến nào trong kỳ.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="px-6 py-2 font-medium">Mã chuyến / Nhận hàng</th>
                          <th className="px-3 py-2 font-medium">Khách hàng / Tuyến</th>
                          <th className="hidden px-3 py-2 font-medium 2xl:table-cell">Tuyến</th>
                          <th className="px-3 py-2 font-medium">Xe / Tài xế</th>
                          <th className="px-6 py-2 font-medium">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recent.map((r) => {
                          const st = shipmentStatus(r.status);
                          return (
                            <tr key={r.id} className="border-b last:border-0">
                              <td className="px-6 py-2.5 whitespace-nowrap">
                                <Link href={`/chuyen-xe/${r.id}`} className="font-medium text-primary hover:underline">
                                  {r.shipment_code}
                                </Link>
                                <div className="text-xs text-muted-foreground">{formatDate(r.pickup_at)}</div>
                              </td>
                              <td className="max-w-56 px-3 py-2.5">
                                <div className="truncate">{r.customer_name ?? "—"}</div>
                                <div className="truncate text-xs text-muted-foreground 2xl:hidden">
                                  {r.pickup_name ?? "?"} → {r.delivery_name ?? "?"}
                                </div>
                              </td>
                              <td className="hidden max-w-56 truncate px-3 py-2.5 text-muted-foreground 2xl:table-cell">
                                {r.pickup_name ?? "?"} → {r.delivery_name ?? "?"}
                              </td>
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                {r.plate_number ?? <span className="text-muted-foreground">Chưa gán xe</span>}
                                {r.driver_name ? <div className="text-xs text-muted-foreground">{r.driver_name}</div> : null}
                              </td>
                              <td className="px-6 py-2.5">
                                <Badge variant={TONE_BADGE[st.tone]}>{st.label}</Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{rankBy.title}</CardTitle>
                <CardDescription>Top 5 trong kỳ, không tính chuyến đã hủy</CardDescription>
              </CardHeader>
              <CardContent>
                {top.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Không có chuyến nào trong kỳ.</p>
                ) : (
                  <ul className="space-y-3">
                    {top.map((c, i) => (
                      <li key={c.id}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-[11px] font-semibold text-primary">{i + 1}</span>
                            <span className="truncate">{c.name}</span>
                          </span>
                          <span className="font-medium tabular-nums">{c.total.toLocaleString("en-US")} chuyến</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted">
                          <div className="h-1.5 rounded-full bg-tone-blue" style={{ width: `${(c.total / topMax) * 100}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3 [&>*]:min-w-0">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Sản lượng chuyến {monthly.length} tháng</CardTitle>
                <CardDescription>Tổng chuyến và chuyến đã hoàn thành theo tháng nhận hàng, đến {dmy(f.den)}{entityNote}</CardDescription>
              </CardHeader>
              <CardContent>
                <LineChart
                  unit="chuyến"
                  labels={monthly.map((m) => `T${Number(m.month.slice(5, 7))}/${m.month.slice(2, 4)}`)}
                  series={[
                    { name: "Tổng chuyến", tone: "blue", values: monthly.map((m) => m.total) },
                    { name: "Đã hoàn thành", tone: "amber", values: monthly.map((m) => m.completed) },
                  ]}
                />
              </CardContent>
            </Card>
            <TodoCard todos={todos} note={`Số liệu hiện tại${entityNote}`} />
          </div>
        </>
      ) : todos.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <TodoCard todos={todos} note="Số liệu hiện tại" />
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {perms.has("vehicles.view") ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="size-4 text-tone-red" /> Giấy tờ xe sắp hết hạn (30 ngày)
              </CardTitle>
              <CardDescription>Đăng kiểm và bảo hiểm{f.xe ? " · xe đang lọc" : ""}</CardDescription>
            </CardHeader>
            <CardContent>
              {expiring.length === 0 ? (
                <p className="text-sm text-muted-foreground">Không có xe nào sắp hết hạn giấy tờ.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {expiring.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                      <Link href={`/phuong-tien/${v.id}`} className="font-medium text-primary hover:underline">
                        {v.plate_number}
                      </Link>
                      <span className="flex flex-wrap justify-end gap-1.5">
                        {v.registration_expiry && v.registration_expiry <= in30 ? (
                          <Badge variant={v.registration_expiry < today ? "destructive" : "warning"}>Đăng kiểm {formatDate(v.registration_expiry)}</Badge>
                        ) : null}
                        {v.insurance_expiry && v.insurance_expiry <= in30 ? (
                          <Badge variant={v.insurance_expiry < today ? "destructive" : "warning"}>Bảo hiểm {formatDate(v.insurance_expiry)}</Badge>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}
        {finance ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wallet className="size-4 text-tone-green" /> Tổng quan tài chính
                </CardTitle>
                <CardDescription>
                  Doanh thu, chi phí theo ngày hoàn thành chuyến, {rangeLabel}
                  {entityNote}
                </CardDescription>
              </div>
              <Link href="/bao-cao" className="text-xs text-primary hover:underline">
                Báo cáo
              </Link>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {finance.map((k) => (
                  <div key={k.label} className="rounded-lg border px-3 py-2">
                    <div className="text-xs text-muted-foreground">
                      {k.label}
                      {k.note ? <span className="opacity-70"> · {k.note}</span> : null}
                    </div>
                    <div className="text-sm font-semibold tabular-nums">{k.value === null ? "Không có quyền xem" : formatVND(k.value)}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function IconTile({ icon: Icon, tone, className }: { icon: LucideIcon; tone: Tone; className?: string }) {
  return (
    <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm", className)} style={{ background: toneVar(tone) }}>
      <Icon className="size-5" />
    </div>
  );
}

function Kpi({
  icon,
  tone,
  label,
  value,
  prev,
  prevLabel,
  prevName,
  note,
}: {
  icon: LucideIcon;
  tone: Tone;
  label: string;
  value: number;
  prev?: number;
  prevLabel?: string;
  prevName?: string;
  note?: string;
}) {
  let change: React.ReactNode = <span className="text-muted-foreground">{note}</span>;
  if (prev !== undefined) {
    if (prev === 0) {
      change = <span className="text-muted-foreground">{value === 0 ? `Không đổi ${prevLabel}` : `${prevName} chưa có chuyến`}</span>;
    } else {
      const pct = ((value - prev) / prev) * 100;
      const up = pct >= 0;
      const Arrow = up ? ArrowUpRight : ArrowDownRight;
      change = (
        <span className="flex flex-wrap items-center gap-1">
          <span className={cn("inline-flex items-center font-medium", up ? "text-[oklch(0.5_0.13_155)]" : "text-[oklch(0.55_0.2_25)]")}>
            <Arrow className="size-3.5" />
            {Math.abs(pct).toLocaleString("en-US", { maximumFractionDigits: 1 })}%
          </span>
          <span className="text-muted-foreground">{prevLabel}</span>
        </span>
      );
    }
  }
  return (
    <Card className="h-full">
      <CardContent>
        <div className="flex items-start justify-between gap-2">
          <div className="pt-0.5 text-sm text-muted-foreground">{label}</div>
          <IconTile icon={icon} tone={tone} className="size-9 sm:size-10" />
        </div>
        <div className="-mt-1 text-2xl font-bold tabular-nums sm:text-3xl">{value.toLocaleString("en-US")}</div>
        <div className="mt-1 text-xs">{change}</div>
      </CardContent>
    </Card>
  );
}

function TodoCard({ todos, note }: { todos: { icon: LucideIcon; tone: Tone; label: string; value: number; href?: string }[]; note: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Việc cần xử lý</CardTitle>
        <CardDescription>{note}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {todos.map((t) => {
            const body = (
              <div className={cn("flex items-center gap-3 rounded-lg border p-2.5", t.href && "transition-colors hover:border-primary/40 hover:bg-accent/40")}>
                <IconTile icon={t.icon} tone={t.tone} className="size-9 rounded-lg" />
                <span className="flex-1 text-sm">{t.label}</span>
                <span className="text-lg font-semibold tabular-nums">{t.value.toLocaleString("en-US")}</span>
                {t.href ? <ChevronRight className="size-4 text-muted-foreground" /> : null}
              </div>
            );
            return <li key={t.label}>{t.href ? <Link href={t.href}>{body}</Link> : body}</li>;
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
