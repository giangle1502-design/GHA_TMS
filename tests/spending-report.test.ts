import { describe, expect, it } from "vitest";
import { lineState, summarizeByGroup, type SpendingLine } from "@/lib/spending-report";

const l = (p: Partial<SpendingLine>): SpendingLine => ({
  id: Math.random().toString(),
  source: "trip",
  group_name: "Nhiên liệu",
  group_sort: 10,
  item_name: "Dầu diesel",
  report_date: "2026-11-05",
  amount: 100,
  status: "approved",
  is_pass_through: false,
  code: null,
  shipment_code: null,
  plate_number: null,
  driver_name: null,
  customer_name: null,
  supplier_name: null,
  paid_by: null,
  ref_no: null,
  note: null,
  ...p,
});

describe("summarizeByGroup", () => {
  it("chỉ cộng khoản đã duyệt, không phải chi hộ; chờ duyệt và chi hộ để riêng", () => {
    const s = summarizeByGroup([
      l({ amount: 1000 }),
      l({ amount: 500, status: "pending" }),
      l({ group_name: "Bốc xếp, nâng hạ", item_name: "Nâng hạ", amount: 300, is_pass_through: true }),
      l({ group_name: "Bốc xếp, nâng hạ", item_name: "Bốc xếp", amount: 200 }),
      l({ source: "carrier", group_name: "Thuê xe ngoài 3PL", item_name: "Cước trả 3PL", amount: 2000, group_sort: 9600 }),
    ], ["Bốc xếp, nâng hạ", "Nhiên liệu"]);
    expect(s.map((g) => g.group)).toEqual(["Bốc xếp, nâng hạ", "Nhiên liệu", "Thuê xe ngoài 3PL"]);
    expect(s[0]).toMatchObject({ total: 200, passThrough: 300, count: 1 });
    expect(s[1]).toMatchObject({ total: 1000, pending: 500, count: 1 });
    expect(s[2].bySource.carrier).toBe(2000);
    expect(s[0].items.map((i) => i.item)).toEqual(["Bốc xếp", "Nâng hạ"]);
  });
  it("lineState ưu tiên chi hộ", () => {
    expect(lineState({ status: "pending", is_pass_through: true })).toBe("pass_through");
    expect(lineState({ status: "approved", is_pass_through: false })).toBe("counted");
  });
});
