import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadTableView } from "@/lib/entities/server";
import { addDaysYMD, todayVN } from "@/lib/format";
import { lastDayOfMonth, loadTrips, tripDay } from "@/lib/trip-counts";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import { TripCountReport, type DriverCountRow, type VehicleCountRow } from "./trip-count-report";

export const metadata: Metadata = { title: "Số chuyến xe, tài xế" };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim();
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

type VehicleRow = {
  id: string;
  code: string;
  plate_number: string;
  ownership_type: string;
  status: string;
  archived_at: string | null;
  assigned_driver_id: string | null;
  supplier_id: string | null;
  vehicle_types: { name: string } | null;
  drivers: { full_name: string } | null;
};
type DriverRow = { id: string; code: string; full_name: string; phone: string | null; status: string; archived_at: string | null; is_outsourced?: boolean | null };

/** Liệt kê "A (3), B (1)" theo số chuyến giảm dần */
const tally = (m: Map<string, number> | undefined) =>
  [...(m ?? new Map<string, number>()).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k} (${n})`)
    .join(", ");

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("dispatch.view", "reports.view");
  const sp = await searchParams;
  const today = todayVN();
  // Mặc định tháng này; ?thang=YYYY-MM hoặc ?tu=&den= (tối đa 366 ngày)
  const thang = /^\d{4}-\d{2}$/.test(one(sp.thang) ?? "") ? one(sp.thang)! : "";
  let from: string;
  let to: string;
  if (!thang && YMD.test(one(sp.tu) ?? "") && YMD.test(one(sp.den) ?? "")) {
    from = one(sp.tu)!;
    to = one(sp.den)!;
    if (from > to) [from, to] = [to, from];
    if (to > addDaysYMD(from, 365)) to = addDaysYMD(from, 365);
  } else {
    const ym = thang || today.slice(0, 7);
    from = `${ym}-01`;
    to = lastDayOfMonth(ym);
  }
  const isMonth = from.endsWith("-01") && to === lastDayOfMonth(from.slice(0, 7));
  const label = isMonth ? `tháng ${from.slice(5, 7)}/${from.slice(0, 4)}` : `từ ${dmy(from)} đến ${dmy(to)}`;

  const supabase = await createClient();
  const [trips, vRes, dRes, viewV, viewD, viewDays] = await Promise.all([
    loadTrips(supabase, from, to),
    supabase
      .from("vehicles")
      .select("id, code, plate_number, ownership_type, status, archived_at, assigned_driver_id, supplier_id, vehicle_types(name), drivers!vehicles_assigned_driver_id_fkey(full_name)")
      .order("plate_number")
      .limit(5000),
    supabase.from("drivers").select("id, code, full_name, phone, status, archived_at, is_outsourced").order("full_name").limit(5000),
    loadTableView(supabase, "trip_count_vehicles", me.id),
    loadTableView(supabase, "trip_count_drivers", me.id),
    loadTableView(supabase, "trip_count_days", me.id),
  ]);
  if (vRes.error) throw vRes.error;
  if (dRes.error) throw dRes.error;
  const vehicles = (vRes.data ?? []) as unknown as VehicleRow[];
  const drivers = (dRes.data ?? []) as DriverRow[];
  const plate = new Map(vehicles.map((v) => [v.id, v.plate_number]));
  const driverName = new Map(drivers.map((d) => [d.id, d.full_name]));
  // Xe và tài xế 3PL (tài xế phụ trách xe thuê ngoài) không tính vào số chuyến
  const is3pl = (v: VehicleRow) => v.ownership_type === "outsourced" || Boolean(v.supplier_id);
  const outsourcedVehicles = new Set(vehicles.filter(is3pl).map((v) => v.id));
  const outsourcedDrivers = new Set([
    ...vehicles.filter((v) => is3pl(v) && v.assigned_driver_id).map((v) => v.assigned_driver_id!),
    ...drivers.filter((d) => d.is_outsourced).map((d) => d.id),
  ]);

  type Acc = { total: number; delivered: number; today: number; days: Map<string, number>; others: Map<string, number> };
  const newAcc = (): Acc => ({ total: 0, delivered: 0, today: 0, days: new Map(), others: new Map() });
  const byVehicle = new Map<string, Acc>();
  const byDriver = new Map<string, Acc>();
  let noVehicle = 0;
  let noDriver = 0;
  for (const t of trips) {
    if (t.vehicle_id && outsourcedVehicles.has(t.vehicle_id)) continue;
    const day = tripDay(t);
    const add = (m: Map<string, Acc>, id: string, other: string | null) => {
      const a = m.get(id) ?? newAcc();
      a.total++;
      if (t.completed_at) a.delivered++;
      if (day === today) a.today++;
      a.days.set(day, (a.days.get(day) ?? 0) + 1);
      if (other) a.others.set(other, (a.others.get(other) ?? 0) + 1);
      m.set(id, a);
    };
    if (t.vehicle_id) add(byVehicle, t.vehicle_id, t.driver_id ? (driverName.get(t.driver_id) ?? "?") : null);
    else noVehicle++;
    if (t.driver_id) add(byDriver, t.driver_id, t.vehicle_id ? (plate.get(t.vehicle_id) ?? "?") : null);
    else noDriver++;
  }

  const activeCompany = (v: VehicleRow) => v.status === "active" && !v.archived_at && !is3pl(v);
  const activeDriver = (d: DriverRow) => d.status === "active" && !d.archived_at && !outsourcedDrivers.has(d.id);
  const avgOf = (ids: string[], m: Map<string, Acc>) => (ids.length ? Math.round((ids.reduce((s, id) => s + (m.get(id)?.total ?? 0), 0) / ids.length) * 10) / 10 : 0);
  const companyIds = vehicles.filter(activeCompany).map((v) => v.id);
  const activeDriverIds = drivers.filter(activeDriver).map((d) => d.id);
  const vehicleAvg = avgOf(companyIds, byVehicle);
  const driverAvg = avgOf(activeDriverIds, byDriver);

  const vehicleRows: VehicleCountRow[] = vehicles
    // Chỉ xe nội bộ (không tính xe thuê ngoài 3PL): xe đang hoạt động, hoặc xe ngừng nhưng có chuyến trong kỳ
    .filter((v) => !is3pl(v) && (activeCompany(v) || byVehicle.has(v.id)))
    .map((v) => {
      const a = byVehicle.get(v.id) ?? newAcc();
      return {
        id: v.id,
        plate_number: v.plate_number,
        code: v.code,
        vehicle_type: v.vehicle_types?.name ?? null,
        ownership_type: v.ownership_type,
        status: v.status,
        company: activeCompany(v),
        assigned_driver: v.drivers?.full_name ?? null,
        total: a.total,
        delivered: a.delivered,
        open: a.total - a.delivered,
        today: a.today,
        work_days: a.days.size,
        vs_avg: Math.round((a.total - vehicleAvg) * 10) / 10,
        others: tally(a.others),
        days: Object.fromEntries(a.days),
      };
    });
  const driverRows: DriverCountRow[] = drivers
    .filter((d) => !outsourcedDrivers.has(d.id) && (activeDriver(d) || byDriver.has(d.id)))
    .map((d) => {
      const a = byDriver.get(d.id) ?? newAcc();
      return {
        id: d.id,
        full_name: d.full_name,
        code: d.code,
        phone: d.phone,
        status: d.status,
        total: a.total,
        delivered: a.delivered,
        open: a.total - a.delivered,
        today: a.today,
        work_days: a.days.size,
        vs_avg: Math.round((a.total - driverAvg) * 10) / 10,
        others: tally(a.others),
        days: Object.fromEntries(a.days),
      };
    });

  const days: string[] = [];
  for (let d = from; d <= to && days.length < 62; d = addDaysYMD(d, 1)) days.push(d);

  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Số chuyến xe, tài xế"
        description={`Mỗi xe, mỗi tài xế đã chạy bao nhiêu chuyến ${label}, để điều phối chia chuyến đều. Chuyến tính theo ngày nhận hàng, không tính chuyến đã hủy. Tài xế đổi xe thì chuyến nào tính cho xe đó. Không tính xe, tài xế thuê ngoài 3PL.`}
      />
      <TripCountReport
        range={{ from, to, isMonth, label }}
        today={today}
        stats={{ trips: trips.length, noVehicle, noDriver, vehicleAvg, driverAvg, companyVehicles: companyIds.length, activeDrivers: activeDriverIds.length }}
        vehicles={vehicleRows}
        drivers={driverRows}
        days={days}
        views={{ vehicles: viewV, drivers: viewD, days: viewDays }}
      />
    </>
  );
}
