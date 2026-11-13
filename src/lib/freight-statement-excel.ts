import "server-only";
import ExcelJS from "exceljs";
import {
  formatStatementCell,
  paymentSummary,
  statementHeading,
  statementTotals,
  sumsInTable,
  vndInWords,
  type ResolvedColumn,
  type StatementColumn,
  type StatementConfig,
} from "@/lib/freight-statement";

const thin = { style: "thin" as const };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
/** Tiêu đề cột: nền đen, chữ trắng, vạch trắng "|" ngăn giữa các cột */
const white = { style: "thin" as const, color: { argb: "FFFFFFFF" } };
const HEAD_BORDER = { top: thin, bottom: thin, left: white, right: white };

/** Tệp Excel bảng kê: khách hàng (trái) | tiêu đề (giữa) | công ty Khánh Hà (phải), bảng chuyến, tổng cộng, bằng chữ, ký nhận hai bên */
export async function buildStatementWorkbook(
  cfg: StatementConfig,
  customer: { name: string; tax_code: string | null; billing_address: string | null },
  tu: string,
  den: string,
  cols: ResolvedColumn[],
  rows: { cells: Record<string, string | number | null> }[],
  catalog: StatementColumn[],
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "KHÁNH HÀ TMS";
  const ws = wb.addWorksheet("Bảng kê cước", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
  });
  const n = cols.length;
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.w));

  // Ba khối đầu trang: trái (khách hàng) | giữa (tiêu đề) | phải (Khánh Hà)
  const side = n >= 6 ? Math.max(2, Math.floor(n * 0.3)) : n >= 3 ? 1 : 0;
  const blocks = side
    ? [
        [1, side],
        [side + 1, n - side],
        [n - side + 1, n],
      ]
    : [
        [1, n],
        [1, n],
        [1, n],
      ];
  const heading = statementHeading(cfg.title, tu, den);
  const left = [customer.name.toUpperCase(), `MST: ${customer.tax_code ?? ""}`, `Địa chỉ: ${customer.billing_address ?? ""}`];
  const right = [cfg.companyName, `Địa chỉ: ${cfg.companyAddress}`, `Mã số thuế: ${cfg.companyTaxCode}`];
  const put = (row: number, [c1, c2]: number[], value: string, font: Partial<ExcelJS.Font>, align: ExcelJS.Alignment["horizontal"]) => {
    if (c2 > c1) ws.mergeCells(row, c1, row, c2);
    const cell = ws.getCell(row, c1);
    cell.value = value;
    cell.font = { name: "Times New Roman", size: 11, ...font };
    cell.alignment = { horizontal: align, vertical: "middle", wrapText: true };
  };
  let r = 1;
  if (side) {
    for (let i = 0; i < 3; i++) {
      put(r + i, blocks[0], left[i], { bold: i === 0 }, "left");
      put(r + i, blocks[2], right[i], { bold: i === 0 }, "left");
      ws.getRow(r + i).height = i === 2 ? 42 : 30;
    }
    ws.mergeCells(r, blocks[1][0], r + 1, blocks[1][1]);
    const t = ws.getCell(r, blocks[1][0]);
    t.value = heading.title;
    t.font = { name: "Times New Roman", size: 15, bold: true };
    t.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    put(r + 2, blocks[1], heading.range, { italic: true }, "center");
    r += 4;
  } else {
    for (const [i, v] of [...left, ...right].entries()) put(r + i, blocks[0], v, { bold: i === 0 || i === 3 }, "left");
    r += 6;
    put(r, blocks[1], heading.title, { size: 15, bold: true }, "center");
    put(r + 1, blocks[1], heading.range, { italic: true }, "center");
    r += 3;
  }

  // Bảng chuyến
  const headerRow = r;
  const head = ws.getRow(r);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.title;
    cell.font = { name: "Times New Roman", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
    cell.border = HEAD_BORDER;
  });
  head.height = 32;
  r++;
  for (const row of rows) {
    const x = ws.getRow(r++);
    cols.forEach((c, i) => {
      const cell = x.getCell(i + 1);
      const v = row.cells[c.key];
      cell.value = v ?? null;
      cell.font = { name: "Times New Roman", size: 11 };
      cell.border = BORDER;
      if (typeof v === "number") {
        cell.numFmt = c.kind === "percent" ? '#,##0.##"%"' : c.kind === "money" || c.kind === "price" ? "#,##0" : c.kind === "index" ? "0" : "#,##0.##";
        cell.alignment = { horizontal: c.kind === "index" ? "center" : "right", vertical: "middle" };
      } else cell.alignment = { vertical: "middle", wrapText: true };
    });
  }
  // Dòng tổng cộng
  const asRows = rows.map((x, i) => ({ id: String(i), cells: x.cells }));
  const totals = statementTotals(cols, asRows, cfg.noSum);
  const firstNum = cols.findIndex((c) => sumsInTable(c, cfg.noSum));
  const tr = ws.getRow(r);
  const labelEnd = firstNum > 0 ? firstNum : 1;
  if (labelEnd > 1) ws.mergeCells(r, 1, r, labelEnd);
  tr.getCell(1).value = "TỔNG CỘNG";
  cols.forEach((c, i) => {
    const cell = tr.getCell(i + 1);
    cell.font = { name: "Times New Roman", size: 11, bold: true };
    cell.border = BORDER;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
    if (i + 1 > labelEnd && sumsInTable(c, cfg.noSum)) {
      cell.value = totals[c.key];
      cell.numFmt = c.kind === "money" ? "#,##0" : "#,##0.##";
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
  });
  tr.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  r += 2;

  if (cfg.showWords) {
    // Ghi rõ từng khoản rồi mới đến tổng thanh toán và số tiền bằng chữ
    const pay = paymentSummary(catalog, cfg, asRows);
    put(r++, [1, n], "TỔNG TIỀN THANH TOÁN", { bold: true }, "left");
    for (const l of pay.lines) put(r++, [1, n], `   - ${l.label}: ${formatStatementCell("money", l.amount)} đồng`, {}, "left");
    put(r++, [1, n], `Tổng số tiền thanh toán: ${formatStatementCell("money", pay.total)} đồng`, { bold: true }, "left");
    put(r++, [1, n], `Bằng chữ: ${vndInWords(pay.total)}.`, { italic: true }, "left");
  }
  if (cfg.note.trim()) {
    put(r, [1, n], cfg.note.trim(), {}, "left");
    ws.getRow(r).height = Math.min(120, 18 * (cfg.note.split("\n").length + 1));
    r++;
  }
  r++;
  // Ký nhận hai bên
  const half = Math.max(1, Math.floor(n / 2));
  const signL = [1, half];
  const signR = [Math.min(n, half + 1), n];
  put(r, n > 1 ? signR : [1, 1], `${cfg.signPlace}, ngày ..... tháng ..... năm ${den.slice(0, 4)}`, { italic: true }, "center");
  r++;
  if (n > 1) {
    put(r, signL, cfg.leftSign, { bold: true }, "center");
    put(r, signR, cfg.rightSign, { bold: true }, "center");
    put(r + 1, signL, "(Ký, ghi rõ họ tên, đóng dấu)", { italic: true }, "center");
    put(r + 1, signR, "(Ký, ghi rõ họ tên, đóng dấu)", { italic: true }, "center");
  }
  ws.views = [{ state: "frozen", ySplit: headerRow }];
  ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
  return wb.xlsx.writeBuffer();
}
