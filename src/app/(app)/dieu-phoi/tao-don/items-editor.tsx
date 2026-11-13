"use client";
import { useState } from "react";
import { ClipboardPaste, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AddFieldButton } from "@/components/entities/add-field-button";
import { applyLayout, formatValue, parseNumberVN, systemLabel, systemSettingsOf } from "@/lib/entities/record";
import { computeFormula } from "@/lib/formula";
import { formatNumber } from "@/lib/format";
import type { CustomFieldRow, FieldDef } from "@/lib/entities/types";
import { AddOptionButton, useFieldOptions } from "@/components/entities/add-option";

export type ItemLine = { key: number; item_code: string; item_name: string; quantity: string; unit: string; note: string; custom: Record<string, unknown> };

let seq = 0;
export const newItem = (from?: Partial<ItemLine>): ItemLine => ({
  key: ++seq,
  item_code: from?.item_code ?? "",
  item_name: from?.item_name ?? "",
  quantity: from?.quantity ?? "",
  unit: from?.unit ?? "",
  note: from?.note ?? "",
  custom: { ...(from?.custom ?? {}) },
});

/** Dữ liệu gửi lên máy chủ (dòng trống bị bỏ qua ở máy chủ) */
export const itemsPayload = (lines: ItemLine[]) =>
  lines.map((l) => ({ item_code: l.item_code, item_name: l.item_name, quantity: l.quantity, unit: l.unit, note: l.note, custom: l.custom }));

const SYSTEM_COLS = [
  { key: "item_code", label: "Mã hàng", width: "w-32", placeholder: "VD: MH001" },
  { key: "item_name", label: "Tên hàng", width: "min-w-48", placeholder: "VD: Thép cuộn" },
  { key: "quantity", label: "Số lượng", width: "w-24", placeholder: "0" },
  { key: "unit", label: "ĐVT", width: "w-20", placeholder: "kiện" },
  { key: "note", label: "Ghi chú", width: "min-w-40", placeholder: "" },
] as const;
type SysKey = (typeof SYSTEM_COLS)[number]["key"];

const lineVars = (l: ItemLine) => ({ ...l.custom, quantity: parseNumberVN(l.quantity) ?? null });
// Chỉ cộng tổng cột số lượng/trọng lượng (số) và cột công thức; không cộng đơn giá
const NUMERIC = ["number", "currency", "percent", "formula"];

/** Bảng hàng hóa của chuyến: mỗi dòng một mã hàng, thêm dòng, dán từ Excel, cột bổ sung do người dùng tự thêm */
export function ItemsEditor({
  value,
  onChange,
  fields,
  layout,
  canAddField,
  fieldRows,
  idPrefix,
}: {
  value: ItemLine[];
  onChange: (lines: ItemLine[]) => void;
  fields: FieldDef[];
  layout: string[];
  canAddField: boolean;
  fieldRows: CustomFieldRow[];
  idPrefix: string;
}) {
  const [paste, setPaste] = useState<string | null>(null);
  const sysSet = systemSettingsOf("shipment_items", fieldRows);
  const cols = applyLayout([...SYSTEM_COLS.map((c) => ({ key: c.key as string, sys: { ...c, label: systemLabel(sysSet, c.key, c.label) }, field: null as FieldDef | null })), ...fields.map((f) => ({ key: f.key, sys: null, field: f }))], layout);
  const set = (key: number, patch: Partial<ItemLine>) => onChange(value.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const totalQty = value.reduce((a, l) => a + (parseNumberVN(l.quantity) ?? 0), 0);
  const sumOf = (f: FieldDef) => value.reduce((a, l) => a + (f.type === "formula" ? (computeFormula(f.formula, lineVars(l)) ?? 0) : (parseNumberVN(l.custom[f.key], f.type === "currency") ?? 0)), 0);

  function applyPaste() {
    const lines = (paste ?? "")
      .split(/\r?\n/)
      .map((r) => r.split("\t"))
      .filter((c) => c.some((x) => x.trim()));
    const add = lines.map(([item_code = "", item_name = "", quantity = "", unit = "", note = ""]) =>
      newItem({ item_code: item_code.trim(), item_name: item_name.trim(), quantity: quantity.trim(), unit: unit.trim(), note: note.trim() }),
    );
    onChange([...value.filter((l) => l.item_code || l.item_name || l.quantity || l.note), ...add].slice(0, 500));
    setPaste(null);
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">
          Hàng hóa (mã hàng) <span className="font-normal text-muted-foreground">· không bắt buộc, dùng khi khách yêu cầu kê từng mã hàng</span>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, newItem({ unit: value.at(-1)?.unit })])}>
            <Plus /> Thêm dòng
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setPaste("")}>
            <ClipboardPaste /> Dán từ Excel
          </Button>
        </div>
      </div>
      {value.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Hàng hóa của chuyến">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="w-8 py-1 pr-2">#</th>
                {cols.map((c) => (
                  <th key={c.key} className={`py-1 pr-2 font-medium ${c.sys?.width ?? "min-w-28"}`}>
                    {c.sys?.label ?? c.field?.label}
                    {c.field?.required ? <span className="text-destructive"> *</span> : null}
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {value.map((l, i) => (
                <tr key={l.key} className="align-top">
                  <td className="py-1 pr-2 pt-3 text-muted-foreground">{i + 1}</td>
                  {cols.map((c) => (
                    <td key={c.key} className="py-1 pr-2">
                      {c.sys ? (
                        <Input
                          aria-label={`${c.sys.label} dòng ${i + 1}`}
                          id={i === 0 ? `${idPrefix}${c.key}` : undefined}
                          className="h-8"
                          inputMode={c.key === "quantity" ? "decimal" : undefined}
                          placeholder={i === 0 ? c.sys.placeholder : undefined}
                          value={l[c.key as SysKey]}
                          maxLength={c.key === "item_name" ? 300 : c.key === "note" ? 500 : 100}
                          onChange={(e) => set(l.key, { [c.key]: e.target.value } as Partial<ItemLine>)}
                        />
                      ) : (
                        <CellInput field={c.field!} line={l} index={i} onChange={(v) => set(l.key, { custom: { ...l.custom, [c.field!.key]: v } })} />
                      )}
                    </td>
                  ))}
                  <td className="py-1">
                    <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" aria-label={`Xóa dòng ${i + 1}`} onClick={() => onChange(value.filter((x) => x.key !== l.key))}>
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t text-sm font-medium">
                <td className="py-1.5 pr-2" />
                {cols.map((c) => (
                  <td key={c.key} className="py-1.5 pr-2">
                    {c.key === "item_code"
                      ? `Tổng ${value.length} dòng`
                      : c.key === "quantity"
                        ? formatNumber(totalQty)
                        : c.field && (c.field.type === "number" || c.field.type === "formula")
                          ? formatValue(c.field.type === "formula" ? { ...c.field, type: "number" } : c.field, sumOf(c.field))
                          : ""}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Chưa có dòng hàng nào. Bấm “Thêm dòng” để nhập từng mã hàng, hoặc “Dán từ Excel” để dán nhiều dòng cùng lúc.</p>
      )}
      {canAddField ? <AddFieldButton module="shipment_items" customRows={fieldRows} label="Thêm cột (VD: Số seal, Trọng lượng, Thành tiền)" /> : null}

      <Dialog open={paste !== null} onOpenChange={(o) => !o && setPaste(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dán hàng hóa từ Excel</DialogTitle>
            <DialogDescription>Trong Excel, chọn các ô theo thứ tự cột: Mã hàng, Tên hàng, Số lượng, ĐVT, Ghi chú (cột nào không có thì để trống), bấm Ctrl+C rồi dán vào đây.</DialogDescription>
          </DialogHeader>
          <Textarea aria-label="Dữ liệu dán từ Excel" className="min-h-40 font-mono text-xs" value={paste ?? ""} onChange={(e) => setPaste(e.target.value)} placeholder={"MH001\tThép cuộn\t12\ttấn\nMH002\tTôn lạnh\t30\tcuộn"} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaste(null)}>
              Đóng
            </Button>
            <Button onClick={applyPaste} disabled={!paste?.trim()}>
              Thêm vào bảng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CellInput({ field: f, line, index, onChange }: { field: FieldDef; line: ItemLine; index: number; onChange: (v: unknown) => void }) {
  const label = `${f.label} dòng ${index + 1}`;
  const v = line.custom[f.key];
  if (f.type === "formula") {
    return <div className="flex h-8 items-center rounded-md border bg-muted/40 px-2 text-sm">{formatValue({ ...f, type: "number" }, computeFormula(f.formula, lineVars(line))) || "—"}</div>;
  }
  if (f.type === "select") return <CellSelect field={f} label={label} value={String(v ?? "")} onChange={onChange} />;
  if (f.type === "boolean") {
    return <input type="checkbox" aria-label={label} className="mt-2 size-4" checked={v === true} onChange={(e) => onChange(e.target.checked)} />;
  }
  return (
    <Input
      aria-label={label}
      className="h-8"
      type={f.type === "date" ? "date" : "text"}
      inputMode={NUMERIC.includes(f.type) ? "decimal" : undefined}
      value={String(v ?? "")}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Ô chọn trong bảng hàng hóa, kèm nút + thêm lựa chọn mới */
function CellSelect({ field: f, label, value, onChange }: { field: FieldDef; label: string; value: string; onChange: (v: unknown) => void }) {
  const { options, canAdd } = useFieldOptions(f);
  return (
    <div className="flex gap-1">
      <NativeSelect aria-label={label} className="h-8" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {value && !options.some((o) => o.value === value) ? <option value={value}>{value}</option> : null}
      </NativeSelect>
      {canAdd ? <AddOptionButton field={f} className="size-8 shrink-0" onAdded={(o) => onChange(o.value)} /> : null}
    </div>
  );
}
