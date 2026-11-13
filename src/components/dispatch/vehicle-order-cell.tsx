"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { setVehicleOrder } from "@/app/(app)/dieu-phoi/actions";
import type { ShipmentListRow } from "@/lib/shipments";

const EDITABLE = ["draft", "assigned", "accepted", "in_transit"];

/**
 * Ô "Thứ tự xe" trên bảng Điều phối: bấm vào để nhập 1, 2, 3… (Enter hoặc rời ô để lưu, xóa trống = bỏ thứ tự).
 * Chưa nhập thì hiện thứ tự từ kế hoạch (nhạt) vì ứng dụng tài xế cũng dùng thứ tự đó.
 */
export function VehicleOrderCell({ r, editable }: { r: ShipmentListRow; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const canEdit = editable && Boolean(r.vehicle_id) && EDITABLE.includes(r.status);
  const shown = r.vehicle_day_order ? (
    <b>{r.vehicle_day_order}</b>
  ) : r.trip_order ? (
    <span className="text-muted-foreground" title="Thứ tự từ kế hoạch">
      {r.trip_order}
    </span>
  ) : null;

  if (!canEdit) return <div className="text-right">{shown}</div>;

  function save() {
    const v = text.trim();
    const n = v === "" ? null : Number(v);
    setEditing(false);
    if (n === (r.vehicle_day_order ?? null)) return;
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 99)) return void toast.error("Thứ tự xe là số từ 1 đến 99");
    start(async () => {
      const res = await setVehicleOrder({ shipmentId: r.id, order: n });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <input
        autoFocus
        inputMode="numeric"
        aria-label={`Thứ tự xe chuyến ${r.shipment_code}`}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 2))}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-7 w-full rounded border bg-background px-1.5 text-right"
        placeholder="1, 2…"
      />
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setText(r.vehicle_day_order ? String(r.vehicle_day_order) : "");
        setEditing(true);
      }}
      title={`Bấm để nhập thứ tự xe ${r.plate_number ?? ""} cho chuyến ${r.shipment_code}`}
      className="flex h-7 w-full items-center justify-end rounded border border-dashed border-transparent px-1.5 hover:border-border"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : (shown ?? <span className="text-xs text-muted-foreground">Nhập</span>)}
    </button>
  );
}
