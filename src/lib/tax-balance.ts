/**
 * Cân đối doanh thu cước với chi phí theo kỳ để làm báo cáo thuế (GHA 9011). Tính ở trình duyệt / máy chủ, không đặt trong tệp "use client".
 *  - Doanh thu: cước + phụ phí + hỗ trợ dầu + phí khác tính doanh thu của chuyến (report_shipment_profit). Chi hộ không tính.
 *  - Chi phí: Tổng chi theo nhóm (report_spending_lines: chi phí chuyến đã duyệt, chi phí xe, trả 3PL, đề nghị chi,
 *    chi phí ngoài chuyến; trừ chi hộ và khoản chờ duyệt) + lương tài xế (bảng lương đã duyệt / đã trả).
 *  - Chi phí ngoài chuyến không có hóa đơn hoặc đánh dấu "không được trừ" thì tách riêng: không trừ khi tính thuế TNDN.
 *  - VAT đầu ra = doanh thu × thuế suất; VAT đầu vào = VAT các khoản chi ngoài chuyến có hóa đơn.
 */
import type { SpendingLine, SpendingSource } from "@/lib/spending-report";
import { lineState } from "@/lib/spending-report";

export type TaxRevenueRow = {
  report_date: string;
  freight_amount: number;
  surcharge_amount: number;
  fuel_support_amount: number;
  extra_fee_amount: number;
  pass_through_amount: number;
};

export type TaxOverheadRow = {
  expense_date: string;
  amount: number;
  vat_amount: number;
  has_invoice: boolean;
  tax_deductible: boolean | null;
  group_name: string;
};

export type TaxPayrollRow = { report_month: string; payroll: number };

export type TaxCostSource = SpendingSource | "payroll";

export const TAX_COST_SOURCES: { value: TaxCostSource; label: string }[] = [
  { value: "trip", label: "Chi phí chuyến (dầu, cầu đường, bốc xếp…)" },
  { value: "carrier", label: "Thuê xe ngoài 3PL" },
  { value: "vehicle", label: "Chi phí xe (sửa chữa, bảo dưỡng nhập ở Phương tiện)" },
  { value: "purchase", label: "Đề nghị chi, mua sắm" },
  { value: "payroll", label: "Lương tài xế" },
  { value: "overhead", label: "Chi phí ngoài chuyến" },
];

export type TaxCostLine = {
  key: string;
  source: TaxCostSource;
  label: string;
  amount: number;
  /** Phần không được trừ khi tính thuế TNDN (chỉ có ở chi phí ngoài chuyến: không hóa đơn / không được trừ) */
  nonDeductible: number;
};

export type TaxMonthRow = {
  month: string;
  label: string;
  trips: number;
  revenue: number;
  cost: number;
  profit: number;
} & Record<TaxCostSource, number>;

export type TaxBalance = {
  revenue: { freight: number; extra: number; total: number; passThrough: number; trips: number };
  costLines: TaxCostLine[];
  costTotal: number;
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

export function computeTaxBalance(input: {
  revenue: TaxRevenueRow[];
  spending: SpendingLine[];
  overhead: TaxOverheadRow[];
  payroll: TaxPayrollRow[];
  vatRate: number;
  citRate: number;
}): TaxBalance {
  const months = new Map<string, TaxMonthRow>();
  const mon = (ymd: string) => {
    const ym = ymd.slice(0, 7);
    let m = months.get(ym);
    if (!m) {
      m = { month: ym, label: monthLabel(ym), trips: 0, revenue: 0, cost: 0, profit: 0, trip: 0, vehicle: 0, carrier: 0, purchase: 0, overhead: 0, payroll: 0 };
      months.set(ym, m);
    }
    return m;
  };

  const rev = { freight: 0, extra: 0, total: 0, passThrough: 0, trips: 0 };
  for (const r of input.revenue) {
    const freight = n(r.freight_amount) + n(r.surcharge_amount) + n(r.fuel_support_amount);
    const extra = n(r.extra_fee_amount);
    rev.freight += freight;
    rev.extra += extra;
    rev.passThrough += n(r.pass_through_amount);
    rev.trips++;
    const m = mon(r.report_date);
    m.trips++;
    m.revenue += freight + extra;
  }
  rev.total = rev.freight + rev.extra;

  // Chi phí theo nguồn; chi phí ngoài chuyến tách theo nhóm loại phí
  const lines = new Map<string, TaxCostLine>();
  const add = (key: string, source: TaxCostSource, label: string, amount: number, nonDeductible = 0) => {
    let l = lines.get(key);
    if (!l) {
      l = { key, source, label, amount: 0, nonDeductible: 0 };
      lines.set(key, l);
    }
    l.amount += amount;
    l.nonDeductible += nonDeductible;
  };
  const label = (s: TaxCostSource) => TAX_COST_SOURCES.find((x) => x.value === s)?.label ?? s;
  for (const l of input.spending) {
    if (l.source === "overhead") continue; // lấy từ input.overhead để có hóa đơn / VAT
    if (lineState(l) !== "counted") continue;
    add(l.source, l.source, label(l.source), n(l.amount));
    const m = mon(l.report_date);
    m[l.source] += n(l.amount);
  }
  let vatIn = 0;
  for (const o of input.overhead) {
    const amt = n(o.amount);
    const nonDed = !o.has_invoice || o.tax_deductible === false ? amt : 0;
    add(`overhead:${o.group_name}`, "overhead", `Ngoài chuyến: ${o.group_name}`, amt, nonDed);
    if (o.has_invoice) vatIn += n(o.vat_amount);
    mon(o.expense_date).overhead += amt;
  }
  for (const p of input.payroll) {
    if (!n(p.payroll)) continue;
    add("payroll", "payroll", label("payroll"), n(p.payroll));
    mon(p.report_month).payroll += n(p.payroll);
  }

  const order = TAX_COST_SOURCES.map((s) => s.value);
  const costLines = [...lines.values()]
    .filter((l) => l.amount)
    .sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source) || a.label.localeCompare(b.label, "vi"));
  const costTotal = costLines.reduce((a, l) => a + l.amount, 0);
  const nonDeductible = costLines.reduce((a, l) => a + l.nonDeductible, 0);
  const deductibleCost = costTotal - nonDeductible;
  const profit = rev.total - costTotal;
  const taxableProfit = rev.total - deductibleCost;
  const cit = Math.max(0, Math.round((taxableProfit * input.citRate) / 100));
  const vatOut = Math.round((rev.total * input.vatRate) / 100);

  for (const m of months.values()) {
    m.cost = m.trip + m.vehicle + m.carrier + m.purchase + m.overhead + m.payroll;
    m.profit = m.revenue - m.cost;
  }
  return {
    revenue: rev,
    costLines,
    costTotal,
    nonDeductible,
    deductibleCost,
    profit,
    taxableProfit,
    cit,
    vatOut,
    vatIn: Math.round(vatIn),
    vatPayable: vatOut - Math.round(vatIn),
    months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}
