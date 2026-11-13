import { describe, expect, it } from "vitest";
import { computeFuelRow, type FuelRowRaw } from "@/lib/vehicle-fuel";
import { allocateTrips, monthsBetween, routeStats, vehicleStats, type FuelMonthRow, type FuelTrip } from "@/lib/fuel-analysis";

const row = (id: string, month: string, o: Partial<FuelRowRaw>): FuelMonthRow => ({
  ...computeFuelRow({
    vehicle_id: id, plate_number: id.toUpperCase(), vehicle_code: null, vehicle_type: "Xe cont", driver_name: null, vehicle_status: "active",
    km_start: 0, km_start_auto: false, km_end: 1000, fuel_opening: 0, fuel_opening_auto: false, fuel_added: 400, fuel_remaining: 0,
    fuel_ratio: 0.35, fuel_ratio_auto: false, fuel_price: 20000, fuel_price_auto: false, final_fuel: null, final_note: null, note: null,
    locked_at: null, locked_by_name: null, has_row: true, ...o,
  }),
  month,
});
const trip = (id: string, v: string, routeKey: string, km: number | null, month = "2026-10"): FuelTrip => ({ id, vehicleId: v, month, routeKey, routeName: routeKey, km });

describe("Phân tích dầu", () => {
  it("so sánh xe: lít/100 km, vượt định mức, so với TB cùng loại, tiền/km", () => {
    const s = vehicleStats(
      [row("a", "2026-10", {}), row("a", "2026-11", { km_start: 1000, km_end: 2000, fuel_added: 300 }), row("b", "2026-10", { fuel_added: 300 }), row("c", "2026-10", { km_end: null })],
      new Map([["a", 4]]),
    );
    expect(s.map((x) => x.id)).toEqual(["a", "b"]); // c thiếu KM cuối: bỏ
    const a = s[0];
    expect(a.km).toBe(2000);
    expect(a.liters).toBe(700);
    expect(a.per100).toBe(35);
    expect(a.overPct).toBe(0);
    expect(a.kmPerTrip).toBe(500);
    expect(a.costPerKm).toBe(7000);
    // TB loại = 1000 lít / 3000 km = 33.33 → a +5%, b −10%
    expect(a.vsTypePct).toBe(5);
    expect(s[1].vsTypePct).toBe(-10);
  });
  it("dùng số Giám đốc chốt nếu có", () => {
    expect(vehicleStats([row("a", "2026-10", { final_fuel: 300 })])[0].liters).toBe(300);
  });
  it("chia dầu xe về chuyến theo km tuyến, tuyến chưa có km lấy km trung bình", () => {
    const alloc = allocateTrips([row("a", "2026-10", {})], [trip("1", "a", "R1", 300), trip("2", "a", "R2", 100), trip("3", "a", "R3", null), trip("4", "a", "R1", 300, "2026-11")]);
    expect(alloc).toHaveLength(3); // tháng 11 không có số dầu
    const l = Object.fromEntries(alloc.map((x) => [x.id, x.liters]));
    expect(l["1"]).toBeCloseTo(200); // 400 × 300/600
    expect(l["2"]).toBeCloseTo((400 * 100) / 600);
    expect(l["3"]).toBeCloseTo((400 * 200) / 600);
    const r = routeStats(alloc);
    expect(r[0].key).toBe("R1");
    expect(r[0].cost).toBe(4000000);
    expect(r.find((x) => x.key === "R3")!.per100).toBeNull();
    expect(r.reduce((a, x) => a + x.sharePct, 0)).toBeCloseTo(100, 1);
  });
  it("không có km tuyến nào thì chia đều theo chuyến", () => {
    const alloc = allocateTrips([row("a", "2026-10", {})], [trip("1", "a", "R1", null), trip("2", "a", "R2", null)]);
    expect(alloc.map((x) => x.liters)).toEqual([200, 200]);
  });
  it("danh sách tháng", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});
