"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { searchReferences, type RefOption } from "@/lib/entities/actions";
import { changeShipmentVehicle } from "@/app/(app)/dieu-phoi/quick-edit-actions";
import { setShipment3plPlate } from "@/app/(app)/dieu-phoi/actions";
import { compactUpper } from "@/lib/entities/record";
import type { ShipmentListRow } from "@/lib/shipments";
import { cn } from "@/lib/utils";

/** Trạng thái còn đổi được xe (giống hộp Phân công) */
const CHANGEABLE = ["draft", "assigned", "accepted"];

/** Kết quả tìm xe trong phiên trình duyệt (theo từ khóa) */
const cache = new Map<string, RefOption[]>();

/**
 * Ô "Số xe" trên bảng Điều phối / Quản lý chuyến: bấm để chọn xe trong danh mục xe (chỉ xe nội bộ đang hoạt động),
 * gõ vài số của biển số để tìm. Giữ tài xế đang phân công; chuyến chưa có tài xế thì tự lấy tài xế phụ trách xe.
 * Chuyến đã chạy, đã giao hoặc chạy xe 3PL thì chỉ hiện số xe (đổi bằng nút Đổi ở cột Thao tác).
 */
export function VehiclePlateCell({
  r,
  editable,
  empty = "Chưa chọn xe",
  className,
  children,
}: {
  r: ShipmentListRow;
  editable: boolean;
  /** Chữ khi chuyến chưa có xe */
  empty?: string;
  className?: string;
  /** Nội dung hiện thêm sau số xe (VD nhãn "Chuyến 2") */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<RefOption[]>([]);
  const [loading, startLoading] = useTransition();
  const [pending, startSave] = useTransition();
  // Số xe vừa chọn: hiện ngay, không chờ tải lại trang
  const [picked, setPicked] = useState<{ base: string | null; plate: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const plate = picked && picked.base === r.vehicle_id ? picked.plate : r.plate_number;
  const shown = plate ? <span className="font-medium">{plate}</span> : <span className="text-muted-foreground">{empty}</span>;

  if (!editable || !CHANGEABLE.includes(r.status))
    return (
      <span className={cn("whitespace-nowrap", className)}>
        {shown}
        {children}
      </span>
    );
  // Chuyến đã chỉ định nhà xe 3PL: gõ số xe 3PL (không chọn trong danh mục xe nội bộ)
  if (r.carrier_supplier_id) return <Plate3plInput r={r} plate={plate} empty={empty} className={className} after={children} onSaved={(p) => setPicked({ base: r.vehicle_id, plate: p })} />;

  function search(term: string) {
    const key = term.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit) setOptions(hit);
    startLoading(async () => {
      const res = await searchReferences("vehicles_internal", term, r.vehicle_id ? [r.vehicle_id] : []);
      if (res.ok) {
        const data = res.data ?? [];
        if (cache.size > 200) cache.clear();
        cache.set(key, data);
        setOptions(data);
      }
    });
  }

  function onQuery(term: string) {
    setQ(term);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => search(term), 150);
  }

  function pick(o: RefOption) {
    setOpen(false);
    if (o.value === r.vehicle_id) return;
    startSave(async () => {
      const res = await changeShipmentVehicle({ shipmentId: r.id, vehicleId: o.value });
      if (!res.ok || !res.data) return void toast.error(res.ok ? "Không lưu được" : res.error);
      const d = res.data;
      setPicked({ base: r.vehicle_id, plate: d.plate });
      const notes = [
        d.driverName ? `tài xế ${d.driverName} (phụ trách xe)` : "",
        d.noDriver ? "chưa có tài xế, bấm Phân công để chọn" : "",
        d.sameDay && d.order ? `xe đã có ${d.sameDay} chuyến khác cùng ngày, chuyến này xếp thứ ${d.order} (sửa ở cột Thứ tự xe nếu cần)` : "",
      ].filter(Boolean);
      const msg = `${r.shipment_code}: đã đổi sang xe ${d.plate}${notes.length ? `; ${notes.join("; ")}` : ""}.`;
      if (d.noDriver || d.sameDay) toast.warning(msg, { duration: 8000 });
      else toast.success(msg);
      router.refresh();
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) search(q);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          title={`Bấm để ${plate ? "đổi" : "chọn"} xe cho chuyến ${r.shipment_code}`}
          className={cn(
            "group/plate inline-flex h-7 max-w-full min-w-0 items-center gap-1 rounded border border-dashed border-transparent px-1 text-left whitespace-nowrap hover:border-muted-foreground/50 hover:bg-background",
            className,
          )}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : shown}
          {children}
          <ChevronDown className="size-3 shrink-0 opacity-0 group-hover/plate:opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="border-b p-2">
          <Input autoFocus placeholder="Gõ biển số để tìm…" value={q} onChange={(e) => onQuery(e.target.value)} className="h-8" />
        </div>
        <ul className="max-h-64 overflow-y-auto p-1 text-sm" role="listbox" aria-label={`Chọn xe cho chuyến ${r.shipment_code}`}>
          {loading && options.length === 0 ? (
            <li className="flex items-center gap-2 px-2 py-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Đang tìm…
            </li>
          ) : null}
          {!loading && options.length === 0 ? <li className="px-2 py-2 text-muted-foreground">{q.trim() ? `Không có xe “${q.trim()}”.` : "Danh mục xe đang trống."}</li> : null}
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === r.vehicle_id}
                onClick={() => pick(o)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent"
              >
                <Check className={cn("size-4 shrink-0", o.value === r.vehicle_id ? "opacity-100" : "opacity-0")} />
                <span className="truncate">{o.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t px-2 py-1.5 text-xs text-muted-foreground">Chỉ xe công ty, giữ tài xế đang phân công. Giao xe 3PL hoặc đổi tài xế: bấm Đổi ở Điều phối.</p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Ô số xe của chuyến 3PL: bấm để gõ số xe nhà xe 3PL cấp, Enter hoặc bấm ra ngoài để lưu, Esc để bỏ.
 * Giữ nhà xe và tài xế 3PL đang ghi; để trống = bỏ số xe (chuyến về Nháp, vẫn giữ nhà xe).
 */
function Plate3plInput({
  r,
  plate,
  empty,
  className,
  after,
  onSaved,
}: {
  r: ShipmentListRow;
  plate: string | null;
  empty: string;
  className?: string;
  after?: React.ReactNode;
  onSaved: (plate: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  function save() {
    const next = compactUpper(text);
    setEditing(false);
    if (next === (plate ?? "")) return;
    if (next && next.length < 4) return void toast.error("Số xe chưa đúng (ví dụ 61K31295).");
    start(async () => {
      const res = await setShipment3plPlate({ shipmentId: r.id, plate: next });
      if (!res.ok) return void toast.error(res.error);
      onSaved(next);
      toast.success(`${r.shipment_code}: ${next ? `đã lưu số xe ${next} (3PL ${r.carrier_name ?? ""})` : "đã bỏ số xe, giữ nhà xe 3PL"}.`);
      router.refresh();
    });
  }

  if (editing)
    return (
      <input
        autoFocus
        aria-label={`Số xe 3PL chuyến ${r.shipment_code}`}
        value={text}
        maxLength={20}
        onChange={(e) => setText(e.target.value.toUpperCase())}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-7 w-28 min-w-0 rounded border border-ring bg-background px-1.5 text-sm outline-none"
        placeholder="61K31295"
      />
    );
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setText(plate ?? "");
        setEditing(true);
      }}
      title={`Bấm để ${plate ? "sửa" : "nhập"} số xe 3PL cho chuyến ${r.shipment_code}`}
      className={cn(
        "inline-flex h-7 max-w-full min-w-0 items-center gap-1 rounded border border-dashed border-transparent px-1 text-left whitespace-nowrap hover:border-muted-foreground/50 hover:bg-background",
        className,
      )}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : plate ? <span className="font-medium">{plate}</span> : <span className="text-muted-foreground">{empty || "Nhập số xe"}</span>}
      {after}
    </button>
  );
}
