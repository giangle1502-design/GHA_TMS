"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/input";
import { cancelOrder } from "../../actions";

/** Hủy cả đơn hàng tạo sai (không xóa dữ liệu) */
export function CancelOrderDialog({ orderId, orderCode, tripCount }: { orderId: string; orderCode: string; tripCount: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button variant="ghost" className="text-destructive" onClick={() => setOpen(true)}>
        <Ban /> Hủy đơn hàng
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Hủy đơn hàng {orderCode}</DialogTitle>
            <DialogDescription>
              {tripCount} chuyến của đơn sẽ chuyển sang Đã hủy, tài xế được gỡ phân công. Dữ liệu không bị xóa, lý do được lưu vào lịch sử. Chuyến đã hủy không tính doanh thu.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-order-reason">Lý do hủy</Label>
            <Textarea id="cancel-order-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ví dụ: Tạo trùng đơn, khách hủy hàng" />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Đóng
            </Button>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < 3}
              onClick={() =>
                start(async () => {
                  const r = await cancelOrder({ orderId, reason });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.message);
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : null} Xác nhận hủy đơn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
