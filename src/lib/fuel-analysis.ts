// Phân tích dầu: so sánh giữa các xe và ước tính dầu theo tuyến đường.
// Dầu chỉ ghi theo xe/tháng (Dầu theo xe), nên dầu theo tuyến là ƯỚC TÍNH: dầu của xe trong tháng được chia
// cho các chuyến xe đó chạy trong tháng, theo số km của tuyến (tuyến chưa có km thì lấy km trung bình các chuyến khác
// của xe trong tháng; không chuyến nào có km thì chia đều theo chuyến).
import { round2, type FuelRow } from "@/lib/vehicle-fuel";

/** Một dòng Dầu theo xe của một tháng */
export type FuelMonthRow = FuelRow & { month: string };

/** Lít dầu dùng để phân tích: số Giám đốc chốt, chưa chốt thì số thực tế */
export const usedLiters = (r: FuelRow) => r.final ?? r.actual;

export type VehicleStat = {
  id: string;
  plate: string;
  type: string;
  driver: string;
  months: number;
  trips: number;
  km: number;
  liters: number;
  norm: number;
  /** Lít/100 km thực tế */
  per100: number | null;
  /** Lít/100 km theo tỷ trọng */
  norm100: number | null;
  /** % vượt định mức = (thực tế − định mức) / định mức */
  overPct: number | null;
  /** Lít/100 km so với trung bình xe cùng loại (%), dương = tốn hơn */
  vsTypePct: number | null;
  cost: number;
  costPerKm: number | null;
  kmPerTrip: number | null;
};

/** Gộp các tháng của từng xe. Chỉ lấy tháng có đủ KM và số lít để không làm sai lít/100 km. */
export function vehicleStats(rows: FuelMonthRow[], tripsByVehicle: Map<string, number> = new Map()): VehicleStat[] {
  const map = new Map<string, VehicleStat>();
  for (const r of rows) {
    const l = usedLiters(r);
    if (r.kmRun === null || r.kmRun <= 0 || l === null) continue;
    const s =
      map.get(r.id) ??
      ({ id: r.id, plate: r.plate, type: r.type, driver: r.driver, months: 0, trips: 0, km: 0, liters: 0, norm: 0, per100: null, norm100: null, overPct: null, vsTypePct: null, cost: 0, costPerKm: null, kmPerTrip: null } as VehicleStat);
    s.months += 1;
    s.km += r.kmRun;
    s.liters += l;
    s.norm += r.norm ?? 0;
    s.cost += r.price !== null ? l * r.price : 0;
    map.set(r.id, s);
  }
  const list = [...map.values()].map((s) => {
    const trips = tripsByVehicle.get(s.id) ?? 0;
    return {
      ...s,
      liters: round2(s.liters),
      norm: round2(s.norm),
      cost: Math.round(s.cost),
      trips,
      per100: round2((s.liters / s.km) * 100),
      norm100: s.norm > 0 ? round2((s.norm / s.km) * 100) : null,
      overPct: s.norm > 0 ? round2(((s.liters - s.norm) / s.norm) * 100) : null,
      costPerKm: s.cost > 0 ? Math.round(s.cost / s.km) : null,
      kmPerTrip: trips ? round2(s.km / trips) : null,
    };
  });
  // Trung bình lít/100 km của loại xe = tổng lít / tổng km của loại
  const byType = new Map<string, { km: number; l: number }>();
  for (const s of list) {
    const t = byType.get(s.type) ?? { km: 0, l: 0 };
    t.km += s.km;
    t.l += s.liters;
    byType.set(s.type, t);
  }
  for (const s of list) {
    const t = byType.get(s.type)!;
    const avg = (t.l / t.km) * 100;
    s.vsTypePct = avg > 0 && s.per100 !== null ? round2(((s.per100 - avg) / avg) * 100) : null;
  }
  return list.sort((a, b) => (b.per100 ?? 0) - (a.per100 ?? 0));
}

/** Một chuyến của xe công ty trong kỳ */
export type FuelTrip = {
  id: string;
  vehicleId: string;
  /** "2026-10" theo ngày hoàn thành (chưa hoàn thành thì ngày nhận hàng), giờ Việt Nam */
  month: string;
  routeKey: string;
  routeName: string;
  /** km của tuyến (Tuyến đường), null nếu chưa nhập */
  km: number | null;
};

export type TripFuel = FuelTrip & { liters: number; cost: number; kmUsed: number; kmGuessed: boolean };

/** Chia dầu của mỗi xe/tháng cho các chuyến của xe đó trong tháng */
export function allocateTrips(rows: FuelMonthRow[], trips: FuelTrip[]): TripFuel[] {
  const fuel = new Map(rows.map((r) => [`${r.id}|${r.month}`, r]));
  const groups = new Map<string, FuelTrip[]>();
  for (const t of trips) {
    const k = `${t.vehicleId}|${t.month}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: TripFuel[] = [];
  for (const [k, list] of groups) {
    const f = fuel.get(k);
    const liters = f ? usedLiters(f) : null;
    if (!f || liters === null || liters <= 0) continue;
    const known = list.filter((t) => t.km !== null && t.km > 0);
    const avg = known.length ? known.reduce((a, t) => a + t.km!, 0) / known.length : 1;
    const weights = list.map((t) => (t.km !== null && t.km > 0 ? t.km : avg));
    const total = weights.reduce((a, w) => a + w, 0);
    list.forEach((t, i) => {
      const l = (liters * weights[i]) / total;
      out.push({
        ...t,
        liters: l,
        cost: f.price !== null ? l * f.price : 0,
        kmUsed: known.length ? weights[i] : 0,
        kmGuessed: !(t.km !== null && t.km > 0),
      });
    });
  }
  return out;
}

export type RouteStat = {
  key: string;
  name: string;
  trips: number;
  vehicles: number;
  /** km một chuyến theo Tuyến đường */
  routeKm: number | null;
  liters: number;
  litersPerTrip: number;
  /** Lít/100 km (chỉ khi tuyến có km) */
  per100: number | null;
  cost: number;
  costPerTrip: number;
  sharePct: number;
};

export function routeStats(alloc: TripFuel[]): RouteStat[] {
  const map = new Map<string, { name: string; trips: number; veh: Set<string>; km: number | null; liters: number; cost: number; kmSum: number }>();
  for (const t of alloc) {
    const s = map.get(t.routeKey) ?? { name: t.routeName, trips: 0, veh: new Set<string>(), km: t.km, liters: 0, cost: 0, kmSum: 0 };
    s.trips += 1;
    s.veh.add(t.vehicleId);
    s.liters += t.liters;
    s.cost += t.cost;
    if (!t.kmGuessed) s.kmSum += t.kmUsed;
    map.set(t.routeKey, s);
  }
  const all = [...map.values()].reduce((a, s) => a + s.liters, 0);
  return [...map.entries()]
    .map(([key, s]) => ({
      key,
      name: s.name,
      trips: s.trips,
      vehicles: s.veh.size,
      routeKm: s.km,
      liters: round2(s.liters),
      litersPerTrip: round2(s.liters / s.trips),
      per100: s.kmSum > 0 ? round2((s.liters / s.kmSum) * 100) : null,
      cost: Math.round(s.cost),
      costPerTrip: Math.round(s.cost / s.trips),
      sharePct: all ? round2((s.liters / all) * 100) : 0,
    }))
    .sort((a, b) => b.liters - a.liters);
}

/** Danh sách tháng "YYYY-MM" từ from đến to (tối đa 24) */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 24) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
