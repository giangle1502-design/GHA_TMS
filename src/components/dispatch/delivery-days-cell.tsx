"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { setDeliveryDays } from "@/app/(app)/dieu-phoi/actions";
import type { ShipmentListRow } from "@/lib/shipments";

/**
 * Ô "Số ngày giao" trên bảng Điều phối: trống = chuyến 1 ngày (hoặc tự tính theo Ngày giao dự kiến, hiện nhạt).
 * Nhập 2, 3… cho chuyến dài ngày; bảng chấm công tính công từ ngày nhận tới hết số ngày này.
 */
export function DeliveryDaysCell({ r, editable }: { r: ShipmentListRow; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const auto = !r.delivery_days && (r.work_days ?? 1) > 1 ? r.work_days : null;
  const shown = r.delivery_days ? (
    <b>{r.delivery_days}</b>
  ) : auto ? (
    <span className="text-muted-foreground" title="Tự tính từ Ngày giao dự kiến">
      {auto}
    </span>
  ) : null;

  if (!editable || r.status === "cancelled") return <div className="text-right">{shown}</div>;

  function save() {
    const v = text.trim();
    const n = v === "" ? null : Number(v);
    setEditing(false);
    if (n === (r.delivery_days ?? null)) return;
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 60)) return void toast.error("Số ngày giao từ 1 đến 60");
    start(async () => {
      const res = await setDeliveryDays({ shipmentId: r.id, days: n });
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
        aria-label={`Số ngày giao chuyến ${r.shipment_code}`}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 2))}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-7 w-full rounded border bg-background px-1.5 text-right"
        placeholder="2, 3…"
      />
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setText(r.delivery_days ? String(r.delivery_days) : "");
        setEditing(true);
      }}
      title={`Bấm để nhập số ngày giao cho chuyến ${r.shipment_code} (trống = 1 ngày)`}
      className="flex h-7 w-full items-center justify-end rounded border border-dashed border-transparent px-1.5 hover:border-border"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : (shown ?? <span className="text-xs text-muted-foreground">Nhập</span>)}
    </button>
  );
}
