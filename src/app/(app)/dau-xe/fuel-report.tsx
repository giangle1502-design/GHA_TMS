"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BarChart3, ChevronLeft, ChevronRight, FileSpreadsheet, Lock, LockOpen, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReportGrid, type ReportColumn } from "@/components/grid/report-grid";
import { downloadXlsx } from "@/lib/xlsx-client";
import { NUMBER_LOCALE, formatDateTime } from "@/lib/format";
import {
  FUEL_IMPORT_COLUMNS,
  computeFuelRow,
  monthLabel,
  parseFuelNumber,
  parseFuelSheet,
  shiftMonth,
  sumFuel,
  summarizeByType,
  type FuelImportParse,
  type FuelMonth,
  type FuelRow,
  type FuelTotals,
} from "@/lib/vehicle-fuel";
import { importVehicleFuel, lockVehicleFuel, saveVehicleFuel, setVehicleFuelFinal, type FuelImportResult } from "@/lib/vehicle-fuel-actions";
import type { TableViewConfig } from "@/lib/entities/types";
import { cn } from "@/lib/utils";

const fmt2 = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits: 2 });
const fmt4 = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits: 4 });
const fmt = (v: number | null | undefined, digits: 2 | 4 = 2) => (v === null || v === undefined ? "" : (digits === 4 ? fmt4 : fmt2).format(v));
const signed = (v: number | null) => (v === null ? "" : `${v > 0 ? "+" : ""}${fmt(v)}`);

type EditKey = "km_start" | "km_end" | "fuel_opening" | "fuel_added" | "fuel_remaining" | "fuel_ratio" | "fuel_price";

/** Ô số sửa tại chỗ: gõ số rồi Enter / bấm ra ngoài để lưu, xóa trống = lấy số tự động */
function NumCell({
  value,
  auto,
  digits = 2,
  editable,
  placeholder,
  title,
  onSave,
}: {
  value: number | null;
  auto?: boolean;
  digits?: 2 | 4;
  editable: boolean;
  placeholder?: string;
  title?: string;
  onSave: (v: number | null) => Promise<boolean>;
}) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = text ?? fmt(value, digits);
  if (!editable) {
    return <span className={cn("tabular-nums", auto && "text-muted-foreground italic")} title={title}>{fmt(value, digits)}</span>;
  }
  async function commit() {
    if (text === null) return;
    const n = parseFuelNumber(text);
    if (n === undefined) {
      toast.error("Chỉ nhập số, ví dụ 2,150.5");
      return;
    }
    if (n !== null && n < 0) {
      toast.error("Không nhập số âm");
      return;
    }
    // Không đổi gì thì không lưu (ô tự lấy để nguyên)
    if (n === value && !(auto && n === null)) {
      setText(null);
      return;
    }
    setBusy(true);
    const ok = await onSave(n);
    setBusy(false);
    if (ok) setText(null);
  }
  return (
    <input
      inputMode="decimal"
      value={shown}
      placeholder={placeholder}
      title={title}
      disabled={busy}
      onFocus={(e) => {
        setText(value === null ? "" : String(value));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(null);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
      className={cn(
        "h-7 w-full rounded border border-transparent bg-transparent px-1 text-right tabular-nums outline-none hover:border-input focus:border-primary focus:bg-background",
        auto && text === null && "text-muted-foreground italic",
        busy && "opacity-50",
      )}
    />
  );
}

function TextCell({ value, editable, placeholder, onSave }: { value: string; editable: boolean; placeholder?: string; onSave: (v: string) => Promise<boolean> }) {
  const [text, setText] = useState<string | null>(null);
  if (!editable) return <span title={value}>{value}</span>;
  return (
    <input
      value={text ?? value}
      placeholder={placeholder}
      maxLength={500}
      onFocus={() => setText(value)}
      onChange={(e) => setText(e.target.value)}
      onBlur={async () => {
        if (text === null) return;
        if (text.trim() === value) return setText(null);
        if (await onSave(text.trim())) setText(null);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="h-7 w-full rounded border border-transparent bg-transparent px-1 outline-none hover:border-input focus:border-primary focus:bg-background"
    />
  );
}

const AUTO_HINT = {
  km_start: "Chữ nghiêng: tự lấy KM cuối tháng trước. Gõ số để sửa, xóa trống để lấy lại số tự động.",
  fuel_opening: "Chữ nghiêng: tự lấy Dầu còn lại tháng trước. Gõ số để sửa, xóa trống để lấy lại số tự động.",
  fuel_ratio: "Chữ nghiêng: lấy Tỷ trọng dầu của xe trong Phương tiện. Gõ số để dùng riêng cho tháng này.",
  fuel_price: "Chữ nghiêng: tự lấy đơn giá dầu tháng trước của xe. Gõ số để sửa.",
};

export function FuelReport({ month, data, view }: { month: string; data: FuelMonth; view: TableViewConfig | null }) {
  const router = useRouter();
  const monthDate = `${month}-01`;
  const rows = useMemo(() => data.rows.map(computeFuelRow), [data.rows]);
  const total = useMemo(() => sumFuel("Tổng cộng", rows), [rows]);
  const byType = useMemo(() => summarizeByType(rows), [rows]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lockOpen, setLockOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [printing, setPrinting] = useState<{ cols: ReportColumn<FuelRow>[]; rows: FuelRow[] } | null>(null);
  const [pending, start] = useTransition();
  const canEdit = data.can_edit;
  const canLock = data.can_lock;

  useEffect(() => {
    if (!printing) return;
    const old = document.title;
    document.title = `Dau theo xe ${month}`;
    const t = setTimeout(() => {
      window.print();
      document.title = old;
      setPrinting(null);
    }, 50);
    return () => clearTimeout(t);
  }, [printing, month]);

  async function save(r: FuelRow, key: EditKey | "note", v: number | string | null) {
    const res = await saveVehicleFuel({ vehicleId: r.id, month: monthDate, values: { [key]: v } });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    router.refresh();
    return true;
  }
  async function saveFinal(r: FuelRow, final: number | null, note?: string) {
    const res = await setVehicleFuelFinal({ vehicleId: r.id, month: monthDate, final, note: note ?? r.finalNote });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    router.refresh();
    return true;
  }
  function lock(ids: string[], locked: boolean, fill: "none" | "actual" | "norm" = "none") {
    start(async () => {
      const res = await lockVehicleFuel({ vehicleIds: ids, month: monthDate, locked, fill });
      if (!res.ok) return void toast.error(res.error);
      toast.success(locked ? `Đã chốt ${res.data} xe` : `Đã mở chốt ${res.data} xe`);
      setSelected(new Set());
      setLockOpen(false);
      router.refresh();
    });
  }

  const editableRow = (r: FuelRow) => canEdit && !r.locked;
  const num = (
    key: string,
    label: string,
    get: (r: FuelRow) => number | null,
    opts: { edit?: EditKey; auto?: (r: FuelRow) => boolean; digits?: 2 | 4; width?: number; hint?: string; tone?: (r: FuelRow) => string } = {},
  ): ReportColumn<FuelRow> => ({
    key,
    label,
    width: opts.width ?? 120,
    align: "right",
    kind: "number",
    value: get,
    render: (r) =>
      opts.edit ? (
        <NumCell
          value={get(r)}
          auto={opts.auto?.(r)}
          digits={opts.digits}
          editable={editableRow(r)}
          title={opts.auto?.(r) ? opts.hint : undefined}
          onSave={(v) => save(r, opts.edit!, v)}
        />
      ) : (
        <span className={cn("tabular-nums", opts.tone?.(r))}>{key === "diff" ? signed(get(r)) : fmt(get(r), opts.digits)}</span>
      ),
  });

  const columns: ReportColumn<FuelRow>[] = [
    ...(canLock
      ? [
          {
            key: "pick",
            label: "Chọn",
            width: 56,
            value: (r: FuelRow) => (selected.has(r.id) ? "Có" : ""),
            render: (r: FuelRow) => (
              <input
                type="checkbox"
                aria-label={`Chọn xe ${r.plate}`}
                className="size-4 align-middle"
                checked={selected.has(r.id)}
                onChange={() =>
                  setSelected((s) => {
                    const n = new Set(s);
                    if (n.has(r.id)) n.delete(r.id);
                    else n.add(r.id);
                    return n;
                  })
                }
              />
            ),
          } satisfies ReportColumn<FuelRow>,
        ]
      : []),
    {
      key: "plate",
      label: "Số xe",
      width: 110,
      value: (r) => r.plate,
      render: (r) => (
        <Link href={`/phuong-tien/${r.id}`} className="font-semibold text-primary hover:underline" title="Mở hồ sơ xe (sửa tỷ trọng dầu mặc định)">
          {r.plate}
        </Link>
      ),
    },
    { key: "type", label: "Loại xe", width: 120, kind: "select", options: byType.map((t) => ({ value: t.label, label: t.label })), value: (r) => r.type },
    { key: "driver", label: "Tài xế phụ trách", width: 150, value: (r) => r.driver },
    num("kmStart", "Số KM đầu tháng", (r) => r.kmStart, { edit: "km_start", auto: (r) => r.kmStartAuto, hint: AUTO_HINT.km_start }),
    num("kmEnd", "Số KM cuối tháng", (r) => r.kmEnd, { edit: "km_end" }),
    num("kmRun", "Số KM chạy", (r) => r.kmRun, { width: 100, tone: (r) => (r.kmRun !== null && r.kmRun < 0 ? "text-red-600" : "") }),
    num("opening", "Tồn dầu đầu tháng", (r) => r.opening, { edit: "fuel_opening", auto: (r) => r.openingAuto, hint: AUTO_HINT.fuel_opening }),
    num("added", "Số lượng dầu đổ thêm", (r) => r.added, { edit: "fuel_added", width: 130 }),
    num("remaining", "Số lượng dầu còn lại", (r) => r.remaining, { edit: "fuel_remaining", width: 130 }),
    num("actual", "Dầu thực tế tiêu hao", (r) => r.actual, { width: 130 }),
    num("ratio", "Tỷ trọng dầu theo xe (lít/km)", (r) => r.ratio, { edit: "fuel_ratio", auto: (r) => r.ratioAuto, digits: 4, width: 150, hint: AUTO_HINT.fuel_ratio }),
    num("norm", "Dầu theo KM và tỷ trọng", (r) => r.norm, { width: 150 }),
    num("diff", "Chênh lệch (thực tế − theo KM)", (r) => r.diff, {
      width: 150,
      tone: (r) => (r.diff === null || r.diff === 0 ? "" : r.diff > 0 ? "font-semibold text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"),
    }),
    {
      key: "final",
      label: "Final: Giám đốc chốt (lít)",
      width: 150,
      align: "right",
      kind: "number",
      value: (r) => r.final,
      render: (r) =>
        canLock && !r.locked ? (
          <NumCell value={r.final} editable placeholder="Nhập số chốt" onSave={(v) => saveFinal(r, v)} />
        ) : (
          <span className={cn("tabular-nums", r.locked && "font-bold text-primary")}>{fmt(r.final)}</span>
        ),
    },
    {
      key: "finalNote",
      label: "Ghi chú Giám đốc",
      width: 180,
      value: (r) => r.finalNote,
      render: (r) => (
        <TextCell
          value={r.finalNote}
          editable={canLock && !r.locked}
          placeholder="Lý do cân đối…"
          onSave={(v) => saveFinal(r, r.final, v)}
        />
      ),
    },
    num("price", "Đơn giá dầu (đồng/lít)", (r) => r.price, { edit: "fuel_price", auto: (r) => r.priceAuto, width: 130, hint: AUTO_HINT.fuel_price }),
    {
      key: "amount",
      label: "Thành tiền",
      width: 140,
      align: "right",
      kind: "number",
      value: (r) => r.amount,
      render: (r) => (
        <span
          className={cn("tabular-nums", r.amountTemp ? "text-muted-foreground italic" : "font-semibold")}
          title={r.amountTemp ? "Tạm tính theo dầu thực tế × đơn giá, chưa có số Giám đốc chốt" : "Số lít Giám đốc chốt × đơn giá"}
        >
          {fmt(r.amount)}
        </span>
      ),
    },
    {
      key: "status",
      label: "Trạng thái",
      width: 130,
      kind: "select",
      options: [
        { value: "Đã chốt", label: "Đã chốt" },
        { value: "Chưa chốt", label: "Chưa chốt" },
      ],
      value: (r) => (r.locked ? "Đã chốt" : "Chưa chốt"),
      render: (r) =>
        r.locked ? (
          <span className="inline-flex items-center gap-1">
            <span
              className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              title={`${r.lockedBy} chốt lúc ${formatDateTime(r.lockedAt)}`}
            >
              Đã chốt
            </span>
            {canLock ? (
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" disabled={pending} onClick={() => lock([r.id], false)}>
                Mở
              </button>
            ) : null}
          </span>
        ) : (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">Chưa chốt</span>
        ),
    },
    { key: "lockedBy", label: "Người chốt", width: 140, value: (r) => r.lockedBy },
    {
      key: "note",
      label: "Ghi chú",
      width: 180,
      value: (r) => r.note,
      render: (r) => <TextCell value={r.note} editable={editableRow(r)} onSave={(v) => save(r, "note", v || null)} />,
    },
  ];

  async function exportExcel(cols: ReportColumn<FuelRow>[], list: FuelRow[]) {
    const use = cols.filter((c) => c.key !== "pick");
    const sum = sumFuel("Tổng cộng", list);
    const sumKey: Record<string, number> = {
      kmRun: sum.kmRun, opening: sum.opening, added: sum.added, remaining: sum.remaining,
      actual: sum.actual, norm: sum.norm, diff: sum.diff, final: sum.final, amount: sum.amount,
    };
    await downloadXlsx({
      filename: `Dau theo xe ${month}`,
      sheet: `Dầu ${monthLabel(month).replace("/", "-")}`,
      title: `DẦU THEO XE THÁNG ${monthLabel(month)}`,
      subtitle: `${list.length} xe, ${sum.locked} xe đã chốt`,
      columns: use.map((c) => ({ label: c.label, width: c.width, numeric: c.kind === "number" })),
      rows: list.map((r) => use.map((c) => c.value(r) ?? null)),
      footer: use.map((c, i) => (i === 0 ? "Tổng cộng" : (sumKey[c.key] ?? null))),
    });
  }

  const pickable = rows.filter((r) => !r.locked);
  const selectedRows = rows.filter((r) => selected.has(r.id));

  return (
    <>
      <style>{`@media print {
        @page { size: A4 landscape; margin: 8mm; }
        html, body { background: #fff !important; }
        .fuel-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
      .fuel-print table { border-collapse: collapse; width: 100%; }
      .fuel-print th, .fuel-print td { border: 1px solid #000; padding: 2px 4px; vertical-align: middle; }
      .fuel-print thead th { background: #000; color: #fff; font-weight: 700; text-align: center; border-color: #000 #fff; }
      .fuel-print tfoot td { font-weight: 700; }`}</style>

      <div className="print:hidden">
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2.5">
          <Button variant="outline" size="sm" onClick={() => router.push(`/dau-xe?thang=${shiftMonth(month, -1)}`)} aria-label="Tháng trước">
            <ChevronLeft />
          </Button>
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && router.push(`/dau-xe?thang=${e.target.value}`)}
            className="h-8 rounded-md border bg-background px-2 text-sm"
            aria-label="Tháng"
          />
          <Button variant="outline" size="sm" onClick={() => router.push(`/dau-xe?thang=${shiftMonth(month, 1)}`)} aria-label="Tháng sau">
            <ChevronRight />
          </Button>
          <span className="text-sm text-muted-foreground">
            Tháng {monthLabel(month)}: {total.vehicles} xe, đã chốt {total.locked}/{total.vehicles}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dau-xe/phan-tich?tu=${shiftMonth(month, -2)}&den=${month}`} title="So sánh dầu giữa các xe, tuyến tốn dầu nhất">
                <BarChart3 /> Phân tích dầu
              </Link>
            </Button>
            {canEdit ? (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload /> Nhập Excel
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => downloadTemplate(month, rows)}>
              <FileSpreadsheet /> Tải file Excel mẫu
            </Button>
          </div>
        </div>

        {/* Phần trên: tổng */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          <Kpi label="Tổng KM chạy" value={fmt(total.kmRun)} note="km" />
          <Kpi label="Tồn dầu đầu tháng" value={fmt(total.opening)} note="lít" />
          <Kpi label="Dầu đổ thêm" value={fmt(total.added)} note="lít" />
          <Kpi label="Dầu còn lại" value={fmt(total.remaining)} note="lít" />
          <Kpi label="Dầu thực tế tiêu hao" value={fmt(total.actual)} note="tồn đầu + đổ thêm − còn lại" />
          <Kpi label="Dầu theo KM × tỷ trọng" value={fmt(total.norm)} note={`chênh lệch ${signed(total.diff)} lít`} />
          <Kpi label="Giám đốc chốt" value={fmt(total.final)} note={`${total.locked}/${total.vehicles} xe đã chốt`} strong />
          <Kpi label="Thành tiền dầu" value={fmt(total.amount)} note="đồng, số chốt × đơn giá" strong />
        </div>
        <Card className="mt-3 gap-0 py-0">
          <div className="border-b px-4 py-2 text-sm font-semibold">Tổng theo loại xe</div>
          <div className="overflow-x-auto">
            <SummaryTable groups={byType} total={total} />
          </div>
        </Card>

        {/* Phần dưới: chi tiết từng xe */}
        <Card className="mt-4 gap-0 py-0">
          <div className="border-b px-4 py-2 text-sm font-semibold">Chi tiết từng xe</div>
          <ReportGrid
            tableKey="vehicle_fuel"
            rows={rows}
            columns={columns}
            view={view}
            getRowId={(r) => r.id}
            defaultPinned={canLock ? ["pick", "plate"] : ["plate"]}
            searchPlaceholder="Tìm số xe, loại xe, tài xế…"
            emptyText="Chưa có xe công ty nào trong Phương tiện."
            onExport={data.can_export ? exportExcel : undefined}
            onPrint={(cols, list) => setPrinting({ cols: cols.filter((c) => c.key !== "pick"), rows: list })}
            toolbar={
              canEdit || canLock ? (
                <>
                  {canEdit ? <PriceAllButton month={monthDate} rows={pickable} onDone={() => router.refresh()} /> : null}
                  {canLock ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!pickable.length}
                    onClick={() => setSelected(selected.size === pickable.length ? new Set() : new Set(pickable.map((r) => r.id)))}
                  >
                    {selected.size && selected.size === pickable.length ? "Bỏ chọn" : "Chọn xe chưa chốt"}
                  </Button>
                  <Button size="sm" disabled={!selectedRows.some((r) => !r.locked) || pending} onClick={() => setLockOpen(true)}>
                    <Lock /> Chốt {selectedRows.filter((r) => !r.locked).length || ""} xe
                  </Button>
                  {selectedRows.some((r) => r.locked) ? (
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => lock(selectedRows.filter((r) => r.locked).map((r) => r.id), false)}>
                      <LockOpen /> Mở chốt
                    </Button>
                  ) : null}
                </>
                  ) : null}
                </>
              ) : null
            }
          />
        </Card>
        <p className="mt-2 text-xs text-muted-foreground">
          Ô chữ nghiêng là số tự lấy: KM đầu tháng = KM cuối tháng trước, Tồn dầu đầu tháng = Dầu còn lại tháng trước, Tỷ trọng = Tỷ trọng dầu (lít/km) của
          xe trong <Link href="/phuong-tien" className="text-primary underline">Phương tiện</Link>. Dầu theo KM và tỷ trọng = (Số KM cuối tháng − Số KM đầu
          tháng) × Tỷ trọng dầu theo xe. Chênh lệch dương (đỏ) là xe tốn dầu hơn định mức. Giám đốc nhập số chốt hoặc chọn xe rồi bấm Chốt để lấy số thực tế /
          số theo KM; xe đã chốt không ai sửa được nữa (Giám đốc mở chốt được). Đơn giá dầu để trống thì lấy đơn giá tháng trước của xe; Thành tiền = số lít Giám đốc chốt × đơn giá (chữ nghiêng: chưa chốt, tạm tính theo dầu thực tế). Xe thuê ngoài 3PL không có ở đây.
        </p>
      </div>

      {/* Bản in */}
      {printing ? (
        <div className="fuel-print hidden text-[10px] text-black print:block" style={{ fontFamily: '"Times New Roman", Times, serif' }}>
          <div className="mb-2 text-center">
            <div className="text-[15px] font-bold">BÁO CÁO DẦU THEO XE THÁNG {monthLabel(month)}</div>
          </div>
          <div className="mb-1 font-bold">I. TỔNG HỢP</div>
          <SummaryTable groups={summarizeByType(printing.rows)} total={sumFuel("Tổng cộng", printing.rows)} print />
          <div className="mt-3 mb-1 font-bold">II. CHI TIẾT TỪNG XE</div>
          <table>
            <thead>
              <tr>
                <th>STT</th>
                {printing.cols.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {printing.rows.map((r, i) => (
                <tr key={r.id}>
                  <td style={{ textAlign: "center" }}>{i + 1}</td>
                  {printing.cols.map((c) => {
                    const v = c.value(r);
                    return (
                      <td key={c.key} style={{ textAlign: c.kind === "number" ? "right" : "left" }}>
                        {typeof v === "number" ? fmt(v, c.key === "ratio" ? 4 : 2) : (v ?? "")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-6 grid grid-cols-3 text-center text-[11px]">
            <div className="font-bold">Người lập</div>
            <div className="font-bold">Kế toán</div>
            <div className="font-bold">Giám đốc</div>
          </div>
        </div>
      ) : null}

      <LockDialog open={lockOpen} onOpenChange={setLockOpen} rows={selectedRows.filter((r) => !r.locked)} pending={pending} onLock={(fill) => lock(selectedRows.filter((r) => !r.locked).map((r) => r.id), true, fill)} />
      {canEdit ? <ImportDialog open={importOpen} onOpenChange={setImportOpen} month={month} onDone={() => router.refresh()} /> : null}
    </>
  );
}

function Kpi({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <Card className={cn("gap-1 py-3", strong && "border-primary/40 bg-primary/5")}>
      <CardContent className="px-3">
        <div className="truncate text-xs text-muted-foreground" title={label}>
          {label}
        </div>
        <div className={cn("text-base font-bold tabular-nums sm:text-lg", strong && "text-primary")}>{value || "0"}</div>
        {note ? <div className="truncate text-[11px] text-muted-foreground" title={note}>{note}</div> : null}
      </CardContent>
    </Card>
  );
}

const SUMMARY_COLS: { key: keyof FuelTotals; label: string }[] = [
  { key: "vehicles", label: "Số xe" },
  { key: "locked", label: "Đã chốt" },
  { key: "kmRun", label: "KM chạy" },
  { key: "opening", label: "Tồn dầu đầu tháng" },
  { key: "added", label: "Dầu đổ thêm" },
  { key: "remaining", label: "Dầu còn lại" },
  { key: "actual", label: "Dầu thực tế tiêu hao" },
  { key: "norm", label: "Dầu theo KM × tỷ trọng" },
  { key: "diff", label: "Chênh lệch" },
  { key: "final", label: "Giám đốc chốt" },
  { key: "amount", label: "Thành tiền" },
];

function SummaryTable({ groups, total, print }: { groups: FuelTotals[]; total: FuelTotals; print?: boolean }) {
  const th = print ? "" : "border-r border-b border-sky-200 bg-sky-100 px-2 py-2 text-xs font-bold whitespace-nowrap text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100";
  const td = print ? "" : "border-r border-b px-2 py-1.5 tabular-nums";
  const cell = (t: FuelTotals, k: keyof FuelTotals) => (k === "diff" ? signed(t[k] as number) : fmt(t[k] as number));
  return (
    <table className={cn(!print && "w-full border-separate border-spacing-0 text-sm")}>
      <thead>
        <tr>
          <th className={cn(th, "text-left")}>Loại xe</th>
          {SUMMARY_COLS.map((c) => (
            <th key={c.key} className={cn(th, "text-right")}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.label}>
            <td className={td}>{g.label}</td>
            {SUMMARY_COLS.map((c) => (
              <td key={c.key} className={cn(td, "text-right")} style={print ? { textAlign: "right" } : undefined}>
                {cell(g, c.key)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className={print ? "" : "bg-muted/60 font-bold"}>
          <td className={td}>Tổng cộng</td>
          {SUMMARY_COLS.map((c) => (
            <td key={c.key} className={cn(td, "text-right")} style={print ? { textAlign: "right" } : undefined}>
              {cell(total, c.key)}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}

function LockDialog({
  open,
  onOpenChange,
  rows,
  pending,
  onLock,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rows: FuelRow[];
  pending: boolean;
  onLock: (fill: "none" | "actual" | "norm") => void;
}) {
  const [fill, setFill] = useState<"none" | "actual" | "norm">("actual");
  const empty = rows.filter((r) => r.final === null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chốt dầu {rows.length} xe</DialogTitle>
          <DialogDescription>
            Xe đã chốt thì không ai sửa số liệu tháng này nữa (Giám đốc mở chốt được). Số tự lấy (KM đầu tháng, tồn đầu, tỷ trọng) được ghi cố định.
          </DialogDescription>
        </DialogHeader>
        {empty.length ? (
          <div className="space-y-2 text-sm">
            <p>
              {empty.length} xe chưa nhập số chốt ({empty.slice(0, 6).map((r) => r.plate).join(", ")}
              {empty.length > 6 ? "…" : ""}). Lấy số chốt cho các xe này theo:
            </p>
            {(
              [
                { v: "actual", label: "Dầu thực tế tiêu hao (tồn đầu + đổ thêm − còn lại)" },
                { v: "norm", label: "Dầu theo KM và tỷ trọng ((KM cuối − KM đầu) × tỷ trọng)" },
                { v: "none", label: "Không lấy, tôi sẽ nhập số chốt từng xe" },
              ] as const
            ).map((o) => (
              <label key={o.v} className="flex items-start gap-2">
                <input type="radio" name="fill" className="mt-1" checked={fill === o.v} onChange={() => setFill(o.v)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm">Mọi xe đã chọn đều có số chốt.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button disabled={pending || (empty.length > 0 && fill === "none")} onClick={() => onLock(empty.length ? fill : "none")}>
            <Lock /> {pending ? "Đang chốt…" : "Chốt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** File Excel mẫu: mỗi cột có ghi chú hướng dẫn; điền sẵn số xe đang có */
async function downloadTemplate(month: string, rows: FuelRow[]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "KHÁNH HÀ TMS";
  const ws = wb.addWorksheet("Dầu theo xe");
  const head = ws.addRow(FUEL_IMPORT_COLUMNS.map((c) => c.label));
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  head.height = 32;
  FUEL_IMPORT_COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
    cell.note = { texts: [{ text: c.hint }] };
    const col = ws.getColumn(i + 1);
    col.width = c.width;
    if (c.numeric) col.numFmt = c.key === "fuel_ratio" ? "0.0###" : "#,##0.##";
  });
  for (const r of rows.filter((x) => !x.locked)) {
    ws.addRow([r.plate, r.kmStartAuto ? null : r.kmStart, r.kmEnd, r.openingAuto ? null : r.opening, r.added, r.remaining, r.ratioAuto ? null : r.ratio, r.priceAuto ? null : r.price, r.note || null]);
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const guide = wb.addWorksheet("Hướng dẫn");
  guide.getColumn(1).width = 30;
  guide.getColumn(2).width = 100;
  guide.addRow([`Nhập số liệu dầu tháng ${monthLabel(month)}`]).font = { bold: true, size: 13 };
  guide.addRow(["Cách nhập", "Điền sheet 'Dầu theo xe' (giữ nguyên dòng tiêu đề), lưu file rồi bấm Nhập Excel ở màn hình Dầu theo xe và chọn đúng tháng."]);
  guide.addRow(["Số", "Dấu phẩy ngăn cách hàng nghìn, dấu chấm là thập phân: 2,150.5"]);
  guide.addRow(["Ô để trống", "KM đầu tháng, tồn dầu đầu tháng, tỷ trọng: để trống thì hệ thống tự lấy. Cột nào xóa khỏi file thì số đã nhập ở cột đó giữ nguyên."]);
  guide.addRow(["Xe đã chốt", "Không sửa được bằng file (dòng đó báo lỗi). Giám đốc mở chốt trước nếu cần."]);
  for (const c of FUEL_IMPORT_COLUMNS) guide.addRow([c.label, c.hint]);
  guide.eachRow((row) => (row.alignment = { vertical: "top", wrapText: true }));
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  a.download = `Mau nhap dau theo xe ${month}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Đọc sheet đầu tiên có cột "Số xe" thành bảng giá trị */
async function readWorkbook(file: File): Promise<FuelImportParse> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  let last: FuelImportParse = { rows: [], errors: [], missing: ["Số xe"] };
  for (const ws of wb.worksheets) {
    const table: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        const v = cell.value as unknown;
        vals[c - 1] =
          v && typeof v === "object"
            ? "result" in (v as object)
              ? (v as { result: unknown }).result
              : "richText" in (v as object)
                ? (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("")
                : "text" in (v as object)
                  ? (v as { text: unknown }).text
                  : String(v)
            : v;
      });
      table[n - 1] = vals;
    });
    // Tiêu đề có thể không ở dòng 1 (file xuất từ báo cáo có dòng tiêu đề lớn)
    for (let h = 0; h < Math.min(10, table.length); h++) {
      const p = parseFuelSheet(table.map((r) => r ?? []), h);
      if (!p.missing.length) return p;
      last = p;
    }
  }
  return last;
}

function ImportDialog({ open, onOpenChange, month, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; month: string; onDone: () => void }) {
  const [parsed, setParsed] = useState<FuelImportParse | null>(null);
  const [result, setResult] = useState<FuelImportResult | null>(null);
  const [pending, start] = useTransition();
  const reset = () => {
    setParsed(null);
    setResult(null);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nhập Excel dầu tháng {monthLabel(month)}</DialogTitle>
          <DialogDescription>
            Dùng file mẫu (nút Tải file Excel mẫu), giữ nguyên dòng tiêu đề. Mỗi dòng một xe; ô trống ở cột có trong file = để trống (KM đầu, tồn đầu, tỷ trọng tự lấy).
          </DialogDescription>
        </DialogHeader>
        {!result ? (
          <input
            type="file"
            accept=".xlsx"
            className="text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 2 * 1024 * 1024) return void toast.error("File quá 2 MB");
              start(async () => {
                try {
                  setParsed(await readWorkbook(f));
                } catch {
                  toast.error("Không đọc được file. Hãy lưu lại dạng .xlsx rồi thử lại.");
                }
              });
            }}
          />
        ) : null}
        {parsed && !result ? (
          parsed.missing.length ? (
            <p className="text-sm text-red-600">Không thấy cột {parsed.missing.join(", ")}. Dùng file mẫu và giữ nguyên tên cột.</p>
          ) : (
            <div className="space-y-1 text-sm">
              <p>
                Đọc được <b>{parsed.rows.length}</b> dòng hợp lệ{parsed.errors.length ? `, ${parsed.errors.length} dòng lỗi (bỏ qua)` : ""}.
              </p>
              <ErrorList errors={parsed.errors.map((e) => ({ ...e, plate: "" }))} />
            </div>
          )
        ) : null}
        {result ? (
          <div className="space-y-1 text-sm">
            <p>
              Đã lưu <b>{result.saved}</b> xe{result.errors.length ? `, ${result.errors.length} dòng không lưu được:` : "."}
            </p>
            <ErrorList errors={result.errors} />
          </div>
        ) : null}
        <DialogFooter>
          {result ? (
            <Button onClick={() => (reset(), onOpenChange(false))}>Đóng</Button>
          ) : (
            <Button
              disabled={pending || !parsed || !parsed.rows.length}
              onClick={() =>
                start(async () => {
                  const res = await importVehicleFuel({ month: `${month}-01`, rows: parsed!.rows });
                  if (!res.ok) return void toast.error(res.error);
                  setResult({ saved: res.data!.saved, errors: [...parsed!.errors.map((e) => ({ ...e, plate: "" })), ...res.data!.errors] });
                  onDone();
                })
              }
            >
              <Upload /> {pending ? "Đang nhập…" : `Nhập ${parsed?.rows.length ?? 0} dòng`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ErrorList({ errors }: { errors: { row: number; plate: string; error: string }[] }) {
  if (!errors.length) return null;
  return (
    <ul className="max-h-48 list-disc overflow-auto rounded border bg-muted/40 py-1 pr-2 pl-6 text-xs">
      {errors.map((e, i) => (
        <li key={i}>
          Dòng {e.row}
          {e.plate ? ` (${e.plate})` : ""}: {e.error}
        </li>
      ))}
    </ul>
  );
}

/** Đặt cùng một đơn giá dầu cho mọi xe chưa chốt trong tháng */
function PriceAllButton({ month, rows, onDone }: { month: string; rows: FuelRow[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const price = parseFuelNumber(text);
  return (
    <>
      <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => setOpen(true)} title="Gõ một đơn giá dùng chung cho mọi xe chưa chốt">
        Đơn giá cho mọi xe
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Đơn giá dầu cho mọi xe chưa chốt</DialogTitle>
            <DialogDescription>Áp dụng cho {rows.length} xe chưa chốt của tháng này. Xe nào giá khác thì sửa riêng ở cột Đơn giá dầu.</DialogDescription>
          </DialogHeader>
          <input
            autoFocus
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ví dụ 20,500"
            className="h-9 rounded-md border bg-background px-2 text-right tabular-nums"
            aria-label="Đơn giá dầu (đồng/lít)"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button
              disabled={pending || price === undefined || price === null || price < 0}
              onClick={() =>
                start(async () => {
                  const res = await importVehicleFuel({ month, rows: rows.map((r, i) => ({ row: i + 1, plate: r.plate, fuel_price: price as number })) });
                  if (!res.ok) return void toast.error(res.error);
                  if (res.data!.errors.length) toast.error(`${res.data!.errors.length} xe không lưu được: ${res.data!.errors[0].error}`);
                  else toast.success(`Đã đặt đơn giá cho ${res.data!.saved} xe`);
                  setOpen(false);
                  setText("");
                  onDone();
                })
              }
            >
              {pending ? "Đang lưu…" : "Áp dụng"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
