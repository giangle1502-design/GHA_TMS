"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Truck, UserPlus, UserRoundPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { assignShipment, assignShipment3pl, shipment3plInfo, vehicleDefaultDriver, type Shipment3plInfo } from "@/app/(app)/dieu-phoi/actions";
import { todayVN } from "@/lib/format";
import { compactUpper } from "@/lib/entities/record";
import { VehicleDayConflict, type VehicleDayState } from "./vehicle-day-conflict";
import { MonthTripHint } from "./month-trip-hint";

type Form3pl = { supplierId: string; supplierName: string; plate: string; driverName: string; driverPhone: string; nationalId: string; licenseNo: string };
const EMPTY_3PL: Form3pl = { supplierId: "", supplierName: "", plate: "", driverName: "", driverPhone: "", nationalId: "", licenseNo: "" };

function from3plInfo(i: Shipment3plInfo): Form3pl {
  return {
    supplierId: i.supplier_id ?? "",
    supplierName: i.supplier_name ?? "",
    plate: i.is_3pl ? (i.plate ?? "") : "",
    driverName: i.is_3pl ? (i.driver_name ?? "") : "",
    driverPhone: i.is_3pl ? (i.driver_phone ?? "") : "",
    nationalId: i.is_3pl ? (i.national_id ?? "") : "",
    licenseNo: i.is_3pl ? (i.license_no ?? "") : "",
  };
}

/**
 * Phân công / đổi / gỡ tài xế và xe cho một chuyến.
 * Chuyến đã có nhà xe 3PL (ghi ở chuyến, xe 3PL đang gắn, hoặc NCC của kế hoạch) mở thẳng khung 3-PL:
 * Số xe, Tài xế, SĐT, CCCD, GPLX đều không bắt buộc. Chuyến khác chọn xe, tài xế nội bộ.
 */
export function AssignDialog({
  shipmentId,
  shipmentCode,
  driverId,
  driverLabel,
  vehicleId,
  vehicleLabel,
  pickupAt,
  compact,
}: {
  shipmentId: string;
  shipmentCode: string;
  driverId: string | null;
  driverLabel?: string | null;
  vehicleId: string | null;
  vehicleLabel?: string | null;
  /** Giờ nhận hàng của chuyến (ISO), để cảnh báo xe đã có chuyến cùng ngày */
  pickupAt: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [driver, setDriver] = useState({ id: driverId ?? "", label: driverLabel ?? "" });
  const [vehicle, setVehicle] = useState({ id: vehicleId ?? "", label: vehicleLabel ?? "" });
  const [driverKey, setDriverKey] = useState(0);
  const [dayState, setDayState] = useState<VehicleDayState>({ blocked: false, order: null, others: [] });
  // null = đang kiểm tra chuyến có nhà xe 3PL không
  const [mode, setMode] = useState<"internal" | "3pl" | null>(null);
  const [f3, setF3] = useState<Form3pl>(EMPTY_3PL);
  const vehicleChanged = vehicle.id !== (vehicleId ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    shipment3plInfo(shipmentId).then((r) => {
      if (!alive) return;
      const info = r.ok ? r.data : null;
      if (info && (info.supplier_id || info.is_3pl)) {
        setF3(from3plInfo(info));
        setMode("3pl");
      } else {
        setF3(EMPTY_3PL);
        setMode("internal");
      }
    });
    return () => {
      alive = false;
    };
  }, [open, shipmentId]);

  function save(unassign = false) {
    start(async () => {
      const r =
        mode === "3pl" && !unassign
          ? await assignShipment3pl({
              shipmentId,
              supplierId: f3.supplierId,
              plate: f3.plate,
              driverName: f3.driverName,
              driverPhone: f3.driverPhone,
              nationalId: f3.nationalId,
              licenseNo: f3.licenseNo,
            })
          : await assignShipment({
              shipmentId,
              driverId: unassign ? "" : driver.id,
              vehicleId: unassign && mode === "3pl" ? "" : vehicle.id,
              // Đổi xe: ghi thứ tự mới (hoặc bỏ thứ tự khi xe mới không có chuyến khác cùng ngày)
              ...(vehicleChanged && mode === "internal" ? { vehicleDayOrder: vehicle.id ? dayState.order : null, otherOrders: dayState.others } : {}),
            });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setOpen(false);
      router.refresh();
    });
  }

  function pickVehicle(id: string, label: string) {
    setVehicle({ id, label });
    // Gợi ý tài xế phụ trách xe nếu chưa chọn tài xế
    if (id && !driver.id) {
      vehicleDefaultDriver(id).then((r) => {
        if (r.ok && r.data?.driverId) {
          setDriver({ id: r.data.driverId, label: "" });
          setDriverKey((k) => k + 1);
        }
      });
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) setMode(null);
  }

  const assigned = Boolean(driverId);
  const day = todayVN(new Date(pickupAt));
  const set3 = (patch: Partial<Form3pl>) => setF3((x) => ({ ...x, ...patch }));
  return (
    <>
      <Button variant={assigned ? "ghost" : "outline"} size="sm" className={compact ? "h-7 px-2" : undefined} onClick={() => onOpenChange(true)}>
        {assigned ? <UserRoundPen /> : <UserPlus />} {assigned ? "Đổi" : "Phân công"}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Phân công chuyến {shipmentCode}</DialogTitle>
            <DialogDescription>
              {mode === "3pl"
                ? "Chuyến chạy xe nhà xe 3PL. Các ô bên dưới không bắt buộc, có thông tin thì nhập để gửi khách và để tài xế nhập số xe xem chuyến."
                : "Chọn xe trước, hệ thống gợi ý tài xế phụ trách xe đó. Tài xế được thông báo trên ứng dụng tài xế."}
            </DialogDescription>
          </DialogHeader>

          {mode === null ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Đang tải…
            </div>
          ) : mode === "3pl" ? (
            <div className="space-y-3">
              {f3.supplierName && f3.supplierId ? (
                <div className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-violet-900">
                  <Truck className="size-4 shrink-0" />
                  <span className="font-semibold">3-PL {f3.supplierName}</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor={`sp-${shipmentId}`}>Nhà xe 3PL *</Label>
                  <ReferenceSelect
                    id={`sp-${shipmentId}`}
                    refKey="suppliers"
                    value={f3.supplierId}
                    onChange={(id, label) => set3({ supplierId: id, supplierName: id ? label : "" })}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`p3-${shipmentId}`}>Số xe</Label>
                  <Input id={`p3-${shipmentId}`} value={f3.plate} maxLength={20} placeholder="61K31295" onChange={(e) => set3({ plate: compactUpper(e.target.value) })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`n3-${shipmentId}`}>Tài xế</Label>
                  <Input id={`n3-${shipmentId}`} value={f3.driverName} maxLength={150} placeholder="Nguyễn Văn A" onChange={(e) => set3({ driverName: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`t3-${shipmentId}`}>SĐT</Label>
                  <Input id={`t3-${shipmentId}`} value={f3.driverPhone} maxLength={20} inputMode="tel" placeholder="0909123456" onChange={(e) => set3({ driverPhone: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`c3-${shipmentId}`}>CCCD</Label>
                  <Input id={`c3-${shipmentId}`} value={f3.nationalId} maxLength={20} inputMode="numeric" placeholder="084091007921" onChange={(e) => set3({ nationalId: e.target.value })} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor={`g3-${shipmentId}`}>GPLX</Label>
                  <Input id={`g3-${shipmentId}`} value={f3.licenseNo} maxLength={30} placeholder="790168005497" onChange={(e) => set3({ licenseNo: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Xe, tài xế 3PL tự lưu theo nhà xe, lần sau gõ đúng số xe hoặc SĐT là dùng lại. Không tính số chuyến, thứ tự xe, tạm ứng, lương.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor={`v-${shipmentId}`}>Xe</Label>
                <ReferenceSelect id={`v-${shipmentId}`} refKey="vehicles_internal" value={vehicle.id} initialLabel={vehicle.label} onChange={pickVehicle} />
                {/* Chỉ kiểm tra khi chọn xe khác xe đang gắn với chuyến */}
                <VehicleDayConflict vehicleId={vehicleChanged ? vehicle.id : ""} day={day} excludeShipmentId={shipmentId} onStateChange={setDayState} />
                <MonthTripHint kind="vehicle" id={vehicle.id} day={day} excludeShipmentId={shipmentId} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`d-${shipmentId}`}>Tài xế</Label>
                <ReferenceSelect
                  key={driverKey}
                  id={`d-${shipmentId}`}
                  refKey="drivers_internal"
                  value={driver.id}
                  initialLabel={driver.label}
                  onChange={(id, label) => setDriver({ id, label })}
                />
                <MonthTripHint kind="driver" id={driver.id} day={day} excludeShipmentId={shipmentId} />
              </div>
              <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => setMode("3pl")}>
                Chuyến này chạy xe nhà xe 3PL? Giao cho 3PL
              </button>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {assigned ? (
              <Button variant="outline" disabled={pending} onClick={() => save(true)}>
                Gỡ phân công
              </Button>
            ) : (
              <span />
            )}
            {mode === "3pl" ? (
              <Button disabled={pending || !f3.supplierId} onClick={() => save()}>
                {pending ? <Loader2 className="animate-spin" /> : null} Giao cho 3-PL
              </Button>
            ) : (
              <Button
                disabled={pending || mode === null || !driver.id || dayState.blocked}
                title={dayState.blocked ? 'Xe đã có chuyến cùng ngày: tích "Vẫn giao cho xe này" và nhập thứ tự chuyến để lưu' : undefined}
                onClick={() => save()}
              >
                {pending ? <Loader2 className="animate-spin" /> : null} Lưu phân công
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
