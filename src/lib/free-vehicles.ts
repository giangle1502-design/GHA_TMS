import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysYMD, startOfDayVN, todayVN } from "@/lib/format";

/** Một dòng báo cáo "Xe chưa có đơn" (chỉ xe công ty, đang hoạt động) */
export type FreeVehicleRow = {
  id: string;
  code: string;
  plate_number: string;
  vehicle_type: string | null;
  ownership_type: string;
  driver_name: string | null;
  driver_phone: string | null;
  trips: number;
  busy_days: number;
  free_days: number;
  /** Các ngày trống YYYY-MM-DD */
  free_dates: string[];
};

type VehicleRow = {
  id: string;
  code: string;
  plate_number: string;
  ownership_type: string;
  vehicle_types: { name: string } | null;
  drivers: { full_name: string; phone: string | null } | null;
};

/** Số ngày tối đa một chuyến được tính là chiếm xe (từ ngày nhận đến ngày giao dự kiến) */
const MAX_TRIP_DAYS = 7;

/**
 * Xe công ty (không tính xe thuê ngoài 3PL) và số ngày chưa có chuyến trong khoảng [tu, den].
 * Một ngày được coi là có chuyến nếu xe nhận hàng trong ngày hoặc đang chạy dở chuyến (đến ngày giao dự kiến;
 * chuyến đã giao thì xe trống ngay từ ngày giao thực tế, không chờ duyệt chi phí hay đóng chuyến).
 */
export async function loadFreeVehicles(supabase: SupabaseClient, tu: string, den: string, opts: { vehicleId?: string; driverId?: string } = {}): Promise<FreeVehicleRow[]> {
  let vq = supabase
    .from("vehicles")
    .select("id, code, plate_number, ownership_type, vehicle_types(name), drivers!vehicles_assigned_driver_id_fkey(full_name, phone)")
    .eq("status", "active")
    .is("archived_at", null)
    .neq("ownership_type", "outsourced")
    .is("supplier_id", null)
    .order("plate_number")
    .limit(2000);
  if (opts.vehicleId) vq = vq.eq("id", opts.vehicleId);
  if (opts.driverId) vq = vq.eq("assigned_driver_id", opts.driverId);
  const { data: vehicles, error } = await vq;
  if (error) throw error;

  const from = startOfDayVN(tu);
  const to = startOfDayVN(addDaysYMD(den, 1));
  const busy = new Map<string, Set<string>>();
  const trips = new Map<string, number>();
  for (let p = 0; p < 20; p++) {
    const { data, error: e } = await supabase
      .from("shipments")
      .select("id, vehicle_id, pickup_at, expected_delivery_at, completed_at")
      .not("vehicle_id", "is", null)
      .not("status", "in", "(cancelled,rejected)")
      .lt("pickup_at", to)
      .or(`pickup_at.gte.${from},expected_delivery_at.gte.${from}`)
      .order("id")
      .range(p * 1000, p * 1000 + 999);
    if (e) throw e;
    const rows = (data ?? []) as { vehicle_id: string; pickup_at: string; expected_delivery_at: string | null; completed_at: string | null }[];
    for (const r of rows) {
      const start = todayVN(new Date(r.pickup_at));
      // Đã giao xong (dù chi phí chưa duyệt, chưa đóng chuyến): xe trống ngay từ ngày giao thực tế
      // (giao trong ngày nhận hàng thì ngày đó vẫn tính là xe trống để điều phối giao thêm đơn)
      const end = r.completed_at
        ? addDaysYMD(todayVN(new Date(r.completed_at)), -1)
        : r.expected_delivery_at
          ? todayVN(new Date(r.expected_delivery_at))
          : start;
      const set = busy.get(r.vehicle_id) ?? new Set<string>();
      for (let d = start, i = 0; d <= end && i < MAX_TRIP_DAYS; d = addDaysYMD(d, 1), i++) if (d >= tu && d <= den) set.add(d);
      busy.set(r.vehicle_id, set);
      if (start >= tu && start <= den) trips.set(r.vehicle_id, (trips.get(r.vehicle_id) ?? 0) + 1);
    }
    if (rows.length < 1000) break;
  }

  const days: string[] = [];
  for (let d = tu; d <= den && days.length < 366; d = addDaysYMD(d, 1)) days.push(d);
  return ((vehicles ?? []) as unknown as VehicleRow[]).map((v) => {
    const set = busy.get(v.id) ?? new Set<string>();
    const free = days.filter((d) => !set.has(d));
    return {
      id: v.id,
      code: v.code,
      plate_number: v.plate_number,
      vehicle_type: v.vehicle_types?.name ?? null,
      ownership_type: v.ownership_type,
      driver_name: v.drivers?.full_name ?? null,
      driver_phone: v.drivers?.phone ?? null,
      trips: trips.get(v.id) ?? 0,
      busy_days: days.length - free.length,
      free_days: free.length,
      free_dates: free,
    };
  });
}
