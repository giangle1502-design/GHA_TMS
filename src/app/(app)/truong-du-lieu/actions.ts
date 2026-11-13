"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { CUSTOM_FIELD_MODULES, ENTITIES, FORM_SYSTEM_FIELDS, FORMULA_SYSTEM_FIELDS } from "@/lib/entities/definitions";
import { FIELD_DATA_TYPES, REFERENCE_TARGETS } from "@/lib/entities/field-types";
import { validateFormula } from "@/lib/formula";
import { isUuid, parseNumberVN, systemFieldEditable } from "@/lib/entities/record";
import { loadCustomFields } from "@/lib/entities/server";
import { conditionSources } from "@/lib/entities/visibility";
import { zodMessageVi } from "@/lib/zod-vi";

const PATH = "/truong-du-lieu";
const optNum = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === "") return undefined;
    const n = parseNumberVN(v);
    if (n === null || Number.isNaN(n)) {
      ctx.addIssue({ code: "custom", message: "Giới hạn phải là số" });
      return z.NEVER;
    }
    return n;
  });

const fieldSchema = z.object({
  module: z.string().refine((m) => CUSTOM_FIELD_MODULES.some((x) => x.module === m), "Module không hợp lệ"),
  field_key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,62}$/, "Mã trường chỉ gồm chữ thường không dấu, số và dấu gạch dưới, bắt đầu bằng chữ"),
  label: z.string().trim().min(1, "Nhập tên hiển thị").max(150, "Tên tối đa 150 ký tự"),
  description: z.string().trim().max(500).optional().transform((v) => v || null),
  data_type: z.string().refine((t) => FIELD_DATA_TYPES.some((x) => x.value === t), "Kiểu dữ liệu không hợp lệ"),
  is_required: z.boolean().default(false),
  is_editable: z.boolean().default(true),
  is_visible: z.boolean().default(true),
  is_searchable: z.boolean().default(false),
  is_filterable: z.boolean().default(false),
  is_sortable: z.boolean().default(false),
  default_value: z.string().max(500).optional(),
  display_format: z.enum(["", "plain", "currency", "percent"]).optional().transform((v) => v || null),
  sort_order: z.coerce.number().int().min(0).max(9999).default(0),
  view_permission: z.string().optional().transform((v) => v || null),
  edit_permission: z.string().optional().transform((v) => v || null),
  min: optNum,
  max: optNum,
  maxLength: optNum,
  formula: z.string().trim().max(500).optional().transform((v) => v || null),
  options_text: z.string().max(5000).optional(),
  reference_target: z.string().optional().transform((v) => v || null),
  status: z.enum(["active", "inactive"]).default("active"),
  /** Chỉ hiện khi trường này nhận một trong các giá trị bên dưới (bỏ trống = luôn hiện) */
  show_if_field: z.string().trim().max(63).optional().transform((v) => v || null),
  show_if_values: z
    .union([z.array(z.string().max(200)), z.string().max(200), z.literal(false), z.null()])
    .optional()
    .transform((v) => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [])),
  change_note: z.string().trim().max(300).optional(),
});
export type FieldInput = z.input<typeof fieldSchema>;

/** Tên ô trên biểu mẫu, để báo lỗi chỉ rõ ô nào cần sửa */
const FIELD_LABELS: Record<string, string> = {
  module: "Màn hình",
  field_key: "Mã trường",
  label: "Tên hiển thị",
  description: "Mô tả / hướng dẫn nhập",
  data_type: "Kiểu dữ liệu",
  default_value: "Giá trị mặc định",
  display_format: "Định dạng hiển thị",
  sort_order: "Thứ tự hiển thị",
  view_permission: "Quyền được xem",
  edit_permission: "Quyền được sửa",
  min: "Giá trị tối thiểu",
  max: "Giá trị tối đa",
  maxLength: "Độ dài tối đa",
  formula: "Công thức",
  options_text: "Các lựa chọn",
  reference_target: "Liên kết tới danh mục",
  status: "Trạng thái",
  show_if_field: "Chỉ hiện khi trường",
  show_if_values: "Giá trị điều kiện",
  change_note: "Ghi chú thay đổi",
};

/** Chuyển giá trị mặc định dạng chữ sang JSON theo kiểu dữ liệu */
function parseDefault(type: string, raw: string | undefined): unknown {
  if (raw === undefined || raw.trim() === "") return null;
  const s = raw.trim();
  if (["integer", "decimal", "currency", "percent"].includes(type)) {
    const n = parseNumberVN(s, type === "currency");
    if (n === null || Number.isNaN(n)) throw new ActionError("Giá trị mặc định phải là số");
    return n;
  }
  if (type === "boolean") return ["true", "1", "có", "co", "x"].includes(s.toLowerCase());
  if (type === "multi_select") return s.split(",").map((x) => x.trim()).filter(Boolean);
  if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ActionError("Giá trị mặc định của ngày phải có dạng YYYY-MM-DD");
  return s;
}

export async function saveField(id: string | null, input: FieldInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    await requirePermission("fields.configure");
    const p = fieldSchema.safeParse(input);
    if (!p.success) throw new ActionError(zodMessageVi(p.error, FIELD_LABELS));
    const v = p.data;
    if (id && !isUuid(id)) throw new ActionError("Mã trường không hợp lệ");
    const mod = CUSTOM_FIELD_MODULES.find((m) => m.module === v.module)!;
    const entity = mod.entity ? ENTITIES[mod.entity] : undefined;
    // Chỉ kiểm tra trùng mã khi tạo mới: trường đã có thì mã không đổi, sửa không được chặn
    if (!id && (entity?.fields.some((f) => f.key === v.field_key) || FORM_SYSTEM_FIELDS[v.module]?.some((f) => f.key === v.field_key) || FORMULA_SYSTEM_FIELDS[v.module]?.some((f) => f.key === v.field_key) || ["id", "code", "custom_fields", "created_at", "updated_at", "created_by", "updated_by"].includes(v.field_key))) {
      throw new ActionError(`Mã "${v.field_key}" trùng với trường hệ thống`);
    }
    for (const perm of [v.view_permission, v.edit_permission]) {
      if (perm && !ALL_PERMISSIONS.includes(perm as never)) throw new ActionError("Quyền không hợp lệ");
    }
    if (v.min !== undefined && v.max !== undefined && v.min > v.max) throw new ActionError("Giá trị tối thiểu lớn hơn tối đa");

    // Danh sách lựa chọn: mỗi dòng "mã|nhãn" hoặc chỉ "nhãn"
    let options: { value: string; label: string }[] = [];
    if (v.data_type === "single_select" || v.data_type === "multi_select") {
      options = (v.options_text ?? "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [a, b] = l.split("|").map((x) => x.trim());
          return { value: a, label: b || a };
        });
      if (options.length === 0) throw new ActionError("Nhập ít nhất một lựa chọn (mỗi dòng một lựa chọn)");
      if (new Set(options.map((o) => o.value)).size !== options.length) throw new ActionError("Có lựa chọn bị trùng");
    }
    if (v.data_type === "reference" && !REFERENCE_TARGETS.includes(v.reference_target as never)) {
      throw new ActionError("Chọn danh mục được liên kết");
    }

    const supabase = await createClient();
    const custom = await loadCustomFields(supabase, v.module);
    let visibility: string | null = null;
    if (v.show_if_field) {
      const src = conditionSources(v.module, custom, v.field_key).find((c) => c.key === v.show_if_field);
      if (!src) throw new ActionError("Trường điều kiện không hợp lệ (chỉ chọn được trường danh sách hoặc Có/Không đang dùng)");
      const vals = [...new Set(v.show_if_values)].filter((x) => src.options.some((o) => o.value === x));
      if (!vals.length) throw new ActionError(`Chọn ít nhất một giá trị của “${src.label}” để hiện trường này`);
      visibility = JSON.stringify({ field: src.key, in: vals });
    }
    if (v.data_type === "formula") {
      if (!v.formula) throw new ActionError("Nhập công thức");
      const numericCustom = custom
        .filter((c) => c.field_key !== v.field_key && FIELD_DATA_TYPES.find((t) => t.value === c.data_type)?.numeric && c.data_type !== "formula")
        .map((c) => c.field_key);
      const numericSystem = entity
        ? entity.fields.filter((f) => ["number", "currency", "percent"].includes(f.type)).map((f) => f.key)
        : (FORMULA_SYSTEM_FIELDS[v.module] ?? []).map((f) => f.key);
      const err = validateFormula(v.formula, [...numericSystem, ...numericCustom], v.field_key);
      if (err) throw new ActionError(`Công thức không hợp lệ: ${err}`);
    }

    const values = {
      module: v.module,
      field_key: v.field_key,
      label: v.label,
      description: v.description,
      field_kind: v.data_type === "formula" ? "formula" : "business",
      data_type: v.data_type,
      is_required: v.data_type === "formula" ? false : v.is_required,
      is_editable: v.data_type === "formula" ? false : v.is_editable,
      is_visible: v.is_visible,
      is_searchable: v.is_searchable,
      is_filterable: v.is_filterable,
      is_sortable: v.is_sortable,
      default_value: parseDefault(v.data_type, v.default_value),
      display_format: v.display_format,
      sort_order: v.sort_order,
      view_permission: v.view_permission,
      edit_permission: v.edit_permission,
      validation: Object.fromEntries(Object.entries({ min: v.min, max: v.max, maxLength: v.maxLength }).filter(([, x]) => x !== undefined)),
      formula: v.data_type === "formula" ? v.formula : null,
      options,
      reference_target: v.data_type === "reference" ? v.reference_target : null,
      status: v.status,
      visibility_condition: visibility,
    };
    const { data, error } = await supabase.rpc("save_field_definition", { p_id: id, p_values: values, p_change_note: v.change_note || null });
    if (error) {
      if (error.code === "23505") throw new ActionError(`Mã trường "${v.field_key}" đã tồn tại trong module này`);
      throw error;
    }
    revalidatePath(PATH);
    return { id: String(data) };
  }, id ? "Đã lưu trường dữ liệu (tạo phiên bản mới)." : "Đã thêm trường dữ liệu.");
}

export async function setFieldStatus(id: string, status: "active" | "inactive"): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("fields.configure");
    if (!isUuid(id) || !["active", "inactive"].includes(status)) throw new ActionError("Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { data, error } = await supabase.from("field_definitions").update({ status }).eq("id", id).select("id");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Không tìm thấy trường dữ liệu");
    revalidatePath(PATH);
  }, status === "active" ? "Đã kích hoạt lại trường." : "Đã ngừng sử dụng trường. Dữ liệu cũ vẫn được giữ.");
}

export async function deleteField(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("fields.configure");
    if (!isUuid(id)) throw new ActionError("Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { data, error } = await supabase.from("field_definitions").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Không tìm thấy trường dữ liệu");
    revalidatePath(PATH);
  }, "Đã xóa trường dữ liệu.");
}

export type FieldImpact = {
  records_with_value: number;
  used_in_formulas: { id: string; label: string; field_key: string }[];
  used_in_visibility: { id: string; label: string }[];
  versions: number;
};

export async function getFieldImpact(id: string): Promise<ActionResult<FieldImpact>> {
  return runAction(async () => {
    await requirePermission("fields.view", "fields.configure");
    if (!isUuid(id)) throw new ActionError("Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("field_impact", { p_field_id: id });
    if (error) throw error;
    return data as FieldImpact;
  });
}

export type FieldVersion = { version: number; changed_at: string; change_note: string | null; changed_by_name: string | null; snapshot: Record<string, unknown> };

export async function listFieldVersions(id: string): Promise<ActionResult<FieldVersion[]>> {
  return runAction(async () => {
    await requirePermission("fields.view", "fields.configure");
    if (!isUuid(id)) throw new ActionError("Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("field_definition_versions")
      .select("version, changed_at, change_note, changed_by, snapshot")
      .eq("field_id", id)
      .order("version", { ascending: false })
      .limit(100);
    if (error) throw error;
    const ids = [...new Set((data ?? []).map((r) => r.changed_by).filter(Boolean))] as string[];
    const names: Record<string, string> = {};
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
      for (const p of ps ?? []) names[p.id] = p.full_name || p.email;
    }
    return (data ?? []).map((r) => ({
      version: r.version,
      changed_at: r.changed_at,
      change_note: r.change_note,
      changed_by_name: r.changed_by ? (names[r.changed_by] ?? null) : null,
      snapshot: r.snapshot as Record<string, unknown>,
    }));
  });
}

export async function restoreFieldVersion(id: string, version: number): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("fields.configure");
    if (!isUuid(id) || !Number.isInteger(version)) throw new ActionError("Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.rpc("restore_field_version", { p_field_id: id, p_version: version });
    if (error) throw error;
    revalidatePath(PATH);
  }, `Đã khôi phục phiên bản ${version}.`);
}

/** Lưu thứ tự trường (hệ thống + bổ sung) trên biểu mẫu của một màn hình */
export async function saveFormLayout(module: string, order: string[]): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("fields.configure");
    if (!CUSTOM_FIELD_MODULES.some((m) => m.module === module)) throw new ActionError("Màn hình không hợp lệ");
    const keys = z.array(z.string().regex(/^[a-z][a-z0-9_]{0,62}$/)).max(300).safeParse(order);
    if (!keys.success) throw new ActionError("Danh sách trường không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_form_layout", { p_module: module, p_field_order: keys.data });
    if (error) throw error;
    revalidatePath("/", "layout");
  }, "Đã lưu thứ tự trường trên biểu mẫu");
}

const systemFieldSchema = z.object({
  label: z.string().trim().max(150, "Tên tối đa 150 ký tự").optional(),
  help: z.string().trim().max(500, "Gợi ý tối đa 500 ký tự").optional(),
  required: z.boolean().optional(),
  hidden: z.boolean().optional(),
  list: z.boolean().optional(),
  options: z.record(z.string(), z.string().trim().max(150)).optional(),
});
export type SystemFieldInput = z.input<typeof systemFieldSchema>;

/**
 * Sửa trường hệ thống: tên hiển thị, gợi ý, bắt buộc, ẩn khỏi biểu mẫu, cột bảng, tên lựa chọn.
 * Mã trường, kiểu dữ liệu và giá trị lưu giữ nguyên. Chỉ lưu phần khác mặc định; để trống hết = trả về mặc định.
 */
export async function saveSystemField(module: string, fieldKey: string, input: SystemFieldInput): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("fields.configure");
    const mod = CUSTOM_FIELD_MODULES.find((m) => m.module === module);
    if (!mod) throw new ActionError("Màn hình không hợp lệ");
    const entity = mod.entity ? ENTITIES[mod.entity] : undefined;
    const def = entity ? entity.fields.find((f) => f.key === fieldKey) : FORM_SYSTEM_FIELDS[module]?.find((f) => f.key === fieldKey);
    if (!def) throw new ActionError("Không tìm thấy trường hệ thống");
    const parsed = systemFieldSchema.safeParse(input ?? {});
    if (!parsed.success) throw new ActionError(zodMessageVi(parsed.error));
    const v = parsed.data;
    const out: Record<string, unknown> = {};
    if (v.label && v.label !== def.label) out.label = v.label;
    const full = entity?.fields.find((f) => f.key === fieldKey);
    if (v.help !== undefined && v.help !== (full?.help ?? "")) out.help = v.help;
    if (full) {
      const can = systemFieldEditable(full);
      if (can.required && v.required !== undefined && v.required !== Boolean(full.required)) out.required = v.required;
      if (can.hidden && v.hidden && !v.required) out.hidden = true;
      if (v.list !== undefined && v.list !== Boolean(full.list)) out.list = v.list;
      if (v.options && full.options?.length) {
        const opts: Record<string, string> = {};
        for (const o of full.options) {
          const name = v.options[o.value]?.trim();
          if (name && name !== o.label) opts[o.value] = name;
        }
        if (Object.keys(opts).length) out.options = opts;
      }
    }
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_system_field", { p_module: module, p_field_key: fieldKey, p_values: out });
    if (error) {
      if (/save_system_field/.test(error.message)) throw new ActionError("CSDL chưa nâng cấp “Sửa trường hệ thống” (0059). Vui lòng chạy tệp nâng cấp trước.");
      throw error;
    }
    revalidatePath("/", "layout");
  }, "Đã lưu trường hệ thống");
}
