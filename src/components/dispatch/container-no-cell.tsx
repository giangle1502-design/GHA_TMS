"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { setShipmentContainerNo } from "@/app/(app)/dieu-phoi/quick-edit-actions";
import { containerCheckOk } from "@/lib/paste-orders";
import { normalizeContainerNo } from "@/lib/shipment-container";
import type { ShipmentListRow } from "@/lib/shipments";
import { cn } from "@/lib/utils";

/**
 * Ô "Số cont" trên bảng Điều phối / Quản lý chuyến: bấm vào để gõ số cont, Enter hoặc bấm ra ngoài để lưu,
 * Esc để bỏ. Để trống = xóa số cont. Số cont sai chữ số kiểm tra vẫn lưu nhưng hiện cảnh báo.
 */
export function ContainerNoCell({ r, editable }: { r: ShipmentListRow; editable: boolean }) {
  // Giá trị vừa lưu: hiện ngay, không chờ tải lại trang
  const [saved, setSaved] = useState<{ base: string | null | undefined; value: string | null } | null>(null);
  const value = saved && saved.base === r.container_no ? saved.value : (r.container_no ?? null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const bad = Boolean(value) && /^[A-Z]{4}\d{7}$/.test(value!) && !containerCheckOk(value!);
  const shown = value ? (
    <span className={cn("font-mono", bad && "text-amber-700 dark:text-amber-400")} title={bad ? "Số cont sai chữ số kiểm tra, xem lại" : undefined}>
      {value}
      {bad ? <AlertTriangle className="ml-1 inline size-3 align-[-1px]" /> : null}
    </span>
  ) : null;

  if (!editable || r.status === "cancelled") return <div className="truncate">{shown}</div>;

  function save() {
    const next = normalizeContainerNo(text) || null;
    setEditing(false);
    if (next === value) return;
    if (next && !/^[A-Z0-9]{1,30}$/.test(next)) return void toast.error("Số cont chỉ gồm chữ và số, tối đa 30 ký tự.");
    start(async () => {
      const res = await setShipmentContainerNo({ shipmentId: r.id, containerNo: next ?? "" });
      if (!res.ok) return void toast.error(res.error);
      const v = res.data?.containerNo ?? null;
      setSaved({ base: r.container_no, value: v });
      if (v && /^[A-Z]{4}\d{7}$/.test(v) && !containerCheckOk(v)) toast.warning(`${r.shipment_code}: đã lưu số cont ${v}, nhưng chữ số kiểm tra không khớp. Xem lại số cont.`);
      else toast.success(`${r.shipment_code}: ${res.message?.toLowerCase() ?? "đã lưu."}`);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={`Số cont chuyến ${r.shipment_code}`}
        value={text}
        maxLength={40}
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
        className="h-7 w-full min-w-0 rounded border border-ring bg-background px-1.5 font-mono text-sm outline-none"
        placeholder="TCLU1234567"
      />
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        setText(value ?? "");
        setEditing(true);
      }}
      title={`Bấm để ${value ? "sửa" : "nhập"} số cont chuyến ${r.shipment_code}`}
      className="flex h-7 w-full min-w-0 items-center rounded border border-dashed border-transparent px-1 text-left hover:border-muted-foreground/50 hover:bg-background"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : (shown ?? <span className="text-xs text-muted-foreground">Nhập số cont</span>)}
    </button>
  );
}
