import { describe, expect, it } from "vitest";
import { computeFuelRow, parseFuelNumber, parseFuelSheet, shiftMonth, sumFuel, summarizeByType, type FuelRowRaw } from "@/lib/vehicle-fuel";

const raw = (o: Partial<FuelRowRaw> = {}): FuelRowRaw => ({
  vehicle_id: "v1",
  plate_number: "61K31295",
  vehicle_code: "XE001",
  vehicle_type: "Xe cont",
  driver_name: "Nguyễn Văn A",
  vehicle_status: "active",
  km_start: 12000,
  km_start_auto: true,
  km_end: 14500,
  fuel_opening: "120",
  fuel_opening_auto: true,
  fuel_added: "900",
  fuel_remaining: "150",
  fuel_ratio: "0.35",
  fuel_ratio_auto: false,
  final_fuel: null,
  final_note: null,
  note: null,
  locked_at: null,
  locked_by_name: null,
  has_row: true,
  ...o,
});

describe("Dầu theo xe", () => {
  it("tính KM chạy, dầu thực tế, dầu theo KM × tỷ trọng, chênh lệch", () => {
    const r = computeFuelRow(raw());
    expect(r.kmRun).toBe(2500);
    expect(r.actual).toBe(870); // 120 + 900 − 150
    expect(r.norm).toBe(875); // 2500 × 0.35
    expect(r.diff).toBe(-5);
  });
  it("thành tiền = số chốt × đơn giá, chưa chốt thì tạm tính theo thực tế", () => {
    const tmp = computeFuelRow(raw({ fuel_price: "20500" }));
    expect(tmp.amount).toBe(870 * 20500);
    expect(tmp.amountTemp).toBe(true);
    const fin = computeFuelRow(raw({ fuel_price: 20500, final_fuel: "875" }));
    expect(fin.amount).toBe(875 * 20500);
    expect(fin.amountTemp).toBe(false);
    expect(computeFuelRow(raw()).amount).toBeNull();
    expect(sumFuel("T", [tmp, fin]).amount).toBe(1745 * 20500);
  });
  it("thiếu số thì không tính (không đoán)", () => {
    const r = computeFuelRow(raw({ km_end: null, fuel_remaining: null, fuel_added: null }));
    expect(r.kmRun).toBeNull();
    expect(r.norm).toBeNull();
    expect(r.actual).toBeNull();
    // Không đổ thêm thì tính là 0
    expect(computeFuelRow(raw({ fuel_added: null })).actual).toBe(-30);
  });
  it("không sai số dấu phẩy động", () => {
    expect(computeFuelRow(raw({ km_start: 0, km_end: 3, fuel_ratio: "0.1" })).norm).toBe(0.3);
  });
  it("cộng tổng và tổng theo loại xe", () => {
    const rows = [
      computeFuelRow(raw()),
      computeFuelRow(raw({ vehicle_id: "v2", vehicle_type: "Xe tải", locked_at: "2026-11-01T00:00:00Z", final_fuel: 500 })),
      computeFuelRow(raw({ vehicle_id: "v3", vehicle_type: null })),
    ];
    const t = sumFuel("Tổng", rows);
    expect(t.vehicles).toBe(3);
    expect(t.locked).toBe(1);
    expect(t.actual).toBe(2610);
    expect(t.final).toBe(500);
    expect(summarizeByType(rows).map((g) => [g.label, g.vehicles])).toEqual([
      ["Xe cont", 1],
      ["Xe tải", 1],
      ["Chưa chọn loại xe", 1],
    ]);
  });
  it("đọc số: dấu phẩy hàng nghìn, dấu chấm thập phân", () => {
    expect(parseFuelNumber("2,150.5")).toBe(2150.5);
    expect(parseFuelNumber(" ")).toBeNull();
    expect(parseFuelNumber(12)).toBe(12);
    expect(parseFuelNumber("abc")).toBeUndefined();
  });
  it("đọc file nhập Excel theo tên cột, bỏ dòng trống, báo dòng lỗi", () => {
    const p = parseFuelSheet([
      ["DẦU THEO XE"],
      ["Số xe", "Số KM cuối tháng", "Số lượng dầu đổ thêm", "Ghi chú"],
      ["61k-312.95", 14500, "2,150", "  "],
      [null, null, null, null],
      ["51C12345", "abc", 1, null],
      ["", 1, 1, null],
    ], 1);
    expect(p.missing).toEqual([]);
    expect(p.rows).toEqual([{ row: 3, plate: "61K31295", km_end: 14500, fuel_added: 2150, note: null }]);
    expect(p.errors).toEqual([
      { row: 5, error: "Số KM cuối tháng không phải số" },
      { row: 6, error: "Thiếu số xe" },
    ]);
    expect(parseFuelSheet([["Biển"], ["X"]]).missing).toEqual(["Số xe"]);
  });
  it("chuyển tháng", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});
