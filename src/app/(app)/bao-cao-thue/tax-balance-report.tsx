"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { ReportGrid, type ReportColumn } from "@/components/grid/report-grid";
import { PeriodBar } from "@/app/(app)/bao-cao/nhom-phi/cost-group-report";
import { formatNumber, formatVND } from "@/lib/format";
import { downloadXlsx } from "@/lib/xlsx-client";
import type { Period } from "@/lib/report-period";
import type { SpendingLine } from "@/lib/spending-report";
import type { TableViewConfig } from "@/lib/entities/types";
import { TAX_COST_SOURCES, computeTaxBalance, type TaxMonthRow, type TaxOverheadRow, type TaxPayrollRow, type TaxRevenueRow } from "@/lib/tax-balance";
import { GHA_COMPANY } from "@/lib/delivery-note";
import { cn } from "@/lib/utils";

// VAT dịch vụ vận tải đang giảm còn 8% đến hết 31/12/2026; TNDN 20%. Đổi được trên trang.
const DEFAULT_RATES = { vat: 8, cit: 20 };

export function TaxBalanceReport({
  period,
  noReports,
  revenue,
  spending,
  overhead,
  payroll,
  view,
}: {
  period: Period;
  noReports: boolean;
  revenue: TaxRevenueRow[];
  spending: SpendingLine[];
  overhead: TaxOverheadRow[];
  payroll: TaxPayrollRow[];
  view: TableViewConfig | null;
}) {
  const [rates, setRates] = useState(DEFAULT_RATES);
  const setRate = (k: "vat" | "cit", v: string) => setRates({ ...rates, [k]: Math.max(0, Math.min(100, Number(v.replace(",", ".")) || 0)) });
  const b = useMemo(
    () => computeTaxBalance({ revenue, spending, overhead, payroll, vatRate: rates.vat, citRate: rates.cit }),
    [revenue, spending, overhead, payroll, rates],
  );

  type Line = { no: string; label: string; amount: number | null; note?: string; bold?: boolean; indent?: boolean };
  const statement: Line[] = [
    { no: "I", label: "DOANH THU CƯỚC VẬN CHUYỂN (chưa VAT)", amount: b.revenue.total, bold: true, note: `${formatNumber(b.revenue.trips)} chuyến` },
    { no: "1", label: "Cước vận chuyển, phụ phí, hỗ trợ dầu", amount: b.revenue.freight, indent: true },
    { no: "2", label: "Phí khác tính doanh thu", amount: b.revenue.extra, indent: true },
    { no: "", label: "Chi hộ khách (thu lại, không tính doanh thu)", amount: b.revenue.passThrough, indent: true, note: "Không cộng" },
    { no: "II", label: "TỔNG CHI PHÍ", amount: b.costTotal, bold: true },
    ...b.costLines.map((l, i) => ({
      no: String(i + 1),
      label: l.label,
      amount: l.amount,
      indent: true,
      note: l.nonDeductible ? `Không hóa đơn / không được trừ: ${formatVND(l.nonDeductible)}` : undefined,
    })),
    { no: "III", label: "LỢI NHUẬN (I − II)", amount: b.profit, bold: true },
    { no: "IV", label: "Chi phí không được trừ khi tính thuế", amount: b.nonDeductible, note: "Chi ngoài chuyến không có hóa đơn hoặc bỏ chọn “được trừ”" },
    { no: "V", label: "THU NHẬP TÍNH THUẾ (III + IV)", amount: b.taxableProfit, bold: true },
    { no: "VI", label: `Thuế TNDN tạm tính (${formatNumber(rates.cit)}%)`, amount: b.cit, bold: true, note: b.taxableProfit <= 0 ? "Lỗ: không phát sinh thuế" : undefined },
    { no: "VII", label: `VAT đầu ra (${formatNumber(rates.vat)}% doanh thu)`, amount: b.vatOut },
    { no: "VIII", label: "VAT đầu vào (chi phí ngoài chuyến có hóa đơn)", amount: b.vatIn },
    { no: "IX", label: "VAT còn phải nộp (VII − VIII)", amount: b.vatPayable, bold: true, note: b.vatPayable < 0 ? "Âm: được khấu trừ chuyển kỳ sau" : undefined },
  ];

  async function exportExcel() {
    await downloadXlsx({
      filename: `Can-doi-thu-chi-${period.from}_${period.to}.xlsx`,
      sheet: "Cân đối thu chi",
      title: `CÂN ĐỐI THU CHI, THUẾ – ${period.label}`,
      subtitle: GHA_COMPANY.name,
      columns: [
        { label: "STT", width: 8 },
        { label: "Chỉ tiêu", width: 60 },
        { label: "Số tiền (đồng)", width: 20, numeric: true },
        { label: "Ghi chú", width: 50 },
      ],
      rows: [
        ...statement.map((l) => [l.no, l.label, l.amount, l.note ?? ""]),
        [],
        ["", "THEO THÁNG", null, ""],
        ...b.months.map((m) => ["", `Tháng ${m.label}: doanh thu ${formatVND(m.revenue)}, chi phí ${formatVND(m.cost)}`, m.profit, "Lợi nhuận"]),
      ],
    });
  }

  const money = (key: keyof TaxMonthRow, label: string, width = 140): ReportColumn<TaxMonthRow> => ({
    key: String(key),
    label,
    width,
    align: "right",
    kind: "number",
    value: (r) => Number(r[key]),
    render: (r) => (Number(r[key]) ? <span className={cn(key === "profit" && Number(r[key]) < 0 && "text-red-600")}>{formatVND(Number(r[key]))}</span> : <span className="text-muted-foreground">0</span>),
  });
  const monthCols: ReportColumn<TaxMonthRow>[] = [
    { key: "label", label: "Tháng", width: 90, value: (r) => r.label },
    { key: "trips", label: "Số chuyến", width: 90, align: "right", kind: "number", value: (r) => r.trips },
    money("revenue", "Doanh thu", 150),
    ...TAX_COST_SOURCES.map((s) => money(s.value, s.label.replace(/ \(.*\)$/, ""), 150)),
    money("cost", "Tổng chi phí", 150),
    money("profit", "Lợi nhuận", 150),
  ];

  return (
    <>
      <div className="print:hidden">
        <PeriodBar period={period} />
        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-2.5">
          <div className="space-y-1">
            <Label htmlFor="vat">Thuế suất VAT đầu ra (%)</Label>
            <Input id="vat" inputMode="decimal" className="h-8 w-28" defaultValue={rates.vat} onBlur={(e) => setRate("vat", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cit">Thuế suất TNDN (%)</Label>
            <Input id="cit" inputMode="decimal" className="h-8 w-28" defaultValue={rates.cit} onBlur={(e) => setRate("cit", e.target.value)} />
          </div>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer /> In / PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel}>
            <Download /> Xuất Excel
          </Button>
        </div>
        {noReports ? (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Bạn chưa có quyền Xem báo cáo nên chỉ thấy chi phí ngoài chuyến; doanh thu và chi phí chuyến đang để 0.
          </p>
        ) : null}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 [&>*]:min-w-0">
          <Kpi label="Doanh thu cước" value={b.revenue.total} note={`${formatNumber(b.revenue.trips)} chuyến · chưa VAT`} />
          <Kpi label="Tổng chi phí" value={b.costTotal} note={`Không được trừ ${formatVND(b.nonDeductible)}`} />
          <Kpi label="Lợi nhuận" value={b.profit} note={b.revenue.total ? `Tỷ suất ${formatNumber(Math.round((b.profit / b.revenue.total) * 1000) / 10)}%` : " "} />
          <Kpi label="Thuế phải nộp (tạm tính)" value={b.cit + Math.max(0, b.vatPayable)} note={`TNDN ${formatVND(b.cit)} · VAT ${formatVND(Math.max(0, b.vatPayable))}`} />
        </div>
      </div>

      <div className="tax-print rounded-lg border bg-card p-4 print:border-0 print:p-0">
        <div className="mb-3 text-center">
          <div className="text-sm font-semibold uppercase">{GHA_COMPANY.name}</div>
          <div className="text-xs text-muted-foreground">MST: {GHA_COMPANY.tax_code}</div>
          <h2 className="mt-2 text-lg font-bold">BẢNG CÂN ĐỐI THU CHI, THUẾ TẠM TÍNH</h2>
          <div className="text-sm italic">{period.label}</div>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/60">
              <th className="w-14 border px-2 py-1.5">STT</th>
              <th className="border px-2 py-1.5 text-left">Chỉ tiêu</th>
              <th className="w-44 border px-2 py-1.5 text-right">Số tiền (đồng)</th>
              <th className="border px-2 py-1.5 text-left">Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {statement.map((l, i) => (
              <tr key={i} className={cn(l.bold && "bg-muted/30 font-semibold")}>
                <td className="border px-2 py-1 text-center">{l.no}</td>
                <td className={cn("border px-2 py-1", l.indent && "pl-6")}>{l.label}</td>
                <td className={cn("border px-2 py-1 text-right tabular-nums", (l.amount ?? 0) < 0 && "text-red-600")}>{l.amount === null ? "" : formatVND(l.amount)}</td>
                <td className="border px-2 py-1 text-xs text-muted-foreground">{l.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          Doanh thu tính theo ngày chuyến hoàn thành (chuyến đang chạy trở đi). Chi phí lấy từ{" "}
          <Link href={`/tong-chi?ky=ngay&tu=${period.from}&den=${period.to}`} className="text-primary underline print:no-underline">
            Tổng chi theo nhóm
          </Link>{" "}
          (đã duyệt, không gồm chi hộ) và lương tài xế đã duyệt. VAT đầu vào chỉ gồm khoản chi ngoài chuyến có hóa đơn: hóa đơn dầu, 3PL… muốn khấu trừ thì
          nhập vào Chi phí ngoài chuyến. Thuế suất đổi được ở ô phía trên.
        </p>
      </div>

      <div className="mt-6 print:hidden">
        <h3 className="mb-2 text-base font-semibold">Theo tháng</h3>
        <ReportGrid tableKey="tax_balance_months" rows={b.months} columns={monthCols} view={view} getRowId={(r) => r.month} emptyText="Không có số liệu trong kỳ." />
      </div>
      <style>{`@media print {
        @page { size: A4 portrait; margin: 12mm; }
        body * { visibility: hidden; }
        .tax-print, .tax-print * { visibility: visible; }
        .tax-print { position: absolute; left: 0; top: 0; width: 100%; }
      }`}</style>
    </>
  );
}

function Kpi({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <Card className="h-full">
      <CardContent>
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-xl font-bold tabular-nums sm:text-2xl", value < 0 && "text-red-600")}>{formatVND(value)}</div>
        <div className="mt-1 text-xs text-muted-foreground">{note}</div>
      </CardContent>
    </Card>
  );
}
