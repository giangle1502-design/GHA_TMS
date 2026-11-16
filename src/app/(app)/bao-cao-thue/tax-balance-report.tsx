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
import type { TableViewConfig } from "@/lib/entities/types";
import { computeTaxBalance, type TaxInvoiceRow, type TaxLine, type TaxMonthRow } from "@/lib/tax-balance";
import { GHA_COMPANY } from "@/lib/delivery-note";
import { cn } from "@/lib/utils";

// Thuế suất TNDN 20%, đổi được trên trang
const DEFAULT_CIT = 20;

export function TaxBalanceReport({ period, invoices, view }: { period: Period; invoices: TaxInvoiceRow[]; view: TableViewConfig | null }) {
  const [citRate, setCitRate] = useState(DEFAULT_CIT);
  const b = useMemo(() => computeTaxBalance({ invoices, citRate }), [invoices, citRate]);

  type Line = { no: string; label: string; amount: number | null; note?: string; bold?: boolean; indent?: boolean };
  const detail = (ls: TaxLine[], withNonDed: boolean): Line[] =>
    ls.map((l, i) => ({
      no: String(i + 1),
      label: l.group && l.group !== "Khác" ? `${l.group}: ${l.label}` : l.label,
      amount: l.amount,
      indent: true,
      note: [`${formatNumber(l.count)} HĐ`, `VAT ${formatVND(l.vat)}`, withNonDed && l.nonDeductible ? `không được trừ ${formatVND(l.nonDeductible)}` : ""].filter(Boolean).join(" · "),
    }));
  const statement: Line[] = [
    { no: "I", label: "DOANH THU (hóa đơn bán ra, chưa VAT)", amount: b.revenue, bold: true, note: `${formatNumber(b.saleCount)} hóa đơn` },
    ...detail(b.revenueLines, false),
    { no: "II", label: "CHI PHÍ (hóa đơn mua vào, chưa VAT)", amount: b.costTotal, bold: true, note: `${formatNumber(b.purchaseCount)} hóa đơn` },
    ...detail(b.costLines, true),
    { no: "III", label: "LỢI NHUẬN (I − II)", amount: b.profit, bold: true },
    { no: "IV", label: "Chi phí không được trừ khi tính thuế", amount: b.nonDeductible, note: "Hóa đơn mua vào bỏ chọn “được trừ”" },
    { no: "V", label: "THU NHẬP TÍNH THUẾ (III + IV)", amount: b.taxableProfit, bold: true },
    { no: "VI", label: `Thuế TNDN tạm tính (${formatNumber(citRate)}%)`, amount: b.cit, bold: true, note: b.taxableProfit <= 0 ? "Lỗ: không phát sinh thuế" : undefined },
    { no: "VII", label: "VAT đầu ra (thuế trên hóa đơn bán ra)", amount: b.vatOut },
    { no: "VIII", label: "VAT đầu vào được khấu trừ (thuế trên hóa đơn mua vào)", amount: b.vatIn },
    { no: "IX", label: "VAT còn phải nộp (VII − VIII)", amount: b.vatPayable, bold: true, note: b.vatPayable < 0 ? "Âm: được khấu trừ chuyển kỳ sau" : undefined },
  ];

  async function exportExcel() {
    await downloadXlsx({
      filename: `Can-doi-thue-${period.from}_${period.to}.xlsx`,
      sheet: "Cân đối thuế",
      title: `CÂN ĐỐI THUẾ – ${period.label}`,
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
        ...b.months.map((m) => ["", `Tháng ${m.label}: doanh thu ${formatVND(m.revenue)}, chi phí ${formatVND(m.cost)}, VAT phải nộp ${formatVND(m.vatPayable)}`, m.profit, "Lợi nhuận"]),
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
    { key: "saleCount", label: "HĐ bán ra", width: 90, align: "right", kind: "number", value: (r) => r.saleCount },
    money("revenue", "Doanh thu", 150),
    money("vatOut", "VAT đầu ra", 130),
    { key: "purchaseCount", label: "HĐ mua vào", width: 100, align: "right", kind: "number", value: (r) => r.purchaseCount },
    money("cost", "Chi phí", 150),
    money("vatIn", "VAT đầu vào", 130),
    money("vatPayable", "VAT phải nộp", 130),
    money("profit", "Lợi nhuận", 150),
  ];

  return (
    <>
      <div className="print:hidden">
        <PeriodBar period={period} />
        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-2.5">
          <div className="space-y-1">
            <Label htmlFor="cit">Thuế suất TNDN (%)</Label>
            <Input
              id="cit"
              inputMode="decimal"
              className="h-8 w-28"
              defaultValue={citRate}
              onBlur={(e) => setCitRate(Math.max(0, Math.min(100, Number(e.target.value.replace(",", ".")) || 0)))}
            />
          </div>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer /> In / PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel}>
            <Download /> Xuất Excel
          </Button>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 [&>*]:min-w-0">
          <Kpi label="Doanh thu (hóa đơn bán ra)" value={b.revenue} note={`${formatNumber(b.saleCount)} hóa đơn · chưa VAT`} />
          <Kpi label="Chi phí (hóa đơn mua vào)" value={b.costTotal} note={`${formatNumber(b.purchaseCount)} hóa đơn · không được trừ ${formatVND(b.nonDeductible)}`} />
          <Kpi label="Lợi nhuận" value={b.profit} note={b.revenue ? `Tỷ suất ${formatNumber(Math.round((b.profit / b.revenue) * 1000) / 10)}%` : " "} />
          <Kpi label="Thuế phải nộp (tạm tính)" value={b.cit + Math.max(0, b.vatPayable)} note={`TNDN ${formatVND(b.cit)} · VAT ${formatVND(Math.max(0, b.vatPayable))}`} />
        </div>
      </div>

      <div className="tax-print rounded-lg border bg-card p-4 print:border-0 print:p-0">
        <div className="mb-3 text-center">
          <div className="text-sm font-semibold uppercase">{GHA_COMPANY.name}</div>
          <div className="text-xs text-muted-foreground">MST: {GHA_COMPANY.tax_code}</div>
          <h2 className="mt-2 text-lg font-bold">BẢNG CÂN ĐỐI THUẾ TẠM TÍNH</h2>
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
        <p className="mt-2 text-xs text-muted-foreground print:hidden">
          Số liệu lấy từ{" "}
          <Link href="/so-hoa-don" className="text-primary underline">
            Sổ hóa đơn bán ra, mua vào
          </Link>{" "}
          theo ngày hóa đơn. Không lấy cước, chi phí chuyến, 3PL hay lương từ dữ liệu chuyến: hóa đơn nào muốn tính thì nhập vào sổ (dán ảnh hóa đơn để nhập nhanh).
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
