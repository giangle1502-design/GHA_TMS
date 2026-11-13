"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Flag, Loader2, Play, UserCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label, NativeSelect, Textarea } from "@/components/ui/input";
import { actForDriver } from "@/app/(app)/dieu-phoi/actions";
import { uploadStaffDocuments, type StaffFile } from "@/components/finance/upload";

const RESULTS = [
  { value: "full", label: "Giao đủ" },
  { value: "partial", label: "Giao thiếu" },
  { value: "failed", label: "Không giao được" },
] as const;

type Props = { shipmentId: string; code: string; status: string; driverName: string; outsourced: boolean; canUpload: boolean };

/** Điều phối làm thay tài xế các bước trên điện thoại: nhận đơn → bắt đầu chạy → hoàn thành */
export function ActForDriver({ shipmentId, code, status, driverName, outsourced, canUpload }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  const quick = (step: "accept" | "start") =>
    start(async () => {
      const r = await actForDriver({ shipmentId, step });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      router.refresh();
    });

  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <p className="text-xs text-muted-foreground">
        Làm thay tài xế <b>{driverName}</b> khi tài xế không thao tác được trên điện thoại. Lịch sử sẽ ghi tên người làm thay.
      </p>
      {status === "assigned" ? (
        <Button size="sm" disabled={pending} onClick={() => quick("accept")}>
          {pending ? <Loader2 className="animate-spin" /> : <UserCheck />} Nhận đơn thay tài xế
        </Button>
      ) : status === "accepted" ? (
        <Button size="sm" disabled={pending} onClick={() => quick("start")}>
          {pending ? <Loader2 className="animate-spin" /> : <Play />} Bắt đầu chạy thay tài xế
        </Button>
      ) : status === "in_transit" ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Flag /> Hoàn thành chuyến thay tài xế
        </Button>
      ) : null}
      {open ? (
        <CompleteDialog
          shipmentId={shipmentId}
          code={code}
          outsourced={outsourced}
          canUpload={canUpload}
          onClose={(done) => {
            setOpen(false);
            if (done) router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function CompleteDialog({ shipmentId, code, outsourced, canUpload, onClose }: { shipmentId: string; code: string; outsourced: boolean; canUpload: boolean; onClose: (done: boolean) => void }) {
  const [files, setFiles] = useState<StaffFile[]>([]);
  const [docType, setDocType] = useState<StaffFile["docType"]>("delivery_note");
  const [result, setResult] = useState<(typeof RESULTS)[number]["value"]>("full");
  const [note, setNote] = useState("");
  const [skipReason, setSkipReason] = useState("");
  const [expenseMode, setExpenseMode] = useState<"has" | "none" | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  function submit() {
    start(async () => {
      setError(null);
      if (!files.length && !uploaded && !skipReason.trim()) return setError("Tải ít nhất 1 ảnh hàng hoặc phiếu ký nhận, hoặc ghi lý do chưa có chứng từ.");
      if (result !== "full" && !note.trim()) return setError("Ghi lý do giao thiếu / không giao được.");
      if (!outsourced && !expenseMode) return setError('Chọn "Có chi phí" hoặc "Không phát sinh chi phí".');
      if (files.length && !uploaded) {
        const u = await uploadStaffDocuments("shipment", shipmentId, files);
        if (!u.ok) return setError(u.error);
        setUploaded(true);
      }
      const r = await actForDriver({
        shipmentId,
        step: "complete",
        result,
        note: note.trim() || undefined,
        // Chuyến 3PL không có chi phí tài xế
        noExpense: outsourced ? true : expenseMode === "none",
        photoSkipReason: files.length || uploaded ? undefined : skipReason.trim(),
      });
      if (!r.ok) return setError(r.error);
      toast.success(r.message);
      onClose(true);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose(uploaded)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Hoàn thành chuyến {code} thay tài xế</DialogTitle>
          <DialogDescription>Tải ảnh hàng đã giao hoặc phiếu ký nhận. Chưa có chứng từ thì ghi lý do, bổ sung sau bằng nút Chứng từ.</DialogDescription>
        </DialogHeader>

        {canUpload ? (
          <div className="space-y-1.5">
            <Label>Ảnh, chứng từ giao hàng</Label>
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect aria-label="Loại chứng từ" className="w-40" value={docType} onChange={(e) => setDocType(e.target.value as StaffFile["docType"])} disabled={uploaded}>
                <option value="delivery_note">Phiếu ký nhận</option>
                <option value="photo">Ảnh hàng</option>
              </NativeSelect>
              <Button type="button" variant="outline" size="sm" disabled={uploaded || pending} onClick={() => input.current?.click()}>
                Chọn ảnh / PDF
              </Button>
              <input
                ref={input}
                type="file"
                multiple
                hidden
                aria-label="Chọn ảnh chứng từ"
                accept="image/*,application/pdf"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []).map((file) => ({ file, docType }));
                  setFiles((f) => [...f, ...picked].slice(0, 10));
                  e.target.value = "";
                }}
              />
            </div>
            {files.length ? (
              <ul className="space-y-1 text-sm">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="truncate">{f.file.name}</span>
                    <span className="text-xs text-muted-foreground">({f.docType === "photo" ? "Ảnh hàng" : "Phiếu ký nhận"})</span>
                    {uploaded ? null : (
                      <button type="button" aria-label={`Bỏ ${f.file.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>
                        <X className="size-4 text-muted-foreground" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {!files.length && !uploaded ? (
          <div className="space-y-1.5">
            <Label htmlFor="skip-reason">Lý do chưa có ảnh, chứng từ</Label>
            <Textarea
              id="skip-reason"
              value={skipReason}
              onChange={(e) => setSkipReason(e.target.value)}
              maxLength={500}
              placeholder="Ví dụ: Khách chưa in được phiếu giao hàng, tài xế gửi bổ sung ngày mai"
            />
            <p className="text-xs text-muted-foreground">Chỉ Điều phối được bỏ qua ảnh. Chứng từ của chuyến vẫn ở trạng thái Thiếu cho đến khi tải ảnh bổ sung.</p>
          </div>
        ) : null}

        <div>
          <div className="mb-1 text-sm font-medium">Kết quả giao hàng</div>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Kết quả giao hàng">
            {RESULTS.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={result === r.value}
                onClick={() => setResult(r.value)}
                className={`rounded-md px-1 py-1.5 text-sm font-medium ${result === r.value ? "bg-card shadow-xs" : "text-muted-foreground"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="act-note">Ghi chú {result !== "full" ? "(bắt buộc)" : "(không bắt buộc)"}</Label>
          <Textarea id="act-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Ví dụ: Thiếu 2 kiện, khách hẹn giao bù ngày mai" />
        </div>

        {outsourced ? null : (
          <div>
            <div className="mb-1 text-sm font-medium">Chi phí tài xế (bắt buộc chọn)</div>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Chi phí chuyến">
              {(
                [
                  ["has", "Có chi phí"],
                  ["none", "Không phát sinh chi phí"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={expenseMode === v}
                  onClick={() => setExpenseMode(v)}
                  className={`rounded-md px-1 py-1.5 text-sm font-medium ${expenseMode === v ? "bg-card shadow-xs" : "text-muted-foreground"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {expenseMode === "has" ? <p className="mt-1 text-xs text-muted-foreground">Sau khi lưu, nhập từng khoản ở mục Chi phí chuyến bằng nút &quot;Nhập chi phí&quot;. Hóa đơn chi phí không bắt buộc.</p> : null}
          </div>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onClose(uploaded)}>
            Đóng
          </Button>
          <Button disabled={pending} onClick={submit}>
            {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Lưu hoàn thành
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
