"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { Ban, CheckCheck, History, Loader2, Plus, Send, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { CustomFieldsEditor } from "@/components/entities/custom-fields-editor";
import { AddFieldButton } from "@/components/entities/add-field-button";
import { moduleCustomFields } from "@/lib/entities/record";
import { formatDateTime, formatVND, todayVN } from "@/lib/format";
import {
  cancelPurchaseRequest,
  completePurchaseRequest,
  createPurchaseRequest,
  getPurchaseRequest,
  payPurchaseRequest,
  purchaseRequestHistory,
  type PurchaseHistoryItem,
} from "@/lib/finance/purchase-actions";
import { Field, MoneyField, type CreateActionProps } from "./create-dialogs";
import { DocumentsButton } from "./documents-button";
import { uploadStaffDocuments } from "./upload";
import type { RowActionProps } from "./row-actions";

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Ô số lượng: dấu phẩy ngăn cách hàng nghìn, dấu chấm thập phân (2.5) */
function QtyField({ id, value, onChange, label }: { id: string; value: number | null; onChange: (v: number | null) => void; label: string }) {
  const [text, setText] = useState(value === null ? "" : fmt(value));
  return (
    <Input
      id={id}
      aria-label={label}
      inputMode="decimal"
      className="h-9 text-right tabular-nums"
      placeholder="1"
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

type Line = { key: number; name: string; qty: number | null; unit: string; price: number | null };
let seq = 0;
const newLine = (): Line => ({ key: ++seq, name: "", qty: 1, unit: "", price: null });

/** Lập phiếu đề nghị chi / mua sắm (người lập không tự duyệt được phiếu của mình) */
export function CreatePurchaseRequestDialog({ open, onOpenChange, customRows, canAddField, onDone }: CreateActionProps) {
  const fields = useMemo(() => moduleCustomFields("purchase_requests", customRows), [customRows]);
  const [typeId, setTypeId] = useState("");
  const [title, setTitle] = useState("");
  const [useItems, setUseItems] = useState(false);
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [amount, setAmount] = useState<number | null>(null);
  const [neededBy, setNeededBy] = useState("");
  const [supplier, setSupplier] = useState("");
  const [payee, setPayee] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const rid = useRef(crypto.randomUUID());
  const [pending, start] = useTransition();
  const patch = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const itemsTotal = lines.reduce((a, l) => a + Math.round((l.qty ?? 0) * (l.price ?? 0)), 0);
  const total = useItems ? itemsTotal : (amount ?? 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Lập phiếu đề nghị chi, mua sắm</DialogTitle>
          <DialogDescription>
            Ví dụ: mua văn phòng phẩm, sửa văn phòng, mua máy móc thiết bị. Gửi xong phiếu chuyển Giám đốc duyệt; duyệt xong Kế toán chi tiền.
          </DialogDescription>
        </DialogHeader>
        {canAddField ? (
          <div>
            <AddFieldButton module="purchase_requests" entityKey="purchase_requests" customRows={customRows} label="Thêm trường cho biểu mẫu này" />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Loại đề nghị *" htmlFor="pr-type" help="Chưa có loại phù hợp thì gõ tên rồi bấm Thêm mới (VD: Mua đồ bảo hộ lao động)">
            <ReferenceSelect id="pr-type" refKey="purchase_request_types" value={typeId} onChange={(v) => setTypeId(v)} />
          </Field>
          <Field label="Cần trước ngày" htmlFor="pr-needed" help="Không bắt buộc. Ngày cần có hàng / cần tiền">
            <Input id="pr-needed" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </Field>
          <Field label="Nội dung đề nghị *" htmlFor="pr-title" wide help="Ví dụ: Mua văn phòng phẩm tháng 11 cho phòng điều phối; Sửa điều hòa phòng kế toán">
            <Input id="pr-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
          </Field>
        </div>

        <div className="space-y-2 rounded-lg border p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">
              Số tiền đề nghị *{" "}
              <span className="font-normal text-muted-foreground">
                · {useItems ? "tự cộng từ danh sách hàng hóa (SL × đơn giá)" : "nhập tổng số tiền, hoặc liệt kê từng món hàng"}
              </span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setUseItems((v) => !v)}>
              {useItems ? "Chỉ nhập tổng số tiền" : "Liệt kê hàng hóa, hạng mục"}
            </Button>
          </div>
          {useItems ? (
            <>
              <div className="hidden gap-1.5 text-[11px] text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_5.5rem_5rem_8.5rem_7.5rem_auto]">
                <span>Tên hàng hóa / hạng mục *</span>
                <span className="text-right">Số lượng</span>
                <span>ĐVT</span>
                <span className="text-right">Đơn giá (đ)</span>
                <span className="text-right">Thành tiền</span>
                <span className="sr-only">Xóa</span>
              </div>
              {lines.map((l, i) => (
                <div key={l.key} className="grid grid-cols-3 items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_5.5rem_5rem_8.5rem_7.5rem_auto]">
                  <Input
                    className="col-span-3 h-9 sm:col-span-1"
                    aria-label={`Tên hàng dòng ${i + 1}`}
                    placeholder="VD: Giấy A4 Double A"
                    maxLength={200}
                    value={l.name}
                    onChange={(e) => patch(l.key, { name: e.target.value })}
                  />
                  <QtyField id={`pr-qty-${l.key}`} label={`Số lượng dòng ${i + 1}`} value={l.qty} onChange={(v) => patch(l.key, { qty: v })} />
                  <Input className="h-9" aria-label={`Đơn vị tính dòng ${i + 1}`} placeholder="ram, hộp, cái" maxLength={30} value={l.unit} onChange={(e) => patch(l.key, { unit: e.target.value })} />
                  <MoneyField id={`pr-price-${l.key}`} value={l.price} onChange={(v) => patch(l.key, { price: v })} />
                  <span className="text-right text-sm tabular-nums">{fmt(Math.round((l.qty ?? 0) * (l.price ?? 0)))}</span>
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
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, newLine()])} disabled={lines.length >= 100}>
                <Plus /> Thêm dòng
              </Button>
            </>
          ) : (
            <div className="max-w-xs">
              <MoneyField id="pr-amount" value={amount} onChange={setAmount} />
            </div>
          )}
          <div className="text-right text-sm">
            Tổng đề nghị: <b className="tabular-nums">{fmt(total)} ₫</b>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nhà cung cấp" htmlFor="pr-supplier" help="Không bắt buộc. Nơi mua hàng / đơn vị sửa chữa; chưa có thì gõ tên rồi bấm Thêm mới">
            <ReferenceSelect id="pr-supplier" refKey="suppliers" value={supplier} onChange={(v) => setSupplier(v)} />
          </Field>
          <Field label="Người nhận tiền" htmlFor="pr-payee" help="Không bắt buộc. VD: chính người đề nghị (mua rồi hoàn tiền), hoặc tên cửa hàng, số tài khoản">
            <Input id="pr-payee" value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={200} placeholder="VD: Nguyễn Văn A - VCB 0123456789" />
          </Field>
          <Field label="Ghi chú" htmlFor="pr-note" wide>
            <Textarea id="pr-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="VD: Đã hỏi 2 nơi, chọn nơi rẻ hơn" />
          </Field>
          <Field label="Báo giá, hóa đơn đính kèm" htmlFor="pr-files" wide help="Không bắt buộc. Ảnh hoặc PDF, tối đa 10 tệp, 10 MB mỗi tệp. Có thể bổ sung sau ở nút Chứng từ.">
            <div className="flex flex-wrap items-center gap-2">
              <Button id="pr-files" type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload /> {files.length ? `${files.length} tệp đã chọn` : "Chọn tệp"}
              </Button>
              {files.length ? <span className="truncate text-xs text-muted-foreground">{files.map((f) => f.name).join(", ")}</span> : null}
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                aria-label="Chọn báo giá, hóa đơn"
                onChange={(e) => {
                  setFiles(Array.from(e.target.files ?? []).filter((f) => f.size <= 10 * 1024 * 1024).slice(0, 10));
                  e.target.value = "";
                }}
              />
            </div>
          </Field>
        </div>
        <CustomFieldsEditor fields={fields} idPrefix="pr-cf-" onChange={setCustom} className="lg:grid-cols-2" />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Đóng
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (!typeId) return void toast.error("Chọn loại đề nghị");
                if (!title.trim()) return void toast.error("Nhập nội dung đề nghị");
                const items = useItems ? lines.filter((l) => l.name.trim() || l.price) : [];
                if (useItems && !items.length) return void toast.error("Nhập ít nhất một dòng hàng hóa");
                const bad = items.findIndex((l) => !l.name.trim() || !l.qty);
                if (bad >= 0) return void toast.error(`Dòng ${bad + 1}: nhập tên hàng và số lượng`);
                if (!total) return void toast.error("Nhập số tiền đề nghị");
                const r = await createPurchaseRequest({
                  typeId,
                  title,
                  amount: useItems ? undefined : (amount ?? undefined),
                  items: items.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit || undefined, price: l.price ?? 0 })),
                  neededBy: neededBy || undefined,
                  supplierId: supplier || undefined,
                  payee: payee.trim() || undefined,
                  note: note.trim() || undefined,
                  custom,
                  clientRequestId: rid.current,
                });
                if (!r.ok) return void toast.error(r.error);
                if (files.length && r.data) {
                  const u = await uploadStaffDocuments("purchase_request", r.data, files.map((file) => ({ file, docType: "other" as const })));
                  if (!u.ok) toast.error(`Đã gửi phiếu nhưng chưa tải được tệp: ${u.error}`);
                }
                toast.success(r.message);
                onDone();
              })
            }
          >
            {pending ? "Đang gửi…" : "Gửi Giám đốc duyệt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const HISTORY_LABEL: Record<string, string> = {
  submit: "Gửi đề nghị",
  approve: "Duyệt",
  reject: "Từ chối",
  cancel: "Hủy phiếu",
  mark_paid: "Chi xong",
  comment: "Ghi chú",
  payment: "Chi tiền",
  payment_voided: "Phiếu chi đã hủy",
};

type Item = { name: string; qty: number; unit?: string; price: number; amount: number };

/** Chi tiết phiếu: danh sách hàng, lịch sử duyệt và chi tiền */
export function PurchaseDetailButton({ row: given, id, label = "Chi tiết" }: { row?: Row; id?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [hist, setHist] = useState<PurchaseHistoryItem[] | null>(null);
  const [loaded, setLoaded] = useState<Row | null>(null);
  const [loading, startLoad] = useTransition();
  const row: Row = given ?? loaded ?? { id };
  const items = (Array.isArray(row.items) ? row.items : []) as Item[];
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2"
        onClick={() => {
          setOpen(true);
          startLoad(async () => {
            const pid = String(given?.id ?? id);
            if (!given) {
              const one = await getPurchaseRequest(pid);
              if (!one.ok) return void toast.error(one.error);
              setLoaded(one.data ?? null);
            }
            const r = await purchaseRequestHistory(pid);
            if (r.ok) setHist(r.data ?? []);
            else toast.error(r.error);
          });
        }}
      >
        <History className="size-3.5" /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Phiếu {String(row.code ?? "")} · {String(row.type_name ?? "")}
            </DialogTitle>
            <DialogDescription>{String(row.title ?? "")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div className="text-muted-foreground">Số đề nghị</div>
            <div className="tabular-nums font-medium">{formatVND(num(row.amount_requested))}</div>
            <div className="text-muted-foreground">Số duyệt</div>
            <div className="tabular-nums font-medium">{formatVND(num(row.amount_approved))}</div>
            <div className="text-muted-foreground">Đã chi</div>
            <div className="tabular-nums font-medium">{formatVND(num(row.paid_amount))}</div>
            <div className="text-muted-foreground">Còn phải chi</div>
            <div className="tabular-nums font-medium">{formatVND(num(row.remaining_amount))}</div>
            <div className="text-muted-foreground">Người đề nghị</div>
            <div>{String(row.requester_name ?? "")}</div>
            <div className="text-muted-foreground">Người nhận tiền</div>
            <div>{String(row.payee ?? "—")}</div>
          </div>
          {items.length ? (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Hàng hóa / hạng mục</th>
                    <th className="px-2 py-1.5 text-right">SL</th>
                    <th className="px-2 py-1.5 text-left">ĐVT</th>
                    <th className="px-2 py-1.5 text-right">Đơn giá</th>
                    <th className="px-2 py-1.5 text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1">{it.name}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmt(Number(it.qty))}</td>
                      <td className="px-2 py-1">{it.unit ?? ""}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmt(Number(it.price))}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmt(Number(it.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div>
            <div className="mb-1 text-sm font-medium">Lịch sử</div>
            {loading && !hist ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Đang tải…
              </p>
            ) : hist && hist.length ? (
              <ol className="space-y-1.5 text-sm">
                {hist.map((h, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2 border-l-2 pl-2">
                    <span className="tabular-nums text-muted-foreground">{formatDateTime(h.acted_at)}</span>
                    <b>{HISTORY_LABEL[h.action] ?? h.action}</b>
                    <span>{h.actor_name ?? ""}</span>
                    {h.comment ? <span className="text-muted-foreground">· {h.comment}</span> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">Chưa có lịch sử.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Nút trên từng phiếu: Chi tiết, Chứng từ, Chi tiền, Hoàn tất, Hủy */
export function PurchaseRowActions({ row, onDone }: RowActionProps) {
  const [mode, setMode] = useState<"pay" | "complete" | "cancel" | null>(null);
  const remaining = num(row.remaining_amount) ?? 0;
  const [amount, setAmount] = useState<number | null>(remaining || null);
  const [method, setMethod] = useState("");
  const [bank, setBank] = useState("");
  const [ref, setRef] = useState("");
  const [paidAt, setPaidAt] = useState(todayVN());
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const close = () => !pending && setMode(null);
  return (
    <>
      <PurchaseDetailButton row={row} />
      <DocumentsButton entityType="purchase_request" entityId={String(row.id)} count={Number(row.file_count ?? 0)} title={`Chứng từ phiếu ${String(row.code)}`} canUpload />
      {row.can_pay ? (
        <Button
          size="sm"
          className="h-7 px-2"
          onClick={() => {
            setAmount(remaining || null);
            setMode("pay");
          }}
          aria-label={`Chi tiền ${String(row.code)}`}
        >
          <Send className="size-3.5" /> Chi tiền
        </Button>
      ) : null}
      {row.can_complete ? (
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setMode("complete")} aria-label={`Hoàn tất ${String(row.code)}`}>
          <CheckCheck className="size-3.5" /> Hoàn tất
        </Button>
      ) : null}
      {row.can_cancel ? (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => setMode("cancel")} aria-label={`Hủy ${String(row.code)}`}>
          <Ban className="size-3.5" /> Hủy
        </Button>
      ) : null}
      <Dialog open={mode !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {mode === "pay" ? "Ghi nhận chi tiền" : mode === "complete" ? "Hoàn tất phiếu" : "Hủy phiếu"} {String(row.code)}
            </DialogTitle>
            <DialogDescription>
              {String(row.title ?? "")} · Duyệt <b>{formatVND(num(row.amount_to_pay))}</b>, đã chi <b>{formatVND(num(row.paid_amount))}</b>.
              {mode === "pay" ? " Chi một lần hoặc nhiều lần (đặt cọc, thanh toán đợt sau), tổng không vượt số đã duyệt." : null}
              {mode === "complete" ? " Dùng khi đã mua xong và chi ít hơn số duyệt: phiếu đóng lại với số đã chi." : null}
            </DialogDescription>
          </DialogHeader>
          {mode === "pay" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="prp-amount">Số tiền chi lần này *</Label>
                <MoneyField id="prp-amount" value={amount} onChange={setAmount} />
                <p className="text-xs text-muted-foreground">Còn được chi {formatVND(remaining)}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prp-date">Ngày chi</Label>
                <Input id="prp-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prp-method">Phương thức</Label>
                <ReferenceSelect id="prp-method" refKey="payment_methods" value={method} onChange={(v) => setMethod(v)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prp-bank">Tài khoản công ty chi</Label>
                <ReferenceSelect id="prp-bank" refKey="company_bank_accounts" value={bank} onChange={(v) => setBank(v)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prp-ref">Số giao dịch ngân hàng</Label>
                <Input id="prp-ref" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={100} placeholder="Ví dụ FT26305123456" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prp-note">Ghi chú</Label>
                <Input id="prp-note" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="VD: Đặt cọc 50%" />
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="prc-text">{mode === "cancel" ? "Lý do hủy *" : "Ghi chú (không bắt buộc)"}</Label>
              <Textarea
                id="prc-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={500}
                placeholder={mode === "cancel" ? "VD: Nhập nhầm, không cần mua nữa" : "VD: Mua được giá rẻ hơn báo giá"}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMode(null)} disabled={pending}>
              Đóng
            </Button>
            <Button
              variant={mode === "cancel" ? "destructive" : "default"}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const id = String(row.id);
                  if (mode === "pay") {
                    if (!amount) return void toast.error("Nhập số tiền chi");
                    const r = await payPurchaseRequest({
                      id,
                      amount,
                      paymentMethodId: method || undefined,
                      bankAccountId: bank || undefined,
                      referenceNo: ref.trim() || undefined,
                      paidAt: paidAt ? `${paidAt}T12:00:00+07:00` : undefined,
                      note: text.trim() || undefined,
                    });
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(`Đã ghi nhận chi tiền (phiếu chi ${r.data})`);
                  } else if (mode === "complete") {
                    const r = await completePurchaseRequest({ id, note: text.trim() || undefined });
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(r.message);
                  } else {
                    if (!text.trim()) return void toast.error("Nhập lý do hủy");
                    const r = await cancelPurchaseRequest({ id, reason: text });
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(r.message);
                  }
                  setText("");
                  setMode(null);
                  onDone();
                })
              }
            >
              {pending ? "Đang lưu…" : mode === "pay" ? "Xác nhận đã chi" : mode === "complete" ? "Hoàn tất phiếu" : "Xác nhận hủy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
