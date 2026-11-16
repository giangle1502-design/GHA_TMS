"use client";
import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { searchReferences, type RefOption } from "@/lib/entities/actions";
import { quickEditShipment, type QuickEditInput } from "@/app/(app)/dieu-phoi/actions";
import { updateShipmentCustom } from "@/app/(app)/chuyen-xe/actions";
import { formatValue } from "@/lib/entities/record";
import type { FieldDef } from "@/lib/entities/types";
import type { ShipmentListRow } from "@/lib/shipments";
import { cn } from "@/lib/utils";

/*
 * Ô sửa nhanh trên bảng Quản lý chuyến: bấm vào ô để sửa, không phải mở chi tiết chuyến.
 * Lưu xong tải lại dữ liệu bảng (router.refresh) để các cột tính toán (cước, doanh thu…) cập nhật theo.
 */

const cellBtn =
  "flex h-7 w-full min-w-0 items-center gap-1 rounded border border-dashed border-transparent px-1 text-left hover:border-muted-foreground/50 hover:bg-background disabled:opacity-60";
const empty = <span className="text-xs text-muted-foreground">…</span>;

/** Lưu một ô của chuyến qua quickEditShipment, báo kết quả và tải lại bảng */
export function useQuickSave(r: ShipmentListRow, label: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function save(input: Omit<QuickEditInput, "shipmentId" | "version">) {
    start(async () => {
      const res = await quickEditShipment({ ...input, shipmentId: r.id, version: r.version } as QuickEditInput);
      if (!res.ok) return void toast.error(`${r.shipment_code}: ${res.error}`);
      const note = res.data?.note;
      if (note) toast.warning(`${r.shipment_code}: đã lưu ${label.toLowerCase()}. ${note}`, { duration: 10000 });
      else toast.success(`${r.shipment_code}: đã lưu ${label.toLowerCase()}.`);
      router.refresh();
    });
  }
  return { pending, save };
}

/** Kết quả tìm danh mục trong phiên trình duyệt (theo danh mục + từ khóa) */
const cache = new Map<string, RefOption[]>();

/** Ô chọn từ danh mục (địa điểm, loại xe, tài xế…): bấm để mở ô tìm, chọn là lưu */
export function RefPickCell({
  refKey,
  value,
  display,
  editable,
  allowClear = false,
  pending,
  onPick,
  title,
  hint,
}: {
  refKey: string;
  value: string | null | undefined;
  display: ReactNode;
  editable: boolean;
  allowClear?: boolean;
  pending?: boolean;
  onPick: (id: string, label: string) => void;
  title: string;
  /** Ghi chú cuối danh sách chọn */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<RefOption[]>([]);
  const [loading, startLoading] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!editable) return <div className="truncate">{display}</div>;

  function search(term: string) {
    const key = `${refKey}|${term.trim().toLowerCase()}`;
    const hit = cache.get(key);
    if (hit) setOptions(hit);
    startLoading(async () => {
      const res = await searchReferences(refKey, term, value ? [value] : []);
      if (res.ok) {
        const data = res.data ?? [];
        if (cache.size > 300) cache.clear();
        cache.set(key, data);
        setOptions(data);
      }
    });
  }
  function pick(id: string, label: string) {
    setOpen(false);
    if (id === (value ?? "")) return;
    onPick(id, label);
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
        <button type="button" disabled={pending} title={title} className={cn(cellBtn, "group/ref")}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <span className="min-w-0 flex-1 truncate">{display || empty}</span>}
          <ChevronDown className="size-3 shrink-0 opacity-0 group-hover/ref:opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b p-2">
          <Input autoFocus placeholder="Gõ để tìm…" value={q} onChange={(e) => {
            const t = e.target.value;
            setQ(t);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => search(t), 150);
          }} className="h-8" />
        </div>
        <ul className="max-h-64 overflow-y-auto p-1 text-sm" role="listbox" aria-label={title}>
          {loading && options.length === 0 ? (
            <li className="flex items-center gap-2 px-2 py-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Đang tìm…
            </li>
          ) : null}
          {!loading && options.length === 0 ? <li className="px-2 py-2 text-muted-foreground">{q.trim() ? `Không có “${q.trim()}”.` : "Danh mục đang trống."}</li> : null}
          {options.map((o) => (
            <li key={o.value}>
              <button type="button" role="option" aria-selected={o.value === value} onClick={() => pick(o.value, o.label)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent">
                <Check className={cn("size-4 shrink-0", o.value === value ? "opacity-100" : "opacity-0")} />
                <span className="truncate">{o.label}</span>
              </button>
            </li>
          ))}
        </ul>
        {allowClear && value ? (
          <div className="border-t p-1">
            <button type="button" onClick={() => pick("", "")} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent">
              <X className="size-4" /> Bỏ chọn
            </button>
          </div>
        ) : null}
        {hint ? <p className="border-t px-2 py-1.5 text-xs text-muted-foreground">{hint}</p> : null}
      </PopoverContent>
    </Popover>
  );
}

/** Ô ngày (YYYY-MM-DD): bấm để chọn ngày, đổi là lưu */
export function DateCell({
  value,
  display,
  editable,
  pending,
  allowEmpty = false,
  onSave,
  title,
}: {
  value: string;
  display: ReactNode;
  editable: boolean;
  pending?: boolean;
  allowEmpty?: boolean;
  onSave: (ymd: string) => void;
  title: string;
}) {
  const [editing, setEditing] = useState(false);
  if (!editable) return <div className="truncate">{display}</div>;
  if (editing)
    return (
      <input
        type="date"
        autoFocus
        aria-label={title}
        defaultValue={value}
        className="h-7 w-full min-w-0 rounded border border-ring bg-background px-1 text-sm outline-none"
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={(e) => {
          setEditing(false);
          const v = e.currentTarget.value;
          if (v === value || (!v && !allowEmpty)) return;
          onSave(v);
        }}
      />
    );
  return (
    <button type="button" disabled={pending} title={title} className={cellBtn} onClick={() => setEditing(true)}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <span className="truncate">{display || empty}</span>}
    </button>
  );
}

/** Ô lựa chọn (danh sách cố định) */
export function SelectCell({
  value,
  options,
  display,
  editable,
  pending,
  onSave,
  title,
  allowEmpty = false,
}: {
  value: string;
  options: { value: string; label: string }[];
  display: ReactNode;
  editable: boolean;
  pending?: boolean;
  onSave: (v: string) => void;
  title: string;
  allowEmpty?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (!editable) return <div className="truncate">{display}</div>;
  if (editing)
    return (
      <select
        autoFocus
        aria-label={title}
        defaultValue={value}
        className="h-7 w-full min-w-0 rounded border border-ring bg-background px-1 text-sm outline-none"
        onChange={(e) => {
          setEditing(false);
          if (e.target.value !== value) onSave(e.target.value);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
      >
        {allowEmpty || !value ? <option value="">—</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  return (
    <button type="button" disabled={pending} title={title} className={cellBtn} onClick={() => setEditing(true)}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <span className="truncate">{display || empty}</span>}
    </button>
  );
}

/** Kiểu trường bổ sung sửa được ngay trên bảng */
const CUSTOM_INLINE = ["text", "textarea", "email", "phone", "url", "number", "currency", "percent", "date", "select", "boolean", "reference"];

/** Ô trường bổ sung (cột người dùng tự thêm) của chuyến */
export function CustomFieldCell({ r, def, display, editable }: { r: ShipmentListRow; def: FieldDef; display: ReactNode; editable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const cur = r.custom_fields?.[def.key];
  const can = editable && r.status !== "cancelled" && !def.readOnly && CUSTOM_INLINE.includes(def.type);
  if (!can) return <div className="truncate">{display}</div>;

  function save(v: unknown) {
    start(async () => {
      // Gửi kèm các trường bổ sung đang có để không bị báo thiếu trường bắt buộc khác
      const res = await updateShipmentCustom(r.id, { ...(r.custom_fields ?? {}), [def.key]: v }, r.version);
      if (!res.ok) return void toast.error(`${r.shipment_code}: ${res.error}`);
      toast.success(`${r.shipment_code}: đã lưu ${def.label.toLowerCase()}.`);
      router.refresh();
    });
  }
  const title = `Bấm để sửa ${def.label.toLowerCase()} chuyến ${r.shipment_code}`;

  if (def.type === "reference" && def.ref)
    return <RefPickCell refKey={def.ref} value={typeof cur === "string" ? cur : ""} display={display} editable allowClear={!def.required} pending={pending} title={title} onPick={(id) => save(id || null)} />;
  if (def.type === "select")
    return <SelectCell value={typeof cur === "string" ? cur : ""} options={def.options ?? []} display={display} editable pending={pending} title={title} allowEmpty={!def.required} onSave={(v) => save(v || null)} />;
  if (def.type === "boolean")
    return (
      <label className="flex h-7 items-center gap-1.5" title={title}>
        <input type="checkbox" className="size-4" disabled={pending} checked={cur === true} onChange={(e) => save(e.target.checked)} />
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
      </label>
    );
  if (def.type === "date")
    return <DateCell value={typeof cur === "string" ? cur.slice(0, 10) : ""} display={display} editable pending={pending} allowEmpty={!def.required} title={title} onSave={(v) => save(v || null)} />;

  const numeric = ["number", "currency", "percent"].includes(def.type);
  if (editing)
    return (
      <input
        autoFocus
        aria-label={title}
        defaultValue={cur === null || cur === undefined ? "" : numeric ? formatValue(def, cur).replace(/%$/, "") : String(cur)}
        inputMode={numeric ? "decimal" : undefined}
        maxLength={def.maxLength ?? 1000}
        className={cn("h-7 w-full min-w-0 rounded border border-ring bg-background px-1.5 text-sm outline-none", numeric && "text-right")}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={(e) => {
          setEditing(false);
          const v = e.currentTarget.value.trim();
          const before = cur === null || cur === undefined ? "" : numeric ? formatValue(def, cur).replace(/%$/, "") : String(cur);
          if (v === before.trim()) return;
          save(v === "" ? null : v);
        }}
      />
    );
  return (
    <button type="button" disabled={pending} title={title} className={cn(cellBtn, numeric && "justify-end")} onClick={() => setEditing(true)}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <span className="truncate">{display || empty}</span>}
    </button>
  );
}

const ymdVN = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }) : "");

/** Ngày nhận / Ngày giao dự kiến của chuyến */
export function ShipmentDateCell({ r, field, display, editable }: { r: ShipmentListRow; field: "pickup_at" | "expected_delivery_at"; display: ReactNode; editable: boolean }) {
  const label = field === "pickup_at" ? "Ngày nhận" : "Ngày giao dự kiến";
  const { pending, save } = useQuickSave(r, label);
  return (
    <DateCell
      value={ymdVN(r[field])}
      display={display}
      editable={editable && r.status !== "cancelled"}
      pending={pending}
      allowEmpty={field === "expected_delivery_at"}
      title={`Bấm để sửa ${label.toLowerCase()} chuyến ${r.shipment_code}`}
      onSave={(v) => save({ field, value: v } as Omit<QuickEditInput, "shipmentId" | "version">)}
    />
  );
}

type RefField = "pickup_location_id" | "delivery_location_id" | "empty_return_location_id" | "offroute_return_location_id" | "vehicle_type_id" | "driver_id";
const REF_META: Record<RefField, { refKey: string; label: string; clear: boolean; hint?: string }> = {
  pickup_location_id: { refKey: "locations", label: "Điểm nhận", clear: false, hint: "Đổi điểm nhận: hệ thống tìm lại bảng giá theo tuyến mới." },
  delivery_location_id: { refKey: "locations", label: "Điểm giao", clear: false, hint: "Đổi điểm giao: hệ thống tìm lại bảng giá theo tuyến mới." },
  empty_return_location_id: { refKey: "locations_depot", label: "Điểm hạ rỗng", clear: true },
  offroute_return_location_id: { refKey: "locations_depot", label: "Hạ rỗng trái tuyến", clear: true },
  vehicle_type_id: { refKey: "vehicle_types", label: "Loại xe", clear: true, hint: "Đổi loại xe: hệ thống tìm lại bảng giá." },
  driver_id: { refKey: "drivers_internal", label: "Tài xế", clear: false, hint: "Chỉ tài xế công ty, giữ xe đang gắn. Tài xế 3PL: bấm Đổi ở Điều phối." },
};
const ASSIGNABLE = ["draft", "assigned", "accepted"];

/** Điểm nhận / giao / hạ rỗng, loại xe, tài xế của chuyến: chọn trong danh mục */
export function ShipmentRefCell({ r, field, display, editable }: { r: ShipmentListRow; field: RefField; display: ReactNode; editable: boolean }) {
  const m = REF_META[field];
  const { pending, save } = useQuickSave(r, m.label);
  const ok = editable && r.status !== "cancelled" && (field !== "driver_id" || ASSIGNABLE.includes(r.status));
  return (
    <RefPickCell
      refKey={m.refKey}
      value={(r[field] as string | null | undefined) ?? ""}
      display={display}
      editable={ok}
      allowClear={m.clear}
      pending={pending}
      hint={m.hint}
      title={`Bấm để đổi ${m.label.toLowerCase()} chuyến ${r.shipment_code}`}
      onPick={(id) => save({ field, value: id } as Omit<QuickEditInput, "shipmentId" | "version">)}
    />
  );
}

/** Đơn vị tính giá (Chuyến / Km / Tấn) */
export function PricingUnitCell({ r, display, editable, options }: { r: ShipmentListRow; display: ReactNode; editable: boolean; options: { value: string; label: string }[] }) {
  const { pending, save } = useQuickSave(r, "ĐVT");
  return (
    <SelectCell
      value={r.pricing_unit}
      options={options}
      display={display}
      editable={editable && r.status !== "cancelled"}
      pending={pending}
      title={`Bấm để đổi đơn vị tính giá chuyến ${r.shipment_code}`}
      onSave={(v) => save({ field: "pricing_unit", value: v as "trip" | "km" | "ton" })}
    />
  );
}
