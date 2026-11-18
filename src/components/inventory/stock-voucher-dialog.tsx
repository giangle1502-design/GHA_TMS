"use client";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { Field, type CreateActionProps } from "@/components/finance/create-dialogs";
import { STOCK_KIND_OPTIONS } from "@/lib/entities/definitions";
import { createStockVoucher, stockOnHand } from "@/lib/inventory/actions";
import { formatNumber, todayVN } from "@/lib/format";

export type StockKind = "opening" | "receipt" | "issue" | "transfer";

export type StockVoucherPrefill = {
  kind?: StockKind;
  entry_date?: string;
  bin_id?: string | null;
  to_bin_id?: string | null;
  ref_no?: string;
  partner?: string;
  notes?: string;
  shipment_id?: string;
  owner_customer_id?: string | null;
  /** Tiêu đề phụ (VD: Chuyến SHD-000123 · Kho VAP → Kho GHA) */
  source?: string;
  lines?: { product_id: string | null; quantity: number | null; label?: string }[];
};

type Line = { key: number; product: string; qty: number | null; label?: string };
let seq = 0;
const newLine = (p?: Partial<Line>): Line => ({ key: ++seq, product: "", qty: null, ...p });
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

/** Ô số lượng: dấu phẩy ngăn cách hàng nghìn, dấu chấm thập phân */
function QtyInput({ id, value, onChange, label }: { id: string; value: number | null; onChange: (v: number | null) => void; label: string }) {
  const [text, setText] = useState(value === null ? "" : fmt(value));
  return (
    <Input
      id={id}
      aria-label={label}
      inputMode="decimal"
      className="h-9 text-right tabular-nums"
      placeholder="0"
      value={text}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d.,]/g, "");
        setText(raw);
        const n = Number(raw.replace(/,/g, ""));
        onChange(raw && Number.isFinite(n) && n > 0 ? n : null);
      }}
      onBlur={() => setText(value === null ? "" : fmt(value))}
    />
  );
}

const TITLES: Record<StockKind, string> = {
  opening: "Nhập tồn đầu kỳ",
  receipt: "Lập phiếu nhập kho",
  issue: "Lập phiếu xuất kho",
  transfer: "Lập phiếu chuyển vị trí",
};

/** Lập phiếu kho GHA nhiều mã hàng: tồn đầu kỳ, nhập, xuất, chuyển vị trí (GHA1 ↔ GHA2) */
export function StockVoucherDialog({
  open,
  onOpenChange,
  onDone,
  prefill,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
  prefill?: StockVoucherPrefill;
}) {
  const [kind, setKind] = useState<StockKind>(prefill?.kind ?? "receipt");
  const [date, setDate] = useState(prefill?.entry_date ?? todayVN());
  const [voucherNo, setVoucherNo] = useState("");
  const [bin, setBin] = useState(prefill?.bin_id ?? "");
  const [toBin, setToBin] = useState(prefill?.to_bin_id ?? "");
  const [refNo, setRefNo] = useState(prefill?.ref_no ?? "");
  const [partner, setPartner] = useState(prefill?.partner ?? "");
  const [note, setNote] = useState(prefill?.notes ?? "");
  const [owner, setOwner] = useState(prefill?.owner_customer_id ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    prefill?.lines?.length ? prefill.lines.map((l) => newLine({ product: l.product_id ?? "", qty: l.quantity, label: l.label })) : [newLine()],
  );
  const [stock, setStock] = useState<{ key: string; data: Record<string, number> } | null>(null);
  const [pending, start] = useTransition();
  const patch = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const outgoing = kind === "issue" || kind === "transfer";

  // Tồn hiện có tại vị trí xuất (đến ngày phiếu) để cảnh báo xuất quá tồn
  const stockKey = `${bin}|${date}|${owner}`;
  useEffect(() => {
    if (!open || !outgoing || !bin) return;
    let live = true;
    stockOnHand(bin, date, owner).then((r) => {
      if (live && r.ok) setStock({ key: `${bin}|${date}|${owner}`, data: r.data ?? {} });
    });
    return () => {
      live = false;
    };
  }, [open, outgoing, bin, date, owner]);
  const onHand = outgoing && bin && stock?.key === stockKey ? stock.data : null;

  const unmatched = lines.filter((l) => !l.product && l.label);
  const over = outgoing && onHand ? lines.filter((l) => l.product && (l.qty ?? 0) > (onHand[l.product] ?? 0)) : [];

  function submit() {
    if (!bin) return toast.error(kind === "transfer" ? "Chọn vị trí chuyển đi" : "Chọn vị trí");
    if (kind === "transfer" && !toBin) return toast.error("Chọn vị trí chuyển tới");
    const ok = lines.filter((l) => l.product && l.qty);
    if (!ok.length) return toast.error("Nhập ít nhất một mã hàng và số lượng");
    if (ok.length < lines.filter((l) => l.product || l.qty || l.label).length) return toast.error("Còn dòng thiếu mã hàng hoặc số lượng (xóa dòng đó nếu không cần)");
    start(async () => {
      const r = await createStockVoucher({
        kind,
        entry_date: date,
        voucher_no: voucherNo,
        bin_id: bin,
        to_bin_id: toBin,
        ref_no: refNo,
        partner,
        notes: note,
        shipment_id: prefill?.shipment_id ?? "",
        owner_customer_id: owner,
        lines: ok.map((l) => ({ product_id: l.product, quantity: l.qty! })),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Đã lưu phiếu ${r.data}`);
      onOpenChange(false);
      onDone();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{TITLES[kind]}</DialogTitle>
          <DialogDescription>
            {prefill?.source ? (
              <>
                Từ {prefill.source}. Kiểm lại mã hàng, số lượng, vị trí rồi bấm Lưu phiếu.
              </>
            ) : (
              <>Một phiếu gồm nhiều mã hàng. Mã hàng chọn từ danh mục mã hàng; đơn vị tính lấy theo mã hàng.</>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Loại phiếu *" htmlFor="sv-kind">
            <NativeSelect id="sv-kind" className="h-9" value={kind} onChange={(e) => setKind(e.target.value as StockKind)}>
              {STOCK_KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Ngày *" htmlFor="sv-date" help={kind === "opening" ? "Ngày chốt số tồn, VD 31/10/2026 để theo dõi từ tháng 11." : undefined}>
            <Input id="sv-date" type="date" className="h-9" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label={kind === "transfer" ? "Từ vị trí *" : "Vị trí *"} htmlFor="sv-bin">
            <ReferenceSelect id="sv-bin" refKey="warehouse_bins" value={bin} onChange={(v) => setBin(v)} />
          </Field>
          {kind === "transfer" ? (
            <Field label="Chuyển tới vị trí *" htmlFor="sv-tobin">
              <ReferenceSelect id="sv-tobin" refKey="warehouse_bins" value={toBin} onChange={(v) => setToBin(v)} />
            </Field>
          ) : (
            <Field label="Số phiếu" htmlFor="sv-no" help="Để trống thì tự đặt (PN-2611-001, PX-…, DK-ngày).">
              <Input id="sv-no" className="h-9" value={voucherNo} maxLength={50} onChange={(e) => setVoucherNo(e.target.value)} />
            </Field>
          )}
          <Field label="Công ty chủ hàng" htmlFor="sv-owner" help="VD Việt An Pha. Để trống thì lấy theo chủ hàng của mã hàng. Tồn kho tách theo công ty.">
            <ReferenceSelect id="sv-owner" refKey="customers" value={owner} onChange={(v) => setOwner(v)} />
          </Field>
          <Field label="Số chứng từ" htmlFor="sv-ref" help="VD: số PXK, phiếu chuyển kho Ecount, số chuyến.">
            <Input id="sv-ref" className="h-9" value={refNo} maxLength={100} onChange={(e) => setRefNo(e.target.value)} />
          </Field>
          <Field label={kind === "issue" ? "Người / đơn vị nhận" : "Người / đơn vị giao"} htmlFor="sv-partner">
            <Input id="sv-partner" className="h-9" value={partner} maxLength={300} onChange={(e) => setPartner(e.target.value)} placeholder="VD: số xe, tài xế, nhà xe" />
          </Field>
        </div>

        <div className="space-y-2 rounded-lg border p-2.5">
          <div className="hidden gap-1.5 text-[11px] text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_9rem_8rem_auto]">
            <span>Mã hàng *</span>
            <span className="text-right">Số lượng *</span>
            <span className="text-right">{outgoing ? "Tồn tại vị trí" : ""}</span>
            <span className="sr-only">Xóa</span>
          </div>
          {lines.map((l, i) => {
            const have = outgoing && onHand && l.product ? (onHand[l.product] ?? 0) : null;
            const short = have !== null && (l.qty ?? 0) > have;
            return (
              <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_9rem_8rem_auto]">
                <div className="min-w-0">
                  <ReferenceSelect id={`sv-p-${l.key}`} refKey="products" value={l.product} onChange={(v) => patch(l.key, { product: v })} />
                  {!l.product && l.label ? <p className="mt-0.5 text-xs text-destructive">Chưa có trong danh mục: {l.label}. Chọn mã hàng đúng.</p> : null}
                </div>
                <QtyInput id={`sv-q-${l.key}`} label={`Số lượng dòng ${i + 1}`} value={l.qty} onChange={(v) => patch(l.key, { qty: v })} />
                <span className={`hidden text-right text-sm tabular-nums sm:block ${short ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                  {have !== null ? formatNumber(have) : ""}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive"
                  aria-label={`Xóa dòng ${i + 1}`}
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])} disabled={lines.length >= 300}>
            <Plus /> Thêm mã hàng
          </Button>
          {over.length ? (
            <p className="text-xs text-destructive">
              {over.length} mã hàng xuất nhiều hơn số tồn tại vị trí này. Vẫn lưu được (VD chưa nhập tồn đầu kỳ), báo cáo sẽ hiện tồn âm để kiểm lại.
            </p>
          ) : null}
          {unmatched.length ? <p className="text-xs text-destructive">{unmatched.length} dòng chưa ghép được mã hàng trong danh mục.</p> : null}
        </div>
        <Field label="Ghi chú" htmlFor="sv-note">
          <Textarea id="sv-note" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Hủy
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />} Lưu phiếu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Nút "Thêm" trên bảng Phiếu nhập, xuất kho mở biểu mẫu nhiều dòng */
export function CreateStockVoucherDialog({ open, onOpenChange, onDone }: CreateActionProps) {
  return <StockVoucherDialog open={open} onOpenChange={onOpenChange} onDone={onDone} />;
}
