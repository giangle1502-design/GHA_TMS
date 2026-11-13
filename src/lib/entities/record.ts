// Chuẩn hóa + kiểm tra dữ liệu bản ghi dùng chung cho trình duyệt (biểu mẫu) và máy chủ (server action, nhập Excel).
// Cùng một hàm chạy hai phía nên quy tắc kiểm tra không bị lệch nhau.
import { computeFormula } from "@/lib/formula";
import { formatDate, formatDateTime, formatNumber, formatVND } from "@/lib/format";
import type { AdvField, AdvFieldKind } from "@/lib/advanced-filter";
import type { CustomFieldRow, EntityDef, FieldDef, Option, SystemFieldSetting, SystemFieldSettings } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+().\s-]{6,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** Chữ hoa liền, chỉ chữ và số (biển số xe) */
export function compactUpper(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Chuyển kiểu dữ liệu của trường động sang kiểu trường của biểu mẫu */
export function customFieldToDef(row: CustomFieldRow): FieldDef {
  const typeMap: Record<string, FieldDef["type"]> = {
    short_text: "text",
    long_text: "textarea",
    integer: "number",
    decimal: "number",
    currency: "currency",
    percent: "percent",
    date: "date",
    datetime: "datetime",
    single_select: "select",
    multi_select: "multiselect",
    boolean: "boolean",
    email: "email",
    phone: "phone",
    url: "url",
    reference: "reference",
    formula: "formula",
    file: "file",
    image: "file",
    gps: "gps",
  };
  const options: Option[] = (row.options ?? []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return {
    key: row.field_key,
    label: row.label,
    type: typeMap[row.data_type] ?? "text",
    required: row.is_required,
    readOnly: !row.is_editable || row.data_type === "formula",
    list: row.is_visible,
    filter: row.is_filterable && ["single_select", "boolean", "reference"].includes(row.data_type),
    options,
    ref: row.reference_target ?? undefined,
    integer: row.data_type === "integer",
    min: row.validation?.min,
    max: row.validation?.max,
    maxLength: row.validation?.maxLength ?? (row.data_type === "short_text" ? 500 : undefined),
    help: row.description ?? undefined,
    defaultValue: row.default_value ?? undefined,
    formula: row.formula ?? undefined,
    displayFormat: row.display_format ?? undefined,
    custom: true,
    fieldId: row.id,
    wide: row.data_type === "long_text",
    showIf: parseVisibility(row.visibility_condition),
  };
}

/** Điều kiện hiện của trường bổ sung: {"field": "ncc", "in": ["3-PL"]} (sai định dạng thì luôn hiện) */
export function parseVisibility(raw: string | null | undefined): FieldDef["showIf"] {
  if (!raw) return undefined;
  try {
    const j = JSON.parse(raw) as { field?: unknown; in?: unknown };
    if (typeof j.field !== "string" || !Array.isArray(j.in) || !j.in.length || j.in.some((x) => typeof x !== "string")) return undefined;
    return { field: j.field, in: j.in as string[] };
  } catch {
    return undefined;
  }
}

/** Trường hệ thống + trường động người dùng được xem (theo view_permission) */
export function effectiveFields(entity: EntityDef, customRows: CustomFieldRow[], permissions?: Set<string>): FieldDef[] {
  const custom = customRows
    .filter((r) => r.status === "active" && r.module === entity.customModule)
    .filter((r) => !r.view_permission || !permissions || permissions.has(r.view_permission))
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, "vi"))
    .map((r) => {
      const def = customFieldToDef(r);
      if (r.edit_permission && permissions && !permissions.has(r.edit_permission)) def.readOnly = true;
      return def;
    });
  const settings = systemSettingsOf(entity.customModule, customRows);
  const system = entity.fields.map((f) => applySystemSetting(f, settings[f.key]));
  return applyLayout([...system, ...custom], layoutOf(entity.customModule, customRows));
}

/** Tùy chỉnh trường hệ thống đã lưu của màn hình (rỗng nếu chưa sửa) */
export function systemSettingsOf(module: string | undefined, customRows: CustomFieldRow[]): SystemFieldSettings {
  return customRows.find((r) => r.field_kind === "layout" && r.module === module)?.system ?? {};
}

/** Trường hệ thống có được bật "bắt buộc" / "ẩn khỏi biểu mẫu" hay không (các thuộc tính khác luôn sửa được) */
export function systemFieldEditable(f: Pick<FieldDef, "required" | "readOnly" | "hideInForm" | "type">) {
  const onForm = !f.readOnly && !f.hideInForm && f.type !== "formula" && f.type !== "file";
  return { required: onForm && !f.required && f.type !== "boolean", hidden: onForm && !f.required };
}

/** Áp tùy chỉnh lên trường hệ thống: tên, gợi ý, bắt buộc, ẩn, cột bảng, tên lựa chọn (không đổi mã, kiểu, giá trị) */
export function applySystemSetting(f: FieldDef, s: SystemFieldSetting | undefined): FieldDef {
  if (!s) return f;
  const can = systemFieldEditable(f);
  const out: FieldDef = { ...f };
  if (s.label) out.label = s.label;
  if (s.help !== undefined) out.help = s.help || undefined;
  if (s.required !== undefined && can.required) out.required = s.required;
  if (s.hidden && can.hidden && !out.required) out.hideInForm = true;
  if (s.list !== undefined) out.list = s.list;
  if (s.options && f.options) out.options = f.options.map((o) => (s.options![o.value] ? { ...o, label: s.options![o.value] } : o));
  return out;
}

/** Tên hiển thị của trường hệ thống trên biểu mẫu viết riêng (Tạo đơn hàng...) */
export function systemLabel(settings: SystemFieldSettings, key: string, fallback: string): string {
  return settings[key]?.label || fallback;
}

/** Dòng giả mang thứ tự trường trên biểu mẫu, đi kèm danh sách trường bổ sung */
export function layoutRow(module: string, order: string[], system: SystemFieldSettings = {}): CustomFieldRow {
  return {
    id: `layout:${module}`, module, field_key: "__layout", label: "", description: null, field_kind: "layout", data_type: "layout",
    is_required: false, is_editable: false, is_visible: false, is_searchable: false, is_filterable: false, is_sortable: false,
    default_value: null, display_format: null, sort_order: 0, view_permission: null, edit_permission: null, validation: null,
    formula: null, visibility_condition: null, options: null, reference_target: null, status: "layout", version: 0, layout: order, system,
  };
}

/** Thứ tự trường đã lưu của màn hình (rỗng nếu chưa sắp xếp) */
export function layoutOf(module: string | undefined, customRows: CustomFieldRow[]): string[] {
  return customRows.find((r) => r.field_kind === "layout" && r.module === module)?.layout ?? [];
}

/** Sắp theo thứ tự đã lưu; trường chưa có trong thứ tự (mới thêm) giữ vị trí tương đối, xếp sau cùng */
export function applyLayout<T extends { key: string }>(items: T[], order: string[]): T[] {
  if (!order.length) return items;
  const pos = new Map(order.map((k, i) => [k, i]));
  return items
    .map((it, i) => ({ it, rank: pos.get(it.key) ?? order.length + i }))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.it);
}

/** Trường có đang hiện theo điều kiện showIf hay không */
export function isFieldShown(field: FieldDef, values: Record<string, unknown>): boolean {
  if (!field.showIf) return true;
  const v = values[field.showIf.field];
  return field.showIf.in.includes(String(v ?? ""));
}

/**
 * Đọc số theo cách công ty dùng: dấu phẩy phân cách hàng nghìn, dấu chấm thập phân.
 *  - "1,500,000" hoặc "1500000" -> 1500000; "39.5" -> 39.5; "1,234.5" -> 1234.5
 *  - Nhiều dấu chấm ("1.500.000", dán từ nơi khác) vẫn hiểu là phân cách hàng nghìn.
 *  - "39,5" (sau dấu phẩy 1-2 chữ số) không thể là hàng nghìn nên hiểu là 39.5.
 *  - Tiền VND không có số lẻ: làm tròn đến đồng; "500.000" là năm trăm nghìn.
 */
export function parseNumberVN(input: unknown, currency = false): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : NaN;
  let s = String(input).trim().replace(/\s|₫|đ|VND/gi, "");
  if (s === "") return null;
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  if (!/^[0-9.,]+$/.test(s)) return NaN;
  const dots = (s.match(/\./g) ?? []).length;
  if (dots > 1) {
    // "1.500.000": dấu chấm là phân cách hàng nghìn, khi đó dấu phẩy (nếu có) là thập phân
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (currency && /^\d{1,3}\.\d{3}$/.test(s)) {
    // Tiền VND không có số lẻ: "500.000" chắc chắn là năm trăm nghìn
    s = s.replace(".", "");
  } else if (!dots && /^\d+,\d{1,2}$/.test(s)) {
    // "39,5": không thể là phân cách hàng nghìn, hiểu là số lẻ để tránh nhập nhầm gấp 10 lần
    s = s.replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  if (!/^\d*\.?\d*$/.test(s) || s === ".") return NaN;
  let n = Number(s);
  if (currency) n = Math.round(n);
  return neg ? -n : n;
}

function checkDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900 && y <= 2200;
}

/** Ngày dạng dd/mm/yyyy (nhập Excel) -> yyyy-mm-dd */
export function normalizeDateInput(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "invalid";
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const vn = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (vn) return `${vn[3]}-${vn[2].padStart(2, "0")}-${vn[1].padStart(2, "0")}`;
  return s.slice(0, 10);
}

export type ValidationResult = { data: Record<string, unknown>; errors: Record<string, string> };

/**
 * Chuẩn hóa và kiểm tra giá trị theo danh sách trường.
 * - Bỏ qua trường chỉ đọc, công thức, tệp.
 * - Trường bị ẩn theo showIf được đặt null và không bắt buộc.
 * - Chuỗi rỗng -> null.
 */
export function validateRecord(fields: FieldDef[], raw: Record<string, unknown>): ValidationResult {
  const data: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (f.readOnly || f.type === "formula" || f.type === "file" || f.hideInForm) continue;
    if (!isFieldShown(f, raw)) {
      data[f.key] = f.type === "boolean" ? false : null;
      continue;
    }
    const v = raw[f.key];
    const empty = v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (f.type === "boolean") {
        data[f.key] = false;
        continue;
      }
      if (f.required) errors[f.key] = `${f.label} là bắt buộc`;
      data[f.key] = f.type === "multiselect" ? [] : null;
      continue;
    }
    switch (f.type) {
      case "text":
      case "textarea":
      case "email":
      case "phone":
      case "url":
      case "gps": {
        const s = f.compactUpper ? compactUpper(String(v)) : String(v).trim();
        if (f.maxLength && s.length > f.maxLength) errors[f.key] = `${f.label} tối đa ${f.maxLength} ký tự`;
        else if (f.type === "email" && !EMAIL_RE.test(s)) errors[f.key] = `${f.label} không đúng định dạng email`;
        else if (f.type === "phone" && !PHONE_RE.test(s)) errors[f.key] = `${f.label} không đúng định dạng số điện thoại`;
        else if (f.type === "url" && !/^https?:\/\/\S+$/i.test(s)) errors[f.key] = `${f.label} phải bắt đầu bằng http:// hoặc https://`;
        else if (f.type === "gps") {
          const m = /^(-?\d{1,2}(\.\d+)?)\s*,\s*(-?\d{1,3}(\.\d+)?)$/.exec(s);
          if (!m || Math.abs(Number(m[1])) > 90 || Math.abs(Number(m[3])) > 180) errors[f.key] = `${f.label} phải có dạng "vĩ độ, kinh độ"`;
        }
        data[f.key] = s;
        break;
      }
      case "number":
      case "currency":
      case "percent": {
        const n = parseNumberVN(v, f.type === "currency");
        if (n === null || Number.isNaN(n)) errors[f.key] = `${f.label} phải là số`;
        else if (f.integer && !Number.isInteger(n)) errors[f.key] = `${f.label} phải là số nguyên`;
        else if (f.min !== undefined && n < f.min) errors[f.key] = `${f.label} không được nhỏ hơn ${formatNumber(f.min)}`;
        else if (f.max !== undefined && n > f.max) errors[f.key] = `${f.label} không được lớn hơn ${formatNumber(f.max)}`;
        else if (Math.abs(n) > 1e15) errors[f.key] = `${f.label} quá lớn`;
        data[f.key] = n;
        break;
      }
      case "date": {
        const s = normalizeDateInput(v);
        if (!s || !checkDate(s)) errors[f.key] = `${f.label} không phải ngày hợp lệ`;
        data[f.key] = s;
        break;
      }
      case "datetime": {
        const s = String(v).trim();
        if (DATETIME_RE.test(s)) {
          const iso = new Date(`${s.length === 16 ? `${s}:00` : s}+07:00`);
          if (Number.isNaN(iso.getTime())) errors[f.key] = `${f.label} không hợp lệ`;
          else data[f.key] = iso.toISOString();
        } else {
          const d = new Date(s);
          if (Number.isNaN(d.getTime())) errors[f.key] = `${f.label} không hợp lệ`;
          else data[f.key] = d.toISOString();
        }
        break;
      }
      case "select": {
        const s = String(v);
        if (f.options && !f.options.some((o) => o.value === s)) errors[f.key] = `${f.label}: giá trị "${s}" không có trong danh sách`;
        data[f.key] = s;
        break;
      }
      case "multiselect": {
        const arr = (Array.isArray(v) ? v : String(v).split(/[,;]/)).map((x) => String(x).trim()).filter(Boolean);
        const bad = f.options ? arr.filter((x) => !f.options!.some((o) => o.value === x)) : [];
        if (bad.length) errors[f.key] = `${f.label}: giá trị "${bad.join(", ")}" không có trong danh sách`;
        data[f.key] = [...new Set(arr)];
        break;
      }
      case "boolean": {
        const s = String(v).trim().toLowerCase();
        data[f.key] = v === true || ["true", "1", "x", "có", "co", "yes", "on"].includes(s);
        break;
      }
      case "reference": {
        if (!isUuid(v)) errors[f.key] = `${f.label} không hợp lệ`;
        data[f.key] = String(v);
        break;
      }
    }
  }
  return { data, errors };
}

/** Tách dữ liệu đã kiểm tra thành cột hệ thống và custom_fields */
export function splitCustom(fields: FieldDef[], data: Record<string, unknown>) {
  const columns: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  for (const f of fields) {
    if (!(f.key in data)) continue;
    if (f.custom) custom[f.key] = data[f.key];
    else columns[f.key] = data[f.key];
  }
  return { columns, custom };
}

/** Giá trị phẳng của một dòng (cột hệ thống + custom_fields + trường công thức đã tính) */
export function flattenRow(fields: FieldDef[], row: Record<string, unknown>): Record<string, unknown> {
  const cf = (row.custom_fields ?? {}) as Record<string, unknown>;
  const flat: Record<string, unknown> = { ...row, ...cf };
  for (const f of fields) {
    if (f.type === "formula" && f.formula) flat[f.key] = computeFormula(f.formula, flat);
  }
  return flat;
}

/** Giá trị khởi tạo cho biểu mẫu (chuỗi cho input) */
export function toFormValues(fields: FieldDef[], row: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = row ? row[f.key] : f.defaultValue;
    if (f.type === "boolean") out[f.key] = Boolean(v ?? false);
    else if (f.type === "multiselect") out[f.key] = Array.isArray(v) ? v : [];
    else if (v === null || v === undefined) out[f.key] = "";
    else if (f.type === "datetime" && typeof v === "string") {
      const d = new Date(v);
      out[f.key] = Number.isNaN(d.getTime()) ? "" : new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 16);
    } else if (f.type === "currency" && typeof v !== "object") out[f.key] = formatNumber(Number(v));
    else out[f.key] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return out;
}

/** Hiển thị giá trị dạng chữ (bảng, xuất Excel) */
export function formatValue(f: FieldDef, v: unknown, refLabel?: string | null): string {
  if (v === null || v === undefined || v === "") return "";
  switch (f.type) {
    case "currency":
      return formatVND(v as number);
    case "percent":
      return `${formatNumber(v as number)}%`;
    case "number":
    case "formula":
      if (f.displayFormat === "plain") return String(v);
      if (f.displayFormat === "currency") return formatVND(v as number);
      if (f.displayFormat === "percent") return `${formatNumber(v as number)}%`;
      return formatNumber(v as number);
    case "date":
      if (f.displayFormat === "MM/yyyy" && typeof v === "string") return `${v.slice(5, 7)}/${v.slice(0, 4)}`;
      return formatDate(v as string);
    case "datetime":
      return formatDateTime(v as string);
    case "boolean":
      return v ? "Có" : "Không";
    case "select":
      return f.options?.find((o) => o.value === v)?.label ?? String(v);
    case "multiselect":
      return (Array.isArray(v) ? v : [])
        .map((x) => f.options?.find((o) => o.value === x)?.label ?? String(x))
        .join(", ");
    case "reference":
      return refLabel ?? "";
    default:
      return String(v);
  }
}

/** Nhãn của một dòng khi được tham chiếu */
export function rowLabel(entity: EntityDef, row: Record<string, unknown>): string {
  const parts = entity.labelCols.map((c) => row[c]).filter((x) => x !== null && x !== undefined && x !== "");
  // Bỏ phần lặp (VD địa chỉ ghi giống tên: "Cảng Cát Lái – Cảng Cát Lái")
  return [...new Set(parts.map((x) => String(x).trim()))].join(" – ");
}

const ADV_KIND: Partial<Record<FieldDef["type"], AdvFieldKind>> = {
  text: "text",
  textarea: "text",
  email: "text",
  phone: "text",
  url: "text",
  number: "number",
  currency: "number",
  percent: "number",
  date: "date",
  datetime: "date",
  select: "select",
  reference: "reference",
  boolean: "boolean",
};

/** Các trường dùng được trong tìm kiếm nâng cao */
export function advancedFields(fields: FieldDef[]): AdvField[] {
  return fields.flatMap((f) => {
    const kind = ADV_KIND[f.type];
    if (!kind || (kind === "reference" && !f.ref)) return [];
    return [{ key: f.key, label: f.label, kind, options: f.options?.map((o) => ({ value: o.value, label: o.label })), ref: f.ref }];
  });
}

/** Trường bổ sung của một module không có trong bộ danh mục chung (đơn hàng, chuyến) */
export function moduleCustomFields(module: string, customRows: CustomFieldRow[], permissions?: Set<string>): FieldDef[] {
  return effectiveFields({ fields: [], customModule: module } as unknown as EntityDef, customRows, permissions);
}
