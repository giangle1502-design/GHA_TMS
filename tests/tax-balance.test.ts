import { describe, expect, it } from "vitest";
import { computeTaxBalance } from "@/lib/tax-balance";
import type { SpendingLine } from "@/lib/spending-report";

const line = (p: Partial<SpendingLine>): SpendingLine => ({
  id: Math.random().toString(),
  source: "trip",
  group_name: "Nhiên liệu",
  group_sort: 1,
  item_name: "Dầu",
  report_date: "2026-10-05",
  amount: 0,
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

describe("cân đối thu chi, thuế", () => {
  const b = computeTaxBalance({
    revenue: [
      { report_date: "2026-10-03", freight_amount: 10_000_000, surcharge_amount: 0, fuel_support_amount: 1_000_000, extra_fee_amount: 500_000, pass_through_amount: 2_000_000 },
      { report_date: "2026-11-03", freight_amount: 8_000_000, surcharge_amount: 500_000, fuel_support_amount: 0, extra_fee_amount: 0, pass_through_amount: 0 },
    ],
    spending: [
      line({ amount: 3_000_000 }),
      line({ amount: 999, status: "pending" }),
      line({ amount: 777, is_pass_through: true }),
      line({ source: "carrier", amount: 4_000_000, report_date: "2026-11-02" }),
      line({ source: "overhead", amount: 123 }), // bỏ qua: lấy từ danh sách chi phí ngoài chuyến
    ],
    overhead: [
      { expense_date: "2026-10-10", amount: 2_000_000, vat_amount: 0, has_invoice: false, tax_deductible: true, group_name: "Thuế, kế toán" },
      { expense_date: "2026-11-10", amount: 1_000_000, vat_amount: 100_000, has_invoice: true, tax_deductible: true, group_name: "Xe" },
    ],
    payroll: [{ report_month: "2026-10-01", payroll: 5_000_000 }],
    vatRate: 8,
    citRate: 20,
  });
  it("doanh thu không gồm chi hộ", () => {
    expect(b.revenue).toMatchObject({ freight: 19_500_000, extra: 500_000, total: 20_000_000, passThrough: 2_000_000, trips: 2 });
  });
  it("chi phí: bỏ chờ duyệt, chi hộ; tách không hóa đơn", () => {
    expect(b.costTotal).toBe(3_000_000 + 4_000_000 + 2_000_000 + 1_000_000 + 5_000_000);
    expect(b.nonDeductible).toBe(2_000_000);
    expect(b.profit).toBe(20_000_000 - 15_000_000);
    expect(b.taxableProfit).toBe(7_000_000);
    expect(b.cit).toBe(1_400_000);
  });
  it("VAT đầu ra, đầu vào", () => {
    expect([b.vatOut, b.vatIn, b.vatPayable]).toEqual([1_600_000, 100_000, 1_500_000]);
  });
  it("theo tháng", () => {
    expect(b.months.map((m) => [m.month, m.revenue, m.cost, m.profit])).toEqual([
      ["2026-10", 11_500_000, 10_000_000, 1_500_000],
      ["2026-11", 8_500_000, 5_000_000, 3_500_000],
    ]);
  });
});
