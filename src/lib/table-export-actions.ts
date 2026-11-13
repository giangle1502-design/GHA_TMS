"use server";
import ExcelJS from "exceljs";
import { z } from "zod";
import { requirePermission, runAction, type ActionResult } from "@/lib/auth/action";

const MAX_ROWS = 2000;
const cell = z.union([z.string().max(4000), z.number(), z.null()]);
const schema = z.object({
  sheet: z.string().min(1).max(31),
  filename: z.string().min(1).max(120),
  title: z.string().max(300).optional(),
  columns: z.array(z.object({ label: z.string().max(200), width: z.number().min(4).max(120), numeric: z.boolean().optional() })).min(1).max(80),
  rows: z.array(z.array(cell)).max(MAX_ROWS),
});
export type TableExportInput = z.infer<typeof schema>;

/**
 * Xuất đúng bảng người dùng đang xem ra Excel: các cột đang hiện theo thứ tự đang xếp,
 * các dòng theo bộ lọc và sắp xếp hiện tại (dữ liệu do bảng ở trình duyệt gửi lên).
 */
export async function exportTableView(input: TableExportInput): Promise<ActionResult<{ base64: string; filename: string; count: number }>> {
  return runAction(async () => {
    await requirePermission("dispatch.view");
    const d = schema.parse(input);
    const wb = new ExcelJS.Workbook();
    wb.creator = "KHÁNH HÀ TMS";
    const ws = wb.addWorksheet(d.sheet.replace(/[\\/?*[\]:]/g, " "));
    let headerRow = 1;
    if (d.title) {
      ws.addRow([d.title]).font = { bold: true, size: 13 };
      ws.addRow([]);
      headerRow = 3;
    }
    const head = ws.addRow(d.columns.map((c) => c.label));
    head.font = { bold: true };
    head.alignment = { vertical: "middle", wrapText: true };
    head.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F2" } };
      c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    });
    d.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width;
      // "," ngăn cách hàng nghìn, "." thập phân
      if (c.numeric) col.numFmt = "#,##0.##";
    });
    for (const r of d.rows) {
      const row = ws.addRow(d.columns.map((_, i) => r[i] ?? null));
      row.alignment = { vertical: "top", wrapText: true };
    }
    ws.views = [{ state: "frozen", ySplit: headerRow }];
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: d.columns.length } };
    const buf = await wb.xlsx.writeBuffer();
    const name = d.filename.replace(/[^\p{L}\p{N}._ -]/gu, "-");
    return { base64: Buffer.from(buf).toString("base64"), filename: name.endsWith(".xlsx") ? name : `${name}.xlsx`, count: d.rows.length };
  });
}
