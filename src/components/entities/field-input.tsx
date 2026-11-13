"use client";
import { Controller, type Control, type UseFormRegister } from "react-hook-form";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { compactUpper, parseNumberVN } from "@/lib/entities/record";
import type { FieldDef } from "@/lib/entities/types";
import { ReferenceSelect } from "./reference-select";
import { AddOptionButton, useFieldOptions } from "./add-option";

type Values = Record<string, unknown>;

export function FieldInput({
  field,
  control,
  register,
  invalid,
  refLabel,
  disabled,
  idPrefix = "f_",
  onRefChange,
}: {
  field: FieldDef;
  control: Control<Values>;
  register: UseFormRegister<Values>;
  invalid?: boolean;
  refLabel?: string;
  disabled?: boolean;
  /** Tiền tố id của ô nhập (nhiều biểu mẫu trên cùng trang) */
  idPrefix?: string;
  /** Báo nhãn của mục vừa chọn ở ô tham chiếu */
  onRefChange?: (label: string) => void;
}) {
  const id = `${idPrefix}${field.key}`;
  const common = { id, "aria-invalid": invalid || undefined, disabled };
  switch (field.type) {
    case "textarea":
      return <Textarea {...common} rows={3} maxLength={field.maxLength} placeholder={field.placeholder} {...register(field.key)} />;
    case "select":
      return (
        <Controller
          control={control}
          name={field.key}
          render={({ field: f }) => (
            <OptionSelect id={id} field={field} invalid={invalid} disabled={disabled} value={String(f.value ?? "")} onChange={f.onChange} onBlur={f.onBlur} />
          )}
        />
      );
    case "multiselect":
      return (
        <Controller
          control={control}
          name={field.key}
          render={({ field: f }) => {
            const arr = Array.isArray(f.value) ? (f.value as string[]) : [];
            return <OptionChecks id={id} field={field} invalid={invalid} disabled={disabled} value={arr} onChange={f.onChange} />;
          }}
        />
      );
    case "boolean":
      return (
        <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" id={id} disabled={disabled} className="size-4" {...register(field.key)} />
          {field.label}
        </label>
      );
    case "reference":
      if (!field.ref) return <Input {...common} disabled />;
      return (
        <Controller
          control={control}
          name={field.key}
          render={({ field: f }) => (
            <ReferenceSelect
              id={id}
              refKey={field.ref!}
              value={String(f.value ?? "")}
              initialLabel={refLabel}
              onChange={(v, label) => {
                f.onChange(v);
                onRefChange?.(label);
              }}
              disabled={disabled}
              invalid={invalid}
            />
          )}
        />
      );
    case "date":
      return <Input {...common} type="date" {...register(field.key)} />;
    case "datetime":
      return <Input {...common} type="datetime-local" {...register(field.key)} />;
    case "number":
    case "percent":
    case "currency":
      return (
        <div className="relative">
          <Input
            {...common}
            inputMode="decimal"
            autoComplete="off"
            placeholder={field.placeholder}
            className={field.type !== "number" ? "pr-9" : undefined}
            {...register(field.key, {
              onBlur: (e) => {
                if (field.type !== "currency") return;
                const n = parseNumberVN(e.target.value, true);
                if (n !== null && Number.isFinite(n)) e.target.value = formatNumber(n);
              },
            })}
          />
          {field.type !== "number" ? (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
              {field.type === "currency" ? "₫" : "%"}
            </span>
          ) : null}
        </div>
      );
    case "email":
      return <Input {...common} type="email" autoComplete="off" placeholder={field.placeholder} {...register(field.key)} />;
    case "phone":
      return <Input {...common} type="tel" inputMode="tel" autoComplete="off" placeholder={field.placeholder ?? "0901 234 567"} {...register(field.key)} />;
    case "url":
      return <Input {...common} type="url" placeholder={field.placeholder ?? "https://"} {...register(field.key)} />;
    case "gps":
      return <Input {...common} placeholder="10.762622, 106.660172" {...register(field.key)} />;
    case "file":
      return <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">Tải tệp/ảnh cho trường động sẽ có ở Giai đoạn 5.</p>;
    default:
      if (field.compactUpper) {
        const reg = register(field.key);
        return (
          <Input
            {...common}
            {...reg}
            maxLength={field.maxLength}
            placeholder={field.placeholder}
            autoComplete="off"
            autoCapitalize="characters"
            className="font-mono uppercase"
            onChange={(e) => {
              e.target.value = compactUpper(e.target.value);
              return reg.onChange(e);
            }}
          />
        );
      }
      if (field.suggestions?.length) {
        return (
          <>
            <Input {...common} maxLength={field.maxLength} placeholder={field.placeholder} autoComplete="off" list={`${field.key}-goi-y`} {...register(field.key)} />
            <datalist id={`${field.key}-goi-y`}>
              {field.suggestions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </>
        );
      }
      return <Input {...common} maxLength={field.maxLength} placeholder={field.placeholder} autoComplete="off" {...register(field.key)} />;
  }
}

/** Ô chọn một: kèm nút + thêm lựa chọn mới (trường bổ sung) */
function OptionSelect({
  id,
  field,
  value,
  onChange,
  onBlur,
  invalid,
  disabled,
}: {
  id: string;
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const { options, canAdd } = useFieldOptions(field);
  const select = (
    <NativeSelect id={id} aria-invalid={invalid || undefined} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}>
      <option value="">{field.required ? "— Chọn —" : "— Không chọn —"}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {value && !options.some((o) => o.value === value) ? <option value={value}>{value}</option> : null}
    </NativeSelect>
  );
  if (!canAdd) return select;
  return (
    <div className="flex gap-1.5">
      {select}
      <AddOptionButton field={field} disabled={disabled} onAdded={(o) => onChange(o.value)} />
    </div>
  );
}

/** Ô chọn nhiều: kèm nút + thêm lựa chọn mới (trường bổ sung), thêm xong tự đánh dấu */
function OptionChecks({
  id,
  field,
  value,
  onChange,
  invalid,
  disabled,
}: {
  id: string;
  field: FieldDef;
  value: string[];
  onChange: (v: string[]) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const { options, canAdd } = useFieldOptions(field);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-2" id={id} aria-invalid={invalid || undefined}>
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            disabled={disabled}
            checked={value.includes(o.value)}
            onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((x) => x !== o.value))}
          />
          {o.label}
        </label>
      ))}
      {canAdd ? (
        <AddOptionButton
          field={field}
          disabled={disabled}
          className="ml-auto size-7 shrink-0"
          onAdded={(o) => onChange(value.includes(o.value) ? value : [...value, o.value])}
        />
      ) : null}
    </div>
  );
}
