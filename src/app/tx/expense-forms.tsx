"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Receipt, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { uploadWithTicket } from "@/lib/driver-link/upload";
import { addExpense, addExpenseSheet, requestUploadTicket } from "./actions";
import { requestExpenseTicket, updateExpense } from "./tien/actions";
import { PhotoPicker, type PickedFile } from "./photo-picker";

export type ExpenseCategory = { id: string; name: string; group: string; requires_image: boolean; requires_approval: boolean };

/** Một dòng chi phí đang nhập trên điện thoại */
export type ExpenseLine = { key: string; cat: string; amount: number | null; note: string; files: PickedFile[] };

export const newLine = (): ExpenseLine => ({ key: crypto.randomUUID(), cat: "", amount: null, note: "", files: [] });

export const bigBtn = "flex h-14 w-full items-center justify-center gap-2 rounded-xl text-lg font-semibold disabled:opacity-60";

/** Ô tiền: chỉ nhận số, hiện dấu chấm phân cách hàng nghìn */
export function MoneyInput({ id, value, onChange, placeholder = "Ví dụ 2,000,000" }: { id: string; value: number | null; onChange: (v: number | null) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="numeric"
        className="h-14 pr-10 text-xl font-semibold tabular-nums"
        placeholder={placeholder}
        value={value ? value.toLocaleString("en-US") : ""}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, "").slice(0, 10));
          onChange(n > 0 ? n : null);
        }}
      />
      <span className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground">đ</span>
    </div>
  );
}

export function Err({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

/** Kiểm tra trước khi gửi; trả về lỗi đầu tiên */
export function lineError(l: ExpenseLine, categories: ExpenseCategory[], n: number | null, requireNewImage = true): string | null {
  const c = categories.find((x) => x.id === l.cat);
  const at = n === null ? "" : ` (khoản ${n})`;
  if (!c) return `Chọn loại chi phí${at}.`;
  if (!l.amount) return `Nhập số tiền${at}.`;
  if (c.requires_image && requireNewImage && !l.files.length) return `Loại "${c.name}" cần chụp hóa đơn / biên lai${at}.`;
  return null;
}

/** Gửi ảnh (nếu có) và trả về vé tải ảnh */
type TicketResult = { ok: true; ticket: string } | { ok: false; error: string };

export async function uploadLineFiles(getTicket: () => Promise<TicketResult>, files: PickedFile[], onProgress: (s: string) => void): Promise<{ ticket: string | null } | { error: string }> {
  if (!files.length) return { ticket: null };
  const t = await getTicket();
  if (!t.ok) return { error: t.error };
  try {
    onProgress(`Đang gửi ảnh hóa đơn 0/${files.length}…`);
    await uploadWithTicket(t.ticket, files.map((f) => ({ file: f.file, kind: f.kind })), (n) => onProgress(`Đang gửi ảnh hóa đơn ${n}/${files.length}…`));
  } catch (e) {
    return { error: (e as Error).message };
  }
  return { ticket: t.ticket };
}

/** Các ô của một khoản chi phí: loại, số tiền, ghi chú, ảnh hóa đơn */
export function ExpenseLineFields({
  line,
  idx,
  categories,
  onChange,
  imageHint,
  photos = true,
}: {
  line: ExpenseLine;
  idx: string;
  categories: ExpenseCategory[];
  onChange: (l: ExpenseLine) => void;
  imageHint?: string;
  /** Cấu hình tắt chụp ảnh: ẩn ô chụp hóa đơn */
  photos?: boolean;
}) {
  const c = categories.find((x) => x.id === line.cat);
  const groups = [...new Set(categories.map((x) => x.group))];
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`exp-cat-${idx}`} className="mb-1 block text-sm font-medium">Loại chi phí</label>
        <NativeSelect id={`exp-cat-${idx}`} value={line.cat} onChange={(e) => onChange({ ...line, cat: e.target.value })} className="h-12">
          <option value="">Chọn loại…</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {categories.filter((x) => x.group === g).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
        {c ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {!photos ? "" : c.requires_image ? "Bắt buộc chụp hóa đơn / biên lai. " : "Ảnh hóa đơn không bắt buộc. "}
            {c.requires_approval ? "Cần Giám đốc duyệt." : "Không cần duyệt."}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor={`exp-amount-${idx}`} className="mb-1 block text-sm font-medium">Số tiền</label>
        <MoneyInput id={`exp-amount-${idx}`} value={line.amount} onChange={(amount) => onChange({ ...line, amount })} placeholder="Ví dụ 150,000" />
      </div>
      <div>
        <label htmlFor={`exp-note-${idx}`} className="mb-1 block text-sm font-medium">Ghi chú (không bắt buộc)</label>
        <Textarea id={`exp-note-${idx}`} value={line.note} onChange={(e) => onChange({ ...line, note: e.target.value })} maxLength={500} placeholder="Ví dụ: BOT Bình Dương lượt đi" />
      </div>
      {photos ? (
        <>
          <PhotoPicker
            value={line.files}
            onChange={(files) => onChange({ ...line, files })}
            label="Chụp hóa đơn"
            kinds={[
              { value: "receipt", label: "Biên lai" },
              { value: "invoice", label: "Hóa đơn VAT" },
            ]}
          />
          {imageHint ? <p className="text-xs text-muted-foreground">{imageHint}</p> : null}
        </>
      ) : null}
    </div>
  );
}

/** Danh sách nhiều khoản chi phí (dùng trong bước Hoàn thành chuyến và Bổ sung chi phí) */
export function ExpenseLinesEditor({
  lines,
  onChange,
  categories,
  photos = true,
}: {
  lines: ExpenseLine[];
  onChange: (l: ExpenseLine[]) => void;
  categories: ExpenseCategory[];
  photos?: boolean;
}) {
  const total = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  return (
    <div className="space-y-3">
      {lines.map((l, i) => (
        <div key={l.key} data-expense-line={i + 1} className="rounded-xl border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">Khoản {i + 1}</span>
            {lines.length > 1 ? (
              <button type="button" aria-label={`Bỏ khoản ${i + 1}`} onClick={() => onChange(lines.filter((x) => x.key !== l.key))} className="rounded-lg p-1.5 text-destructive">
                <Trash2 className="size-4" />
              </button>
            ) : null}
          </div>
          <ExpenseLineFields line={l} idx={String(i + 1)} categories={categories} photos={photos} onChange={(n) => onChange(lines.map((x) => (x.key === l.key ? n : x)))} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...lines, newLine()])} className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed py-3 text-sm font-medium text-primary">
        <Plus className="size-4" /> Thêm khoản chi phí
      </button>
      {total > 0 ? (
        <p className="text-right text-sm">
          Tổng: <b className="tabular-nums">{total.toLocaleString("en-US")} đ</b>
        </p>
      ) : null}
    </div>
  );
}

/** Gửi lần lượt các khoản; trả về các khoản chưa gửi được và lỗi đầu tiên */
export async function submitLines(shipmentId: string, lines: ExpenseLine[], onProgress: (s: string) => void): Promise<{ failed: ExpenseLine[]; error: string | null }> {
  const failed: ExpenseLine[] = [];
  let error: string | null = null;
  for (const [i, l] of lines.entries()) {
    onProgress(`Đang lưu chi phí ${i + 1}/${lines.length}…`);
    const up = await uploadLineFiles(() => requestUploadTicket(shipmentId, "expense"), l.files, onProgress);
    if ("error" in up) {
      failed.push(l);
      error ??= up.error;
      continue;
    }
    // key của dòng dùng làm mã chống gửi trùng khi bấm gửi lại
    const r = await addExpense({ shipmentId, categoryId: l.cat, amount: l.amount!, note: l.note.trim() || undefined, ticket: up.ticket, clientRequestId: l.key });
    if (!r.ok) {
      failed.push(l);
      error ??= r.error;
    }
  }
  return { failed, error };
}

/** Bổ sung chi phí cho chuyến đã hoàn thành (khi văn phòng chưa đóng chuyến) */
export function AddExpenseButton({ shipmentId, code, categories, photos = true }: { shipmentId: string; code: string; categories: ExpenseCategory[]; photos?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<ExpenseLine[]>(() => [newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      setError(null);
      const bad = lines.map((l, i) => lineError(l, categories, lines.length > 1 ? i + 1 : null, photos)).find(Boolean);
      if (bad) return setError(bad);
      const r = await submitLines(shipmentId, lines, setProgress);
      setProgress(null);
      router.refresh();
      if (r.failed.length) {
        setLines(r.failed);
        return setError(`${r.error} Các khoản còn lại trên màn hình chưa lưu, bấm gửi lại.`);
      }
      setLines([newLine()]);
      setOpen(false);
    });
  }

  return (
    <>
      <button type="button" aria-label={`Bổ sung chi phí ${code}`} onClick={() => setOpen(true)} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border bg-card font-semibold">
        <Receipt className="size-5" /> Bổ sung chi phí
      </button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bổ sung chi phí chuyến {code}</DialogTitle>
            <DialogDescription>Nhập khoản bị sót. Sau khi văn phòng đóng chuyến sẽ không bổ sung được nữa.</DialogDescription>
          </DialogHeader>
          <ExpenseLinesEditor lines={lines} onChange={setLines} categories={categories} photos={photos} />
          <Err error={error} />
          <button type="button" disabled={pending} onClick={submit} className={`${bigBtn} bg-primary text-primary-foreground`}>
            {progress ?? (pending ? "Đang gửi…" : "Gửi chi phí")}
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

type EditableExpense = { id: string; code: string; amount: number; note: string | null; category_id: string; shipment_code: string; files: number };

/** Sửa khoản chi phí chưa duyệt: lưu thành khoản mới, khoản cũ chuyển Đã hủy */
export function EditExpenseButton({ expense, categories, photos = true }: { expense: EditableExpense; categories: ExpenseCategory[]; photos?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const init = (): ExpenseLine => ({ key: expense.id, cat: expense.category_id, amount: Number(expense.amount), note: (expense.note ?? "").replace(/\s*\(sửa từ [^)]+\)$/, ""), files: [] });
  const [line, setLine] = useState<ExpenseLine>(init);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      setError(null);
      const bad = lineError(line, categories, null, photos && expense.files === 0);
      if (bad) return setError(bad);
      const up = await uploadLineFiles(() => requestExpenseTicket(expense.id), line.files, setProgress);
      if ("error" in up) {
        setProgress(null);
        return setError(up.error);
      }
      setProgress("Đang lưu…");
      const r = await updateExpense({ expenseId: expense.id, categoryId: line.cat, amount: line.amount!, note: line.note.trim() || undefined, ticket: up.ticket });
      setProgress(null);
      if (!r.ok) return setError(r.error);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Sửa ${expense.code}`}
        onClick={() => {
          setLine(init());
          setError(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm"
      >
        <Pencil className="size-3.5" /> Sửa
      </button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sửa chi phí {expense.code}</DialogTitle>
            <DialogDescription>Chuyến {expense.shipment_code}. Khoản cũ được giữ lại ở trạng thái Đã hủy để kế toán đối chiếu.</DialogDescription>
          </DialogHeader>
          <ExpenseLineFields
            line={line}
            idx="edit"
            categories={categories}
            onChange={setLine}
            photos={photos}
            imageHint={expense.files > 0 ? `Không chụp lại thì giữ ${expense.files} ảnh cũ.` : undefined}
          />
          <Err error={error} />
          <button type="button" disabled={pending} onClick={submit} className={`${bigBtn} bg-primary text-primary-foreground`}>
            {progress ?? (pending ? "Đang lưu…" : "Lưu thay đổi")}
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Gửi thêm ảnh phiếu chi phí cho chuyến đã hoàn thành (văn phòng nhập chi phí theo phiếu) */
export function AddSheetButton({ shipmentId, code }: { shipmentId: string; code: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      setError(null);
      if (!files.length) return setError("Chụp ít nhất 1 ảnh phiếu chi phí.");
      const up = await uploadLineFiles(() => requestUploadTicket(shipmentId, "expense"), files, setProgress);
      if ("error" in up) {
        setProgress(null);
        return setError(up.error);
      }
      setProgress("Đang lưu…");
      const r = await addExpenseSheet({ shipmentId, ticket: up.ticket! });
      setProgress(null);
      if (!r.ok) return setError(r.error);
      setFiles([]);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" aria-label={`Gửi thêm phiếu chi phí ${code}`} onClick={() => setOpen(true)} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border bg-card font-semibold">
        <Receipt className="size-5" /> Gửi thêm phiếu chi phí
      </button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Gửi thêm phiếu chi phí chuyến {code}</DialogTitle>
            <DialogDescription>Chụp phiếu chi phí bị sót. Văn phòng nhập chi phí theo phiếu. Sau khi văn phòng đóng chuyến sẽ không gửi thêm được.</DialogDescription>
          </DialogHeader>
          <PhotoPicker value={files} onChange={setFiles} label="Chụp phiếu chi phí" kinds={[{ value: "receipt", label: "Phiếu chi phí" }]} />
          <Err error={error} />
          <button type="button" disabled={pending} onClick={submit} className={`${bigBtn} bg-primary text-primary-foreground`}>
            {progress ?? (pending ? "Đang gửi…" : "Gửi phiếu chi phí")}
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
