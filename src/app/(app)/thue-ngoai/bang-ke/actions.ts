"use server";
import { z } from "zod";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { createClient } from "@/lib/supabase/server";
import { loadCarrierStatement } from "@/lib/freight-statement-data";
import { STATEMENT_STATUS_OPTIONS, carrierStatementFileName, resolveColumns, statementConfigSchema } from "@/lib/freight-statement";
import { buildStatementWorkbook } from "@/lib/freight-statement-excel";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const exportSchema = z.object({
  nx: z.string().uuid({ message: "Chọn nhà xe 3PL." }),
  kh: z.union([z.string().uuid(), z.literal("")]).default(""),
  tu: z.string().regex(YMD),
  den: z.string().regex(YMD),
  tt: z.enum(STATEMENT_STATUS_OPTIONS.map((o) => o.value) as [string, ...string[]]),
  config: statementConfigSchema,
  /** Chuyến người dùng bỏ tích (hoặc lọc bằng ô tìm kiếm): không đưa vào bảng kê */
  excludeIds: z.array(z.string().uuid()).max(2000).default([]),
});

/** Xuất bảng kê 3PL ra Excel: nhà xe (trái), tiêu đề (giữa), công ty GHA (phải), bảng chuyến đã tích, tổng, ký nhận */
export async function exportCarrierStatementExcel(input: z.input<typeof exportSchema>): Promise<ActionResult<{ base64: string; filename: string; count: number }>> {
  return runAction(async () => {
    const me = await requirePermission("reports.view", "receivables.view");
    if (!me.permissions.has("carriers.view")) throw new ActionError("Bạn không có quyền xem chi phí 3PL.");
    const d = exportSchema.parse(input);
    const supabase = await createClient();
    const data = await loadCarrierStatement(supabase, me.permissions, { nx: d.nx, kh: d.kh, tu: d.tu, den: d.den, tt: d.tt as "giao" });
    if (!data.customer) throw new ActionError("Không tìm thấy nhà xe 3PL.");
    const skip = new Set(d.excludeIds);
    const rows = data.rows.filter((r) => !skip.has(r.id)).map((r, i) => ({ ...r, cells: { ...r.cells, stt: i + 1 } }));
    const cols = resolveColumns(data.catalog, d.config);
    if (!cols.length) throw new ActionError("Chọn ít nhất một cột cho bảng kê.");
    const buf = await buildStatementWorkbook(d.config, data.customer, d.tu, d.den, cols, rows, data.catalog);
    return { base64: Buffer.from(buf).toString("base64"), filename: `${carrierStatementFileName(data.customer.code, d.tu, d.den)}.xlsx`, count: rows.length };
  });
}
