"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { cancelShipment, deleteCancelledShipments, restoreShipment } from "@/app/(app)/dieu-phoi/actions";

export function CancelDialog({ shipmentId, shipmentCode, compact }: { shipmentId: string; shipmentCode: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={compact ? "h-7 px-2 text-destructive" : "text-destructive"}
        onClick={() => setOpen(true)}
        aria-label="Hủy chuyến"
        title="Hủy chuyến"
      >
        <Ban />
        {compact ? null : " Hủy chuyến"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Hủy chuyến {shipmentCode}</DialogTitle>
            <DialogDescription>Chuyến không bị xóa mà chuyển sang trạng thái Đã hủy, lý do được lưu vào lịch sử. Phân công hiện tại sẽ bị gỡ.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`cancel-${shipmentId}`}>Lý do hủy</Label>
            <Textarea id={`cancel-${shipmentId}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Đóng
            </Button>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < 3}
              onClick={() =>
                start(async () => {
                  const r = await cancelShipment({ shipmentId, reason });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.message);
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : null} Xác nhận hủy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Khôi phục chuyến đã hủy về "Chưa phân công" */
export function RestoreShipmentButton({ shipmentId, shipmentCode, compact }: { shipmentId: string; shipmentCode: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button variant="outline" size="sm" className={compact ? "h-7 px-2" : undefined} onClick={() => setOpen(true)} title="Khôi phục chuyến đã hủy">
        <RotateCcw /> Khôi phục
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Khôi phục chuyến {shipmentCode}</DialogTitle>
            <DialogDescription>
              Chuyến trở về trạng thái Chưa phân công (giữ nguyên giá, điểm nhận/giao). Đơn hàng đã hủy được mở lại. Nếu cont đã trở về Lập kế hoạch thì được lấy lại khỏi
              kế hoạch. Sau đó phân công lại xe, tài xế.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Đóng
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await restoreShipment({ shipmentId });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.message);
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Khôi phục
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Xóa vĩnh viễn chuyến đã hủy: một chuyến (compact, trên dòng) hoặc nhiều chuyến (nút trên đầu danh sách) */
export function DeleteCancelledButton({ ids, label, compact }: { ids: string[]; label: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  if (ids.length === 0) return null;
  return (
    <>
      <Button
        variant={compact ? "ghost" : "outline"}
        size="sm"
        className={compact ? "h-7 px-2 text-destructive" : "text-destructive"}
        onClick={() => {
          setConfirm("");
          setOpen(true);
        }}
        title={`Xóa vĩnh viễn ${label}`}
        aria-label={`Xóa vĩnh viễn ${label}`}
      >
        <Trash2 />
        {compact ? null : ` Xóa ${ids.length} chuyến đang lọc`}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Xóa vĩnh viễn {label}</DialogTitle>
            <DialogDescription>
              Chuyến bị xóa hẳn khỏi phần mềm, không khôi phục lại được. Đơn hàng không còn chuyến nào cũng bị xóa. Chuyến đã có chi phí tài xế, tạm ứng, thanh toán hoặc
              công nợ được giữ lại để đối chiếu. Nhật ký hệ thống vẫn lưu nội dung chuyến đã xóa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`del-${ids[0]}`}>
              Gõ <b>XOA</b> để xác nhận
            </Label>
            <Input id={`del-${ids[0]}`} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="XOA" autoComplete="off" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Đóng
            </Button>
            <Button
              variant="destructive"
              disabled={pending || confirm.trim().toUpperCase() !== "XOA"}
              onClick={() =>
                start(async () => {
                  const r = await deleteCancelledShipments({ ids, confirm });
                  if (!r.ok) return void toast.error(r.error);
                  const d = r.data!;
                  const kept = d.skipped.length
                    ? ` Giữ lại ${d.skipped.length} chuyến: ${d.skipped.slice(0, 5).map((x) => `${x.code} (${x.reason})`).join(", ")}${d.skipped.length > 5 ? "…" : ""}.`
                    : "";
                  (d.deleted ? toast.success : toast.warning)(`Đã xóa ${d.deleted} chuyến${d.orders_deleted ? `, ${d.orders_deleted} đơn hàng` : ""}.${kept}`, { duration: kept ? 10000 : 4000 });
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Xóa vĩnh viễn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
