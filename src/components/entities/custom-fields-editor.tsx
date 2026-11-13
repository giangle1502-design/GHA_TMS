"use client";
import { useEffect, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { computeFormula } from "@/lib/formula";
import { applyLayout, formatValue, isFieldShown, toFormValues } from "@/lib/entities/record";
import type { FieldDef } from "@/lib/entities/types";
import { FieldInput } from "./field-input";

type Values = Record<string, unknown>;

/**
 * Ô nhập cho các trường bổ sung (người dùng tự thêm) trong biểu mẫu không thuộc bộ danh mục chung, ví dụ đơn hàng, chuyến.
 * Truyền `slots` (ô của trường hệ thống, đã bọc sẵn) và `order` để xếp chung với trường bổ sung theo thứ tự người dùng sắp.
 */
export function CustomFieldsEditor({
  fields,
  idPrefix,
  initial,
  onChange,
  className,
  slots,
  order = [],
  context,
}: {
  fields: FieldDef[];
  idPrefix: string;
  initial?: Values | null;
  onChange: (values: Values) => void;
  className?: string;
  slots?: Record<string, ReactNode>;
  order?: string[];
  /** Số liệu hệ thống (đơn giá, % hỗ trợ dầu...) mà công thức của trường bổ sung dùng được */
  context?: Values;
}) {
  const form = useForm<Values>({ defaultValues: toFormValues(fields, initial ?? null) });
  const values = useWatch({ control: form.control }) as Values;
  useEffect(() => {
    onChange(values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values)]);
  if (!fields.length && !slots) return null;
  const items = applyLayout(
    [...Object.keys(slots ?? {}).map((key) => ({ key, field: null as FieldDef | null })), ...fields.map((f) => ({ key: f.key, field: f as FieldDef | null }))],
    order,
  );
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {items.map(({ key, field: f }) => {
        if (!f) return <div key={`slot-${key}`} className="contents">{slots?.[key]}</div>;
        if (!isFieldShown(f, { ...context, ...values })) return null;
        const wide = f.wide || f.type === "textarea" || f.type === "multiselect";
        if (f.type === "formula" || f.readOnly) {
          const v = f.type === "formula" ? computeFormula(f.formula, { ...context, ...values }) : initial?.[f.key];
          return (
            <div key={f.key} className={cn("space-y-1.5", wide && "sm:col-span-2")}>
              <Label>{f.label}</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{formatValue(f, v) || "—"}</div>
              {f.type === "formula" ? <p className="text-xs text-muted-foreground">Tự tính: {f.formula}</p> : null}
            </div>
          );
        }
        return (
          <div key={f.key} className={cn("space-y-1.5", wide && "sm:col-span-2")}>
            {f.type !== "boolean" ? (
              <Label htmlFor={`${idPrefix}${f.key}`}>
                {f.label}
                {f.required ? <span className="text-destructive"> *</span> : null}
              </Label>
            ) : null}
            <FieldInput field={f} control={form.control} register={form.register} idPrefix={idPrefix} />
            {f.help ? <p className="text-xs text-muted-foreground">{f.help}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
