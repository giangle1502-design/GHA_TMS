"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PackageMinus, PackagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber, monthRangeYMD, todayVN } from "@/lib/format";
import { downloadXlsx } from "@/lib/xlsx-client";
import { stockCard, type StockCardLine } from "@/lib/inventory/actions";
import { STOCK_KIND_OPTIONS } from "@/lib/entities/definitions";
import { StockVoucherDialog, type StockKind } from "@/components/inventory/stock-voucher-dialog";
import { ReportGrid, type ReportColumn } from "@/components/grid/report-grid";
import type { TableViewConfig } from "@/lib/entities/types";

export type BinOption = { id: string; code: string; name: string; warehouse_id: string; warehouse_name: string; has_location: boolean };
export type StockRow = {
  warehouse_id: string;
  warehouse_name: string;
  bin_id: string | null;
  bin_code: string | null;
  bin_name: string | null;
  product_id: string;
  product_code: string;
  product_name: string;
  unit: string | null;
  owner_customer_id: string | null;
  owner_name: string | null;
  opening_qty: number;
  in_qty: number;
  out_qty: number;
  closing_qty: number;
};

const KIND_LABEL = Object.fromEntries(STOCK_KIND_OPTIONS.map((o) => [o.value, o.label]));
const n = (v: unknown) => Number(v ?? 0);
const qty = (v: number) => (v === 0 ? "" : formatNumber(v));
const rowId = (r: StockRow) => `${r.bin_id ?? r.warehouse_id}-${r.owner_customer_id ?? ""}-${r.product_id}`;
const IN_CLS = "text-[oklch(0.42_0.11_155)]";
const OUT_CLS = "text-[oklch(0.47_0.12_65)]";

/** Cột báo cáo xuất nhập tồn (chọn / ẩn / kéo độ rộng, lưu cấu hình theo tài khoản) */
function stockColumns(byBin: boolean): ReportColumn<StockRow>[] {
  return [
    ...(byBin
      ? [{ key: "bin_code", label: "Vị trí", width: 80, value: (r: StockRow) => r.bin_code, render: (r: StockRow) => <Badge variant="info">{r.bin_code}</Badge> }]
      : []),
    { key: "product_code", label: "Mã hàng", width: 140, value: (r) => r.product_code, render: (r) => <span className="font-medium">{r.product_code}</span> },
    { key: "product_name", label: "Tên hàng", width: 240, value: (r) => r.product_name },
    { key: "owner_name", label: "Chủ hàng", width: 180, value: (r) => r.owner_name },
    { key: "unit", label: "ĐVT", width: 70, value: (r) => r.unit },
    { key: "opening_qty", label: "Tồn đầu kỳ", width: 120, align: "right", kind: "number", value: (r) => n(r.opening_qty), render: (r) => qty(n(r.opening_qty)) },
    { key: "in_qty", label: "Nhập", width: 120, align: "right", kind: "number", value: (r) => n(r.in_qty), render: (r) => <span className={IN_CLS}>{qty(n(r.in_qty))}</span> },
    { key: "out_qty", label: "Xuất", width: 120, align: "right", kind: "number", value: (r) => n(r.out_qty), render: (r) => <span className={OUT_CLS}>{qty(n(r.out_qty))}</span> },
    {
      key: "closing_qty",
      label: "Tồn cuối kỳ",
      width: 130,
      align: "right",
      kind: "number",
      value: (r) => n(r.closing_qty),
      render: (r) => <span className={`font-semibold ${n(r.closing_qty) < 0 ? "text-destructive" : ""}`}>{formatNumber(n(r.closing_qty))}</span>,
    },
  ];
}
const SUM_KEYS = ["opening_qty", "in_qty", "out_qty", "closing_qty"] as const;

export function StockReport(props: {
  tu: string;
  den: string;
  bin: string;
  byBin: boolean;
  bins: BinOption[];
  rows: StockRow[];
  canCreate: boolean;
  view: TableViewConfig | null;
  cardView: TableViewConfig | null;
}) {
  const router = useRouter();
  const [tu, setTu] = useState(props.tu);
  const [den, setDen] = useState(props.den);
  const [onlyStock, setOnlyStock] = useState(false);
  const [owner, setOwner] = useState("");
  const owners = useMemo(() => [...new Map(props.rows.map((r) => [r.owner_customer_id ?? "", r.owner_name ?? "Chưa ghi công ty"])).entries()], [props.rows]);
  const [dialog, setDialog] = useState<StockKind | null>(null);
  const [card, setCard] = useState<StockRow | null>(null);
  const [printing, setPrinting] = useState<{ cols: ReportColumn<StockRow>[]; rows: StockRow[] } | null>(null);
  const columns = useMemo(() => stockColumns(props.byBin), [props.byBin]);

  useEffect(() => {
    if (!printing) return;
    const tm = setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 50);
    return () => clearTimeout(tm);
  }, [printing]);

  const go = (p: Partial<{ tu: string; den: string; vt: string; gop: string }>) => {
    const sp = new URLSearchParams({ tab: "bao-cao", tu: props.tu, den: props.den });
    if (props.bin) sp.set("vt", props.bin);
    if (!props.byBin) sp.set("gop", "1");
    for (const [k, v] of Object.entries(p)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    router.push(`/kho?${sp.toString()}`);
  };
  const shiftMonth = (d: number) => {
    const r = monthRangeYMD(props.tu, d);
    setTu(r.tu);
    setDen(r.den);
    go(r);
  };

  const shown = useMemo(
    () => props.rows.filter((r) => (!onlyStock || n(r.closing_qty) !== 0) && (!owner || (r.owner_customer_id ?? "-") === owner)),
    [props.rows, onlyStock, owner],
  );
  const negatives = shown.filter((r) => n(r.closing_qty) < 0).length;
  const binLabel = props.bin ? (props.bins.find((b) => b.id === props.bin)?.code ?? "") : props.byBin ? "Từng vị trí" : "Cả kho";
  const ownerLabel = owner ? (owners.find(([id]) => (id || "-") === owner)?.[1] ?? "") : "";
  const period = `Từ ${formatDate(props.tu)} đến ${formatDate(props.den)}`;
  /** Tổng chỉ cộng khi các dòng cùng đơn vị tính */
  const totals = (list: StockRow[]) => {
    const units = [...new Set(list.map((r) => r.unit ?? ""))];
    if (units.length !== 1 || list.length < 2) return null;
    const out: Record<string, number | string> = { unit: units[0] };
    for (const k of SUM_KEYS) out[k] = list.reduce((a, r) => a + n(r[k]), 0);
    return out;
  };

  const exportXlsx = (cols: ReportColumn<StockRow>[], list: StockRow[]) => {
    const t = totals(list);
    return downloadXlsx({
      filename: `Xuat-nhap-ton-kho-GHA-${props.tu}-${props.den}.xlsx`,
      sheet: "Xuất nhập tồn",
      title: "BÁO CÁO XUẤT NHẬP TỒN KHO GHA",
      subtitle: `${period} · ${binLabel}${ownerLabel ? ` · ${ownerLabel}` : ""}`,
      columns: cols.map((c) => ({ label: c.label, width: Math.max(8, Math.round(c.width / 8)), numeric: c.align === "right" })),
      rows: list.map((r) => cols.map((c) => c.value(r) ?? "")),
      footer: t ? cols.map((c, i) => (c.key in t ? t[c.key] : i === 0 ? "Tổng cộng" : "")) : undefined,
    });
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3 print:hidden">
        <div className="space-y-1">
          <Label htmlFor="k-tu">Từ ngày</Label>
          <Input id="k-tu" type="date" className="h-9 w-40" value={tu} onChange={(e) => setTu(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="k-den">Đến ngày</Label>
          <Input id="k-den" type="date" className="h-9 w-40" value={den} onChange={(e) => setDen(e.target.value)} />
        </div>
        <Button variant="outline" className="h-9" onClick={() => go({ tu, den })} disabled={tu === props.tu && den === props.den}>
          Xem
        </Button>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-9" onClick={() => shiftMonth(-1)}>
            ‹ Tháng trước
          </Button>
          <Button variant="ghost" size="sm" className="h-9" onClick={() => shiftMonth(1)}>
            Tháng sau ›
          </Button>
        </div>
        <div className="space-y-1">
          <Label htmlFor="k-vt">Vị trí</Label>
          <NativeSelect
            id="k-vt"
            className="h-9 min-w-44"
            value={props.bin || (props.byBin ? "" : "gop")}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "gop") go({ vt: "", gop: "1" });
              else go({ vt: v, gop: "" });
            }}
          >
            <option value="">Từng vị trí (GHA1, GHA2…)</option>
            <option value="gop">Gộp cả kho</option>
            {props.bins.map((b) => (
              <option key={b.id} value={b.id}>
                Chỉ {b.code} · {b.warehouse_name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="k-cty">Công ty chủ hàng</Label>
          <NativeSelect id="k-cty" className="h-9 min-w-44" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">-- Tất cả công ty --</option>
            {owners.map(([id, name]) => (
              <option key={id || "-"} value={id || "-"}>
                {name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> Chỉ mã còn tồn
        </label>
        {props.canCreate ? (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" className="h-9" onClick={() => setDialog("receipt")}>
              <PackagePlus /> Phiếu nhập
            </Button>
            <Button variant="outline" className="h-9" onClick={() => setDialog("issue")}>
              <PackageMinus /> Phiếu xuất
            </Button>
            <Button variant="outline" className="h-9" onClick={() => setDialog("opening")}>
              Tồn đầu kỳ
            </Button>
          </div>
        ) : null}
      </div>

      {!props.rows.length ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Chưa có phát sinh trong kỳ này. Bắt đầu theo dõi: bấm <b>Tồn đầu kỳ</b> để nhập số hàng đang có ở từng vị trí (hoặc nhập Excel ở tab Phiếu nhập, xuất), rồi lập phiếu nhập / xuất hằng ngày.
        </div>
      ) : (
        <div className="print:hidden">
          {negatives ? (
            <p className="mb-2 text-sm text-destructive">
              {negatives} mã hàng tồn âm (xuất nhiều hơn nhập): kiểm lại tồn đầu kỳ hoặc phiếu nhập còn thiếu.
            </p>
          ) : null}
          <div className="rounded-lg border bg-card">
            <ReportGrid
              key={props.byBin ? "bin" : "all"}
              tableKey="stock_balance"
              rows={shown}
              columns={columns}
              view={props.view}
              getRowId={rowId}
              defaultPinned={props.byBin ? ["bin_code", "product_code"] : ["product_code"]}
              searchPlaceholder="Tìm mã, tên hàng, chủ hàng…"
              emptyText="Không có mã hàng phù hợp."
              onRowClick={setCard}
              rowTitle="Bấm để xem thẻ kho (từng phiếu nhập, xuất)"
              footer={(list) => {
                const t = totals(list);
                if (!t) return null;
                const first = columns.find((c) => !(c.key in t))?.key ?? "product_code";
                return { ...Object.fromEntries(SUM_KEYS.map((k) => [k, formatNumber(Number(t[k]))])), unit: t.unit, [first]: `Tổng cộng (${list.length} dòng)` };
              }}
              onExport={exportXlsx}
              onPrint={(cols, list) => setPrinting({ cols, rows: list })}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Tồn đầu kỳ = phát sinh trước ngày bắt đầu + phiếu tồn đầu kỳ. Từng vị trí: chuyển GHA1 → GHA2 tính là xuất ở GHA1, nhập ở GHA2; gộp cả kho thì không tính chuyển vị trí. Bấm một dòng để xem thẻ kho. Chọn cột, kéo độ rộng rồi bấm <b>Lưu cấu hình</b> để giữ cho lần sau.
          </p>
        </div>
      )}

      {printing ? (
        <div className="hidden text-[11px] text-black print:block">
          <div className="text-center text-base font-bold">BÁO CÁO XUẤT NHẬP TỒN KHO GHA</div>
          <div className="mb-2 text-center">
            {period} · {binLabel}
            {ownerLabel ? ` · ${ownerLabel}` : ""}
          </div>
          <table className="w-full border-collapse [&_td]:border [&_td]:border-black [&_td]:px-1 [&_th]:border [&_th]:border-black [&_th]:px-1">
            <thead>
              <tr>
                {printing.cols.map((c) => (
                  <th key={c.key} style={{ textAlign: c.align === "right" ? "right" : "left" }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {printing.rows.map((r) => (
                <tr key={rowId(r)}>
                  {printing.cols.map((c) => {
                    const v = c.value(r);
                    return (
                      <td key={c.key} style={{ textAlign: c.align === "right" ? "right" : "left" }}>
                        {typeof v === "number" ? formatNumber(v) : (v ?? "")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {dialog ? (
        <StockVoucherDialog
          key={dialog}
          open
          onOpenChange={(o) => !o && setDialog(null)}
          onDone={() => router.refresh()}
          prefill={{ kind: dialog, entry_date: dialog === "opening" ? monthRangeYMD(todayVN(), -1).den : undefined, bin_id: props.bin || props.bins[0]?.id }}
        />
      ) : null}
      {card ? <StockCardDialog row={card} tu={props.tu} den={props.den} byBin={props.byBin} view={props.cardView} onClose={() => setCard(null)} /> : null}
    </>
  );
}

type CardRow = StockCardLine & { id: string };
const CARD_COLUMNS: ReportColumn<CardRow>[] = [
  { key: "entry_date", label: "Ngày", width: 100, kind: "date", value: (l) => l.entry_date, render: (l) => formatDate(l.entry_date) },
  { key: "voucher_no", label: "Số phiếu", width: 120, value: (l) => l.voucher_no },
  { key: "kind", label: "Loại", width: 120, value: (l) => KIND_LABEL[l.kind] ?? l.kind },
  { key: "ref_no", label: "Chứng từ (chuyến)", width: 150, value: (l) => l.ref_no },
  { key: "partner", label: "Xe / cont", width: 150, value: (l) => l.partner },
  { key: "notes", label: "Diễn giải", width: 200, value: (l) => l.notes },
  { key: "qty_in", label: "Nhập", width: 110, align: "right", kind: "number", value: (l) => l.qty_in, render: (l) => <span className={IN_CLS}>{qty(l.qty_in)}</span> },
  { key: "qty_out", label: "Xuất", width: 110, align: "right", kind: "number", value: (l) => l.qty_out, render: (l) => <span className={OUT_CLS}>{qty(l.qty_out)}</span> },
  {
    key: "balance",
    label: "Tồn",
    width: 120,
    align: "right",
    kind: "number",
    value: (l) => l.balance,
    render: (l) => <span className={l.balance < 0 ? "text-destructive" : ""}>{formatNumber(l.balance)}</span>,
  },
];

/** Thẻ kho: từng phiếu nhập, xuất của một mã hàng trong kỳ, tồn lũy kế */
function StockCardDialog({ row, tu, den, byBin, view, onClose }: { row: StockRow; tu: string; den: string; byBin: boolean; view: TableViewConfig | null; onClose: () => void }) {
  const [data, setData] = useState<{ opening: number; lines: StockCardLine[] } | null>(null);
  const [err, setErr] = useState("");
  const [loading, start] = useTransition();
  useEffect(() => {
    start(async () => {
      const r = await stockCard({ productId: row.product_id, binId: byBin ? row.bin_id : null, warehouseId: row.warehouse_id, ownerId: row.owner_customer_id, tu, den });
      if (!r.ok) {
        toast.error(r.error);
        setErr(r.error);
      } else setData(r.data ?? null);
    });
  }, [row, tu, den, byBin]);
  const lines = useMemo<CardRow[]>(() => (data?.lines ?? []).map((l, i) => ({ ...l, id: String(i) })), [data]);
  const title = `Thẻ kho: ${row.product_code} · ${row.product_name}`;
  const sub = `${byBin ? `Vị trí ${row.bin_code}` : row.warehouse_name} · ${row.owner_name ?? ""} · Từ ${formatDate(tu)} đến ${formatDate(den)} · ĐVT ${row.unit ?? ""}`;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 print:hidden" onClick={onClose}>
      <div className="mx-auto my-6 w-[96%] max-w-6xl rounded-lg bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <div className="text-lg font-semibold">{title}</div>
            <div className="text-sm text-muted-foreground">{sub}</div>
          </div>
          <Button variant="ghost" size="icon" aria-label="Đóng" onClick={onClose}>
            <X />
          </Button>
        </div>
        {err ? (
          <p className="p-6 text-sm text-destructive">{err}</p>
        ) : loading || !data ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Đang tải…
          </div>
        ) : (
          <>
            <div className="mb-2 text-sm">
              Tồn đầu kỳ: <b className="tabular-nums">{formatNumber(data.opening)}</b> · Tồn cuối kỳ:{" "}
              <b className="tabular-nums">{formatNumber(lines.length ? lines[lines.length - 1].balance : data.opening)}</b>
            </div>
            <div className="rounded border">
              <ReportGrid
                tableKey="stock_card"
                rows={lines}
                columns={CARD_COLUMNS}
                view={view}
                getRowId={(l) => l.id}
                defaultPinned={["entry_date"]}
                emptyText="Không có phiếu nhập, xuất trong kỳ."
                footer={(list) =>
                  list.length > 1
                    ? {
                        entry_date: "Cộng",
                        qty_in: formatNumber(list.reduce((a, l) => a + l.qty_in, 0)),
                        qty_out: formatNumber(list.reduce((a, l) => a + l.qty_out, 0)),
                      }
                    : null
                }
                onExport={(cols, list) =>
                  downloadXlsx({
                    filename: `The-kho-${row.product_code}-${tu}-${den}.xlsx`,
                    sheet: "Thẻ kho",
                    title,
                    subtitle: `${sub} · Tồn đầu kỳ ${formatNumber(data.opening)}`,
                    columns: cols.map((c) => ({ label: c.label, width: Math.max(8, Math.round(c.width / 8)), numeric: c.align === "right" })),
                    rows: list.map((l) => cols.map((c) => (c.key === "entry_date" ? formatDate(l.entry_date) : (c.value(l) ?? "")))),
                  })
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
