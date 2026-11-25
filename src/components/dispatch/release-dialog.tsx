"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Truck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { releaseShipment } from "@/app/(app)/dieu-phoi/actions";
import { compactUpper } from "@/lib/entities/record";
import { formatNumber } from "@/lib/format";

const QUICK_REASONS = ["Tài xế nhận nhưng không đi", "Nhà xe báo không có xe", "Xe hư, nhà xe không thay được", "Tài xế không liên lạc được"];

/**
 * Hủy nhận chuyến: tài xế / nhà xe 3PL đã nhận nhưng không đi. Gỡ xe, tài xế, nhà xe (không xóa đơn, chuyến),
 * chuyến về Nháp; chọn luôn nhà xe 3PL khác (và số xe nếu đã biết). Tài xế cũ không còn thấy chuyến trên app.
 */
export function ReleaseShipmentDialog({
  shipmentId,
  shipmentCode,
  plate,
  driverName,
  carrierName,
  hasCarrier,
  grouped,
  compact,
  variant = "ghost",
}: {
  shipmentId: string;
  shipmentCode: string;
  plate?: string | null;
  driverName?: string | null;
  carrierName?: string | null;
  /** Chuyến đang gắn nhà xe 3PL (để hỏi xóa chi phí 3PL cũ) */
  hasCarrier?: boolean;
  /** Chuyến ghép chung xe: hủy cả nhóm */
  grouped?: boolean;
  compact?: boolean;
  variant?: "ghost" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sup, setSup] = useState({ id: "", label: "" });
  const [clearCosts, setClearCosts] = useState(true);
  const [newPlate, setNewPlate] = useState("");
  const [newDriver, setNewDriver] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  function reset() {
    setReason("");
    setSup({ id: "", label: "" });
    setClearCosts(true);
    setNewPlate("");
    setNewDriver("");
    setNewPhone("");
  }

  function save() {
    start(async () => {
      const r = await releaseShipment({
        shipmentId,
        reason,
        supplierId: sup.id || undefined,
        clearCarrierCosts: clearCosts,
        ...(sup.id ? { plate: newPlate, driverName: newDriver, driverPhone: newPhone } : {}),
      });
      if (!r.ok) return void toast.error(r.error);
      const d = r.data;
      const codes = d?.codes?.length ? d.codes.join(", ") : shipmentCode;
      const parts = [`Đã hủy nhận chuyến ${codes}.`];
      if (d?.assigned) parts.push(`Đã giao cho nhà xe ${d.newCarrier}.`);
      else if (d?.newCarrier) parts.push(`Đã gắn nhà xe ${d.newCarrier}, nhập số xe ở cột Số xe hoặc bấm Phân công.`);
      else parts.push("Chuyến về Nháp, chọn xe hoặc nhà xe 3PL khác bằng nút Phân công.");
      if (d?.costsRemoved) parts.push(`Đã xóa ${formatNumber(d.costsRemoved)} đ chi phí 3PL của nhà xe cũ.`);
      toast.success(parts.join(" "));
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  const crew = [plate, driverName, carrierName ? `3PL ${carrierName}` : null].filter(Boolean).join(" · ");
  return (
    <>
      <Button
        variant={variant}
        size="sm"
        className={compact ? "h-7 px-2 text-red-700 hover:text-red-800" : "text-red-700 hover:text-red-800"}
        title="Tài xế / nhà xe đã nhận nhưng không đi: hủy nhận, giao cho 3PL khác"
        onClick={() => setOpen(true)}
      >
        <UserX /> Hủy nhận chuyến
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Hủy nhận chuyến {shipmentCode}</DialogTitle>
            <DialogDescription>
              Gỡ xe, tài xế, nhà xe đang nhận chuyến; chuyến về Nháp (đơn và chuyến giữ nguyên). Tài xế cũ không còn thấy chuyến trên app. Lý do và người hủy được lưu ở
              Lịch sử của chuyến.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {crew ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Đang nhận: </span>
                <b>{crew}</b>
              </div>
            ) : null}
            {grouped ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Chuyến này ghép chung xe với đơn khác: hủy nhận cả nhóm (các chuyến vẫn ghép chung, chờ xe mới).
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor={`rl-r-${shipmentId}`}>Lý do *</Label>
              <div className="flex flex-wrap gap-1">
                {QUICK_REASONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
                    onClick={() => setReason(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <Textarea id={`rl-r-${shipmentId}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Ví dụ: Tài xế nhận chuyến nhưng sáng nay báo không đi" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`rl-s-${shipmentId}`}>Giao cho nhà xe 3PL khác (không bắt buộc)</Label>
              <ReferenceSelect id={`rl-s-${shipmentId}`} refKey="suppliers" value={sup.id} onChange={(id, label) => setSup({ id, label: id ? label : "" })} />
            </div>
            {sup.id ? (
              <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50/60 p-2.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-violet-900">
                  <Truck className="size-3.5" /> Đã biết xe của {sup.label || "nhà xe mới"}? Nhập luôn (để trống = nhập sau)
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Input aria-label="Số xe mới" value={newPlate} maxLength={20} placeholder="Số xe" onChange={(e) => setNewPlate(compactUpper(e.target.value))} />
                  <Input aria-label="Tài xế mới" value={newDriver} maxLength={150} placeholder="Tài xế" onChange={(e) => setNewDriver(e.target.value)} />
                  <Input aria-label="SĐT tài xế mới" value={newPhone} maxLength={20} inputMode="tel" placeholder="SĐT" onChange={(e) => setNewPhone(e.target.value)} />
                </div>
              </div>
            ) : null}
            {hasCarrier ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={clearCosts} onChange={(e) => setClearCosts(e.target.checked)} />
                <span>
                  Xóa chi phí 3PL đã nhập cho nhà xe cũ (nhà xe cũ không chạy). Bỏ tick để giữ lại, chi phí và công nợ chuyển sang nhà xe mới.
                </span>
              </label>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Đóng
            </Button>
            <Button variant="destructive" disabled={pending || reason.trim().length < 3} onClick={save}>
              {pending ? <Loader2 className="animate-spin" /> : null} {sup.id ? "Hủy nhận, giao 3PL mới" : "Hủy nhận chuyến"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
