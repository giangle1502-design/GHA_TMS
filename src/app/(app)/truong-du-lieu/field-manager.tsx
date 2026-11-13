"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { History, Loader2, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/entities/confirm-dialog";
import { ENTITIES } from "@/lib/entities/definitions";
import { FIELD_DATA_TYPES, REFERENCE_TARGETS, fieldTypeCompatible, slugifyKey } from "@/lib/entities/field-types";
import type { CustomFieldRow } from "@/lib/entities/types";
import { parseVisibility } from "@/lib/entities/record";
import { conditionSources } from "@/lib/entities/visibility";
import { validateFormula } from "@/lib/formula";
import { formatDateTime } from "@/lib/format";
import { permissionLabel as PERMISSION_LABEL } from "@/lib/permissions";
import {
  deleteField,
  getFieldImpact,
  listFieldVersions,
  restoreFieldVersion,
  saveField,
  setFieldStatus,
  type FieldImpact,
  type FieldInput,
  type FieldVersion,
} from "./actions";
import { FormLayoutCard, type FormLayoutCardProps } from "./form-layout-card";

const typeLabel = (t: string) => FIELD_DATA_TYPES.find((x) => x.value === t)?.label ?? t;

/** "chỉ hiện khi NCC = 3-PL" để hiện trong bảng trường */
function conditionText(module: string, rows: CustomFieldRow[], r: CustomFieldRow): string | null {
  const c = parseVisibility(r.visibility_condition);
  if (!c) return null;
  const src = conditionSources(module, rows).find((s) => s.key === c.field);
  const vals = c.in.map((v) => src?.options.find((o) => o.value === v)?.label ?? v).join(" hoặc ");
  return `chỉ hiện khi ${src?.label ?? c.field} = ${vals}`;
}

type FormV = Omit<FieldInput, "min" | "max" | "maxLength" | "sort_order" | "show_if_values"> & {
  min: string;
  max: string;
  maxLength: string;
  sort_order: string;
  show_if_values: string[];
};

function toForm(module: string, r: CustomFieldRow | null): FormV {
  const opts = (r?.options ?? []).map((o) => (typeof o === "string" ? o : o.value === o.label ? o.value : `${o.value}|${o.label}`));
  const dv = r?.default_value;
  const cond = parseVisibility(r?.visibility_condition);
  return {
    module,
    field_key: r?.field_key ?? "",
    label: r?.label ?? "",
    description: r?.description ?? "",
    data_type: r?.data_type ?? "short_text",
    is_required: r?.is_required ?? false,
    is_editable: r?.is_editable ?? true,
    is_visible: r?.is_visible ?? true,
    is_searchable: r?.is_searchable ?? false,
    is_filterable: r?.is_filterable ?? false,
    is_sortable: r?.is_sortable ?? false,
    default_value: dv === null || dv === undefined ? "" : Array.isArray(dv) ? dv.join(", ") : String(dv),
    display_format: (r?.display_format as FormV["display_format"]) ?? "",
    sort_order: String(r?.sort_order ?? 0),
    view_permission: r?.view_permission ?? "",
    edit_permission: r?.edit_permission ?? "",
    min: r?.validation?.min !== undefined ? String(r.validation.min) : "",
    max: r?.validation?.max !== undefined ? String(r.validation.max) : "",
    maxLength: r?.validation?.maxLength !== undefined ? String(r.validation.maxLength) : "",
    formula: r?.formula ?? "",
    options_text: opts.join("\n"),
    reference_target: r?.reference_target ?? "",
    status: (r?.status as "active" | "inactive") ?? "active",
    show_if_field: cond?.field ?? "",
    show_if_values: cond?.in ?? [],
    change_note: "",
  };
}

export function FieldManager({
  module,
  moduleLabel,
  rows,
  canConfigure,
  numericSystem,
  systemKeys,
  permissions,
  autoOpen = false,
  layout,
}: {
  module: string;
  moduleLabel: string;
  rows: CustomFieldRow[];
  canConfigure: boolean;
  numericSystem: { key: string; label: string }[];
  systemKeys: string[];
  permissions: readonly string[];
  /** Mở sẵn hộp thêm trường (đến từ liên kết "Thêm trường" trong biểu mẫu) */
  autoOpen?: boolean;
  /** Khung sắp thứ tự trên biểu mẫu, có nút sửa/ngừng dùng/xóa cho trường bổ sung */
  layout?: Omit<FormLayoutCardProps, "module" | "moduleLabel" | "canConfigure" | "actions"> & { resetKey: string };
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CustomFieldRow | null>(null);
  const [open, setOpen] = useState(autoOpen && canConfigure);
  const [historyOf, setHistoryOf] = useState<CustomFieldRow | null>(null);
  const [deleting, setDeleting] = useState<CustomFieldRow | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<FieldImpact | null>(null);
  const [pending, start] = useTransition();
  const editRow = (r: CustomFieldRow) => {
    setEditing(r);
    setOpen(true);
  };
  const toggleRow = (r: CustomFieldRow) =>
    start(async () => {
      const res = await setFieldStatus(r.id, r.status === "active" ? "inactive" : "active");
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else toast.error(res.error);
    });
  const deleteRow = (r: CustomFieldRow) => {
    setDeleting(r);
    setDeleteImpact(null);
    getFieldImpact(r.id).then((res) => res.ok && setDeleteImpact(res.data ?? null));
  };
  const withRow = (fn: (r: CustomFieldRow) => void) => (key: string) => {
    const r = rows.find((x) => x.field_key === key);
    if (r) fn(r);
  };

  return (
    <>
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="text-sm">
          <b>Trường bổ sung của {moduleLabel.toLowerCase()}</b> <span className="text-muted-foreground">({rows.length})</span>
        </div>
        {canConfigure ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus /> Thêm trường
          </Button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">Chưa có trường bổ sung nào. Ví dụ: “Số container”, “Ngày hết hạn phù hiệu”, “Hạng bằng lái”.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Tên hiển thị</th>
                <th className="px-3 py-2 text-left">Mã trường</th>
                <th className="px-3 py-2 text-left">Kiểu</th>
                <th className="px-3 py-2 text-left">Thuộc tính</th>
                <th className="px-3 py-2 text-left">Phiên bản</th>
                <th className="px-3 py-2 text-left">Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.label}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r.field_key}</td>
                  <td className="px-3 py-2">
                    {typeLabel(r.data_type)}
                    {r.data_type === "formula" ? <div className="font-mono text-xs text-muted-foreground">{r.formula}</div> : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {[
                      r.is_required && "bắt buộc",
                      r.is_visible && "hiện trên bảng",
                      r.is_filterable && "lọc",
                      r.is_searchable && "tìm kiếm",
                      r.view_permission && `xem: ${PERMISSION_LABEL(r.view_permission)}`,
                      conditionText(module, rows, r),
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2">v{r.version}</td>
                  <td className="px-3 py-2">
                    <Badge variant={r.status === "active" ? "success" : "secondary"}>{r.status === "active" ? "Đang dùng" : "Ngừng dùng"}</Badge>
                  </td>
                  <td className="px-2 py-1 text-right whitespace-nowrap">
                    <Button size="icon" variant="ghost" className="size-7" title="Lịch sử phiên bản" aria-label="Lịch sử" onClick={() => setHistoryOf(r)}>
                      <History className="size-3.5" />
                    </Button>
                    {canConfigure ? (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          title="Sửa"
                          aria-label="Sửa"
                          onClick={() => editRow(r)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          title={r.status === "active" ? "Ngừng sử dụng" : "Kích hoạt lại"}
                          aria-label={r.status === "active" ? "Ngừng sử dụng" : "Kích hoạt lại"}
                          disabled={pending}
                          onClick={() => toggleRow(r)}
                        >
                          <Power className="size-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive"
                          title="Xóa"
                          aria-label="Xóa"
                          onClick={() => deleteRow(r)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canConfigure ? (
        <FieldEditor
          key={editing?.id ?? "new"}
          open={open}
          onOpenChange={setOpen}
          module={module}
          row={editing}
          others={rows.filter((r) => r.id !== editing?.id)}
          numericSystem={numericSystem}
          systemKeys={systemKeys}
          permissions={permissions}
          onSaved={() => router.refresh()}
        />
      ) : null}
      <HistoryDialog row={historyOf} onClose={() => setHistoryOf(null)} canConfigure={canConfigure} onRestored={() => router.refresh()} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Xóa trường “${deleting?.label ?? ""}”?`}
        description={
          deleteImpact === null ? (
            "Đang kiểm tra dữ liệu liên quan…"
          ) : deleteImpact.records_with_value > 0 || deleteImpact.used_in_formulas.length > 0 || deleteImpact.used_in_visibility.length > 0 ? (
            <>
              Không thể xóa: {deleteImpact.records_with_value > 0 ? `${deleteImpact.records_with_value} bản ghi đang có dữ liệu` : ""}
              {deleteImpact.used_in_formulas.length ? ` · được dùng trong công thức: ${deleteImpact.used_in_formulas.map((f) => f.label).join(", ")}` : ""}
              {deleteImpact.used_in_visibility.length ? ` · là điều kiện hiện của: ${deleteImpact.used_in_visibility.map((f) => f.label).join(", ")}` : ""}. Hãy chọn “Ngừng
              sử dụng” để ẩn trường mà vẫn giữ dữ liệu.
            </>
          ) : (
            "Trường chưa có dữ liệu và không được công thức nào sử dụng. Thao tác này không hoàn tác được."
          )
        }
        confirmLabel="Xóa"
        destructive
        pending={pending}
        onConfirm={() =>
          start(async () => {
            const res = await deleteField(deleting!.id);
            if (res.ok) {
              toast.success(res.message);
              setDeleting(null);
              router.refresh();
            } else toast.error(res.error);
          })
        }
      />
    </Card>
    {layout ? (
      <FormLayoutCard
        key={layout.resetKey}
        module={module}
        moduleLabel={moduleLabel}
        canConfigure={canConfigure}
        items={layout.items}
        defaults={layout.defaults}
        appliesTo={layout.appliesTo}
        note={layout.note}
        actions={canConfigure ? { onEdit: withRow(editRow), onToggle: withRow(toggleRow), onDelete: withRow(deleteRow) } : undefined}
      />
    ) : null}
    </>
  );
}

export function FieldEditor({
  open,
  onOpenChange,
  module,
  row,
  others,
  numericSystem,
  systemKeys,
  permissions,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  module: string;
  row: CustomFieldRow | null;
  others: CustomFieldRow[];
  numericSystem: { key: string; label: string }[];
  systemKeys: string[];
  permissions: readonly string[];
  onSaved: () => void;
}) {
  const form = useForm<FormV>({ defaultValues: toForm(module, row) });
  const v = useWatch({ control: form.control }) as FormV;
  const [pending, start] = useTransition();
  const [impact, setImpact] = useState<FieldImpact | null>(null);
  const [keyTouched, setKeyTouched] = useState(Boolean(row));

  // Phân tích ảnh hưởng mỗi lần mở biểu mẫu sửa
  useEffect(() => {
    if (!open || !row) return;
    let alive = true;
    getFieldImpact(row.id).then((r) => alive && r.ok && setImpact(r.data ?? null));
    return () => {
      alive = false;
    };
  }, [open, row]);

  const numericRefs = useMemo(
    () => [
      ...numericSystem,
      ...others
        .filter((o) => o.status === "active" && FIELD_DATA_TYPES.find((t) => t.value === o.data_type)?.numeric && o.data_type !== "formula")
        .map((o) => ({ key: o.field_key, label: o.label })),
    ],
    [numericSystem, others],
  );
  const formulaError = v.data_type === "formula" && v.formula ? validateFormula(v.formula, numericRefs.map((r) => r.key), v.field_key) : null;
  const keyClash = !row && (systemKeys.includes(v.field_key ?? "") || others.some((o) => o.field_key === v.field_key));
  const typeChanged = row && v.data_type !== row.data_type;
  const sources = useMemo(() => conditionSources(module, others, v.field_key), [module, others, v.field_key]);
  const condSource = sources.find((c) => c.key === v.show_if_field);

  function onSubmit(values: FormV) {
    start(async () => {
      const res = await saveField(row?.id ?? null, values as unknown as FieldInput);
      if (res.ok) {
        toast.success(res.message);
        onOpenChange(false);
        onSaved();
      } else toast.error(res.error);
    });
  }

  const isSelect = v.data_type === "single_select" || v.data_type === "multi_select";
  const isNumeric = ["integer", "decimal", "currency", "percent"].includes(v.data_type ?? "");

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{row ? `Sửa trường “${row.label}” (v${row.version})` : "Thêm trường dữ liệu"}</DialogTitle>
          <DialogDescription>Mã trường không đổi được sau khi tạo. Mỗi lần lưu tạo một phiên bản mới, có thể khôi phục.</DialogDescription>
        </DialogHeader>
        {row && impact ? (
          <Alert>
            <AlertDescription>
              <b>Phân tích ảnh hưởng:</b> {impact.records_with_value} bản ghi đang có dữ liệu ở trường này
              {impact.used_in_formulas.length ? `; được dùng trong công thức: ${impact.used_in_formulas.map((f) => f.label).join(", ")}` : "; không công thức nào dùng trường này"}
              {impact.used_in_visibility.length ? `; là điều kiện hiện của: ${impact.used_in_visibility.map((f) => f.label).join(", ")} (đổi lựa chọn có thể làm các trường đó không hiện nữa)` : ""}.
              {impact.records_with_value > 0 ? " Đã có dữ liệu: chỉ đổi được sang kiểu tương thích (Số ↔ Tiền ↔ Phần trăm, Văn bản ngắn ↔ dài, hoặc sang Văn bản)." : ""}
            </AlertDescription>
          </Alert>
        ) : null}
        <form
          onSubmit={(e) => {
            e.stopPropagation(); // mở từ trong biểu mẫu khác: không gửi biểu mẫu cha
            form.handleSubmit(onSubmit)(e);
          }}
          className="space-y-4"
          noValidate
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fd-label">Tên hiển thị *</Label>
              <Input
                id="fd-label"
                {...form.register("label", {
                  onChange: (e) => {
                    if (!keyTouched) form.setValue("field_key", slugifyKey(e.target.value));
                  },
                })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-key">Mã trường *</Label>
              <Input id="fd-key" className="font-mono" disabled={Boolean(row)} {...form.register("field_key", { onChange: () => setKeyTouched(true) })} />
              {keyClash ? <p className="text-xs text-destructive">Mã trùng với trường đã có.</p> : <p className="text-xs text-muted-foreground">Chữ thường không dấu, dùng trong công thức.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-type">Kiểu dữ liệu *</Label>
              <NativeSelect id="fd-type" {...form.register("data_type")}>
                {FIELD_DATA_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
              {typeChanged && row && impact && impact.records_with_value > 0 ? (
                fieldTypeCompatible(row.data_type, v.data_type ?? "") ? (
                  <p className="text-xs text-muted-foreground">Đổi được: dữ liệu cũ được giữ nguyên và hiển thị theo kiểu mới.</p>
                ) : (
                  <p className="text-xs text-destructive">Không đổi được vì đã có dữ liệu. Hãy tạo trường mới đúng kiểu rồi chuyển trường này sang Ngừng sử dụng.</p>
                )
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-order">Thứ tự hiển thị</Label>
              <Input id="fd-order" inputMode="numeric" {...form.register("sort_order")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="fd-desc">Mô tả / hướng dẫn nhập</Label>
              <Input id="fd-desc" {...form.register("description")} />
            </div>

            {isSelect ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="fd-opts">Các lựa chọn * (mỗi dòng một lựa chọn, có thể ghi “mã|nhãn”)</Label>
                <Textarea id="fd-opts" rows={4} className="font-mono" {...form.register("options_text")} placeholder={"20ft|Container 20 feet\n40ft|Container 40 feet"} />
              </div>
            ) : null}
            {v.data_type === "reference" ? (
              <div className="space-y-1.5">
                <Label htmlFor="fd-ref">Liên kết tới danh mục *</Label>
                <NativeSelect id="fd-ref" {...form.register("reference_target")}>
                  <option value="">— Chọn —</option>
                  {REFERENCE_TARGETS.map((k) => (
                    <option key={k} value={k}>
                      {ENTITIES[k].label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
            {v.data_type === "formula" ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="fd-formula">Công thức *</Label>
                <Input id="fd-formula" className="font-mono" placeholder="ROUND(gia_tri_hang * 0.1, 0)" {...form.register("formula")} />
                {formulaError ? <p className="text-xs text-destructive">{formulaError}</p> : v.formula ? <p className="text-xs text-emerald-700">Công thức hợp lệ.</p> : null}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Bấm tên trường để chèn vào công thức:</p>
                  <div className="flex flex-wrap gap-1">
                    {numericRefs.length ? (
                      numericRefs.map((r) => (
                        <button
                          key={r.key}
                          type="button"
                          className="rounded border bg-muted/50 px-2 py-0.5 text-xs hover:border-primary hover:text-primary"
                          title={r.key}
                          onClick={() => form.setValue("formula", `${(form.getValues("formula") ?? "").trimEnd()} ${r.key}`.trim())}
                        >
                          {r.label} <span className="font-mono text-muted-foreground">{r.key}</span>
                        </button>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">Chưa có trường số. Thêm trường kiểu số hoặc tiền trước.</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Phép tính: + − × ÷ (gõ * và /), ngoặc ( ). Hàm: ROUND, MIN, MAX, ABS, IF, AND, OR, NOT, N(x) tính ô trống là 0. Ví dụ:{" "}
                    <code>ROUND(unit_price * (1 + fuel_support_rate / 100), 0) + N(phu_thu_ve)</code>
                  </p>
                </div>
              </div>
            ) : null}
            {isNumeric || v.data_type === "formula" ? (
              <div className="space-y-1.5">
                <Label htmlFor="fd-fmt">Định dạng hiển thị</Label>
                <NativeSelect id="fd-fmt" {...form.register("display_format")}>
                  <option value="">Số (1,234.5)</option>
                  <option value="plain">Số không phân cách (2026)</option>
                  <option value="currency">Tiền VND</option>
                  <option value="percent">Phần trăm</option>
                </NativeSelect>
              </div>
            ) : null}
            {isNumeric ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="fd-min">Giá trị tối thiểu</Label>
                  <Input id="fd-min" inputMode="decimal" {...form.register("min")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fd-max">Giá trị tối đa</Label>
                  <Input id="fd-max" inputMode="decimal" {...form.register("max")} />
                </div>
              </>
            ) : null}
            {v.data_type === "short_text" || v.data_type === "long_text" ? (
              <div className="space-y-1.5">
                <Label htmlFor="fd-len">Độ dài tối đa (ký tự)</Label>
                <Input id="fd-len" inputMode="numeric" {...form.register("maxLength")} />
              </div>
            ) : null}
            {v.data_type !== "formula" && v.data_type !== "file" && v.data_type !== "image" && v.data_type !== "reference" ? (
              <div className="space-y-1.5">
                <Label htmlFor="fd-default">Giá trị mặc định</Label>
                <Input id="fd-default" {...form.register("default_value")} placeholder={v.data_type === "date" ? "YYYY-MM-DD" : ""} />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="fd-vp">Quyền được xem</Label>
              <NativeSelect id="fd-vp" {...form.register("view_permission")}>
                <option value="">Mọi người xem được màn hình</option>
                {permissions.map((p) => (
                  <option key={p} value={p}>
                    {PERMISSION_LABEL(p)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fd-ep">Quyền được sửa</Label>
              <NativeSelect id="fd-ep" {...form.register("edit_permission")}>
                <option value="">Theo quyền sửa của màn hình</option>
                {permissions.map((p) => (
                  <option key={p} value={p}>
                    {PERMISSION_LABEL(p)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <fieldset className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-3">
            <legend className="px-1 text-xs text-muted-foreground">Thuộc tính</legend>
            {(
              [
                ["is_required", "Bắt buộc nhập"],
                ["is_editable", "Cho phép sửa"],
                ["is_visible", "Hiện trên bảng mặc định"],
                ["is_searchable", "Tìm kiếm được"],
                ["is_filterable", "Lọc nhanh (danh sách, có/không, liên kết)"],
                ["is_sortable", "Sắp xếp được"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" {...form.register(k)} disabled={v.data_type === "formula" && (k === "is_required" || k === "is_editable")} />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-2 rounded-md border p-3 text-sm">
            <legend className="px-1 text-xs text-muted-foreground">Điều kiện hiện trường</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fd-showif">Chỉ hiện khi trường</Label>
                <NativeSelect id="fd-showif" {...form.register("show_if_field", { onChange: () => form.setValue("show_if_values", []) })}>
                  <option value="">Luôn hiện</option>
                  {sources.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {condSource ? (
                <div className="space-y-1.5">
                  <span className="text-sm font-medium">bằng một trong các giá trị</span>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {condSource.options.map((o) => (
                      <label key={o.value} className="flex items-center gap-2">
                        <input type="checkbox" value={o.value} {...form.register("show_if_values")} />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {sources.length
                ? "Ví dụ: trường “3-PL” chỉ hiện khi “NCC” là “3-PL”. Khi bị ẩn, trường không bắt buộc nhập và được lưu trống."
                : "Màn hình này chưa có trường danh sách chọn một hoặc Có/Không để làm điều kiện. Hãy thêm một trường như vậy trước (ví dụ “NCC” với lựa chọn Xe nội bộ, 3-PL)."}
            </p>
          </fieldset>
          {row ? (
            <div className="space-y-1.5">
              <Label htmlFor="fd-note">Ghi chú thay đổi (lưu vào lịch sử phiên bản)</Label>
              <Input id="fd-note" {...form.register("change_note")} placeholder="Ví dụ: thêm lựa chọn 45ft theo yêu cầu khách hàng" />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Hủy
            </Button>
            <Button type="submit" disabled={pending || Boolean(formulaError) || keyClash}>
              {pending ? <Loader2 className="animate-spin" /> : null} Lưu
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ row, onClose, canConfigure, onRestored }: { row: CustomFieldRow | null; onClose: () => void; canConfigure: boolean; onRestored: () => void }) {
  const [versions, setVersions] = useState<FieldVersion[] | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (row && loadedFor !== row.id) {
    setLoadedFor(row.id);
    setVersions(null);
    listFieldVersions(row.id).then((r) => (r.ok ? setVersions(r.data ?? []) : toast.error(r.error)));
  }
  return (
    <Dialog open={Boolean(row)} onOpenChange={(o) => !o && (onClose(), setLoadedFor(null))}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lịch sử phiên bản: {row?.label}</DialogTitle>
          <DialogDescription>Khôi phục một phiên bản sẽ tạo phiên bản mới với nội dung cũ; không mất lịch sử.</DialogDescription>
        </DialogHeader>
        {versions === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Đang tải…
          </p>
        ) : (
          <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-md border text-sm">
            {versions.map((ver) => (
              <li key={ver.version} className="flex items-start justify-between gap-3 px-3 py-2">
                <div>
                  <b>v{ver.version}</b> · {formatDateTime(ver.changed_at)} {ver.changed_by_name ? `· ${ver.changed_by_name}` : ""}
                  <div className="text-xs text-muted-foreground">
                    {String(ver.snapshot.label)} · {typeLabel(String(ver.snapshot.data_type))}
                    {ver.snapshot.is_required ? " · bắt buộc" : ""} · {ver.snapshot.status === "active" ? "đang dùng" : "ngừng dùng"}
                    {ver.change_note ? ` — ${ver.change_note}` : ""}
                  </div>
                </div>
                {canConfigure && ver.version !== row?.version ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await restoreFieldVersion(row!.id, ver.version);
                        if (r.ok) {
                          toast.success(r.message);
                          onClose();
                          setLoadedFor(null);
                          onRestored();
                        } else toast.error(r.error);
                      })
                    }
                  >
                    Khôi phục
                  </Button>
                ) : ver.version === row?.version ? (
                  <Badge variant="secondary">Hiện tại</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
