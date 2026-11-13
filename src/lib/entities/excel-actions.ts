"use server";
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { todayVN } from "@/lib/format";
import { ENTITIES } from "./definitions";
import { entityAccess } from "./access";
import { effectiveFields, formatValue, rowLabel, splitCustom, validateRecord } from "./record";
import { describeField, importableFields, matchHeaders, normalizeHeader, parseCsv } from "./import";
import { EXPORT_LIMIT, listRows, loadCustomFields, visibleCustomRows, type ListParams } from "./server";
import type { EntityDef, FieldDef } from "./types";

const MAX_IMPORT_ROWS = 2000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

async function setup(entityKey: string) {
  const entity: EntityDef | undefined = ENTITIES[entityKey];
  if (!entity) throw new ActionError("Danh mục không tồn tại.");
  const me = await requirePermission();
  const access = entityAccess(entity, me.permissions);
  const supabase = await createClient();
  const customRows = visibleCustomRows(await loadCustomFields(supabase, entity.customModule), me.permissions);
  const fields = effectiveFields(entity, customRows, me.permissions);
  return { entity, access, supabase, customRows, fields };
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  row.alignment = { vertical: "middle" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

async function toBase64(wb: ExcelJS.Workbook) {
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer).toString("base64");
}

export type FileResult = { filename: string; base64: string; truncated?: boolean; count?: number };

/** Xuất danh sách đang lọc ra Excel theo các cột đang hiển thị */
export async function exportRecords(
  entityKey: string,
  params: Omit<ListParams, "page" | "size">,
  visibleColumns: string[],
): Promise<ActionResult<FileResult>> {
  return runAction(async () => {
    const { entity, access, supabase, customRows, fields } = await setup(entityKey);
    if (!access.export) throw new ActionError("Bạn không có quyền xuất dữ liệu này.");
    const { rows, total, refLabels } = await listRows(supabase, entity, customRows, { ...params, page: 1 }, { limit: EXPORT_LIMIT });
    const cols = (visibleColumns.length ? visibleColumns : fields.filter((f) => f.list).map((f) => f.key))
      .map((k) => fields.find((f) => f.key === k))
      .filter((f): f is FieldDef => Boolean(f));
    const wb = new ExcelJS.Workbook();
    wb.creator = "KHÁNH HÀ TMS";
    const ws = wb.addWorksheet(entity.label.slice(0, 31));
    ws.columns = cols.map((f) => ({ header: f.label, key: f.key, width: Math.min(40, Math.max(12, f.label.length + 4)) }));
    for (const r of rows) {
      ws.addRow(
        Object.fromEntries(
          cols.map((f) => {
            const v = r[f.key];
            if (v === null || v === undefined) return [f.key, null];
            if (["currency", "number", "percent", "formula"].includes(f.type)) return [f.key, Number(v)];
            return [f.key, formatValue(f, v, f.type === "reference" ? refLabels[f.key]?.[String(v)] : null)];
          }),
        ),
      );
    }
    cols.forEach((f, i) => {
      if (f.type === "currency") ws.getColumn(i + 1).numFmt = "#,##0";
    });
    styleHeader(ws);
    return {
      filename: `${entity.key}-${todayVN()}.xlsx`,
      base64: await toBase64(wb),
      truncated: total > rows.length,
      count: rows.length,
    };
  });
}

/** File mẫu để nhập: sheet dữ liệu + sheet hướng dẫn */
export async function importTemplate(entityKey: string): Promise<ActionResult<FileResult>> {
  return runAction(async () => {
    const { entity, access, fields } = await setup(entityKey);
    if (!access.import) throw new ActionError("Bạn không có quyền nhập dữ liệu này.");
    const cols = importableFields(fields);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Du lieu");
    ws.columns = cols.map((f) => ({ header: `${f.label}${f.required ? " *" : ""}`, key: f.key, width: Math.min(40, Math.max(14, f.label.length + 6)) }));
    styleHeader(ws);
    const guide = wb.addWorksheet("Huong dan");
    guide.columns = [
      { header: "Cột", key: "label", width: 30 },
      { header: "Bắt buộc", key: "req", width: 10 },
      { header: "Kiểu dữ liệu / giá trị hợp lệ", key: "desc", width: 90 },
    ];
    for (const f of cols) guide.addRow({ label: f.label, req: f.required ? "Có" : "", desc: describeField(f) + (f.key === "code" && entity.autoCode ? ". Để trống để hệ thống tự sinh." : "") });
    styleHeader(guide);
    if (entity.importExamples?.length) {
      // Sheet ví dụ (chỉ để xem; khi nhập app chỉ đọc sheet đầu tiên)
      const ex = wb.addWorksheet("Vi du");
      ex.columns = cols.map((f) => ({ header: f.label, key: f.key, width: Math.min(40, Math.max(14, f.label.length + 6)) }));
      for (const r of entity.importExamples) ex.addRow(r);
      styleHeader(ex);
    }
    return { filename: `mau-nhap-${entity.key}.xlsx`, base64: await toBase64(wb) };
  });
}

export type PreviewRow = { line: number; values: Record<string, unknown>; display: Record<string, string>; errors: string[] };
export type ImportPreview = {
  columns: { key: string; label: string }[];
  unknownHeaders: string[];
  missingRequired: string[];
  rows: PreviewRow[];
  validCount: number;
};

function cellText(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("hyperlink" in v) return String((v as { hyperlink: string }).hyperlink);
    return "";
  }
  return v;
}

async function readGrid(file: File): Promise<unknown[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return parseCsv(await file.text());
  if (!name.endsWith(".xlsx")) throw new ActionError("Chỉ hỗ trợ tệp .xlsx hoặc .csv.");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new ActionError("Tệp Excel không có sheet nào.");
  const grid: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = (row.values as ExcelJS.CellValue[]).slice(1).map(cellText);
    if (vals.some((v) => v !== "" && v !== null)) grid.push(vals);
  });
  return grid;
}

/** Tra id của bản ghi được tham chiếu theo mã hoặc tên */
async function referenceResolver(supabase: Awaited<ReturnType<typeof createClient>>, fields: FieldDef[]) {
  const maps: Record<string, Map<string, string>> = {};
  for (const f of fields) {
    if (f.type !== "reference" || !f.ref || maps[f.ref]) continue;
    const t = ENTITIES[f.ref];
    if (!t) continue;
    const hasCode = t.fields.some((x) => x.key === "code");
    const cols = ["id", ...(hasCode ? ["code"] : []), ...t.labelCols.filter((c) => c !== "code")];
    const { data } = await supabase.from(t.table).select([...new Set(cols)].join(",")).limit(5000);
    const m = new Map<string, string>();
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      const id = String(r.id);
      if (hasCode && r.code) m.set(normalizeHeader(String(r.code)), id);
      const first = r[t.labelCols[0]];
      if (first) m.set(normalizeHeader(String(first)), id);
      m.set(normalizeHeader(rowLabel(t, r)), id);
    }
    maps[f.ref] = m;
  }
  return (f: FieldDef, text: unknown): string | null => {
    if (text === "" || text === null || text === undefined) return "";
    return maps[f.ref!]?.get(normalizeHeader(String(text))) ?? null;
  };
}

function selectValue(f: FieldDef, v: unknown): unknown {
  if (typeof v !== "string" || !f.options) return v;
  const n = normalizeHeader(v);
  return f.options.find((o) => o.value === v || normalizeHeader(o.label) === n || normalizeHeader(o.value) === n)?.value ?? v;
}

/** Đọc tệp, ghép cột, kiểm tra từng dòng; chưa ghi gì vào CSDL */
export async function importPreview(entityKey: string, formData: FormData): Promise<ActionResult<ImportPreview>> {
  return runAction(async () => {
    const { entity, access, supabase, fields } = await setup(entityKey);
    if (!access.import) throw new ActionError("Bạn không có quyền nhập dữ liệu này.");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("Chưa chọn tệp.");
    if (file.size > MAX_FILE_BYTES) throw new ActionError("Tệp lớn hơn 2 MB. Hãy chia nhỏ tệp.");
    const grid = await readGrid(file);
    if (grid.length < 2) throw new ActionError("Tệp không có dòng dữ liệu nào (dòng đầu tiên phải là tiêu đề cột).");
    if (grid.length - 1 > MAX_IMPORT_ROWS) throw new ActionError(`Mỗi lần nhập tối đa ${MAX_IMPORT_ROWS} dòng.`);
    const cols = importableFields(fields);
    const { mapping, unknown, missingRequired } = matchHeaders(cols, grid[0].map((h) => String(h ?? "")));
    const used = mapping.filter((f): f is FieldDef => Boolean(f));
    const resolve = await referenceResolver(supabase, used);

    // Mã đã tồn tại (để báo trước thay vì lỗi trùng khi ghi)
    const codeIdx = mapping.findIndex((f) => f?.key === "code");
    const existingCodes = new Set<string>();
    if (codeIdx >= 0) {
      const codes = grid.slice(1).map((r) => String(r[codeIdx] ?? "").trim().toUpperCase()).filter(Boolean);
      for (let i = 0; i < codes.length; i += 500) {
        const { data } = await supabase.from(entity.table).select("code").in("code", codes.slice(i, i + 500));
        for (const r of data ?? []) existingCodes.add(String(r.code).toUpperCase());
      }
    }
    const seenCodes = new Set<string>();
    const rows: PreviewRow[] = grid.slice(1).map((cells, i) => {
      const values: Record<string, unknown> = {};
      const display: Record<string, string> = {};
      const errors: string[] = [];
      mapping.forEach((f, ci) => {
        if (!f) return;
        let v: unknown = cells[ci] ?? "";
        display[f.key] = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
        if (f.type === "reference") {
          const id = resolve(f, v);
          if (id === null) errors.push(`${f.label}: không tìm thấy "${String(v)}" trong danh mục`);
          v = id ?? "";
        } else if (f.type === "select") v = selectValue(f, v);
        else if (f.type === "multiselect" && typeof v === "string") v = v.split(/[,;]/).map((x) => selectValue(f, x.trim()));
        values[f.key] = v;
      });
      const { errors: ve } = validateRecord(used, values);
      errors.push(...Object.values(ve));
      const code = String(values.code ?? "").trim().toUpperCase();
      if (code) {
        if (existingCodes.has(code)) errors.push(`Mã ${code} đã tồn tại`);
        if (seenCodes.has(code)) errors.push(`Mã ${code} bị lặp trong tệp`);
        seenCodes.add(code);
      }
      return { line: i + 2, values, display, errors };
    });
    return {
      columns: used.map((f) => ({ key: f.key, label: f.label })),
      unknownHeaders: unknown,
      missingRequired,
      rows,
      validCount: rows.filter((r) => r.errors.length === 0).length,
    };
  });
}

/** Ghi các dòng hợp lệ trong một câu lệnh (tất cả hoặc không) */
export async function importCommit(entityKey: string, rows: Record<string, unknown>[], revalidate?: string): Promise<ActionResult<{ count: number }>> {
  return runAction(async () => {
    const { entity, access, supabase, fields } = await setup(entityKey);
    if (!access.import) throw new ActionError("Bạn không có quyền nhập dữ liệu này.");
    if (!Array.isArray(rows) || rows.length === 0) throw new ActionError("Không có dòng hợp lệ để nhập.");
    if (rows.length > MAX_IMPORT_ROWS) throw new ActionError(`Mỗi lần nhập tối đa ${MAX_IMPORT_ROWS} dòng.`);
    const cols = importableFields(fields);
    const payload = rows.map((raw, i) => {
      // Trường không có trong tệp lấy giá trị mặc định
      const withDefaults = Object.fromEntries(cols.map((f) => [f.key, f.key in raw ? raw[f.key] : f.defaultValue]));
      const { data, errors } = validateRecord(cols, withDefaults);
      const first = Object.values(errors)[0];
      if (first) throw new ActionError(`Dòng ${i + 1}: ${first}`);
      const { columns, custom } = splitCustom(cols, data);
      if (entity.autoCode && !columns.code) columns.code = "";
      return { ...columns, ...(entity.fixed ?? {}), ...(entity.customModule ? { custom_fields: custom } : {}) };
    });
    const { error } = await supabase.from(entity.table).insert(payload);
    if (error) throw error;
    if (revalidate) revalidatePath(revalidate);
    return { count: payload.length };
  }, "Đã nhập dữ liệu.");
}
