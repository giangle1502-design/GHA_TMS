import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ENTITIES } from "./definitions";
import { applyConditions, parseConditions } from "@/lib/advanced-filter";
import { addDaysYMD, startOfDayVN } from "@/lib/format";
import { advancedFields, effectiveFields, flattenRow, layoutRow, rowLabel } from "./record";
import type { CustomFieldRow, EntityDef, FieldDef, SystemFieldSettings, TableViewConfig } from "./types";

export const PAGE_SIZES = [20, 50, 100] as const;
export const EXPORT_LIMIT = 5000;

export type ListParams = {
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  size?: number;
  filters?: Record<string, string>;
  /** Điều kiện tìm kiếm nâng cao (chuỗi a=truong.toan_tu.gia_tri) */
  adv?: string[];
  parentId?: string;
};

export type RefLabels = Record<string, Record<string, string>>;

const CUSTOM_FIELD_COLUMNS =
  "id, module, field_key, label, description, field_kind, data_type, is_required, is_editable, is_visible, is_searchable, is_filterable, is_sortable, default_value, display_format, sort_order, view_permission, edit_permission, validation, formula, visibility_condition, options, reference_target, status, version";

/**
 * Trường bổ sung của một màn hình. Khi không lấy trường đã ngừng dùng, kèm thêm một dòng giả field_kind = "layout"
 * mang thứ tự trường trên biểu mẫu để mọi nơi dùng effectiveFields tự sắp đúng thứ tự.
 */
export async function loadCustomFields(supabase: SupabaseClient, module: string | undefined, includeInactive = false): Promise<CustomFieldRow[]> {
  if (!module) return [];
  let q = supabase.from("field_definitions").select(CUSTOM_FIELD_COLUMNS).eq("module", module).order("sort_order");
  if (!includeInactive) q = q.eq("status", "active");
  const [{ data, error }, cfg] = await Promise.all([q, includeInactive ? Promise.resolve(null) : loadFormConfig(supabase, module)]);
  if (error) throw error;
  const rows = (data ?? []) as CustomFieldRow[];
  return cfg && (cfg.order.length || Object.keys(cfg.system).length) ? [...rows, layoutRow(module, cfg.order, cfg.system)] : rows;
}

/** Thứ tự trường đã lưu cho biểu mẫu (rỗng nếu chưa sắp xếp) */
export async function loadFormLayout(supabase: SupabaseClient, module: string): Promise<string[]> {
  return (await loadFormConfig(supabase, module)).order;
}

/** Thứ tự trường + tùy chỉnh trường hệ thống của một màn hình (CSDL chưa nâng cấp 0059 thì chỉ có thứ tự) */
export async function loadFormConfig(supabase: SupabaseClient, module: string): Promise<{ order: string[]; system: SystemFieldSettings }> {
  const res = await supabase.from("form_layouts").select("field_order, system_fields").eq("module", module).maybeSingle();
  const data = res.error ? (await supabase.from("form_layouts").select("field_order").eq("module", module).maybeSingle()).data : res.data;
  const row = data as { field_order?: string[]; system_fields?: SystemFieldSettings } | null;
  return { order: row?.field_order ?? [], system: row?.system_fields ?? {} };
}

/** Trường động người dùng được xem (lọc theo view_permission ở máy chủ) */
export function visibleCustomRows(rows: CustomFieldRow[], perms: Set<string>) {
  return rows.filter((r) => !r.view_permission || perms.has(r.view_permission));
}

export async function loadTableView(supabase: SupabaseClient, tableKey: string, userId: string): Promise<TableViewConfig | null> {
  const { data } = await supabase
    .from("table_view_preferences")
    .select("scope, config, user_id")
    .eq("table_key", tableKey)
    .in("scope", ["user", "system"])
    .eq("is_default", true);
  const rows = (data ?? []) as { scope: string; config: TableViewConfig; user_id: string | null }[];
  return rows.find((r) => r.scope === "user" && r.user_id === userId)?.config ?? rows.find((r) => r.scope === "system")?.config ?? null;
}

/** Loại bỏ ký tự có nghĩa đặc biệt trong bộ lọc PostgREST */
export function sanitizeSearch(q: string): string {
  return q.replace(/[%,()*\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function columnRef(f: FieldDef): string {
  return f.custom ? `custom_fields->>${f.key}` : f.key;
}

/** Áp dụng điều kiện cố định, cha, tìm kiếm, bộ lọc lên truy vấn */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(query: any, entity: EntityDef, fields: FieldDef[], params: ListParams) {
  let q = query;
  for (const [k, v] of Object.entries(entity.fixed ?? {})) q = q.eq(k, v);
  if (entity.parentKey && params.parentId) q = q.eq(entity.parentKey, params.parentId);
  const term = params.q ? sanitizeSearch(params.q) : "";
  if (term) {
    const cols = [...entity.search, ...fields.filter((f) => f.custom && f.type === "text").map((f) => columnRef(f))];
    if (cols.length) q = q.or(cols.map((c) => `${c}.ilike.*${term}*`).join(","));
  }
  for (const [key, value] of Object.entries(params.filters ?? {})) {
    const f = fields.find((x) => x.key === key && x.filter);
    if (!f || value === "") continue;
    if (f.type === "boolean") q = q.eq(columnRef(f), f.custom ? value : value === "true");
    else q = q.eq(columnRef(f), value);
  }
  if (params.adv?.length) {
    const adv = advancedFields(fields);
    q = applyConditions(q, parseConditions(params.adv, adv), adv, {
      column: (k) => columnRef(fields.find((f) => f.key === k)!),
      dateTime: (k) => fields.find((f) => f.key === k)?.type === "datetime",
      dayStart: startOfDayVN,
      nextDayStart: (d) => startOfDayVN(addDaysYMD(d, 1)),
    });
  }
  return q;
}

/** Nhãn của các giá trị tham chiếu trong điều kiện tìm kiếm nâng cao */
export async function advValueLabels(supabase: SupabaseClient, fields: FieldDef[], adv: string[] | undefined) {
  const conds = parseConditions(adv, advancedFields(fields)).filter((c) => fields.find((f) => f.key === c.field)?.type === "reference");
  if (!conds.length) return {};
  const labels = await resolveRefLabels(
    supabase,
    fields.filter((f) => conds.some((c) => c.field === f.key)),
    conds.map((c) => ({ [c.field]: c.value })),
  );
  return Object.assign({}, ...Object.values(labels)) as Record<string, string>;
}

export async function listRows(
  supabase: SupabaseClient,
  entity: EntityDef,
  customRows: CustomFieldRow[],
  params: ListParams,
  opts: { limit?: number } = {},
) {
  const fields = effectiveFields(entity, customRows);
  const size = opts.limit ?? (PAGE_SIZES.includes(params.size as 20) ? params.size! : 20);
  const page = Math.max(1, params.page ?? 1);
  let query = supabase.from(entity.table).select("*", { count: "exact" });
  query = applyFilters(query, entity, fields, params);
  const sortField = fields.find((f) => f.key === params.sort && f.type !== "reference" && f.type !== "formula" && f.type !== "multiselect");
  const sortKey = sortField ? columnRef(sortField) : entity.defaultSort.key;
  const desc = sortField ? params.dir === "desc" : Boolean(entity.defaultSort.desc);
  query = query.order(sortKey, { ascending: !desc, nullsFirst: false });
  if (sortKey !== (entity.pk ?? "id")) query = query.order(entity.pk ?? "id");
  const from = opts.limit ? 0 : (page - 1) * size;
  query = query.range(from, from + size - 1);
  const { data, error, count } = await query;
  if (error) throw error;
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => flattenRow(fields, r));
  const refLabels = await resolveRefLabels(supabase, fields, rows);
  return { rows, total: count ?? rows.length, page, size, refLabels, fields };
}

/** Số bản ghi theo từng giá trị của trường tab trạng thái (giữ tìm kiếm và các bộ lọc khác, bỏ lọc trạng thái) */
export async function countByStatus(supabase: SupabaseClient, entity: EntityDef, fields: FieldDef[], params: ListParams) {
  const f = entity.statusTabs ? fields.find((x) => x.key === entity.statusTabs && x.type === "select") : undefined;
  if (!f) return null;
  const rest = { ...params, filters: { ...(params.filters ?? {}) } };
  delete rest.filters[f.key];
  const values = ["", ...(f.options ?? []).map((o) => o.value)];
  const counts = await Promise.all(
    values.map(async (v) => {
      let q = supabase.from(entity.table).select(entity.pk ?? "id", { count: "exact", head: true });
      q = applyFilters(q, entity, fields, rest);
      if (v) q = q.eq(columnRef(f), v);
      const { count, error } = await q;
      if (error) throw error;
      return [v || "all", count ?? 0] as const;
    }),
  );
  return { field: f.key, counts: Object.fromEntries(counts) as Record<string, number> };
}

/** Lấy nhãn hiển thị cho các cột tham chiếu (một truy vấn cho mỗi bảng đích, qua RLS) */
export async function resolveRefLabels(supabase: SupabaseClient, fields: FieldDef[], rows: Record<string, unknown>[]): Promise<RefLabels> {
  const out: RefLabels = {};
  const byTarget = new Map<string, Set<string>>();
  for (const f of fields) {
    if (f.type !== "reference" || !f.ref || !ENTITIES[f.ref]) continue;
    const ids = byTarget.get(f.ref) ?? new Set<string>();
    for (const r of rows) {
      const v = r[f.key];
      if (typeof v === "string" && v) ids.add(v);
    }
    byTarget.set(f.ref, ids);
  }
  const labelsByTarget: Record<string, Record<string, string>> = {};
  await Promise.all(
    [...byTarget.entries()].map(async ([target, ids]) => {
      labelsByTarget[target] = {};
      if (ids.size === 0) return;
      const t = ENTITIES[target];
      const { data } = await supabase
        .from(t.table)
        .select(["id", ...t.labelCols].join(","))
        .in("id", [...ids].slice(0, 1000));
      for (const r of (data ?? []) as unknown as Record<string, unknown>[]) labelsByTarget[target][String(r.id)] = rowLabel(t, r);
    }),
  );
  for (const f of fields) if (f.type === "reference" && f.ref) out[f.key] = labelsByTarget[f.ref] ?? {};
  return out;
}

/** Tùy chọn cho bộ lọc theo cột tham chiếu (tối đa 300 mục) */
export async function loadFilterOptions(supabase: SupabaseClient, fields: FieldDef[]) {
  const out: Record<string, { value: string; label: string }[]> = {};
  await Promise.all(
    fields
      .filter((f) => f.filter && f.type === "reference" && f.ref && ENTITIES[f.ref])
      .map(async (f) => {
        const t = ENTITIES[f.ref!];
        const { data } = await supabase
          .from(t.table)
          .select(["id", ...t.labelCols].join(","))
          .order(t.labelCols[0])
          .limit(300);
        out[f.key] = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ value: String(r.id), label: rowLabel(t, r) }));
      }),
  );
  return out;
}

/** Đọc tham số danh sách từ URL */
export function parseListParams(sp: Record<string, string | string[] | undefined>): ListParams {
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (k.startsWith("f_") && typeof v === "string" && /^[a-z][a-z0-9_]{0,62}$/.test(k.slice(2))) filters[k.slice(2)] = v.slice(0, 100);
  }
  const page = Number(one("page"));
  const size = Number(one("size"));
  const sort = one("sort");
  return {
    q: one("q")?.slice(0, 100),
    sort: sort && /^[a-z][a-z0-9_]{0,62}$/.test(sort) ? sort : undefined,
    dir: one("dir") === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    size: Number.isInteger(size) ? size : undefined,
    filters,
    adv: (Array.isArray(sp.a) ? sp.a : sp.a ? [sp.a] : []).slice(0, 20),
  };
}

/** Một bản ghi theo khóa chính, kèm nhãn tham chiếu */
export async function loadRecord(supabase: SupabaseClient, entity: EntityDef, customRows: CustomFieldRow[], id: string) {
  const fields = effectiveFields(entity, customRows);
  const { data, error } = await supabase.from(entity.table).select("*").eq(entity.pk ?? "id", id).maybeSingle();
  if (error) throw error;
  const record = (data as Record<string, unknown> | null) ?? null;
  const refLabels = record ? await resolveRefLabels(supabase, fields, [flattenRow(fields, record)]) : {};
  return { record, refLabels };
}

/** Bản ghi con của một bản ghi cha (tối đa 500 dòng) */
export async function loadChildren(supabase: SupabaseClient, entity: EntityDef, parentId: string) {
  const fields = effectiveFields(entity, []);
  let q = supabase.from(entity.table).select("*").eq(entity.parentKey!, parentId);
  for (const [k, v] of Object.entries(entity.fixed ?? {})) q = q.eq(k, v);
  const { data, error } = await q.order(entity.defaultSort.key, { ascending: !entity.defaultSort.desc }).limit(500);
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  return { rows, refLabels: await resolveRefLabels(supabase, fields, rows) };
}
