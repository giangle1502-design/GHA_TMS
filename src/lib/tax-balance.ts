/**
 * Cân đối thuế theo kỳ từ Sổ hóa đơn (GHA 9012), tách riêng với dữ liệu chuyến. Không đặt trong tệp "use client" (có kiểm thử).
 *  - Doanh thu = tiền chưa thuế của hóa đơn bán ra (GHA xuất cho khách); VAT đầu ra = tiền thuế ghi trên các hóa đơn đó.
 *  - Chi phí = tiền chưa thuế của hóa đơn mua vào (3PL, xăng dầu, điện, ăn uống, taxi, vé máy bay…);
 *    VAT đầu vào = tiền thuế các hóa đơn mua vào được trừ.
 *  - Hóa đơn mua vào bỏ chọn "được trừ" thì vẫn là chi phí nhưng không trừ khi tính thuế TNDN và không khấu trừ VAT.
 */

export type TaxInvoiceRow = {
  direction: "sale" | "purchase";
  invoice_date: string;
  amount: number;
  vat_amount: number;
  tax_deductible: boolean;
  category_name: string;
  group_name: string;
};

export type TaxLine = {
  key: string;
  group: string;
  label: string;
  count: number;
  amount: number;
  vat: number;
  /** Phần không được trừ khi tính thuế TNDN (chỉ ở hóa đơn mua vào) */
  nonDeductible: number;
};

export type TaxMonthRow = {
  month: string;
  label: string;
  saleCount: number;
  revenue: number;
  vatOut: number;
  purchaseCount: number;
  cost: number;
  vatIn: number;
  vatPayable: number;
  profit: number;
};

export type TaxBalance = {
  revenueLines: TaxLine[];
  revenue: number;
  saleCount: number;
  costLines: TaxLine[];
  costTotal: number;
  purchaseCount: number;
  nonDeductible: number;
  deductibleCost: number;
  profit: number;
  taxableProfit: number;
  cit: number;
  vatOut: number;
  vatIn: number;
  vatPayable: number;
  months: TaxMonthRow[];
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const monthLabel = (ym: string) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;

export function computeTaxBalance(input: { invoices: TaxInvoiceRow[]; citRate: number }): TaxBalance {
  const months = new Map<string, TaxMonthRow>();
  const mon = (ymd: string) => {
    const ym = ymd.slice(0, 7);
    let m = months.get(ym);
    if (!m) {
      m = { month: ym, label: monthLabel(ym), saleCount: 0, revenue: 0, vatOut: 0, purchaseCount: 0, cost: 0, vatIn: 0, vatPayable: 0, profit: 0 };
      months.set(ym, m);
    }
    return m;
  };
  const sale = new Map<string, TaxLine>();
  const buy = new Map<string, TaxLine>();
  const add = (map: Map<string, TaxLine>, r: TaxInvoiceRow, nonDed: number) => {
    const group = r.group_name?.trim() || "Khác";
    const label = r.category_name?.trim() || "Chưa phân loại";
    const key = `${group}|${label}`;
    let l = map.get(key);
    if (!l) {
      l = { key, group, label, count: 0, amount: 0, vat: 0, nonDeductible: 0 };
      map.set(key, l);
    }
    l.count++;
    l.amount += n(r.amount);
    l.vat += n(r.vat_amount);
    l.nonDeductible += nonDed;
  };

  let vatOut = 0;
  let vatIn = 0;
  for (const r of input.invoices) {
    const m = mon(r.invoice_date);
    if (r.direction === "sale") {
      add(sale, r, 0);
      vatOut += n(r.vat_amount);
      m.saleCount++;
      m.revenue += n(r.amount);
      m.vatOut += n(r.vat_amount);
    } else {
      add(buy, r, r.tax_deductible === false ? n(r.amount) : 0);
      if (r.tax_deductible !== false) {
        vatIn += n(r.vat_amount);
        m.vatIn += n(r.vat_amount);
      }
      m.purchaseCount++;
      m.cost += n(r.amount);
    }
  }
  const sorted = (map: Map<string, TaxLine>) =>
    [...map.values()].sort((a, b) => a.group.localeCompare(b.group, "vi") || b.amount - a.amount || a.label.localeCompare(b.label, "vi"));
  const revenueLines = sorted(sale);
  const costLines = sorted(buy);
  const revenue = revenueLines.reduce((a, l) => a + l.amount, 0);
  const costTotal = costLines.reduce((a, l) => a + l.amount, 0);
  const nonDeductible = costLines.reduce((a, l) => a + l.nonDeductible, 0);
  const deductibleCost = costTotal - nonDeductible;
  const profit = revenue - costTotal;
  const taxableProfit = revenue - deductibleCost;
  const cit = Math.max(0, Math.round((taxableProfit * input.citRate) / 100));
  for (const m of months.values()) {
    m.profit = m.revenue - m.cost;
    m.vatPayable = m.vatOut - m.vatIn;
  }
  return {
    revenueLines,
    revenue,
    saleCount: revenueLines.reduce((a, l) => a + l.count, 0),
    costLines,
    costTotal,
    purchaseCount: costLines.reduce((a, l) => a + l.count, 0),
    nonDeductible,
    deductibleCost,
    profit,
    taxableProfit,
    cit,
    vatOut: Math.round(vatOut),
    vatIn: Math.round(vatIn),
    vatPayable: Math.round(vatOut) - Math.round(vatIn),
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}
