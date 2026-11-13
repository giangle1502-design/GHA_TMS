"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { formatVND, todayVN } from "@/lib/format";
import { decideApproval, payAdvance } from "@/lib/finance/actions";
import { DocumentsButton } from "./documents-button";
import { PurchaseDetailButton } from "./purchase-dialogs";

type Row = Record<string, unknown>;
export type RowActionProps = { row: Row; onDone: () => void };

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Duyệt / Từ chối trên danh sách phê duyệt (chỉ hiện khi người xem đúng cấp duyệt) */
export function ApprovalRowActions({ row, onDone }: RowActionProps) {
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const [amount, setAmount] = useState<number | null>(num(row.amount));
  const [pending, start] = useTransition();
  const isAdvance = row.entity_type === "advance_request";
  const isPurchase = row.entity_type === "purchase_request";
  // Duyệt ít hơn số xin: ứng tiền và phiếu đề nghị chi
  const amountEditable = isAdvance || isPurchase;
  const isTrip = row.entity_type === "shipment_dispatch";
  const isLeave = row.entity_type === "leave_request";
  const docType =
    row.entity_type === "shipment_expense" || row.entity_type === "advance_request" || row.entity_type === "purchase_request"
      ? (row.entity_type as "shipment_expense" | "advance_request" | "purchase_request")
      : null;
  return (
    <>
      {isTrip && row.entity_id ? (
        <Button asChild size="sm" variant="ghost" className="h-7 px-2">
          <Link href={`/chuyen-xe/${String(row.entity_id)}`}>Xem chuyến</Link>
        </Button>
      ) : null}
      {isLeave ? (
        <Button asChild size="sm" variant="ghost" className="h-7 px-2">
          <Link href="/nghi-phep?tab=leave_requests&f_can_approve=true">Xem đơn nghỉ</Link>
        </Button>
      ) : null}
      {isPurchase && row.entity_id ? <PurchaseDetailButton id={String(row.entity_id)} label="Xem phiếu" /> : null}
      {docType && Number(row.file_count) > 0 ? (
        <DocumentsButton entityType={docType} entityId={String(row.entity_id)} count={Number(row.file_count)} title={`Chứng từ ${String(row.code)}`} />
      ) : null}
      {row.can_approve ? (
        <>
          <Button size="sm" className="h-7 px-2" onClick={() => setMode("approve")} aria-label={`Duyệt ${String(row.code)}`}>
            <Check className="size-3.5" /> Duyệt
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-destructive" onClick={() => setMode("reject")} aria-label={`Từ chối ${String(row.code)}`}>
            <X className="size-3.5" /> Từ chối
          </Button>
        </>
      ) : null}
      <Dialog open={mode !== null} onOpenChange={(o) => !o && !pending && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "approve" ? "Duyệt yêu cầu" : "Từ chối yêu cầu"}</DialogTitle>
            <DialogDescription>{String(row.content ?? "")}</DialogDescription>
          </DialogHeader>
          {isLeave ? (
            <p className="text-sm">Người gửi: {String(row.requester_name ?? "")}. Xem bàn giao ở mục Xin nghỉ, bàn giao.</p>
          ) : (
            <p className="text-sm">
              {isTrip ? "Doanh thu chuyến" : "Số tiền xin"}: <b>{formatVND(num(row.amount))}</b> · Người gửi: {String(row.requester_name ?? "")}
            </p>
          )}
          {mode === "approve" && amountEditable ? (
            <div className="space-y-1.5">
              <Label htmlFor="approve-amount">Số tiền duyệt</Label>
              <Input
                id="approve-amount"
                inputMode="numeric"
                value={amount ? amount.toLocaleString("en-US") : ""}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/\D/g, "").slice(0, 13));
                  setAmount(n > 0 ? n : null);
                }}
              />
              <p className="text-xs text-muted-foreground">Có thể duyệt ít hơn số tiền xin. Không được vượt số tiền xin.</p>
              {isPurchase ? <p className="text-xs text-muted-foreground">Kế toán chỉ chi được tối đa số tiền duyệt.</p> : null}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="approve-comment">{mode === "reject" ? "Lý do từ chối *" : "Ghi chú (không bắt buộc)"}</Label>
            <Textarea id="approve-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} placeholder={mode === "reject" ? "Ví dụ: Thiếu hóa đơn, đã ứng đủ trong tuần" : ""} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMode(null)} disabled={pending}>
              Đóng
            </Button>
            <Button
              variant={mode === "reject" ? "destructive" : "default"}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await decideApproval({
                    requestId: String(row.id),
                    action: mode!,
                    comment: comment.trim() || undefined,
                    amount: mode === "approve" && amountEditable && amount && amount !== num(row.amount) ? amount : undefined,
                  });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.message);
                  setMode(null);
                  onDone();
                })
              }
            >
              {pending ? "Đang lưu…" : mode === "approve" ? "Xác nhận duyệt" : "Xác nhận từ chối"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Kế toán ghi nhận đã chuyển tiền ứng cho tài xế */
export function AdvanceRowActions({ row, onDone }: RowActionProps) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("");
  const [bank, setBank] = useState("");
  const [ref, setRef] = useState("");
  const [paidAt, setPaidAt] = useState(todayVN());
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  if (!row.can_pay) return null;
  return (
    <>
      <Button size="sm" className="h-7 px-2" onClick={() => setOpen(true)} aria-label={`Chuyển tiền ${String(row.code)}`}>
        <Send className="size-3.5" /> Chuyển tiền
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ghi nhận chuyển tiền ứng {String(row.code)}</DialogTitle>
            <DialogDescription>
              Chuyển <b>{formatVND(num(row.amount_to_pay))}</b> cho tài xế {String(row.driver_name ?? "")}. Sau khi lưu không sửa được số tiền; khoản ứng sẽ được trừ khi đối soát lương cuối tháng.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-method">Phương thức</Label>
              <ReferenceSelect id="pay-method" refKey="payment_methods" value={method} onChange={(v) => setMethod(v)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-bank">Tài khoản công ty chuyển</Label>
              <ReferenceSelect id="pay-bank" refKey="company_bank_accounts" value={bank} onChange={(v) => setBank(v)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-ref">Số giao dịch ngân hàng</Label>
              <Input id="pay-ref" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={100} placeholder="Ví dụ FT26295123456" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">Ngày chuyển</Label>
              <Input id="pay-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pay-note">Ghi chú</Label>
              <Textarea id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Đóng
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await payAdvance({
                    advanceId: String(row.id),
                    paymentMethodId: method || undefined,
                    bankAccountId: bank || undefined,
                    referenceNo: ref.trim() || undefined,
                    paidAt: paidAt ? `${paidAt}T12:00:00+07:00` : undefined,
                    note: note.trim() || undefined,
                  });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(`Đã ghi nhận chuyển tiền (phiếu chi ${r.data})`);
                  setOpen(false);
                  onDone();
                })
              }
            >
              {pending ? "Đang lưu…" : "Xác nhận đã chuyển"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ExpenseRowActions({ row }: RowActionProps) {
  return <DocumentsButton entityType="shipment_expense" entityId={String(row.id)} count={Number(row.file_count ?? 0)} title={`Chứng từ ${String(row.code)}`} />;
}
