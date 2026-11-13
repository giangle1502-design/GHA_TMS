"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ItemsEditor, itemsPayload, newItem, type ItemLine } from "@/app/(app)/dieu-phoi/tao-don/items-editor";
import { saveShipmentItems } from "@/app/(app)/dieu-phoi/actions";
import { applyLayout, formatValue } from "@/lib/entities/record";
import { computeFormula } from "@/lib/formula";
import { formatNumber } from "@/lib/format";
import type { CustomFieldRow, FieldDef } from "@/lib/entities/types";

export type ShipmentItem = { line_no: number; item_code: string | null; item_name: string | null; quantity: number | null; unit: string | null; note: string | null; custom_fields: Record<string, unknown> };

const SYS = [
  { key: "item_code", label: "Mã hàng" },
  { key: "item_name", label: "Tên hàng" },
  { key: "quantity", label: "Số lượng" },
  { key: "unit", label: "ĐVT" },
  { key: "note", label: "Ghi chú" },
] as const;

/** Hàng hóa (mã hàng) của chuyến: xem, và sửa khi có quyền điều phối */
export function ItemsCard({
  shipmentId,
  items,
  fields,
  layout,
  fieldRows,
  canEdit,
  canAddField,
}: {
  shipmentId: string;
  items: ShipmentItem[];
  fields: FieldDef[];
  layout: string[];
  fieldRows: CustomFieldRow[];
  canEdit: boolean;
  canAddField: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ItemLine[] | null>(null);
  const [pending, start] = useTransition();
  const cols = applyLayout([...SYS.map((c) => ({ key: c.key as string, label: c.label, field: null as FieldDef | null })), ...fields.map((f) => ({ key: f.key, label: f.label, field: f }))], layout);
  const cell = (it: ShipmentItem, key: string, f: FieldDef | null) => {
    if (!f) return key === "quantity" ? (it.quantity === null ? "" : formatNumber(Number(it.quantity))) : ((it[key as keyof ShipmentItem] as string | null) ?? "");
    if (f.type === "formula") return formatValue({ ...f, type: "number" }, computeFormula(f.formula, { ...it.custom_fields, quantity: it.quantity }));
    return formatValue(f, it.custom_fields?.[f.key]);
  };

  return (
    <Card className="lg:col-span-3">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Hàng hóa ({items.length} mã hàng)</CardTitle>
        {canEdit && !editing ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setEditing(
                items.map((it) =>
                  newItem({ item_code: it.item_code ?? "", item_name: it.item_name ?? "", quantity: it.quantity === null ? "" : String(it.quantity), unit: it.unit ?? "", note: it.note ?? "", custom: it.custom_fields ?? {} }),
                ),
              )
            }
          >
            <Pencil /> Sửa hàng hóa
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <>
            <ItemsEditor value={editing} onChange={setEditing} fields={fields} layout={layout} canAddField={canAddField} fieldRows={fieldRows} idPrefix="ct-it-" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={pending} onClick={() => setEditing(null)}>
                Đóng
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await saveShipmentItems({ shipmentId, items: itemsPayload(editing) });
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(r.message);
                    setEditing(null);
                    router.refresh();
                  })
                }
              >
                {pending ? <Loader2 className="animate-spin" /> : <Save />} Lưu hàng hóa
              </Button>
            </div>
          </>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Chưa kê mã hàng cho chuyến này.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Hàng hóa của chuyến">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3">#</th>
                  {cols.map((c) => (
                    <th key={c.key} className="py-1.5 pr-3 font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.line_no} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 text-muted-foreground">{it.line_no}</td>
                    {cols.map((c) => (
                      <td key={c.key} className="py-1.5 pr-3">
                        {cell(it, c.key, c.field)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-medium">
                  <td />
                  {cols.map((c) => (
                    <td key={c.key} className="py-1.5 pr-3">
                      {c.key === "quantity" ? formatNumber(items.reduce((a, it) => a + Number(it.quantity ?? 0), 0)) : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
