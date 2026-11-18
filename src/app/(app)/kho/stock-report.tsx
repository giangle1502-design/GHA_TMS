"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileSpreadsheet, Loader2, PackageMinus, PackagePlus, Printer, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber, monthRangeYMD, todayVN } from "@/lib/format";
import { downloadXlsx } from "@/lib/xlsx-client";
import { stockCard, type StockCardLine } from "@/lib/inventory/actions";
import { STOCK_KIND_OPTIONS } from "@/lib/entities/definitions";
import { StockVoucherDialog, type StockKind } from "@/components/inventory/stock-voucher-dialog";

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
  owner_name: string | null;
  opening_qty: number;
  in_qty: number;
  out_qty: number;
  closing_qty: number;
};

const KIND_LABEL = Object.fromEntries(STOCK_KIND_OPTIONS.map((o) => [o.value, o.label]));
const n = (v: unknown) => Number(v ?? 0);
const qty = (v: number) => (v === 0 ? "" : formatNumber(v));

export function StockReport(props: { tu: string; den: string; bin: string; byBin: boolean; bins: BinOption[]; rows: StockRow[]; canCreate: boolean }) {
  const router = useRouter();
  const [tu, setTu] = useState(props.tu);
  const [den, setDen] = useState(props.den);
  const [q, setQ] = useState("");
  const [onlyStock, setOnlyStock] = useState(false);
  const [dialog, setDialog] = useState<StockKind | null>(null);
  const [card, setCard] = useState<StockRow | null>(null);

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

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return props.rows.filter(
      (r) =>
        (!onlyStock || n(r.closing_qty) !== 0) &&
        (!term || `${r.product_code} ${r.product_name} ${r.owner_name ?? ""} ${r.bin_code ?? ""}`.toLowerCase().includes(term)),
    );
  }, [props.rows, q, onlyStock]);
  const units = [...new Set(shown.map((r) => r.unit ?? ""))];
  const sameUnit = units.length === 1;
  const sum = (k: keyof StockRow) => shown.reduce((a, r) => a + n(r[k]), 0);
  const negatives = shown.filter((r) => n(r.closing_qty) < 0).length;
  const binLabel = props.bin ? (props.bins.find((b) => b.id === props.bin)?.code ?? "") : props.byBin ? "Từng vị trí" : "Cả kho";
  const period = `Từ ${formatDate(props.tu)} đến ${formatDate(props.den)}`;

  const exportXlsx = () =>
    downloadXlsx({
      filename: `Xuat-nhap-ton-kho-GHA-${props.tu}-${props.den}.xlsx`,
      sheet: "Xuất nhập tồn",
      title: "BÁO CÁO XUẤT NHẬP TỒN KHO GHA",
      subtitle: `${period} · ${binLabel}`,
      columns: [
        ...(props.byBin ? [{ label: "Vị trí", width: 10 }] : []),
        { label: "Mã hàng", width: 16 },
        { label: "Tên hàng", width: 32 },
        { label: "Chủ hàng", width: 22 },
        { label: "ĐVT", width: 8 },
        { label: "Tồn đầu kỳ", width: 14, numeric: true },
        { label: "Nhập trong kỳ", width: 14, numeric: true },
        { label: "Xuất trong kỳ", width: 14, numeric: true },
        { label: "Tồn cuối kỳ", width: 14, numeric: true },
      ],
      rows: shown.map((r) => [
        ...(props.byBin ? [r.bin_code ?? ""] : []),
        r.product_code,
        r.product_name,
        r.owner_name ?? "",
        r.unit ?? "",
        n(r.opening_qty),
        n(r.in_qty),
        n(r.out_qty),
        n(r.closing_qty),
      ]),
      footer: sameUnit
        ? [...(props.byBin ? [""] : []), "Tổng cộng", "", "", units[0], sum("opening_qty"), sum("in_qty"), sum("out_qty"), sum("closing_qty")]
        : undefined,
    });

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
          <Label htmlFor="k-q">Tìm mã hàng</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-2 size-4 text-muted-foreground" />
            <Input id="k-q" className="h-9 w-52 pl-7" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Mã, tên hàng, chủ hàng" />
          </div>
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> Chỉ mã còn tồn
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          {props.canCreate ? (
            <>
              <Button variant="outline" className="h-9" onClick={() => setDialog("receipt")}>
                <PackagePlus /> Phiếu nhập
              </Button>
              <Button variant="outline" className="h-9" onClick={() => setDialog("issue")}>
                <PackageMinus /> Phiếu xuất
              </Button>
              <Button variant="outline" className="h-9" onClick={() => setDialog("opening")}>
                Tồn đầu kỳ
              </Button>
            </>
          ) : null}
          <Button variant="outline" className="h-9" onClick={exportXlsx} disabled={!shown.length}>
            <FileSpreadsheet /> Excel
          </Button>
          <Button variant="outline" className="h-9" onClick={() => window.print()} disabled={!shown.length}>
            <Printer /> In
          </Button>
        </div>
      </div>

      <div className="mb-2 hidden text-center print:block">
        <div className="text-lg font-bold">BÁO CÁO XUẤT NHẬP TỒN KHO GHA</div>
        <div className="text-sm">
          {period} · {binLabel}
        </div>
      </div>

      {!props.rows.length ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Chưa có phát sinh trong kỳ này. Bắt đầu theo dõi: bấm <b>Tồn đầu kỳ</b> để nhập số hàng đang có ở từng vị trí (hoặc nhập Excel ở tab Phiếu nhập, xuất), rồi lập phiếu nhập / xuất hằng ngày.
        </div>
      ) : (
        <>
          {negatives ? (
            <p className="mb-2 text-sm text-destructive print:hidden">
              {negatives} mã hàng tồn âm (xuất nhiều hơn nhập): kiểm lại tồn đầu kỳ hoặc phiếu nhập còn thiếu.
            </p>
          ) : null}
          <div className="overflow-x-auto rounded-lg border bg-card print:border-black">
            <table className="w-full min-w-[860px] border-collapse text-sm [&_td]:border-r [&_td:last-child]:border-r-0 [&_th]:border-r [&_th:last-child]:border-r-0">
              <thead className="sticky top-0 bg-muted text-left text-xs">
                <tr>
                  {props.byBin ? <th className="px-2 py-2">Vị trí</th> : null}
                  <th className="px-2 py-2">Mã hàng</th>
                  <th className="px-2 py-2">Tên hàng</th>
                  <th className="px-2 py-2">Chủ hàng</th>
                  <th className="px-2 py-2">ĐVT</th>
                  <th className="px-2 py-2 text-right">Tồn đầu kỳ</th>
                  <th className="px-2 py-2 text-right">Nhập</th>
                  <th className="px-2 py-2 text-right">Xuất</th>
                  <th className="px-2 py-2 text-right">Tồn cuối kỳ</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr
                    key={`${r.bin_id ?? r.warehouse_id}-${r.product_id}`}
                    className="cursor-pointer border-t hover:bg-muted/40"
                    onClick={() => setCard(r)}
                    title="Bấm để xem thẻ kho (từng phiếu nhập, xuất)"
                  >
                    {props.byBin ? (
                      <td className="px-2 py-1.5">
                        <Badge variant="info">{r.bin_code}</Badge>
                      </td>
                    ) : null}
                    <td className="px-2 py-1.5 font-medium whitespace-nowrap">{r.product_code}</td>
                    <td className="px-2 py-1.5">{r.product_name}</td>
                    <td className="px-2 py-1.5">{r.owner_name}</td>
                    <td className="px-2 py-1.5">{r.unit}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{qty(n(r.opening_qty))}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[oklch(0.42_0.11_155)]">{qty(n(r.in_qty))}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[oklch(0.47_0.12_65)]">{qty(n(r.out_qty))}</td>
                    <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${n(r.closing_qty) < 0 ? "text-destructive" : ""}`}>{formatNumber(n(r.closing_qty))}</td>
                  </tr>
                ))}
              </tbody>
              {sameUnit && shown.length > 1 ? (
                <tfoot>
                  <tr className="border-t-2 bg-muted/60 font-semibold">
                    <td className="px-2 py-2" colSpan={props.byBin ? 4 : 3}>
                      Tổng cộng ({shown.length} dòng)
                    </td>
                    <td className="px-2 py-2">{units[0]}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatNumber(sum("opening_qty"))}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatNumber(sum("in_qty"))}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatNumber(sum("out_qty"))}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatNumber(sum("closing_qty"))}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground print:hidden">
            Tồn đầu kỳ = phát sinh trước ngày bắt đầu + phiếu tồn đầu kỳ. Từng vị trí: chuyển GHA1 → GHA2 tính là xuất ở GHA1, nhập ở GHA2; gộp cả kho thì không tính chuyển vị trí. Bấm một dòng để xem thẻ kho.
          </p>
        </>
      )}

      {dialog ? (
        <StockVoucherDialog
          key={dialog}
          open
          onOpenChange={(o) => !o && setDialog(null)}
          onDone={() => router.refresh()}
          prefill={{ kind: dialog, entry_date: dialog === "opening" ? monthRangeYMD(todayVN(), -1).den : undefined, bin_id: props.bin || props.bins[0]?.id }}
        />
      ) : null}
      {card ? <StockCardDialog row={card} tu={props.tu} den={props.den} byBin={props.byBin} onClose={() => setCard(null)} /> : null}
    </>
  );
}

/** Thẻ kho: từng phiếu nhập, xuất của một mã hàng trong kỳ, tồn lũy kế */
function StockCardDialog({ row, tu, den, byBin, onClose }: { row: StockRow; tu: string; den: string; byBin: boolean; onClose: () => void }) {
  const [data, setData] = useState<{ opening: number; lines: StockCardLine[] } | null>(null);
  const [err, setErr] = useState("");
  const [loading, start] = useTransition();
  useEffect(() => {
    start(async () => {
      const r = await stockCard({ productId: row.product_id, binId: byBin ? row.bin_id : null, warehouseId: row.warehouse_id, tu, den });
      if (!r.ok) {
        toast.error(r.error);
        setErr(r.error);
      } else setData(r.data ?? null);
    });
  }, [row, tu, den, byBin]);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 print:hidden" onClick={onClose}>
      <div className="mx-auto my-6 w-[96%] max-w-4xl rounded-lg bg-card p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <div className="text-lg font-semibold">
              Thẻ kho: {row.product_code} · {row.product_name}
            </div>
            <div className="text-sm text-muted-foreground">
              {byBin ? `Vị trí ${row.bin_code}` : row.warehouse_name} · Từ {formatDate(tu)} đến {formatDate(den)} · ĐVT {row.unit}
            </div>
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
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm [&_td]:border-r [&_td:last-child]:border-r-0 [&_th]:border-r [&_th:last-child]:border-r-0">
              <thead className="bg-muted text-left text-xs">
                <tr>
                  <th className="px-2 py-1.5">Ngày</th>
                  <th className="px-2 py-1.5">Số phiếu</th>
                  <th className="px-2 py-1.5">Loại</th>
                  <th className="px-2 py-1.5">Chứng từ, diễn giải</th>
                  <th className="px-2 py-1.5 text-right">Nhập</th>
                  <th className="px-2 py-1.5 text-right">Xuất</th>
                  <th className="px-2 py-1.5 text-right">Tồn</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t bg-muted/30">
                  <td className="px-2 py-1.5" colSpan={6}>
                    Tồn đầu kỳ
                  </td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{formatNumber(data.opening)}</td>
                </tr>
                {data.lines.map((l, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(l.entry_date)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{l.voucher_no}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{KIND_LABEL[l.kind] ?? l.kind}</td>
                    <td className="px-2 py-1.5">{[l.ref_no, l.partner, l.notes].filter(Boolean).join(" · ")}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{qty(l.qty_in)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{qty(l.qty_out)}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${l.balance < 0 ? "text-destructive" : ""}`}>{formatNumber(l.balance)}</td>
                  </tr>
                ))}
                {!data.lines.length ? (
                  <tr className="border-t">
                    <td className="px-2 py-3 text-center text-muted-foreground" colSpan={7}>
                      Không có phiếu nhập, xuất trong kỳ.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
