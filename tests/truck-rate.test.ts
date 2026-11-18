import { describe, expect, test } from "vitest";
import { basePrice, fuelFactor, parseRateSheet, parseWeightLabel, quoteTruck, resolveGrid, validateCard, type Grid } from "@/lib/truck-rate";

// Bố cục giống file BANG_GIA_NOI_BO.xlsx (rút gọn 2 khoảng km × 3 trọng tải), có ô công thức chưa lưu kết quả
const grid: Grid = [
  ["BẢNG GIÁ VẬN CHUYỂN XE TẢI ĐÃ ĐIỀU CHỈNH HỖ TRỢ XĂNG DẦU 20%"],
  ["Từ (KM)", "Đến (KM)", "Khoảng cách", "Dưới 2.5 tấn", "2.5 - 3.5 tấn", "3.5 - 5.0 tấn"],
  [0, 15, "Từ 0 - 15 KM", 750000, 950000, 1000000],
  [15.001, 25, "Từ 15 - 25 KM", 850000, 1050000, 1150000],
  [],
  ["Từ  (Tấn)", "Đến (Tấn)", "Trọng tải", "Phí bốc xếp"],
  [0, 2.5, "Dưới 2.5 tấn", 150000],
  [{ formula: "B7+0.001" }, 3.5, "2.5 - 3.5 tấn", 150000],
  [{ formula: "B8+0.001" }, 5, "3.5 - 5.0 tấn", 250000],
  [],
  ["Từ (VNĐ)", "Đến (VNĐ)", "Hỗ trợ dầu"],
  [19250, 21999, 1],
  [{ formula: "B12+1" }, { formula: "B12+4000" }, 1.08],
  [{ formula: "B13+1" }, { formula: "B13+5000" }, 1.12],
];

describe("Bảng giá xe tải", () => {
  test("tính công thức đơn giản trong file", () => {
    const g = resolveGrid(grid);
    expect(g[7][0]).toBeCloseTo(2.501);
    expect(g[12][1]).toBe(25999);
    expect(g[13][1]).toBe(30999);
  });

  test("đọc bảng cước, phí bốc xếp, hệ số dầu theo mẫu", () => {
    const { card, warnings } = parseRateSheet(grid, { today: "2026-11-18", fileName: "BANG_GIA_NOI_BO.xlsx", sheetName: "S" });
    expect(warnings).toEqual([]);
    expect(card.fuel_pct_included).toBe(20);
    expect(card.distance_bands.map((b) => b.to_km)).toEqual([15, 25]);
    expect(card.weight_bands.map((b) => [b.from_ton, b.to_ton, b.loading_fee])).toEqual([
      [0, 2.5, 150000],
      [2.501, 3.5, 150000],
      [3.501, 5, 250000],
    ]);
    expect(card.prices[1][2]).toBe(1150000);
    expect(card.fuel_bands.map((b) => [b.from_price, b.to_price, b.factor])).toEqual([
      [19250, 21999, 1],
      [22000, 25999, 1.08],
      [26000, 30999, 1.12],
    ]);
    expect(validateCard(card)).toEqual([]);
  });

  test("đơn giá chưa dầu và cước theo giá dầu", () => {
    const { card } = parseRateSheet(grid, { today: "2026-11-18" });
    expect(basePrice(1200000, 20)).toBe(1000000);
    // 20 km, 4.2 tấn → ô 15-25 km / 3.5-5 tấn = 1,150,000 (gồm 20% dầu)
    const q = quoteTruck(card, { km: 20, tons: 4.2 });
    expect([q.cardPrice, q.unitPrice, q.fuelPct, q.freight, q.loadingFee]).toEqual([1150000, 958333, 20, 1150000, 250000]);
    // Giá dầu 23,500 → hệ số 1.08: cước = 958,333.33 × 1.08
    const q2 = quoteTruck(card, { km: 20, tons: 4.2, fuelPrice: 23500 });
    expect([q2.fuelPct, q2.freight]).toEqual([8, 1035000]);
    // Đúng biên: 15 km thuộc dòng 0-15, 2.5 tấn thuộc cột dưới 2.5
    expect(quoteTruck(card, { km: 15, tons: 2.5 }).cardPrice).toBe(750000);
    expect(quoteTruck(card, { km: 30, tons: 1 }).warnings[0]).toMatch(/vượt bảng giá/);
    expect(fuelFactor(card.fuel_bands, 60000)?.outside).toBe("above");
  });

  test("hiểu nhãn trọng tải", () => {
    expect(parseWeightLabel("Dưới 2.5 tấn")).toEqual({ from: 0, to: 2.5 });
    expect(parseWeightLabel("5.0 tấn - 6.0 tấn")).toEqual({ from: 5, to: 6 });
    expect(parseWeightLabel("abc")).toBeNull();
  });

  test("không có bảng cước thì báo lỗi", () => {
    expect(() => parseRateSheet([["xin chào"]], { today: "2026-11-18" })).toThrow(/Từ \(KM\)/);
  });
});
