/**
 * Đọc / xuất file Excel bảng giá xe tải theo mẫu BANG_GIA_NOI_BO.xlsx (chạy trên trình duyệt, exceljs tải khi cần).
 */
import { parseRateSheet, type Grid, type GridCell, type ParsedCard, type TruckRateCard } from "@/lib/truck-rate";

type CellLike = { value: unknown };
type SheetLike = {
  name: string;
  rowCount: number;
  columnCount: number;
  getRow: (r: number) => { getCell: (c: number) => CellLike };
};

function cellValue(v: unknown): GridCell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (v instanceof Date) return null;
  if (typeof v === "object") {
    const o = v as { formula?: string; sharedFormula?: string; result?: unknown; richText?: { text: string }[]; text?: string };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (o.formula !== undefined || o.sharedFormula !== undefined) {
      const res = o.result;
      if (typeof res === "number" || typeof res === "string") return res;
      return o.formula ? { formula: o.formula } : null;
    }
    if (typeof o.text === "string") return o.text;
  }
  return null;
}

export function sheetToGrid(ws: SheetLike): Grid {
  const grid: Grid = [];
  const cols = Math.min(ws.columnCount, 60);
  for (let r = 1; r <= Math.min(ws.rowCount, 500); r++) {
    const row = ws.getRow(r);
    const out: GridCell[] = [];
    for (let c = 1; c <= cols; c++) out.push(cellValue(row.getCell(c).value));
    grid.push(out);
  }
  return grid;
}

/** Đọc file: lấy sheet đầu tiên có bảng cước "Từ (KM)" */
export async function readRateWorkbook(buf: ArrayBuffer, fileName: string, today: string): Promise<ParsedCard> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  let lastErr: unknown = null;
  for (const ws of wb.worksheets) {
    try {
      return parseRateSheet(sheetToGrid(ws as unknown as SheetLike), { sheetName: ws.name, fileName, today });
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("File không có bảng giá theo mẫu.");
}

/** Xuất file Excel cùng bố cục với file mẫu (nhập lại được) */
export async function downloadRateWorkbook(card: TruckRateCard) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "GHA-TMS";
  const ws = wb.addWorksheet("BẢNG GIÁ XE TẢI");
  const thin = { style: "thin" as const };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const headFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFDCE6F2" } };
  const money = "#,##0";
  const nw = card.weight_bands.length;

  ws.addRow([card.name]).font = { bold: true, size: 13 };
  const h = ws.addRow(["Từ (KM)", "Đến (KM)", "Khoảng cách", ...card.weight_bands.map((b) => b.label)]);
  h.font = { bold: true };
  h.eachCell((c) => ((c.fill = headFill), (c.border = border), (c.alignment = { wrapText: true, vertical: "middle", horizontal: "center" })));
  card.distance_bands.forEach((b, i) => {
    const row = ws.addRow([b.from_km, b.to_km, b.label, ...card.weight_bands.map((_, j) => card.prices[i]?.[j] ?? null)]);
    row.eachCell({ includeEmpty: true }, (c, col) => {
      if (col > 3 + nw) return;
      c.border = border;
      if (col > 3) c.numFmt = money;
    });
  });

  ws.addRow([]);
  ws.addRow([]);
  const lh = ws.addRow(["Từ  (Tấn)", "Đến (Tấn)", "Trọng tải", "Phí bốc xếp"]);
  lh.font = { bold: true };
  lh.eachCell((c) => ((c.fill = headFill), (c.border = border)));
  for (const b of card.weight_bands) {
    const row = ws.addRow([b.from_ton, b.to_ton, b.label, b.loading_fee ?? null]);
    row.eachCell({ includeEmpty: true }, (c, col) => {
      if (col > 4) return;
      c.border = border;
      if (col === 4) c.numFmt = money;
    });
  }

  ws.addRow([]);
  ws.addRow([]);
  const fh = ws.addRow(["Từ (VNĐ)", "Đến (VNĐ)", "Hỗ trợ dầu"]);
  fh.font = { bold: true };
  fh.eachCell((c) => ((c.fill = headFill), (c.border = border)));
  for (const b of card.fuel_bands) {
    const row = ws.addRow([b.from_price, b.to_price, b.factor]);
    row.eachCell({ includeEmpty: true }, (c, col) => {
      if (col > 3) return;
      c.border = border;
      c.numFmt = col === 3 ? "0.00" : money;
    });
  }

  ws.getColumn(1).width = 11;
  ws.getColumn(2).width = 11;
  ws.getColumn(3).width = 18;
  for (let j = 0; j < Math.max(nw, 1); j++) ws.getColumn(4 + j).width = 15;

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(card.code || "Bang-gia-xe-tai").replace(/[^\w-]+/g, "_")}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
