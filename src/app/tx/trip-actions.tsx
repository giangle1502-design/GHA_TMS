"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Flag, Play, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { uploadWithTicket } from "@/lib/driver-link/upload";
import { acceptTrip, changeVehicle, completeTrip, requestUploadTicket, startTrip } from "./actions";
import { PhotoPicker, type PickedFile } from "./photo-picker";
import type { DriverAppSettings } from "@/lib/driver-link/settings";
import { ExpenseLinesEditor, lineError, newLine, submitLines, type ExpenseCategory, type ExpenseLine } from "./expense-forms";

export function AcceptButton({ shipmentId, code }: { shipmentId: string; code: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={pending}
        aria-label={`Nhận đơn ${code}`}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await acceptTrip(shipmentId);
            if (!r.ok) setError(r.error);
            router.refresh();
          })
        }
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-success text-lg font-semibold text-white disabled:opacity-60"
      >
        <CheckCircle2 className="size-6" /> {pending ? "Đang gửi…" : "Nhận đơn"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ChangeVehicleButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await changeVehicle();
          router.refresh();
        })
      }
      className="rounded-lg border px-3 py-1.5 text-sm"
    >
      Đổi xe
    </button>
  );
}

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="mt-2 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">
      {error}
    </p>
  ) : null;
}

export function StartButton({ shipmentId, code }: { shipmentId: string; code: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={pending}
        aria-label={`Bắt đầu chạy ${code}`}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await startTrip(shipmentId);
            if (!r.ok) setError(r.error);
            router.refresh();
          })
        }
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-lg font-semibold text-primary-foreground disabled:opacity-60"
      >
        <Play className="size-6" /> {pending ? "Đang gửi…" : "Bắt đầu chạy"}
      </button>
      <ErrorText error={error} />
    </div>
  );
}

const RESULTS = [
  { value: "full", label: "Giao đủ" },
  { value: "partial", label: "Giao thiếu" },
  { value: "failed", label: "Không giao được" },
] as const;

export function CompleteButton({
  shipmentId,
  code,
  categories,
  outsourced = false,
  settings,
  podPhotoRequired,
}: {
  shipmentId: string;
  code: string;
  categories: ExpenseCategory[];
  outsourced?: boolean;
  settings: DriverAppSettings;
  /** Đơn yêu cầu chụp chứng từ (điều phối chọn khi tạo đơn) */
  podPhotoRequired: boolean;
}) {
  const photos = settings.photos_enabled;
  // Đơn không yêu cầu chụp chứng từ: bỏ qua bước chụp ảnh giao hàng
  const photoRequired = photos && podPhotoRequired;
  // Tắt nhập chi phí (Cấu hình) hoặc xe 3PL: không hỏi chi phí
  const askExpense = settings.expense_enabled && !outsourced;
  // Có chi phí: chụp phiếu chi phí, văn phòng nhập theo phiếu (thay cho tài xế nhập từng khoản)
  const sheetMode = askExpense && settings.expense_sheet_photo;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [result, setResult] = useState<(typeof RESULTS)[number]["value"]>("full");
  const [note, setNote] = useState("");
  // Chế độ phiếu chi phí: mặc định "Có chi phí"
  const [expenseMode, setExpenseMode] = useState<"has" | "none" | null>(settings.expense_enabled && settings.expense_sheet_photo ? "has" : null);
  const [sheets, setSheets] = useState<PickedFile[]>([]);
  const [lines, setLines] = useState<ExpenseLine[]>(() => [newLine()]);
  // Chuyến đã lưu hoàn thành nhưng còn khoản chi phí chưa gửi được: bấm lại chỉ gửi chi phí
  const [completed, setCompleted] = useState(false);
  // Đã gửi xong (hoàn thành + chi phí): chuyển sang màn hình "đã hoàn thành" có nút Tìm chuyến khác
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      setError(null);
      if (!completed) {
        if (photoRequired && !files.length) return setError("Chụp ít nhất 1 ảnh hàng đã giao hoặc phiếu ký nhận.");
        if (result !== "full" && !note.trim()) return setError("Ghi lý do giao thiếu / không giao được.");
      }
      if (!expenseMode && askExpense) return setError('Chọn "Có chi phí" và nhập chi phí, hoặc chọn "Không phát sinh chi phí".');
      if (!completed && sheetMode && expenseMode === "has" && !sheets.length)
        return setError('Vui lòng chụp hình chứng từ chuyến có chi phí. Chuyến không có chi phí thì chọn "Không có chi phí".');
      if (!completed && files.length + (sheetMode && expenseMode === "has" ? sheets.length : 0) > 10) return setError("Gửi tối đa 10 ảnh mỗi lần.");
      if (askExpense && !sheetMode && expenseMode === "has") {
        const bad = lines.map((l, i) => lineError(l, categories, lines.length > 1 ? i + 1 : null, photos)).find(Boolean);
        if (bad) return setError(bad);
      }
      if (!completed) {
        // Không có ảnh (đã tắt chụp ảnh hoặc không bắt buộc): không xin vé tải ảnh
        let ticket: string | null = null;
        const all = [...files, ...(sheetMode && expenseMode === "has" ? sheets : [])];
        if (all.length) {
          const t = await requestUploadTicket(shipmentId, "delivery");
          if (!t.ok) return setError(t.error);
          try {
            setProgress(`Đang gửi ảnh 0/${all.length}…`);
            await uploadWithTicket(t.ticket, all.map((f) => ({ file: f.file, kind: f.kind })), (n) => setProgress(`Đang gửi ảnh ${n}/${all.length}…`));
          } catch (e) {
            setProgress(null);
            return setError((e as Error).message);
          }
          ticket = t.ticket;
        }
        setProgress("Đang lưu…");
        const r = await completeTrip({ shipmentId, ticket, result, note: note.trim() || undefined, noExpense: !askExpense || expenseMode === "none" });
        if (!r.ok) {
          setProgress(null);
          return setError(r.error);
        }
        setCompleted(true);
      }
      if (askExpense && !sheetMode && expenseMode === "has") {
        const r = await submitLines(shipmentId, lines, setProgress);
        if (r.failed.length) {
          setProgress(null);
          setLines(r.failed);
          return setError(`Chuyến đã hoàn thành. ${r.error} Các khoản còn lại trên màn hình chưa lưu, bấm gửi lại.`);
        }
      }
      setProgress(null);
      setFiles([]);
      setSheets([]);
      // Đóng hộp thoại trước, rồi mới chuyển sang màn hình "đã hoàn thành" (tránh kẹt màn hình khi thẻ chuyến đổi ngay lúc hộp thoại đang mở)
      setOpen(false);
      setFinished(true);
    });
  }

  useEffect(() => {
    if (!finished || open) return;
    const t = setTimeout(() => {
      unlockBody();
      router.replace(`/tx?xong=${shipmentId}`);
      router.refresh();
    }, 250);
    return () => clearTimeout(t);
  }, [finished, open, router, shipmentId]);

  return (
    <div className="mt-4">
      <button
        type="button"
        aria-label={`Hoàn thành chuyến ${code}`}
        onClick={() => setOpen(true)}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-success text-lg font-semibold text-white"
      >
        <Flag className="size-6" /> Hoàn thành chuyến
      </button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (pending) return;
          setOpen(o);
          // Đã lưu hoàn thành mà đóng hộp thoại (còn chi phí chưa gửi): vẫn sang màn hình đã hoàn thành
          if (!o && completed) setFinished(true);
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Hoàn thành chuyến {code}</DialogTitle>
            <DialogDescription>
              {photoRequired
                ? "Đơn này yêu cầu chụp chứng từ: chụp ảnh hàng đã giao hoặc phiếu giao hàng có chữ ký người nhận. Bắt buộc ít nhất 1 ảnh."
                : "Chọn kết quả giao hàng rồi bấm gửi."}
            </DialogDescription>
          </DialogHeader>
          {completed ? (
            <p className="rounded-lg bg-success/10 p-3 text-sm">Đã lưu hoàn thành chuyến. Gửi nốt các khoản chi phí bên dưới.</p>
          ) : (
            <>
              {photoRequired ? (
                <PhotoPicker
                  value={files}
                  onChange={setFiles}
                  kinds={[
                    { value: "photo", label: "Ảnh hàng" },
                    { value: "delivery_note", label: "Phiếu ký nhận" },
                  ]}
                />
              ) : null}
              <div>
                <div className="mb-1 text-sm font-medium">Kết quả giao hàng</div>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Kết quả giao hàng">
                  {RESULTS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      role="radio"
                      aria-checked={result === r.value}
                      onClick={() => setResult(r.value)}
                      className={`rounded-lg px-1 py-2 text-sm font-medium ${result === r.value ? "bg-card shadow-xs" : "text-muted-foreground"}`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="complete-note" className="mb-1 block text-sm font-medium">
                  Ghi chú {result !== "full" ? "(bắt buộc)" : "(không bắt buộc)"}
                </label>
                <Textarea id="complete-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Ví dụ: Thiếu 2 kiện, khách hẹn giao bù ngày mai" />
              </div>
            </>
          )}
          <div hidden={completed || !askExpense}>
            <div className="mb-1 text-sm font-medium">{sheetMode ? "Chi phí chuyến" : "Chi phí chuyến (bắt buộc chọn)"}</div>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Chi phí chuyến">
              {(
                [
                  ["has", "Có chi phí"],
                  ["none", sheetMode ? "Không có chi phí" : "Không phát sinh chi phí"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={expenseMode === v}
                  onClick={() => setExpenseMode(v)}
                  className={`rounded-lg px-1 py-2 text-sm font-medium ${expenseMode === v ? "bg-card shadow-xs" : "text-muted-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {sheetMode
                ? "Có chi phí: chụp phiếu chi phí công ty phát (đã ghi từng loại phí), văn phòng sẽ nhập. Gửi sót thì bấm \"Gửi thêm phiếu chi phí\" trên thẻ chuyến."
                : "Chi phí tài xế tự trả (dầu, cầu đường, bốc xếp…). Nhập sót thì bấm \"Bổ sung chi phí\" trên thẻ chuyến trước khi văn phòng đóng chuyến."}
            </p>
          </div>
          {expenseMode === "has" && sheetMode && !completed ? (
            <PhotoPicker value={sheets} onChange={setSheets} label="Chụp phiếu chi phí" kinds={[{ value: "receipt", label: "Phiếu chi phí" }]} />
          ) : null}
          {expenseMode === "has" && askExpense && !sheetMode ? <ExpenseLinesEditor lines={lines} onChange={setLines} categories={categories} photos={photos} /> : null}
          <ErrorText error={error} />
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-success text-lg font-semibold text-white disabled:opacity-60"
          >
            <CheckCircle2 className="size-6" /> {progress ?? (pending ? "Đang gửi…" : "Gửi và hoàn thành")}
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Bỏ khóa bấm của trang nếu hộp thoại đóng không trọn (lỗi "không thoát ra được" trên điện thoại) */
function unlockBody() {
  if (typeof document === "undefined") return;
  document.body.style.pointerEvents = "";
  document.body.removeAttribute("data-scroll-locked");
  document.body.style.overflow = "";
}

/** Sau khi hoàn thành chuyến (hoặc chưa có chuyến): tìm chuyến tiếp theo điều phối đã sắp cho xe */
export function FindNextButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => {
    unlockBody();
  }, []);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(() => {
          router.replace("/tx");
          router.refresh();
        })
      }
      className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-lg font-semibold text-primary-foreground disabled:opacity-60"
    >
      <Search className="size-6" /> {pending ? "Đang tìm…" : "Tìm chuyến khác"}
    </button>
  );
}
