"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { CustomFieldsEditor } from "@/components/entities/custom-fields-editor";
import { AddFieldButton } from "@/components/entities/add-field-button";
import { moduleCustomFields } from "@/lib/entities/record";
import type { CustomFieldRow } from "@/lib/entities/types";
import { createAdvance, createExpense } from "@/lib/finance/actions";
import { uploadStaffDocuments } from "./upload";

export type CreateActionProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customRows: CustomFieldRow[];
  canAddField: boolean;
  onDone: () => void;
  /** Điền sẵn chuyến (khi mở từ trang chi tiết chuyến) */
  shipment?: { id: string; label: string; driverId?: string | null; driverLabel?: string | null };
  /** Giá trị điền sẵn từ tham số đường dẫn (?new=1&customer=…&shipment=…) */
  prefill?: Record<string, string>;
};

export function MoneyField({ id, value, onChange }: { id: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <Input
      id={id}
      inputMode="numeric"
      placeholder="Ví dụ 2,000,000"
      className="tabular-nums"
      value={value ? value.toLocaleString("en-US") : ""}
      onChange={(e) => {
        const n = Number(e.target.value.replace(/\D/g, "").slice(0, 13));
        onChange(n > 0 ? n : null);
      }}
    />
  );
}

export function Field({ label, htmlFor, help, children, wide }: { label: string; htmlFor: string; help?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );
}

export function CreateAdvanceDialog({ open, onOpenChange, customRows, canAddField, onDone }: CreateActionProps) {
  const fields = useMemo(() => moduleCustomFields("advances", customRows), [customRows]);
  const [driver, setDriver] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const rid = useRef(crypto.randomUUID());
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tạo yêu cầu ứng tiền</DialogTitle>
          <DialogDescription>Ứng tiền thay cho tài xế. Yêu cầu chuyển Giám đốc duyệt, sau đó kế toán ghi nhận chuyển tiền.</DialogDescription>
        </DialogHeader>
        {canAddField ? (
          <div>
            <AddFieldButton module="advances" entityKey="advances" customRows={customRows} label="Thêm trường cho biểu mẫu này" />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tài xế *" htmlFor="adv-driver">
            <ReferenceSelect id="adv-driver" refKey="drivers" value={driver} onChange={(v) => setDriver(v)} />
          </Field>
          <Field label="Số tiền *" htmlFor="adv-amount">
            <MoneyField id="adv-amount" value={amount} onChange={setAmount} />
          </Field>
          <Field label="Lý do *" htmlFor="adv-reason" wide help="Ví dụ: Ứng dầu và cầu đường cho tuần 43">
            <Input id="adv-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
          <Field label="Ghi chú" htmlFor="adv-note" wide>
            <Textarea id="adv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </Field>
        </div>
        <CustomFieldsEditor fields={fields} idPrefix="adv-cf-" onChange={setCustom} className="lg:grid-cols-2" />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Đóng
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (!driver) return void toast.error("Chọn tài xế");
                if (!amount) return void toast.error("Nhập số tiền");
                const r = await createAdvance({ driverId: driver, amount, reason, note: note.trim() || undefined, custom, clientRequestId: rid.current });
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.message);
                onDone();
              })
            }
          >
            {pending ? "Đang gửi…" : "Gửi duyệt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ExpenseLine = { key: number; categoryId: string; amount: number | null; note: string; files: File[]; rid: string };
let expenseSeq = 0;
const newExpenseLine = (): ExpenseLine => ({ key: ++expenseSeq, categoryId: "", amount: null, note: "", files: [], rid: crypto.randomUUID() });

export function CreateExpenseDialog({ open, onOpenChange, customRows, canAddField, onDone, shipment }: CreateActionProps) {
  const fields = useMemo(() => moduleCustomFields("expenses", customRows), [customRows]);
  const [ship, setShip] = useState(shipment?.id ?? "");
  // Nhiều khoản chi cùng lúc: mỗi dòng một loại chi phí, số tiền, ghi chú, hóa đơn riêng
  const [lines, setLines] = useState<ExpenseLine[]>(() => [newExpenseLine()]);
  const [date, setDate] = useState("");
  const [paidBy, setPaidBy] = useState<"driver" | "company">("company");
  const [driver, setDriver] = useState(shipment?.driverId ?? "");
  const [supplier, setSupplier] = useState("");
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileFor, setFileFor] = useState<number | null>(null);
  const patchLine = (key: number, p: Partial<ExpenseLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const total = lines.reduce((a, l) => a + (l.amount ?? 0), 0);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nhập chi phí chuyến</DialogTitle>
          <DialogDescription>
            Nhập được nhiều khoản cùng lúc. Loại chi phí cần duyệt sẽ chuyển Giám đốc duyệt ở menu Phê duyệt; loại đã tắt duyệt được ghi nhận ngay.
          </DialogDescription>
        </DialogHeader>
        {canAddField ? (
          <div>
            <AddFieldButton module="expenses" entityKey="expenses" customRows={customRows} label="Thêm trường cho biểu mẫu này" />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Chuyến *" htmlFor="exp-ship" help="Gõ mã chuyến, khách hàng hoặc biển số để tìm">
            <ReferenceSelect id="exp-ship" refKey="shipment_ref" value={ship} initialLabel={shipment?.label} allowQuickCreate={false} onChange={(v) => setShip(v)} />
          </Field>
          <Field label="Ngày phát sinh" htmlFor="exp-date" help="Để trống là hôm nay">
            <Input id="exp-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Nguồn chi" htmlFor="exp-paidby" help="Chi bởi tài xế: được cộng lại cho tài xế khi đối soát lương cuối tháng">
            <NativeSelect id="exp-paidby" value={paidBy} onChange={(e) => setPaidBy(e.target.value as "driver" | "company")}>
              <option value="company">Chi bởi công ty</option>
              <option value="driver">Chi bởi tài xế</option>
            </NativeSelect>
          </Field>
          {paidBy === "company" ? (
            <Field label="Nhà thầu nhận tiền" htmlFor="exp-supplier" help="Không bắt buộc. Ví dụ tổ bốc xếp, bãi nâng hạ; dùng để đối chiếu và lập công nợ phải trả nhà thầu">
              <ReferenceSelect id="exp-supplier" refKey="suppliers" value={supplier} onChange={(v) => setSupplier(v)} />
            </Field>
          ) : null}
          <Field label="Tài xế" htmlFor="exp-driver" help="Để trống là tài xế của chuyến">
            <ReferenceSelect id="exp-driver" refKey="drivers" value={driver} initialLabel={shipment?.driverLabel ?? undefined} onChange={(v) => setDriver(v)} />
          </Field>
        </div>
        <div className="space-y-2 rounded-lg border p-2.5">
          <div className="text-sm font-medium">
            Các khoản chi <span className="font-normal text-muted-foreground">· nhiều khoản thì bấm Thêm khoản chi, mỗi dòng một khoản</span>
          </div>
          <div className="hidden gap-1.5 text-[11px] text-muted-foreground sm:grid sm:grid-cols-[minmax(0,12rem)_8.5rem_minmax(0,1fr)_auto_auto]">
            <span>Loại chi phí *</span>
            <span className="text-right">Số tiền (đ) *</span>
            <span>Ghi chú</span>
            <span>Hóa đơn</span>
            <span className="sr-only">Xóa</span>
          </div>
          {lines.map((l, i) => (
            <div key={l.key} className="grid grid-cols-2 items-center gap-1.5 sm:grid-cols-[minmax(0,12rem)_8.5rem_minmax(0,1fr)_auto_auto]">
              <div className="col-span-full sm:col-span-1">
                <ReferenceSelect id={`exp-cat-${l.key}`} refKey="expense_categories" value={l.categoryId} onChange={(v) => patchLine(l.key, { categoryId: v })} />
              </div>
              <MoneyField id={`exp-amount-${l.key}`} value={l.amount} onChange={(v) => patchLine(l.key, { amount: v })} />
              <Input
                className="h-9"
                aria-label={`Ghi chú khoản ${i + 1}`}
                placeholder="VD: BOT Bình Dương lượt đi"
                maxLength={1000}
                value={l.note}
                onChange={(e) => patchLine(l.key, { note: e.target.value })}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                title={l.files.length ? l.files.map((f) => f.name).join(", ") : "Ảnh hoặc PDF, tối đa 10 tệp, 10 MB mỗi tệp (không bắt buộc)"}
                onClick={() => {
                  setFileFor(l.key);
                  fileRef.current?.click();
                }}
              >
                <Upload /> {l.files.length ? `${l.files.length} tệp` : "Tệp"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-destructive"
                aria-label={`Xóa khoản ${i + 1}`}
                disabled={lines.length === 1}
                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, newExpenseLine()])} disabled={lines.length >= 30}>
              <Plus /> Thêm khoản chi
            </Button>
            <span className="text-sm">
              Tổng: <b className="tabular-nums">{total.toLocaleString("en-US")} ₫</b>
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            aria-label="Chọn hóa đơn, biên lai"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []).filter((f) => f.size <= 10 * 1024 * 1024).slice(0, 10);
              if (fileFor !== null) patchLine(fileFor, { files: picked });
              e.target.value = "";
            }}
          />
        </div>
        <CustomFieldsEditor fields={fields} idPrefix="exp-cf-" onChange={setCustom} className="lg:grid-cols-2" />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Đóng
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (!ship) return void toast.error("Chọn chuyến");
                const todo = lines.filter((l) => l.categoryId || l.amount || l.note.trim() || l.files.length);
                if (!todo.length) return void toast.error("Nhập ít nhất một khoản chi");
                const bad = todo.findIndex((l) => !l.categoryId || !l.amount);
                if (bad >= 0) return void toast.error(`Khoản ${bad + 1}: chọn loại chi phí và nhập số tiền`);
                let saved = 0;
                for (const l of todo) {
                  const r = await createExpense({
                    shipmentId: ship,
                    categoryId: l.categoryId,
                    amount: l.amount!,
                    incurredAt: date || undefined,
                    paidBy,
                    supplierId: paidBy === "company" && supplier ? supplier : undefined,
                    driverId: driver || undefined,
                    note: l.note.trim() || undefined,
                    custom,
                    clientRequestId: l.rid,
                  });
                  if (!r.ok) {
                    // Bỏ các khoản đã lưu khỏi form để bấm Lưu lại không bị trùng
                    const done = new Set(todo.slice(0, saved).map((x) => x.key));
                    setLines((ls) => ls.filter((x) => !done.has(x.key)));
                    return void toast.error(saved ? `Đã lưu ${saved} khoản; khoản tiếp theo lỗi: ${r.error}` : r.error);
                  }
                  saved++;
                  if (l.files.length && r.data) {
                    const u = await uploadStaffDocuments("shipment_expense", r.data, l.files.map((file) => ({ file, docType: "receipt" as const })));
                    if (!u.ok) toast.error(`Đã lưu khoản ${saved} nhưng ${u.error.toLowerCase()}`);
                  }
                }
                toast.success(saved > 1 ? `Đã lưu ${saved} khoản chi` : "Đã lưu chi phí");
                onDone();
              })
            }
          >
            {pending ? "Đang lưu…" : "Lưu chi phí"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
