"use client";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { addFieldOption } from "@/lib/entities/option-actions";
import type { FieldDef, Option } from "@/lib/entities/types";

type Ctx = {
  canAdd: boolean;
  /** Lựa chọn vừa thêm trong phiên làm việc, theo id trường (mọi ô của cùng trường thấy ngay) */
  extras: Record<string, Option[]>;
  push: (fieldId: string, o: Option) => void;
};

const OptionCtx = createContext<Ctx>({ canAdd: false, extras: {}, push: () => {} });

export function OptionAddProvider({ canAdd, children }: { canAdd: boolean; children: ReactNode }) {
  const [extras, setExtras] = useState<Record<string, Option[]>>({});
  const push = useCallback((fieldId: string, o: Option) => {
    setExtras((m) => ((m[fieldId] ?? []).some((x) => x.value === o.value) ? m : { ...m, [fieldId]: [...(m[fieldId] ?? []), o] }));
  }, []);
  const value = useMemo(() => ({ canAdd, extras, push }), [canAdd, extras, push]);
  return <OptionCtx.Provider value={value}>{children}</OptionCtx.Provider>;
}

/** Lựa chọn của trường (gồm cả lựa chọn vừa thêm) và có hiện nút + hay không */
export function useFieldOptions(field: FieldDef): { options: Option[]; canAdd: boolean } {
  const { canAdd, extras } = useContext(OptionCtx);
  const base = field.options ?? [];
  const more = field.fieldId ? (extras[field.fieldId] ?? []).filter((o) => !base.some((b) => b.value === o.value)) : [];
  return {
    options: more.length ? [...base, ...more] : base,
    canAdd: canAdd && Boolean(field.fieldId) && (field.type === "select" || field.type === "multiselect") && !field.readOnly,
  };
}

/** Nút + cạnh ô chọn: gõ tên lựa chọn mới → lưu vào trường → chọn luôn */
export function AddOptionButton({ field, onAdded, disabled, className }: { field: FieldDef; onAdded: (o: Option) => void; disabled?: boolean; className?: string }) {
  const { push } = useContext(OptionCtx);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const n = name.trim();
    if (!n || !field.fieldId) return;
    setBusy(true);
    const res = await addFieldOption(field.fieldId, n);
    setBusy(false);
    if (!res.ok || !res.data) {
      toast.error(res.ok ? "Không thêm được lựa chọn" : res.error);
      return;
    }
    const o = { value: res.data.value, label: res.data.label };
    push(field.fieldId, o);
    onAdded(o);
    toast.success(res.data.existed ? `“${o.label}” đã có sẵn, đã chọn.` : `Đã thêm lựa chọn “${o.label}”.`);
    setName("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={className ?? "size-9 shrink-0"}
          disabled={disabled}
          title={`Thêm lựa chọn mới cho “${field.label}”`}
          aria-label={`Thêm lựa chọn mới cho ${field.label}`}
        >
          <Plus className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2" onOpenAutoFocus={(e) => e.preventDefault()}>
        <p className="text-xs font-medium">Thêm lựa chọn cho “{field.label}”</p>
        <Input
          autoFocus
          value={name}
          maxLength={200}
          placeholder="Ví dụ: Nội địa"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              void save();
            }
          }}
        />
        <p className="text-xs text-muted-foreground">Lưu vào danh sách chọn của trường, mọi người dùng thấy ngay. Sửa/xóa lựa chọn ở Quản lý trường dữ liệu.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Hủy
          </Button>
          <Button type="button" size="sm" disabled={busy || !name.trim()} onClick={() => void save()}>
            {busy ? "Đang lưu…" : "Thêm và chọn"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
