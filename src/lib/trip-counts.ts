import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysYMD, startOfDayVN, todayVN } from "@/lib/format";

/** Một chuyến (chưa hủy) dùng để đếm số chuyến theo xe, tài xế */
export type TripLite = {
  id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  pickup_at: string;
  completed_at: string | null;
  status: string;
};

/** Ngày cuối tháng của "YYYY-MM" */
export function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Các chuyến chưa hủy có ngày nhận hàng trong [from, to] (YYYY-MM-DD, giờ VN).
 * Chuyến được tính vào tháng của ngày nhận hàng; tài xế đổi xe thì mỗi chuyến tính cho đúng xe và tài xế chạy chuyến đó.
 */
export async function loadTrips(supabase: SupabaseClient, from: string, to: string): Promise<TripLite[]> {
  const out: TripLite[] = [];
  for (let p = 0; p < 50; p++) {
    const { data, error } = await supabase
      .from("shipments")
      .select("id, vehicle_id, driver_id, pickup_at, completed_at, status")
      .not("status", "in", "(cancelled,rejected)")
      .gte("pickup_at", startOfDayVN(from))
      .lt("pickup_at", startOfDayVN(addDaysYMD(to, 1)))
      .order("id")
      .range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    out.push(...((data ?? []) as TripLite[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/** Ngày nhận hàng (giờ VN) của chuyến */
export const tripDay = (t: TripLite) => todayVN(new Date(t.pickup_at));
