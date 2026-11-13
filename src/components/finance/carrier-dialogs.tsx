"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, HandCoins, Loader2, Plus, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { parseNumberVN } from "@/lib/entities/record";
import { formatNumber, formatVND, formatDate, todayVN } from "@/lib/format";
import { listOpenCarrierPayables, payCarrierPayables, saveCarrierCosts, type OpenCarrierPayable } from "@/lib/finance/carrier-actions";

import { CARRIER_KIND_LABEL, type CarrierKind } from "@/lib/finance/carrier-kind";
export type { CarrierKind };

export type CarrierCost = {
  line_no: number;
  cost_kind: CarrierKind;
  fee_type_id: string | null;
  description: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number;
  ref_no: string | null;
  note: string | null;
  fee_type?: { name: string } | null;
};

/** Phí chi hộ thu khách của chuyến: chép sang làm khoản chi hộ trả 3PL */
export type CustomerPassThrough = { fee_type_id: string; name: string; amount: number; ref_no: string | null; note: string | null };

type Line = {
  key: number;
  kind: CarrierKind;
  fee_type_id: string;
  fee_label: string;
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  ref_no: string;
  note: string;
};

let seq = 0;
const txt = (v: number | null | undefined) => (v === null || v === undefined ? "" : formatNumber(Number(v)));
const newLine = (p: Partial<Line> = {}): Line => ({
  key: ++seq,
  kind: "freight",
  fee_type_id: "",
  fee_label: "",
  description: "",
  quantity: "",
  unit_price: "",
  amount: "",
  ref_no: "",
  note: "",
  ...p,
});
const n = (s: string) => {
  const v = parseNumberVN(s, true);
  return v === null || Number.isNaN(v) ? null : v;
};
const lineAmount = (l: Line) => {
  const a = n(l.amount);
  if (a !== null) return a;
  const q = n(l.quantity);
  const p = n(l.unit_price);
  return q !== null && p !== null ? Math.round(q * p) : 0;
};

/** Nhập cước, chi hộ, chi phí khác phải trả nhà xe 3PL của chuyến */
export function CarrierCostsDialog(props: {
  shipmentId: string;
  code: string;
  supplierId: string | null;
  supplierLabel: string | null;
  invoiceNo: string | null;
  dueDate: string | null;
  costs: CarrierCost[];
  customerPassThrough: CustomerPassThrough[];
  paidAmount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState(props.supplierId ?? "");
  const [invoice, setInvoice] = useState(props.invoiceNo ?? "");
  const [due, setDue] = useState(props.dueDate ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [pending, start] = useTransition();
  const total = lines.reduce((a, l) => a + lineAmount(l), 0);
  const patch = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const openDialog = () => {
    setSupplier(props.supplierId ?? "");
    setInvoice(props.invoiceNo ?? "");
    setDue(props.dueDate ?? "");
    setLines(
      props.costs.length
        ? props.costs.map((c) =>
            newLine({
              kind: c.cost_kind,
              fee_type_id: c.fee_type_id ?? "",
              fee_label: c.fee_type?.name ?? "",
              description: c.description,
              quantity: txt(c.quantity),
              unit_price: txt(c.unit_price),
              amount: txt(c.amount),
              ref_no: c.ref_no ?? "",
              note: c.note ?? "",
            }),
          )
        : [newLine({ kind: "freight", description: "Cước 3PL" })],
    );
    setOpen(true);
  };

  const copyPassThrough = () => {
    if (!props.customerPassThrough.length) return void toast.info("Chuyến chưa có phí chi hộ thu khách để chép.");
    const have = new Set(lines.filter((l) => l.kind === "pass_through").map((l) => l.fee_type_id));
    const add = props.customerPassThrough
      .filter((f) => !have.has(f.fee_type_id))
      .map((f) =>
        newLine({
          kind: "pass_through",
          fee_type_id: f.fee_type_id,
          fee_label: f.name,
          description: f.name,
          amount: formatNumber(Number(f.amount)),
          ref_no: f.ref_no ?? "",
          note: f.note ?? "",
        }),
      );
    if (!add.length) return void toast.info("Các phí chi hộ thu khách đã có trong danh sách.");
    setLines((ls) => [...ls.filter((l) => lineAmount(l) > 0 || l.description.trim()), ...add]);
  };

  const save = () =>
    start(async () => {
      const bad = lines.find((l) => [l.amount, l.quantity, l.unit_price].some((s) => s.trim() && n(s) === null));
      if (bad) return void toast.error(`Số không hợp lệ ở khoản "${bad.description || CARRIER_KIND_LABEL[bad.kind]}"`);
      const r = await saveCarrierCosts({
        shipmentId: props.shipmentId,
        supplierId: supplier || null,
        invoiceNo: invoice,
        dueDate: due || null,
        lines: lines
          .filter((l) => lineAmount(l) > 0)
          .map((l) => ({
            kind: l.kind,
            feeTypeId: l.fee_type_id || null,
            description: l.description,
            quantity: n(l.quantity),
            unitPrice: n(l.unit_price),
            amount: n(l.amount) ?? lineAmount(l),
            refNo: l.ref_no,
            note: l.note,
          })),
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.data?.payable_code ? `${r.message} Công nợ phải trả ${r.data.payable_code}.` : r.message);
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button size="sm" variant={props.costs.length ? "outline" : "default"} onClick={openDialog}>
        <Truck /> {props.costs.length ? "Sửa chi phí 3PL" : "Nhập chi phí 3PL"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chi phí trả 3PL chuyến {props.code}</DialogTitle>
            <DialogDescription>
              Cước và chi phí khác trả 3PL được trừ vào lời/lỗ chuyến. Chi hộ 3PL (nâng, hạ, cược… nhà xe trả thay) công ty trả lại cho nhà xe, không trừ lời/lỗ vì đã
              thu lại của khách qua phí chi hộ. Lưu xong, phần mềm tự lập công nợ phải trả cho nhà xe để Kế toán trả một hoặc nhiều lần.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="cc-supplier">Nhà xe 3PL nhận tiền *</Label>
              <ReferenceSelect id="cc-supplier" refKey="suppliers" value={supplier} initialLabel={props.supplierLabel ?? ""} onChange={(v) => setSupplier(v)} />
              <p className="text-xs text-muted-foreground">
                Tự điền theo xe (Phương tiện → Nhà xe 3PL). Chưa có thì gõ tên để thêm mới.{props.paidAmount > 0 ? " Đã trả tiền thì không đổi nhà xe được." : ""}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-invoice">Số hóa đơn / bảng kê của nhà xe</Label>
              <Input id="cc-invoice" value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={100} placeholder="Ví dụ 0001234" />
              <p className="text-xs text-muted-foreground">Không bắt buộc, để đối chiếu khi nhà xe gửi hóa đơn.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-due">Hạn trả</Label>
              <Input id="cc-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              <p className="text-xs text-muted-foreground">Để trống: ngày chuyến + số ngày công nợ của nhà xe (danh mục Nhà cung cấp).</p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="hidden gap-1.5 px-1 text-xs font-medium text-muted-foreground lg:grid lg:grid-cols-[8.5rem_minmax(0,1fr)_5rem_7rem_8rem_7rem_minmax(0,9rem)_2rem]">
              <span>Loại khoản</span>
              <span>Nội dung</span>
              <span>SL</span>
              <span>Đơn giá</span>
              <span>Số tiền (đ)</span>
              <span>Số HĐ/chứng từ</span>
              <span>Ghi chú</span>
              <span />
            </div>
            {lines.map((l, i) => (
              <div key={l.key} className="grid gap-1.5 rounded-lg border p-2 lg:grid-cols-[8.5rem_minmax(0,1fr)_5rem_7rem_8rem_7rem_minmax(0,9rem)_2rem] lg:items-start lg:border-0 lg:p-0">
                <NativeSelect
                  aria-label={`Loại khoản dòng ${i + 1}`}
                  className="h-8"
                  value={l.kind}
                  onChange={(e) => patch(l.key, { kind: e.target.value as CarrierKind })}
                >
                  <option value="freight">Cước 3PL</option>
                  <option value="pass_through">Chi hộ 3PL</option>
                  <option value="other">Chi phí khác</option>
                </NativeSelect>
                {l.kind === "pass_through" ? (
                  <div>
                    <ReferenceSelect
                      id={`cc-fee-${l.key}`}
                      refKey="fee_types"
                      value={l.fee_type_id}
                      initialLabel={l.fee_label}
                      onChange={(id, label) => patch(l.key, { fee_type_id: id, fee_label: label, description: label || l.description })}
                    />
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Chọn loại phí (Phí nâng, Phí hạ, Phí cược…) để đối chiếu với chi hộ thu khách</p>
                  </div>
                ) : (
                  <Input
                    aria-label={`Nội dung dòng ${i + 1}`}
                    className="h-8"
                    maxLength={200}
                    placeholder={l.kind === "freight" ? "Cước 3PL" : "Ví dụ: Neo xe, bốc xếp"}
                    value={l.description}
                    onChange={(e) => patch(l.key, { description: e.target.value })}
                  />
                )}
                <Input
                  aria-label={`Số lượng dòng ${i + 1}`}
                  className="h-8 text-right tabular-nums"
                  inputMode="decimal"
                  placeholder="SL"
                  value={l.quantity}
                  onChange={(e) => patch(l.key, { quantity: e.target.value, amount: "" })}
                />
                <Input
                  aria-label={`Đơn giá dòng ${i + 1}`}
                  className="h-8 text-right tabular-nums"
                  inputMode="numeric"
                  placeholder="Đơn giá"
                  value={l.unit_price}
                  onChange={(e) => patch(l.key, { unit_price: e.target.value, amount: "" })}
                  onBlur={(e) => {
                    const v = n(e.target.value);
                    if (v !== null) patch(l.key, { unit_price: formatNumber(v) });
                  }}
                />
                <Input
                  aria-label={`Số tiền dòng ${i + 1}`}
                  className="h-8 text-right tabular-nums"
                  inputMode="numeric"
                  placeholder={l.quantity && l.unit_price ? formatNumber(lineAmount(l)) : "Ví dụ 3,000,000"}
                  value={l.amount}
                  onChange={(e) => patch(l.key, { amount: e.target.value })}
                  onBlur={(e) => {
                    const v = n(e.target.value);
                    if (v !== null) patch(l.key, { amount: formatNumber(v) });
                  }}
                />
                <Input
                  aria-label={`Số hóa đơn dòng ${i + 1}`}
                  className="h-8"
                  maxLength={100}
                  placeholder="Số HĐ"
                  value={l.ref_no}
                  onChange={(e) => patch(l.key, { ref_no: e.target.value })}
                />
                <Input
                  aria-label={`Ghi chú dòng ${i + 1}`}
                  className="h-8"
                  maxLength={500}
                  placeholder="Ghi chú"
                  value={l.note}
                  onChange={(e) => patch(l.key, { note: e.target.value })}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 text-destructive"
                  aria-label={`Xóa dòng ${i + 1}`}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, newLine({ kind: ls.some((x) => x.kind === "freight") ? "pass_through" : "freight" })])}>
                <Plus /> Thêm khoản
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={copyPassThrough} disabled={!props.customerPassThrough.length}>
                <Copy /> Chép phí chi hộ thu khách
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Nhập Số tiền, hoặc nhập SL × Đơn giá để tự tính. Dòng số tiền bằng 0 bị bỏ qua. Xóa hết các khoản thì công nợ 3PL chưa trả bị hủy.
            </p>
          </div>

          <div className="grid gap-1 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-4">
            {(["freight", "pass_through", "other"] as CarrierKind[]).map((k) => (
              <div key={k}>
                <div className="text-xs text-muted-foreground">{CARRIER_KIND_LABEL[k]}</div>
                <div className="tabular-nums">{formatVND(lines.filter((l) => l.kind === k).reduce((a, l) => a + lineAmount(l), 0))}</div>
              </div>
            ))}
            <div>
              <div className="text-xs text-muted-foreground">Tổng phải trả nhà xe</div>
              <div className="font-semibold tabular-nums">{formatVND(total)}</div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Đóng
            </Button>
            <Button disabled={pending} onClick={save}>
              {pending ? <Loader2 className="animate-spin" /> : null} Lưu chi phí 3PL
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Trả gộp nhiều chuyến cho một nhà xe: chọn nhà xe → tick các chuyến còn nợ → ghi một lần */
export function BulkCarrierPayDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [rows, setRows] = useState<OpenCarrierPayable[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [method, setMethod] = useState("");
  const [bank, setBank] = useState("");
  const [ref, setRef] = useState("");
  const [paidAt, setPaidAt] = useState(todayVN());
  const [note, setNote] = useState("");
  const [loading, startLoading] = useTransition();
  const [pending, start] = useTransition();

  const load = (id: string) => {
    setSupplier(id);
    setRows(null);
    setPicked(new Set());
    if (!id) return;
    startLoading(async () => {
      const r = await listOpenCarrierPayables(id);
      if (!r.ok) return void toast.error(r.error);
      setRows(r.data ?? []);
      setPicked(new Set((r.data ?? []).map((x) => x.payable_id)));
    });
  };
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => !k || `${r.shipment_code} ${r.plate_number ?? ""} ${r.payable_code}`.toLowerCase().includes(k));
  }, [rows, q]);
  const total = (rows ?? []).filter((r) => picked.has(r.payable_id)).reduce((a, r) => a + Number(r.remaining_amount), 0);
  const toggle = (id: string) =>
    setPicked((s) => {
      const x = new Set(s);
      if (x.has(id)) x.delete(id);
      else x.add(id);
      return x;
    });

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <HandCoins /> Trả tiền 3PL nhiều chuyến
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Trả tiền nhà xe 3PL nhiều chuyến</DialogTitle>
            <DialogDescription>
              Chọn nhà xe, tick các chuyến trả lần này. Mỗi chuyến được trả đủ số còn nợ, ghi thành một phiếu chi riêng cùng số giao dịch. Trả một phần thì dùng nút Trả tiền ở
              từng dòng.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-supplier">Nhà xe 3PL *</Label>
            <ReferenceSelect id="bulk-supplier" refKey="suppliers" value={supplier} onChange={(v) => load(v)} allowQuickCreate={false} />
          </div>
          {supplier ? (
            loading || rows === null ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Đang tải…</p>
            ) : rows.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Nhà xe này không còn chuyến nào chưa trả.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Input aria-label="Tìm chuyến" className="h-8 max-w-60" placeholder="Tìm mã chuyến, biển số…" value={q} onChange={(e) => setQ(e.target.value)} />
                  <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(rows.map((r) => r.payable_id)))}>
                    Chọn hết
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                    Bỏ chọn
                  </Button>
                </div>
                <div className="max-h-72 overflow-y-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted text-xs">
                      <tr>
                        <th className="w-8 p-2" />
                        <th className="p-2 text-left font-semibold">Chuyến</th>
                        <th className="p-2 text-left font-semibold">Ngày</th>
                        <th className="p-2 text-left font-semibold">Biển số</th>
                        <th className="p-2 text-left font-semibold">Hạn trả</th>
                        <th className="p-2 text-right font-semibold">Còn nợ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {shown.map((r) => (
                        <tr key={r.payable_id} className="cursor-pointer hover:bg-muted/50" onClick={() => toggle(r.payable_id)}>
                          <td className="p-2">
                            <input type="checkbox" aria-label={`Chọn ${r.shipment_code}`} checked={picked.has(r.payable_id)} onChange={() => toggle(r.payable_id)} onClick={(e) => e.stopPropagation()} />
                          </td>
                          <td className="p-2 font-medium">{r.shipment_code}</td>
                          <td className="p-2">{formatDate(r.report_date)}</td>
                          <td className="p-2">{r.plate_number ?? ""}</td>
                          <td className={r.overdue_days > 0 ? "p-2 text-red-700 dark:text-red-400" : "p-2"}>
                            {formatDate(r.due_date)}
                            {r.overdue_days > 0 ? ` (quá ${r.overdue_days} ngày)` : ""}
                          </td>
                          <td className="p-2 text-right tabular-nums">{formatVND(r.remaining_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-sm">
                  Đã chọn <b>{picked.size}</b> chuyến · tổng trả <b className="text-primary">{formatVND(total)}</b>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="bulk-method">Phương thức</Label>
                    <ReferenceSelect id="bulk-method" refKey="payment_methods" value={method} onChange={(x) => setMethod(x)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bulk-bank">Tài khoản công ty chuyển</Label>
                    <ReferenceSelect id="bulk-bank" refKey="company_bank_accounts" value={bank} onChange={(x) => setBank(x)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bulk-ref">Số giao dịch ngân hàng</Label>
                    <Input id="bulk-ref" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={100} placeholder="Ví dụ FT26305123456" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bulk-date">Ngày trả</Label>
                    <Input id="bulk-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="bulk-note">Ghi chú</Label>
                    <Textarea id="bulk-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Ví dụ: Thanh toán cước tháng 10/2026" />
                  </div>
                </div>
              </div>
            )
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Đóng
            </Button>
            <Button
              disabled={pending || picked.size === 0}
              onClick={() =>
                start(async () => {
                  const r = await payCarrierPayables({
                    payableIds: [...picked],
                    paymentMethodId: method || undefined,
                    bankAccountId: bank || undefined,
                    referenceNo: ref.trim() || undefined,
                    paidAt: paidAt ? `${paidAt}T12:00:00+07:00` : undefined,
                    note: note.trim() || undefined,
                  });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(`Đã trả ${r.data?.count ?? 0} chuyến, tổng ${formatVND(r.data?.total ?? 0)}`);
                  setOpen(false);
                  setSupplier("");
                  setRows(null);
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : null} Xác nhận đã trả {picked.size ? formatVND(total) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
