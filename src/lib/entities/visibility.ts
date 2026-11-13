// Điều kiện hiện/ẩn trường bổ sung theo giá trị của trường khác (dùng chung trình duyệt và máy chủ)
import { CUSTOM_FIELD_MODULES, ENTITIES } from "./definitions";
import type { CustomFieldRow, Option } from "./types";

export type ConditionSource = { key: string; label: string; options: Option[] };

const BOOL_OPTIONS: Option[] = [
  { value: "true", label: "Có" },
  { value: "false", label: "Không" },
];

/** Các trường làm được điều kiện: trường danh sách chọn một hoặc Có/Không (hệ thống và bổ sung) của cùng màn hình */
export function conditionSources(module: string, customRows: CustomFieldRow[], exceptKey?: string): ConditionSource[] {
  const mod = CUSTOM_FIELD_MODULES.find((m) => m.module === module);
  const entity = mod?.entity ? ENTITIES[mod.entity] : undefined;
  const system: ConditionSource[] = (entity?.fields ?? [])
    .filter((f) => !f.hideInForm && f.key !== entity?.parentKey && ((f.type === "select" && f.options?.length) || f.type === "boolean"))
    .map((f) => ({ key: f.key, label: f.label, options: f.type === "boolean" ? BOOL_OPTIONS : (f.options ?? []) }));
  const custom: ConditionSource[] = customRows
    .filter((r) => r.module === module && r.status === "active" && r.field_key !== exceptKey && ["single_select", "boolean"].includes(r.data_type))
    .map((r) => ({
      key: r.field_key,
      label: r.label,
      options: r.data_type === "boolean" ? BOOL_OPTIONS : (r.options ?? []).map((o) => (typeof o === "string" ? { value: o, label: o } : o)),
    }));
  return [...system, ...custom].filter((s) => s.key !== exceptKey);
}
