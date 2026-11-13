"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Ban, FilePlus2, HandCoins, History, Send, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { formatDateTime, formatVND, todayVN } from "@/lib/format";
import { cancelDebt, cancelPayroll, listDebtPayments, payPayroll, recordDebtPayment, voidPayment, type DebtPayment } from "@/lib/finance/actions";
import { MoneyField } from "./create-dialogs";
import type { RowActionProps } from "./row-actions";

const num = (v: unknown) => Number(v ?? 0);

type PayInfo = {
  method: string;
  bank: string;
  ref: string;
  paidAt: string;
  note: string;
};

/** Ô nhập chung khi ghi nhận tiền ra/vào: phương thức, tài khoản công ty, số giao dịch, ngày, ghi chú */
function PayFields({ v, set, prefix, bankLabel }: { v: PayInfo; set: (p: Partial<PayInfo>) => void; prefix: string; bankLabel: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-method`}>Phương thức</Label>
        <ReferenceSelect id={`${prefix}-method`} refKey="payment_methods" value={v.method} onChange={(x) => set({ method: x })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-bank`}>{bankLabel}</Label>
        <ReferenceSelect id={`${prefix}-bank`} refKey="company_bank_accounts" value={v.bank} onChange={(x) => set({ bank: x })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-ref`}>Số giao dịch ngân hàng</Label>
        <Input id={`${prefix}-ref`} value={v.ref} onChange={(e) => set({ ref: e.target.value })} maxLength={100} placeholder="Ví dụ FT26295123456" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-date`}>Ngày</Label>
        <Input id={`${prefix}-date`} type="date" value={v.paidAt} onChange={(e) => set({ paidAt: e.target.value })} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${prefix}-note`}>Ghi chú</Label>
        <Textarea id={`${prefix}-note`} value={v.note} onChange={(e) => set({ note: e.target.value })} maxLength={1000} />
      </div>
    </div>
  );
}

function usePayInfo() {
  const [v, setV] = useState<PayInfo>({ method: "", bank: "", ref: "", paidAt: todayVN(), note: "" });
  return [v, (p: Partial<PayInfo>) => setV((o) => ({ ...o, ...p }))] as const;
}

const payPayload = (v: PayInfo) => ({
  paymentMethodId: v.method || undefined,
  bankAccountId: v.bank || undefined,
  referenceNo: v.ref.trim() || undefined,
  paidAt: v.paidAt ? `${v.paidAt}T12:00:00+07:00` : undefined,
  note: v.note.trim() || undefined,
});

/** Hộp nhập lý do rồi xác nhận (hủy bảng lương, hủy công nợ, hủy phiếu) */
function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  confirm: string;
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reason-input">Lý do *</Label>
          <Textarea id="reason-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ví dụ: Ghi nhầm số tiền" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Đóng
          </Button>
          <Button
            variant="destructive"
            disabled={pending || !reason.trim()}
            onClick={() => start(async () => void ((await onConfirm(reason.trim())) && onOpenChange(false)))}
          >
            {pending ? "Đang lưu…" : confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Bảng lương: Trả lương (đã duyệt), Hủy (chưa trả) */
export function PayrollRowActions({ row, onDone }: RowActionProps) {
  const [open, setOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [v, set] = usePayInfo();
  const [pending, start] = useTransition();
  return (
    <>
      {row.can_pay ? (
        <Button size="sm" className="h-7 px-2" onClick={() => setOpen(true)} aria-label={`Trả lương ${String(row.code)}`}>
          <Send className="size-3.5" /> Trả lương
        </Button>
      ) : null}
      {row.can_cancel ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-destructive"
          onClick={() => setCancelOpen(true)}
          aria-label={`Hủy bảng lương ${String(row.code)}`}
        >
          <Ban className="size-3.5" /> Hủy
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trả lương {String(row.code)}</DialogTitle>
            <DialogDescription>
              Trả <b>{formatVND(num(row.net_amount))}</b> cho tài xế {String(row.driver_name ?? "")}
              {num(row.advance_offset) > 0 ? <> và cấn trừ {formatVND(num(row.advance_offset))} tiền đã ứng</> : null}. Sau khi lưu không sửa được.
            </DialogDescription>
          </DialogHeader>
          <PayFields v={v} set={set} prefix="prpay" bankLabel="Tài khoản công ty chuyển" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Đóng
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await payPayroll({ id: String(row.id), ...payPayload(v) });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(`Đã ghi nhận trả lương (${r.data})`);
                  setOpen(false);
                  onDone();
                })
              }
            >
              {pending ? "Đang lưu…" : "Xác nhận đã trả"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {cancelOpen ? (
        <ReasonDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          title={`Hủy bảng lương ${String(row.code)}`}
          description="Chi phí tự trả trong bảng lương được trả lại để lập bảng mới. Yêu cầu phê duyệt cũng bị hủy."
          confirm="Hủy bảng lương"
          onConfirm={async (reason) => {
            const r = await cancelPayroll({ id: String(row.id), reason });
            if (!r.ok) {
              toast.error(r.error);
              return false;
            }
            toast.success(r.message);
            onDone();
            return true;
          }}
        />
      ) : null}
    </>
  );
}

/** Lịch sử phiếu thu/chi của một công nợ, hủy phiếu ghi nhầm */
function DebtHistory({ kind, row, onDone }: { kind: "receivable" | "payable"; row: RowActionProps["row"]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<DebtPayment[] | null>(null);
  const [voiding, setVoiding] = useState<DebtPayment | null>(null);
  const load = async () => {
    const r = await listDebtPayments(kind, String(row.id));
    if (!r.ok) return void toast.error(r.error);
    setItems(r.data ?? []);
  };
  if (num(row.paid_amount) <= 0 && row.status !== "partial" && row.status !== "paid") return null;
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2"
        onClick={() => {
          setOpen(true);
          void load();
        }}
        aria-label={`Lịch sử ${String(row.code)}`}
      >
        <History className="size-3.5" /> Lịch sử
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {kind === "receivable" ? "Các lần thu" : "Các lần trả"} {String(row.code)}
            </DialogTitle>
            <DialogDescription>
              Tổng {formatVND(num(row.amount))} · {kind === "receivable" ? "đã thu" : "đã trả"} {formatVND(num(row.paid_amount))} · còn{" "}
              {formatVND(num(row.remaining_amount))}
            </DialogDescription>
          </DialogHeader>
          {items === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Đang tải…</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Chưa có phiếu nào.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {items.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className={p.status === "voided" ? "text-muted-foreground line-through" : "font-medium"}>
                      {p.code} · {formatVND(Number(p.amount))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(p.paid_at)}
                      {p.reference_no ? ` · ${p.reference_no}` : ""}
                      {p.status === "voided" ? ` · Đã hủy: ${p.void_reason ?? ""}` : ""}
                    </div>
                  </div>
                  {p.can_void ? (
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => setVoiding(p)}>
                      Hủy phiếu
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      {voiding ? (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setVoiding(null)}
          title={`Hủy phiếu ${voiding.code}`}
          description={`Phiếu ${formatVND(Number(voiding.amount))} được đánh dấu hủy (không xóa), số tiền được cộng lại vào công nợ.`}
          confirm="Hủy phiếu"
          onConfirm={async (reason) => {
            const r = await voidPayment({ id: voiding.id, reason });
            if (!r.ok) {
              toast.error(r.error);
              return false;
            }
            toast.success(r.message);
            await load();
            onDone();
            return true;
          }}
        />
      ) : null}
    </>
  );
}

function DebtRowActions({ kind, row, onDone }: RowActionProps & { kind: "receivable" | "payable" }) {
  const [open, setOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(num(row.remaining_amount) || null);
  const [v, set] = usePayInfo();
  const [pending, start] = useTransition();
  const verb = kind === "receivable" ? "Thu tiền" : "Trả tiền";
  return (
    <>
      <DebtHistory kind={kind} row={row} onDone={onDone} />
      {row.can_pay ? (
        <Button size="sm" className="h-7 px-2" onClick={() => setOpen(true)} aria-label={`${verb} ${String(row.code)}`}>
          <HandCoins className="size-3.5" /> {verb}
        </Button>
      ) : null}
      {row.can_cancel ? (
        <Button
          size="icon"
          variant="ghost"
          className="size-7 text-destructive"
          onClick={() => setCancelOpen(true)}
          aria-label={`Hủy công nợ ${String(row.code)}`}
          title="Hủy công nợ"
        >
          <Ban className="size-3.5" />
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {verb} {String(row.code)}
            </DialogTitle>
            <DialogDescription>
              {String(kind === "receivable" ? (row.customer_name ?? "") : (row.partner_name ?? ""))} · còn {kind === "receivable" ? "phải thu" : "phải trả"}{" "}
              <b>{formatVND(num(row.remaining_amount))}</b>. Có thể {kind === "receivable" ? "thu" : "trả"} một phần, nhiều lần.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="debt-amount">Số tiền lần này *</Label>
            <MoneyField id="debt-amount" value={amount} onChange={setAmount} />
          </div>
          <PayFields v={v} set={set} prefix="debt" bankLabel={kind === "receivable" ? "Tài khoản công ty nhận" : "Tài khoản công ty chuyển"} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Đóng
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  if (!amount) return void toast.error("Nhập số tiền");
                  const r = await recordDebtPayment({ kind, id: String(row.id), amount, ...payPayload(v) });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(`${r.message} (${r.data})`);
                  setOpen(false);
                  onDone();
                })
              }
            >
              {pending ? "Đang lưu…" : `Xác nhận ${verb.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {cancelOpen ? (
        <ReasonDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          title={`Hủy công nợ ${String(row.code)}`}
          description={kind === "receivable" ? "Các chuyến trong công nợ này sẽ quay lại danh sách chưa lập công nợ." : "Công nợ được đánh dấu hủy, không xóa."}
          confirm="Hủy công nợ"
          onConfirm={async (reason) => {
            const r = await cancelDebt({ kind, id: String(row.id), reason });
            if (!r.ok) {
              toast.error(r.error);
              return false;
            }
            toast.success(r.message);
            onDone();
            return true;
          }}
        />
      ) : null}
    </>
  );
}

export const ReceivableRowActions = (p: RowActionProps) => <DebtRowActions kind="receivable" {...p} />;
export const PayableRowActions = (p: RowActionProps) => <DebtRowActions kind="payable" {...p} />;

/** Chuyến chưa lập công nợ: mở biểu mẫu lập công nợ điền sẵn khách hàng và chuyến */
export function BillingRowActions({ row }: RowActionProps) {
  return (
    <Button asChild size="sm" className="h-7 px-2">
      <Link
        href={`/cong-no?tab=receivables&new=1&customer=${String(row.customer_id)}&shipment=${String(row.id)}`}
        aria-label={`Lập công nợ ${String(row.shipment_code)}`}
      >
        <FilePlus2 className="size-3.5" /> Lập công nợ
      </Link>
    </Button>
  );
}

/** Phiếu thu/chi: hủy phiếu thu/chi công nợ ghi nhầm */
export function PaymentRowActions({ row, onDone }: RowActionProps) {
  const [open, setOpen] = useState(false);
  if (!row.can_void) return null;
  return (
    <>
      <Button size="sm" variant="outline" className="h-7 px-2 text-destructive" onClick={() => setOpen(true)} aria-label={`Hủy phiếu ${String(row.code)}`}>
        <Ban className="size-3.5" /> Hủy phiếu
      </Button>
      {open ? (
        <ReasonDialog
          open
          onOpenChange={setOpen}
          title={`Hủy phiếu ${String(row.code)}`}
          description={`Phiếu ${formatVND(num(row.amount))} được đánh dấu hủy (không xóa), số tiền được cộng lại vào công nợ.`}
          confirm="Hủy phiếu"
          onConfirm={async (reason) => {
            const r = await voidPayment({ id: String(row.id), reason });
            if (!r.ok) {
              toast.error(r.error);
              return false;
            }
            toast.success(r.message);
            onDone();
            return true;
          }}
        />
      ) : null}
    </>
  );
}

/** Báo cáo chuyến 3PL: mở chi phí 3PL của chuyến; trả tiền, xem lịch sử trả của công nợ 3PL */
export function CarrierRowActions({ row, onDone }: RowActionProps) {
  const payable = row.payable_id
    ? { ...row, id: row.payable_id, code: row.payable_code, status: row.pay_status === "unpaid" ? "open" : row.pay_status }
    : null;
  return (
    <>
      <Button asChild size="sm" variant="outline" className="h-7 px-2">
        <Link href={`/chuyen-xe/${String(row.id)}#chi-phi-3pl`} aria-label={`Chi phí 3PL ${String(row.shipment_code)}`}>
          <Truck className="size-3.5" /> {row.pay_status === "no_cost" ? "Nhập chi phí" : "Chi phí"}
        </Link>
      </Button>
      {payable ? <DebtRowActions kind="payable" row={payable} onDone={onDone} /> : null}
    </>
  );
}
