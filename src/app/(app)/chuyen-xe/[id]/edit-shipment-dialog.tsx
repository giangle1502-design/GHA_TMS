"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { updateShipmentCore } from "../actions";
import { parseNumberVN } from "@/lib/entities/record";
import type { ShipmentListRow } from "@/lib/shipments";

const ymd = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }) : "");

/** Sửa chuyến tạo sai: ngày, điểm nhận/giao, loại xe, số lượng, giá, ghi chú */
export function EditShipmentDialog({ s, compact }: { s: ShipmentListRow; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const init = () => ({
    pickupDate: ymd(s.pickup_at),
    expectedDeliveryDate: ymd(s.expected_delivery_at),
    pickup: { id: s.pickup_location_id, label: s.pickup_name ?? "" },
    delivery: { id: s.delivery_location_id, label: s.delivery_name ?? "" },
    vtype: { id: s.vehicle_type_id ?? "", label: s.vehicle_type_name ?? "" },
    quantity: String(s.quantity ?? 1),
    unitPrice: String(s.unit_price ?? 0),
    pricingUnit: s.pricing_unit,
    surcharge: String(s.surcharge_amount ?? 0),
    fuel: s.fuel_support_rate === null ? "" : String(s.fuel_support_rate),
    notes: s.notes ?? "",
  });
  const [v, setV] = useState(init);
  const set = (patch: Partial<ReturnType<typeof init>>) => setV((x) => ({ ...x, ...patch }));

  function save() {
    start(async () => {
      const num = (x: string, money = false) => parseNumberVN(x, money);
      const r = await updateShipmentCore({
        id: s.id,
        version: s.version,
        pickupDate: v.pickupDate,
        expectedDeliveryDate: v.expectedDeliveryDate || null,
        pickupLocationId: v.pickup.id,
        deliveryLocationId: v.delivery.id,
        vehicleTypeId: v.vtype.id || null,
        quantity: num(v.quantity) ?? 0,
        unitPrice: num(v.unitPrice, true) ?? 0,
        pricingUnit: v.pricingUnit as "trip",
        surchargeAmount: num(v.surcharge, true) ?? 0,
        fuelSupportRate: v.fuel.trim() === "" ? null : (num(v.fuel) ?? null),
        notes: v.notes.trim() || null,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant={compact ? "ghost" : "outline"}
        size="sm"
        className={compact ? "h-7 px-2" : undefined}
        title={`Sửa chuyến ${s.shipment_code}`}
        onClick={() => {
          setV(init());
          setOpen(true);
        }}
      >
        <Pencil /> {compact ? "Sửa" : "Sửa chuyến"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sửa chuyến {s.shipment_code}</DialogTitle>
            <DialogDescription>
              Sửa thông tin nhập sai. Giá không tự tìm lại theo bảng giá: đổi tuyến thì kiểm tra lại đơn giá. Mọi thay đổi được ghi vào lịch sử thay đổi của chuyến.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="es-pickup-date">Ngày nhận hàng *</Label>
              <Input id="es-pickup-date" type="date" value={v.pickupDate} onChange={(e) => set({ pickupDate: e.target.value, ...(v.expectedDeliveryDate && v.expectedDeliveryDate < e.target.value ? { expectedDeliveryDate: e.target.value } : {}) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-delivery-date">Ngày giao dự kiến</Label>
              <Input id="es-delivery-date" type="date" min={v.pickupDate} value={v.expectedDeliveryDate} onChange={(e) => set({ expectedDeliveryDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-pickup">Điểm nhận *</Label>
              <ReferenceSelect id="es-pickup" refKey="locations" value={v.pickup.id} initialLabel={v.pickup.label} onChange={(id, label) => set({ pickup: { id, label } })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-delivery">Điểm giao *</Label>
              <ReferenceSelect id="es-delivery" refKey="locations" value={v.delivery.id} initialLabel={v.delivery.label} onChange={(id, label) => set({ delivery: { id, label } })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-vtype">Loại xe</Label>
              <ReferenceSelect id="es-vtype" refKey="vehicle_types" value={v.vtype.id} initialLabel={v.vtype.label} onChange={(id, label) => set({ vtype: { id, label } })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-qty">Số lượng</Label>
              <Input id="es-qty" inputMode="decimal" value={v.quantity} onChange={(e) => set({ quantity: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-price">Đơn giá (đ)</Label>
              <Input id="es-price" inputMode="decimal" value={v.unitPrice} onChange={(e) => set({ unitPrice: e.target.value })} />
              <p className="text-xs text-muted-foreground">Để 0 nếu chưa có giá.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-unit">Tính theo</Label>
              <NativeSelect id="es-unit" value={v.pricingUnit} onChange={(e) => set({ pricingUnit: e.target.value })}>
                <option value="trip">Chuyến</option>
                <option value="km">Km</option>
                <option value="ton">Tấn</option>
                <option value="other">Khác</option>
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-surcharge">Phụ phí (đ)</Label>
              <Input id="es-surcharge" inputMode="decimal" value={v.surcharge} onChange={(e) => set({ surcharge: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es-fuel">Tỷ lệ hỗ trợ dầu (%)</Label>
              <Input id="es-fuel" inputMode="decimal" value={v.fuel} onChange={(e) => set({ fuel: e.target.value })} placeholder="Bỏ trống nếu không có" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="es-notes">Ghi chú cho tài xế</Label>
              <Textarea id="es-notes" value={v.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Đóng
            </Button>
            <Button disabled={pending} onClick={save}>
              {pending ? <Loader2 className="animate-spin" /> : null} Lưu thay đổi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
