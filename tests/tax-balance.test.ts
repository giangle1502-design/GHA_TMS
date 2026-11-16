import { describe, expect, it } from "vitest";
import { computeTaxBalance, type TaxInvoiceRow } from "@/lib/tax-balance";

const inv = (p: Partial<TaxInvoiceRow>): TaxInvoiceRow => ({
  direction: "purchase",
  invoice_date: "2026-10-05",
  amount: 0,
  vat_amount: 0,
  tax_deductible: true,
  category_name: "",
  group_name: "",
  ...p,
});

describe("cân đối thuế từ sổ hóa đơn", () => {
  const b = computeTaxBalance({
    citRate: 20,
    invoices: [
      inv({ direction: "sale", invoice_date: "2026-10-03", amount: 100_000_000, vat_amount: 8_000_000, category_name: "Cước vận chuyển", group_name: "Vận chuyển" }),
      inv({ direction: "sale", invoice_date: "2026-11-03", amount: 20_000_000, vat_amount: 1_600_000, category_name: "Cước vận chuyển", group_name: "Vận chuyển" }),
      inv({ amount: 50_000_000, vat_amount: 4_000_000, category_name: "Thuê xe ngoài 3PL", group_name: "Vận chuyển" }),
      inv({ invoice_date: "2026-11-10", amount: 500_000, vat_amount: 0, category_name: "Xăng dầu", group_name: "Xe" }),
      inv({ invoice_date: "2026-11-12", amount: 2_000_000, vat_amount: 160_000, tax_deductible: false, category_name: "Ăn uống, tiếp khách", group_name: "Công tác, tiếp khách" }),
    ],
  });

  it("doanh thu, chi phí, VAT chỉ từ hóa đơn", () => {
    expect(b.revenue).toBe(120_000_000);
    expect(b.saleCount).toBe(2);
    expect(b.costTotal).toBe(52_500_000);
    expect(b.purchaseCount).toBe(3);
    expect(b.vatOut).toBe(9_600_000);
    expect(b.vatIn).toBe(4_000_000); // ăn uống không được trừ: không khấu trừ VAT
    expect(b.vatPayable).toBe(5_600_000);
  });

  it("lợi nhuận, thu nhập tính thuế, TNDN", () => {
    expect(b.profit).toBe(67_500_000);
    expect(b.nonDeductible).toBe(2_000_000);
    expect(b.taxableProfit).toBe(69_500_000);
    expect(b.cit).toBe(13_900_000);
  });

  it("gom theo nhóm, loại và theo tháng", () => {
    expect(b.revenueLines).toHaveLength(1);
    expect(b.costLines.map((l) => l.label)).toEqual(["Ăn uống, tiếp khách", "Thuê xe ngoài 3PL", "Xăng dầu"]);
    expect(b.months.map((m) => [m.label, m.revenue, m.cost, m.vatPayable])).toEqual([
      ["10/2026", 100_000_000, 50_000_000, 4_000_000],
      ["11/2026", 20_000_000, 2_500_000, 1_600_000],
    ]);
  });

  it("lỗ thì không có thuế TNDN", () => {
    const l = computeTaxBalance({ citRate: 20, invoices: [inv({ amount: 1_000_000, vat_amount: 80_000 })] });
    expect(l.cit).toBe(0);
    expect(l.vatPayable).toBe(-80_000);
  });
});
