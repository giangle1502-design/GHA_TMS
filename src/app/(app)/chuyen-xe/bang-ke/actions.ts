"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/entities/record";
import { loadStatement } from "@/lib/freight-statement-data";
import { STATEMENT_STATUS_OPTIONS, STATEMENT_TABLE_KEY, resolveColumns, statementConfigSchema, statementFileName } from "@/lib/freight-statement";
import { buildStatementWorkbook } from "@/lib/freight-statement-excel";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const exportSchema = z.object({
  kh: z.string().uuid({ message: "Chọn khách hàng." }),
  tu: z.string().regex(YMD),
  den: z.string().regex(YMD),
  tt: z.enum(STATEMENT_STATUS_OPTIONS.map((o) => o.value) as [string, ...string[]]),
  config: statementConfigSchema,
  /** Chuyến người dùng bỏ ra khỏi bảng kê (bỏ tích hoặc lọc bằng ô tìm kiếm) */
  excludeIds: z.array(z.string().uuid()).max(2000).default([]),
});

/** Xuất bảng kê cước ra Excel: thông tin khách (trái), tiêu đề (giữa), công ty Khánh Hà (phải), bảng chuyến, tổng, ký nhận */
export async function exportStatementExcel(input: z.input<typeof exportSchema>): Promise<ActionResult<{ base64: string; filename: string; count: number }>> {
  return runAction(async () => {
    const me = await requirePermission("shipments.export");
    const d = exportSchema.parse(input);
    const supabase = await createClient();
    const data = await loadStatement(supabase, me.permissions, { kh: d.kh, tu: d.tu, den: d.den, tt: d.tt as "giao" });
    if (!data.customer) throw new ActionError("Không tìm thấy khách hàng.");
    const skip = new Set(d.excludeIds);
    const rows = data.rows.filter((r) => !skip.has(r.id)).map((r, i) => ({ ...r, cells: { ...r.cells, stt: i + 1 } }));
    const cols = resolveColumns(data.catalog, d.config);
    if (!cols.length) throw new ActionError("Chọn ít nhất một cột cho bảng kê.");
    const buf = await buildStatementWorkbook(d.config, data.customer, d.tu, d.den, cols, rows, data.catalog);
    return { base64: Buffer.from(buf).toString("base64"), filename: `${statementFileName(data.customer.code, d.tu, d.den)}.xlsx`, count: rows.length };
  });
}

const templateSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().trim().min(1, "Đặt tên mẫu.").max(80),
  shared: z.boolean(),
  config: statementConfigSchema,
});

/** Lưu mẫu bảng kê (cột, tên cột, tiêu đề, chữ ký). Mẫu dùng chung cần quyền cấu hình hệ thống. */
export async function saveStatementTemplate(input: z.input<typeof templateSchema>): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const me = await requirePermission("shipments.view");
    const d = templateSchema.parse(input);
    if (d.shared && !me.permissions.has("settings.configure")) throw new ActionError("Chỉ người có quyền Cấu hình hệ thống mới lưu được mẫu dùng chung. Hãy bỏ chọn Dùng chung để lưu mẫu riêng.");
    const supabase = await createClient();
    const row = {
      table_key: STATEMENT_TABLE_KEY,
      scope: d.shared ? "system" : "user",
      user_id: d.shared ? null : me.id,
      role_id: null,
      name: d.name,
      is_default: false,
      config: d.config,
    };
    if (d.id) {
      const { data, error } = await supabase.from("table_view_preferences").update(row).eq("id", d.id).eq("table_key", STATEMENT_TABLE_KEY).select("id");
      if (error) throw error;
      if (!data?.length) throw new ActionError("Không sửa được mẫu này (mẫu dùng chung chỉ người có quyền Cấu hình hệ thống sửa được).");
      revalidatePath("/chuyen-xe/bang-ke");
      return { id: d.id };
    }
    const { data, error } = await supabase.from("table_view_preferences").insert(row).select("id").single();
    if (error) {
      if (error.code === "23505") throw new ActionError("Đã có mẫu cùng tên. Đặt tên khác hoặc chọn mẫu đó rồi bấm Lưu mẫu.");
      throw error;
    }
    revalidatePath("/chuyen-xe/bang-ke");
    return { id: (data as { id: string }).id };
  }, "Đã lưu mẫu bảng kê.");
}

export async function deleteStatementTemplate(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("shipments.view");
    if (!isUuid(id)) throw new ActionError("Mẫu không hợp lệ.");
    const supabase = await createClient();
    const { data, error } = await supabase.from("table_view_preferences").delete().eq("id", id).eq("table_key", STATEMENT_TABLE_KEY).select("id");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Không xóa được mẫu này (mẫu dùng chung chỉ người có quyền Cấu hình hệ thống xóa được).");
    revalidatePath("/chuyen-xe/bang-ke");
  }, "Đã xóa mẫu.");
}
