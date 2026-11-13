"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { setShipmentDriverPay } from "@/app/(app)/dieu-phoi/actions";
import { formatNumber } from "@/lib/format";
import type { ShipmentListRow } from "@/lib/shipments";

const SOURCE: Record<string, string> = {
  route: "theo tuyến",
  place: "theo địa điểm",
  zone: "theo vùng",
  default: "giá mặc định",
  driver_legacy: "hồ sơ tài xế (cũ)",
  monthly_only: "lương tháng, không tính chuyến",
  manual: "sửa tay",
  missing: "chưa có giá",
};

/** Ô "Lương chuyến": số tiền theo đơn giá (hoặc sửa tay); chưa có giá thì nhắc điền giá tuyến; kế toán sửa tay được */
export function DriverPayCell({ r }: { r: ShipmentListRow }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!r.driver_pay_source) return null;
  const src = r.driver_pay_source;
  const title = [`Lương chuyến ${SOURCE[src] ?? src}`, r.driver_pay_note ? `Lý do: ${r.driver_pay_note}` : ""].filter(Boolean).join(" · ");

  const save = (clear: boolean) =>
    start(async () => {
      const n = clear ? null : Number(amount.replace(/[^0-9]/g, ""));
      if (!clear && (!amount.trim() || !Number.isFinite(n))) return void toast.error("Nhập số tiền");
      const res = await setShipmentDriverPay({ shipmentId: r.id, amount: n, note });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });

  return (
    <div className="flex items-center justify-end gap-1" title={title}>
      {src === "missing" ? (
        <Link href="/dieu-phoi/tuyen-chua-gia" className="text-xs font-medium text-destructive hover:underline">
          Chưa có giá
        </Link>
      ) : (
        <span className={src === "manual" ? "font-semibold text-violet-700 dark:text-violet-300" : src === "default" ? "text-muted-foreground" : ""}>
          {formatNumber(r.driver_pay ?? 0)}
          {src === "manual" ? "*" : ""}
        </span>
      )}
      {r.can_override_pay ? (
        <>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Sửa tay lương chuyến ${r.shipment_code}`}
            onClick={() => {
              setAmount(r.driver_pay_override != null ? formatNumber(r.driver_pay_override) : "");
              setNote(r.driver_pay_note ?? "");
              setOpen(true);
            }}
          >
            <Pencil className="size-3" />
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Sửa tay lương chuyến {r.shipment_code}</DialogTitle>
                <DialogDescription>
                  Theo đơn giá: {src === "manual" ? "đang sửa tay" : src === "missing" ? "chưa có giá" : `${formatNumber(r.driver_pay ?? 0)} (${SOURCE[src] ?? src})`}. Chỉ dùng
                  cho chuyến ngoại lệ; giá cả tuyến thì sửa ở Đơn giá lương chuyến.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor={`pay-${r.id}`}>Lương chuyến này</Label>
                <Input
                  id={`pay-${r.id}`}
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => {
                    const d = e.target.value.replace(/[^0-9]/g, "");
                    setAmount(d ? formatNumber(Number(d)) : "");
                  }}
                  placeholder="Ví dụ: 1,000,000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`pay-note-${r.id}`}>Lý do *</Label>
                <Input id={`pay-note-${r.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Ví dụ: chờ hàng ở cảng 1 ngày" />
              </div>
              <DialogFooter>
                {r.driver_pay_override != null ? (
                  <Button variant="outline" disabled={pending} onClick={() => save(true)}>
                    Trả về theo đơn giá
                  </Button>
                ) : null}
                <Button disabled={pending} onClick={() => save(false)}>
                  {pending ? <Loader2 className="animate-spin" /> : null} Lưu
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
