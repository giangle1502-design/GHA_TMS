import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadTableView } from "@/lib/entities/server";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import { todayVN } from "@/lib/format";
import { computeFuelRow, shiftMonth, type FuelMonth } from "@/lib/vehicle-fuel";
import { monthsBetween, type FuelMonthRow, type FuelTrip } from "@/lib/fuel-analysis";
import { FuelAnalysis } from "./fuel-analysis";

export const metadata: Metadata = { title: "Phân tích dầu" };

const ym = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}$/.test(v) ? v : null);
/** Tháng theo giờ Việt Nam của một thời điểm */
const monthVN = (iso: string) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 7);

type Shp = { id: string; vehicle_id: string; pickup_at: string; completed_at: string | null; route_id: string | null; pickup_location_id: string; delivery_location_id: string };
type Rt = { id: string; name: string; distance_km: number | string | null; pickup_location_id: string; delivery_location_id: string };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("fuel.view");
  const sp = await searchParams;
  const cur = todayVN().slice(0, 7);
  let to = ym(sp.den) ?? cur;
  let from = ym(sp.tu) ?? shiftMonth(to, -2);
  if (from > to) [from, to] = [to, from];
  const months = monthsBetween(from, to);
  to = months[months.length - 1];
  const supabase = await createClient();

  const fuelRes = await Promise.all(months.map((m) => supabase.rpc("fuel_month", { p_month: `${m}-01` })));
  const rows: FuelMonthRow[] = [];
  fuelRes.forEach((r, i) => {
    if (r.error) throw r.error;
    for (const x of (r.data as FuelMonth).rows) rows.push({ ...computeFuelRow(x), month: months[i] });
  });
  const vehicleIds = [...new Set(rows.map((r) => r.id))];

  // Chuyến của xe công ty trong kỳ (lấy rộng 1 tháng hai đầu theo ngày nhận hàng, lọc lại theo tháng hoàn thành)
  let tripsError: string | null = null;
  const trips: FuelTrip[] = [];
  if (vehicleIds.length) {
    const shp: Shp[] = [];
    for (let p = 0; p < 50; p++) {
      const { data, error } = await supabase
        .from("shipments")
        .select("id, vehicle_id, pickup_at, completed_at, route_id, pickup_location_id, delivery_location_id")
        .in("vehicle_id", vehicleIds)
        .neq("status", "cancelled")
        .gte("pickup_at", `${shiftMonth(from, -1)}-01`)
        .lt("pickup_at", `${shiftMonth(to, 2)}-01`)
        .order("id")
        .range(p * 1000, p * 1000 + 999);
      if (error) {
        tripsError = "Không đọc được chuyến xe (cần quyền xem Chuyến xe), nên chưa có phần theo tuyến.";
        break;
      }
      shp.push(...((data ?? []) as Shp[]));
      if ((data ?? []).length < 1000) break;
    }
    const inRange = shp
      .map((s) => ({ ...s, month: monthVN(s.completed_at ?? s.pickup_at) }))
      .filter((s) => s.month >= from && s.month <= to);
    if (inRange.length) {
      const locIds = [...new Set(inRange.flatMap((s) => [s.pickup_location_id, s.delivery_location_id]))];
      const [rt, ...locChunks] = await Promise.all([
        supabase.from("routes").select("id, name, distance_km, pickup_location_id, delivery_location_id").limit(10000),
        ...Array.from({ length: Math.ceil(locIds.length / 300) }, (_, i) =>
          supabase.from("locations").select("id, name").in("id", locIds.slice(i * 300, i * 300 + 300)),
        ),
      ]);
      const routes = (rt.data ?? []) as Rt[];
      const byId = new Map(routes.map((r) => [r.id, r]));
      const byPair = new Map(routes.map((r) => [`${r.pickup_location_id}|${r.delivery_location_id}`, r]));
      const locName = new Map(locChunks.flatMap((c) => ((c.data ?? []) as { id: string; name: string }[]).map((l) => [l.id, l.name] as const)));
      for (const s of inRange) {
        const r = (s.route_id ? byId.get(s.route_id) : undefined) ?? byPair.get(`${s.pickup_location_id}|${s.delivery_location_id}`);
        const km = r?.distance_km !== null && r?.distance_km !== undefined ? Number(r.distance_km) : null;
        trips.push({
          id: s.id,
          vehicleId: s.vehicle_id,
          month: s.month,
          routeKey: r ? r.id : `${s.pickup_location_id}|${s.delivery_location_id}`,
          routeName: r?.name ?? `${locName.get(s.pickup_location_id) ?? "?"} → ${locName.get(s.delivery_location_id) ?? "?"}`,
          km: km !== null && Number.isFinite(km) ? km : null,
        });
      }
    }
  }

  const [vVeh, vRoute, vMonth] = await Promise.all([
    loadTableView(supabase, "fuel_analysis_vehicles", me.id),
    loadTableView(supabase, "fuel_analysis_routes", me.id),
    loadTableView(supabase, "fuel_analysis_months", me.id),
  ]);

  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Phân tích dầu"
        description="So sánh dầu giữa các xe theo quãng đường đã chạy, và ước tính tuyến đường nào tốn nhiều dầu nhất. Số liệu lấy từ Dầu theo xe (số Giám đốc chốt, chưa chốt thì số thực tế)."
      />
      <FuelAnalysis
        from={from}
        to={to}
        months={months}
        rows={rows}
        trips={trips}
        tripsError={tripsError}
        canExport={me.permissions.has("fuel.export")}
        views={{ vehicles: vVeh, routes: vRoute, months: vMonth }}
      />
    </>
  );
}
