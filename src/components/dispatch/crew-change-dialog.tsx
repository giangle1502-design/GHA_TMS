"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCcw, UserRoundPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/input";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { correctShipmentCrew, unacceptShipment } from "@/app/(app)/dieu-phoi/actions";
import { todayVN } from "@/lib/format";
import { VehicleDayConflict, type VehicleDayState } from "./vehicle-day-conflict";
import { VehicleSourcePicker, type VehicleSource } from "./vehicle-source-picker";


/**
 * mode "unaccept": xe hư sau khi tài xế đã nhận → hủy phần nhận, chọn xe khác (tài xế khác nếu cần),
 *   chuyến về Chờ tài xế nhận trên xe mới.
 * mode "correct": nhập sai số xe / tên tài xế (kể cả chuyến đã hoàn thành) → sửa thẳng, giữ trạng thái.
 */
export function CrewChangeDialog({
  mode,
  shipmentId,
  shipmentCode,
  driverId,
  driverLabel,
  vehicleId,
  vehicleLabel,
  pickupAt,
  compact,
}: {
  mode: "unaccept" | "correct";
  shipmentId: string;
  shipmentCode: string;
  driverId: string | null;
  driverLabel?: string | null;
  vehicleId: string | null;
  vehicleLabel?: string | null;
  pickupAt: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [driver, setDriver] = useState({ id: driverId ?? "", label: driverLabel ?? "" });
  const [vehicle, setVehicle] = useState({ id: vehicleId ?? "", label: vehicleLabel ?? "" });
  const [reason, setReason] = useState("");
  const [dayState, setDayState] = useState<VehicleDayState>({ blocked: false, order: null, others: [] });
  const [pending, start] = useTransition();
  const router = useRouter();
  const unaccept = mode === "unaccept";
  const vehicleChanged = vehicle.id !== (vehicleId ?? "");
  const changed = vehicleChanged || driver.id !== (driverId ?? "");
  const [source, setSource] = useState<VehicleSource>("internal");
  const is3pl = source === "3pl";
  const blocked = unaccept && vehicleChanged && !is3pl && dayState.blocked;

  function save() {
    start(async () => {
      const input = { shipmentId, vehicleId: vehicle.id, driverId: driver.id, reason };
      const r = unaccept
        ? await unacceptShipment({ ...input, ...(vehicleChanged && !is3pl ? { vehicleDayOrder: dayState.order, otherOrders: dayState.others } : {}) })
        : await correctShipmentCrew(input);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  const title = unaccept ? `Hủy nhận xe, đổi xe chuyến ${shipmentCode}` : `Sửa xe, tài xế chuyến ${shipmentCode}`;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={compact ? "h-7 px-2" : undefined}
        title={unaccept ? "Tài xế đã nhận nhưng xe hư: hủy nhận, đổi sang xe khác" : "Sửa số xe / tên tài xế nhập sai (cả chuyến đã hoàn thành)"}
        onClick={() => setOpen(true)}
      >
        {unaccept ? <RefreshCcw /> : <UserRoundPen />} {unaccept ? "Hủy nhận / đổi xe" : "Sửa xe, TX"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {unaccept
                ? "Dùng khi tài xế đã nhận (hoặc đang chạy) mà xe hư. Chuyến trở về \"Chờ tài xế nhận\" trên xe mới, tài xế nhập số xe mới trên điện thoại rồi bấm Nhận đơn. Giữ tài xế thì không phải Giám đốc duyệt lại."
                : "Dùng khi nhập sai số xe hoặc tên tài xế. Trạng thái chuyến giữ nguyên; chi phí tài xế tự trả của chuyến (chưa vào bảng lương) chuyển theo tài xế đúng. Mọi lần sửa được ghi vào nhật ký."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`cv-${mode}-${shipmentId}`}>{unaccept ? "Xe mới" : "Xe đúng"}</Label>
              <VehicleSourcePicker id={`cv-${mode}-${shipmentId}`} shipmentId={shipmentId} value={vehicle.id} initialLabel={vehicle.label} onChange={(id, label) => setVehicle({ id, label })} onSourceChange={setSource} />
              {unaccept && !is3pl ? (
                <VehicleDayConflict vehicleId={vehicleChanged ? vehicle.id : ""} day={todayVN(new Date(pickupAt))} excludeShipmentId={shipmentId} onStateChange={setDayState} />
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`cd-${mode}-${shipmentId}`}>{unaccept ? "Tài xế (giữ nguyên nếu chỉ đổi xe)" : "Tài xế đúng"}</Label>
              <ReferenceSelect id={`cd-${mode}-${shipmentId}`} refKey={is3pl ? "drivers" : "drivers_internal"} key={source} value={driver.id} initialLabel={driver.label} onChange={(id, label) => setDriver({ id, label })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`cr-${mode}-${shipmentId}`}>Lý do *</Label>
              <Textarea
                id={`cr-${mode}-${shipmentId}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                placeholder={unaccept ? "Ví dụ: Xe 61K31295 hư hộp số, đổi sang xe 51C12345" : "Ví dụ: Nhập nhầm tài xế, người chạy thực tế là anh Minh"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Đóng
            </Button>
            <Button
              disabled={pending || !vehicle.id || !driver.id || reason.trim().length < 3 || (!unaccept && !changed) || blocked}
              title={!unaccept && !changed ? "Chọn xe hoặc tài xế khác để sửa" : blocked ? "Xe mới đã có chuyến cùng ngày: tích \"Vẫn giao cho xe này\" và nhập thứ tự" : undefined}
              onClick={save}
            >
              {pending ? <Loader2 className="animate-spin" /> : null} {unaccept ? "Hủy nhận, giao xe mới" : "Lưu sửa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
