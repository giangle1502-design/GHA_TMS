"use client";
import { useState } from "react";
import { Filter, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { ADV_OPS, ADV_OP_LABEL, opNeedsValue, type AdvCondition, type AdvField } from "@/lib/advanced-filter";

/** Nút + hộp "Tìm kiếm nâng cao": người dùng tự thêm điều kiện theo bất kỳ trường nào (nối bằng VÀ). */
export function AdvancedFilter({
  fields,
  value,
  valueLabels = {},
  onApply,
}: {
  fields: AdvField[];
  value: AdvCondition[];
  /** Nhãn hiển thị của giá trị tham chiếu (id -> tên) */
  valueLabels?: Record<string, string>;
  onApply: (conds: AdvCondition[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AdvCondition[]>(value);
  const [labels, setLabels] = useState<Record<string, string>>(valueLabels);
  const byKey = (k: string) => fields.find((f) => f.key === k);

  const blank = (): AdvCondition => {
    const f = fields[0];
    return { field: f.key, op: ADV_OPS[f.kind][0], value: f.kind === "boolean" ? "true" : "" };
  };
  const set = (i: number, patch: Partial<AdvCondition>) => setDraft((d) => d.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const describe = (c: AdvCondition) => {
    const f = byKey(c.field);
    if (!f) return "";
    let v = c.value;
    if (f.kind === "select") v = f.options?.find((o) => o.value === v)?.label ?? v;
    if (f.kind === "boolean") v = v === "true" ? "Có" : "Không";
    if (f.kind === "reference") v = labels[v] ?? valueLabels[v] ?? "…";
    if (f.kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) v = v.split("-").reverse().join("/");
    return `${f.label} ${ADV_OP_LABEL[c.op]}${opNeedsValue(c.op) ? ` “${v}”` : ""}`;
  };

  return (
    <>
      <Button
        type="button"
        variant={value.length ? "default" : "outline"}
        size="sm"
        onClick={() => {
          setDraft(value.length ? value : [blank()]);
          setOpen(true);
        }}
      >
        <Filter /> Tìm kiếm nâng cao{value.length ? ` (${value.length})` : ""}
      </Button>
      {value.length ? (
        <div className="flex w-full flex-wrap gap-1.5" aria-label="Điều kiện đang áp dụng">
          {value.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border bg-primary/5 py-0.5 pr-1 pl-2.5 text-xs">
              {describe(c)}
              <button type="button" aria-label={`Bỏ điều kiện ${describe(c)}`} className="rounded-full p-0.5 hover:bg-muted" onClick={() => onApply(value.filter((_, j) => j !== i))}>
                <X className="size-3" />
              </button>
            </span>
          ))}
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => onApply([])}>
            Bỏ tất cả
          </button>
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Tìm kiếm nâng cao</DialogTitle>
            <DialogDescription>Thêm điều kiện theo bất kỳ cột nào. Dòng phải thỏa tất cả điều kiện.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {draft.map((c, i) => {
              const f = byKey(c.field) ?? fields[0];
              return (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,9rem)_minmax(0,1fr)_auto] sm:border-0 sm:p-0">
                  <NativeSelect
                    aria-label={`Trường điều kiện ${i + 1}`}
                    value={c.field}
                    onChange={(e) => {
                      const nf = byKey(e.target.value)!;
                      set(i, { field: nf.key, op: ADV_OPS[nf.kind][0], value: nf.kind === "boolean" ? "true" : "" });
                    }}
                    className="col-span-1"
                  >
                    {fields.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <Button type="button" variant="ghost" size="icon" className="sm:order-last" aria-label={`Xóa điều kiện ${i + 1}`} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
                    <X />
                  </Button>
                  <NativeSelect aria-label={`Phép so sánh ${i + 1}`} value={c.op} onChange={(e) => set(i, { op: e.target.value as AdvCondition["op"] })}>
                    {ADV_OPS[f.kind].map((op) => (
                      <option key={op} value={op}>
                        {ADV_OP_LABEL[op]}
                      </option>
                    ))}
                  </NativeSelect>
                  <div className="col-span-2 sm:col-span-1">
                    {!opNeedsValue(c.op) ? null : f.kind === "select" || f.kind === "boolean" ? (
                      <NativeSelect aria-label={`Giá trị ${i + 1}`} value={c.value} onChange={(e) => set(i, { value: e.target.value })}>
                        {f.kind === "boolean" ? (
                          <>
                            <option value="true">Có</option>
                            <option value="false">Không</option>
                          </>
                        ) : (
                          <>
                            <option value="">Chọn…</option>
                            {f.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </>
                        )}
                      </NativeSelect>
                    ) : f.kind === "reference" && f.ref ? (
                      <ReferenceSelect
                        key={`${i}-${f.key}`}
                        refKey={f.ref}
                        value={c.value}
                        initialLabel={labels[c.value] ?? valueLabels[c.value]}
                        allowQuickCreate={false}
                        onChange={(id, label) => {
                          setLabels((l) => ({ ...l, [id]: label }));
                          set(i, { value: id });
                        }}
                      />
                    ) : (
                      <Input
                        aria-label={`Giá trị ${i + 1}`}
                        type={f.kind === "date" ? "date" : "text"}
                        inputMode={f.kind === "number" ? "decimal" : undefined}
                        value={c.value}
                        placeholder={f.kind === "number" ? "Ví dụ 1000000" : "Nhập giá trị"}
                        onChange={(e) => set(i, { value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            onApply(draft.filter((d) => !opNeedsValue(d.op) || d.value.trim()));
                            setOpen(false);
                          }
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => setDraft((d) => [...d, blank()])}>
              <Plus /> Thêm điều kiện
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDraft([])}>
              Xóa hết
            </Button>
            <Button
              type="button"
              onClick={() => {
                onApply(draft.filter((d) => !opNeedsValue(d.op) || d.value.trim()));
                setOpen(false);
              }}
            >
              Áp dụng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
