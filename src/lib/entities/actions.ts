"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { ENTITIES } from "./definitions";
import { entityAccess } from "./access";
import { effectiveFields, isUuid, rowLabel, splitCustom, validateRecord } from "./record";
import { loadCustomFields, sanitizeSearch, visibleCustomRows } from "./server";
import { assertActiveRefs } from "./active-check";
import type { EntityDef, TableViewConfig } from "./types";

function entityOr404(key: string): EntityDef {
  const e = ENTITIES[key];
  if (!e) throw new ActionError("Danh mục không tồn tại.");
  return e;
}

async function context(entityKey: string) {
  const entity = entityOr404(entityKey);
  const me = await requirePermission();
  const access = entityAccess(entity, me.permissions);
  const supabase = await createClient();
  return { entity, me, access, supabase };
}

export type SaveInput = {
  id?: string | null;
  parentId?: string | null;
  values: Record<string, unknown>;
  /** updated_at lúc mở biểu mẫu, để phát hiện người khác đã sửa */
  expectedUpdatedAt?: string | null;
  /** Tạo nhanh từ nút "+" */
  quick?: boolean;
  /** Đường dẫn cần làm mới */
  revalidate?: string;
};

export async function saveRecord(entityKey: string, input: SaveInput): Promise<ActionResult<{ id: string; label: string }>> {
  return runAction(async () => {
    const { entity, me, access, supabase } = await context(entityKey);
    const isUpdate = Boolean(input.id) || Boolean(entity.singleton && input.parentId);
    if (isUpdate ? !access.update : !access.create) throw new ActionError("Bạn không có quyền thực hiện thao tác này.");
    if (input.id && !isUuid(input.id)) throw new ActionError("Mã bản ghi không hợp lệ.");
    if (entity.parentKey && !isUuid(input.parentId)) throw new ActionError("Thiếu bản ghi cha.");

    const customRows = visibleCustomRows(await loadCustomFields(supabase, entity.customModule), me.permissions);
    const allFields = effectiveFields(entity, customRows, me.permissions);
    let fields = allFields;
    let raw = input.values ?? {};
    if (input.quick && !input.id) {
      // Tạo nhanh: chỉ nhận các trường tạo nhanh + trường bắt buộc; còn lại lấy giá trị mặc định
      const quick = new Set(entity.quickFields ?? []);
      fields = allFields.filter((f) => quick.has(f.key) || (f.required && f.defaultValue === undefined) || f.defaultValue !== undefined);
      raw = Object.fromEntries(fields.map((f) => [f.key, quick.has(f.key) || f.defaultValue === undefined ? raw[f.key] : f.defaultValue]));
    }
    const { data, errors } = validateRecord(fields, raw);
    const firstError = Object.values(errors)[0];
    if (firstError) throw new ActionError(firstError);
    const { columns, custom } = splitCustom(fields, data);
    const pk = entity.pk ?? "id";

    // Không cho chọn mới bản ghi đã ngừng hoạt động (VD khách hàng ngừng hoạt động); giá trị cũ giữ nguyên thì vẫn lưu được
    const refFields = fields.filter((f) => f.type === "reference" && f.ref && ENTITIES[f.ref]?.activeFilter && data[f.key]);
    if (refFields.length) {
      let prev: Record<string, unknown> = {};
      if (input.id) {
        const { data: cur, error } = await supabase.from(entity.table).select("*").eq(pk, input.id).maybeSingle();
        if (error) throw error;
        prev = (cur as Record<string, unknown> | null) ?? {};
      }
      const prevCustom = (prev.custom_fields ?? {}) as Record<string, unknown>;
      await assertActiveRefs(
        supabase,
        refFields.map((f) => ({ ref: f.ref!, id: String(data[f.key]), previous: (f.custom ? prevCustom[f.key] : prev[f.key]) as string | null, label: f.label })),
      );
    }
    if (entity.autoCode && "code" in columns && !columns.code) columns.code = "";

    const payload: Record<string, unknown> = { ...columns, ...(entity.writeFixed ?? {}), ...(entity.fixed ?? {}) };
    if (entity.parentKey) payload[entity.parentKey] = input.parentId;

    if (entity.customModule) {
      // Gộp với custom_fields hiện có để không làm mất trường người dùng không được xem/sửa
      let existing: Record<string, unknown> = {};
      if (input.id) {
        const { data: cur, error } = await supabase.from(entity.table).select("custom_fields").eq(pk, input.id).maybeSingle();
        if (error) throw error;
        existing = (cur?.custom_fields as Record<string, unknown>) ?? {};
      }
      const editable = new Set(allFields.filter((f) => f.custom && !f.readOnly).map((f) => f.key));
      const merged = { ...existing };
      for (const [k, v] of Object.entries(custom)) if (editable.has(k)) merged[k] = v;
      payload.custom_fields = merged;
    }

    let saved: Record<string, unknown> | null = null;
    if (entity.singleton) {
      // Bản ghi đơn theo cha (khóa chính = khóa cha): upsert
      const { data: row, error } = await supabase.from(entity.table).upsert(payload, { onConflict: pk }).select("*").single();
      if (error) throw error;
      saved = row;
    } else if (input.id) {
      let q = supabase.from(entity.table).update(payload).eq(pk, input.id);
      for (const [k, v] of Object.entries(entity.fixed ?? {})) q = q.eq(k, v);
      if (input.expectedUpdatedAt) q = q.eq("updated_at", input.expectedUpdatedAt);
      const { data: rows, error } = await q.select("*");
      if (error) throw error;
      if (!rows?.length) {
        const { data: still } = await supabase.from(entity.table).select(pk).eq(pk, input.id).maybeSingle();
        if (still && input.expectedUpdatedAt) {
          throw new ActionError("Bản ghi vừa được người khác sửa. Vui lòng đóng biểu mẫu, tải lại trang và nhập lại.");
        }
        throw new ActionError("Không tìm thấy bản ghi hoặc bạn không có quyền sửa.");
      }
      saved = rows[0];
    } else {
      const { data: row, error } = await supabase.from(entity.table).insert(payload).select("*").single();
      if (error) throw error;
      saved = row;
    }
    if (input.revalidate) revalidatePath(input.revalidate);
    return { id: String(saved?.[pk] ?? ""), label: rowLabel(entity, saved ?? {}) };
  }, input.id || ENTITIES[entityKey]?.singleton ? "Đã lưu thay đổi." : `Đã thêm ${ENTITIES[entityKey]?.singular ?? "bản ghi"}.`);
}

export async function deleteRecord(entityKey: string, id: string, revalidate?: string): Promise<ActionResult> {
  return runAction(async () => {
    const { entity, access, supabase } = await context(entityKey);
    if (!access.delete) throw new ActionError("Bạn không có quyền xóa.");
    if (!isUuid(id)) throw new ActionError("Mã bản ghi không hợp lệ.");
    const pk = entity.pk ?? "id";
    let q = supabase.from(entity.table).delete().eq(pk, id);
    for (const [k, v] of Object.entries(entity.fixed ?? {})) q = q.eq(k, v);
    const { data, error } = await q.select(pk);
    if (error) {
      if (error.code === "23503") {
        throw new ActionError(entity.archiveHint ?? "Bản ghi đang được sử dụng ở nơi khác nên không xóa được; hãy chuyển sang ngừng sử dụng.");
      }
      throw error;
    }
    if (!data?.length) throw new ActionError("Không tìm thấy bản ghi hoặc bạn không có quyền xóa.");
    if (revalidate) revalidatePath(revalidate);
  }, "Đã xóa.");
}

export type RefOption = { value: string; label: string };

/** Tìm bản ghi để chọn trong ô tham chiếu (qua RLS của người dùng) */
export async function searchReferences(
  refKey: string,
  q: string,
  includeIds: string[] = [],
  /** Lọc thêm theo cột tham chiếu / lựa chọn của danh mục (ví dụ chỉ xe của một nhà xe 3PL) */
  where: Record<string, string> = {},
): Promise<ActionResult<RefOption[]>> {
  return runAction(async () => {
    const entity = entityOr404(refKey);
    await requirePermission();
    const supabase = await createClient();
    const cols = ["id", ...entity.labelCols].join(",");
    let query = supabase.from(entity.table).select(cols);
    for (const [k, v] of Object.entries(where ?? {})) {
      const f = entity.fields.find((x) => x.key === k && !x.custom && (x.type === "reference" || x.type === "select"));
      if (!f || typeof v !== "string" || !v) continue;
      if (f.type === "reference" && !isUuid(v)) continue;
      query = query.eq(k, v);
    }
    for (const [k, v] of Object.entries(entity.fixed ?? {})) query = query.eq(k, v);
    for (const [k, v] of Object.entries(entity.refExclude ?? {})) query = query.neq(k, v);
    for (const c of entity.refNull ?? []) query = query.is(c, null);
    if (entity.activeFilter) query = query.eq(entity.activeFilter.col, entity.activeFilter.value);
    const term = sanitizeSearch(q ?? "");
    const searchCols = entity.search.length ? entity.search : entity.labelCols;
    const termOr = term ? searchCols.map((c) => `${c}.ilike.*${term}*`).join(",") : "";
    if (entity.refOr && termOr) query = query.or(`and(or(${entity.refOr}),or(${termOr}))`);
    else if (entity.refOr) query = query.or(entity.refOr);
    else if (termOr) query = query.or(termOr);
    const { data, error } = await query.order(entity.labelCols[0]).limit(30);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const ids = includeIds.filter(isUuid).filter((id) => !rows.some((r) => r.id === id));
    if (ids.length) {
      const { data: extra } = await supabase.from(entity.table).select(cols).in("id", ids);
      rows.unshift(...((extra ?? []) as unknown as Record<string, unknown>[]));
    }
    return rows.map((r) => ({ value: String(r.id), label: rowLabel(entity, r) }));
  });
}

const TABLE_KEY_RE = /^[a-z][a-z0-9_.]*$/;

export async function saveTableView(tableKey: string, config: TableViewConfig): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission();
    if (!TABLE_KEY_RE.test(tableKey)) throw new ActionError("Bảng không hợp lệ.");
    const clean: TableViewConfig = {
      hidden: (config.hidden ?? []).filter((k) => typeof k === "string").slice(0, 200),
      order: (config.order ?? []).filter((k) => typeof k === "string").slice(0, 200),
      pinned: (config.pinned ?? []).filter((k) => typeof k === "string").slice(0, 10),
      widths: Object.fromEntries(
        Object.entries(config.widths ?? {})
          .filter(([, v]) => typeof v === "number" && v >= 40 && v <= 1000)
          .slice(0, 200),
      ),
      density: config.density === "compact" ? "compact" : "normal",
      rowHeight: typeof config.rowHeight === "number" && config.rowHeight >= 28 && config.rowHeight <= 200 ? Math.round(config.rowHeight) : null,
      pageSize: [20, 50, 100].includes(config.pageSize ?? 0) ? config.pageSize : 20,
      sort: (Array.isArray(config.sort) ? config.sort : [])
        .filter((x) => x && typeof x.id === "string")
        .slice(0, 3)
        .map((x) => ({ id: x.id, desc: Boolean(x.desc) })),
    };
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_table_view", { p_table_key: tableKey, p_config: clean });
    if (error) throw error;
  }, "Đã lưu cấu hình bảng.");
}

export async function resetTableView(tableKey: string): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requirePermission();
    if (!TABLE_KEY_RE.test(tableKey)) throw new ActionError("Bảng không hợp lệ.");
    const supabase = await createClient();
    const { error } = await supabase.from("table_view_preferences").delete().eq("table_key", tableKey).eq("scope", "user").eq("user_id", me.id);
    if (error) throw error;
  }, "Đã khôi phục cấu hình mặc định.");
}

/** Thông tin để dựng biểu mẫu ở trình duyệt: trường động được xem + quyền */
export async function getEntityMeta(entityKey: string) {
  return runAction(async () => {
    const { entity, me, access, supabase } = await context(entityKey);
    const customRows = access.view || access.create ? visibleCustomRows(await loadCustomFields(supabase, entity.customModule), me.permissions) : [];
    return { customRows, access };
  });
}
