"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, CheckCheck, Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/input";
import { decideTrips, resubmitTrip } from "@/app/(app)/dieu-phoi/actions";

/** Giám đốc duyệt / từ chối một chuyến (hoặc nhiều chuyến khi truyền nhiều requestIds) */
export function TripApprovalButtons({
  requestIds,
  label,
  compact,
  bulk,
}: {
  requestIds: string[];
  /** Mã chuyến hoặc mô tả, hiện trên hộp thoại */
  label: string;
  compact?: boolean;
  /** Nút "Duyệt tất cả" (không có nút từ chối hàng loạt) */
  bulk?: boolean;
}) {
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!requestIds.length) return null;
  const size = compact ? "h-7 px-2" : "";
  return (
    <>
      <Button size="sm" className={size} onClick={() => setMode("approve")} aria-label={bulk ? `Duyệt tất cả ${requestIds.length} chuyến` : `Duyệt chuyến ${label}`} title="Giám đốc duyệt: tài xế thấy chuyến và nhận đơn được">
        {bulk ? <CheckCheck /> : <Check />}
        {bulk ? ` Duyệt tất cả (${requestIds.length})` : " Duyệt"}
      </Button>
      {bulk ? null : (
        <Button size="sm" variant="outline" className={`${size} text-destructive`} onClick={() => setMode("reject")} aria-label={`Từ chối chuyến ${label}`} title="Từ chối: điều phối sửa rồi gửi duyệt lại">
          <X />
          {compact ? null : " Từ chối"}
        </Button>
      )}
      <Dialog open={mode !== null} onOpenChange={(o) => !o && !pending && setMode(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {mode === "reject" ? `Từ chối chuyến ${label}` : bulk ? `Duyệt ${requestIds.length} chuyến đang chờ` : `Duyệt chuyến ${label}`}
            </DialogTitle>
            <DialogDescription>
              {mode === "reject"
                ? "Tài xế vẫn chưa thấy chuyến. Điều phối nhận thông báo kèm lý do, sửa chuyến rồi gửi duyệt lại."
                : "Sau khi duyệt, tài xế thấy chuyến trên điện thoại và bấm Nhận đơn được. Điều phối nhận thông báo."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="trip-approval-comment">{mode === "reject" ? "Lý do từ chối *" : "Ghi chú (không bắt buộc)"}</Label>
            <Textarea
              id="trip-approval-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={1000}
              placeholder={mode === "reject" ? "Ví dụ: Sai loại xe, đổi sang xe 8 tấn; giá cước chưa đúng" : "Ví dụ: Chạy sớm trước 6 giờ"}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMode(null)} disabled={pending}>
              Đóng
            </Button>
            <Button
              variant={mode === "reject" ? "destructive" : "default"}
              disabled={pending || (mode === "reject" && !comment.trim())}
              onClick={() =>
                start(async () => {
                  const r = await decideTrips({ requestIds, action: mode!, comment: comment.trim() || undefined });
                  if (!r.ok) return void toast.error(r.error);
                  if (r.data?.failed.length) toast.warning(`Đã ${mode === "approve" ? "duyệt" : "từ chối"} ${r.data.done} chuyến. ${r.data.failed.length} chuyến lỗi: ${r.data.failed[0]}`);
                  else toast.success(bulk ? `Đã duyệt ${r.data?.done ?? 0} chuyến.` : r.message);
                  setMode(null);
                  setComment("");
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              {mode === "reject" ? "Xác nhận từ chối" : "Xác nhận duyệt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Điều phối gửi duyệt lại chuyến bị từ chối */
export function ResubmitTripButton({ shipmentId, shipmentCode, reason, compact }: { shipmentId: string; shipmentCode: string; reason?: string | null; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button size="sm" variant="outline" className={compact ? "h-7 px-2" : ""} onClick={() => setOpen(true)} aria-label={`Gửi duyệt lại chuyến ${shipmentCode}`} title="Gửi Giám đốc duyệt lại">
        <Send />
        {compact ? null : " Gửi duyệt lại"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Gửi duyệt lại chuyến {shipmentCode}</DialogTitle>
            <DialogDescription>
              {reason ? (
                <>
                  Giám đốc từ chối: <b>{reason}</b>.{" "}
                </>
              ) : null}
              Sửa chuyến trước (nút Sửa hoặc Phân công), sau đó gửi lại. Đổi tài xế thì hệ thống tự gửi duyệt, không cần bấm nút này.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`resubmit-${shipmentId}`}>Ghi chú cho Giám đốc (không bắt buộc)</Label>
            <Textarea id={`resubmit-${shipmentId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Ví dụ: Đã đổi sang xe 8 tấn" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Đóng
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await resubmitTrip({ shipmentId, note: note.trim() || undefined });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.message);
                  setOpen(false);
                  setNote("");
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : null} Gửi duyệt lại
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
