/**
 * Tạo tệp Excel (.xlsx) ngay trên trình duyệt từ bảng đang xem (không giới hạn số dòng như khi gửi lên máy chủ).
 * Số: "," ngăn cách hàng nghìn, "." thập phân.
 */
export type XlsxColumn = { label: string; width: number; numeric?: boolean };

export async function downloadXlsx(opts: {
  filename: string;
  sheet: string;
  title?: string;
  subtitle?: string;
  columns: XlsxColumn[];
  rows: (string | number | null | undefined)[][];
  /** Dòng tổng cuối bảng (tùy chọn) */
  footer?: (string | number | null | undefined)[];
}) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "KHÁNH HÀ TMS";
  const ws = wb.addWorksheet(
    opts.sheet.replace(/[\\/?*[\]:]/g, " ").slice(0, 31),
  );
  let headerRow = 1;
  if (opts.title) {
    ws.addRow([opts.title]).font = { bold: true, size: 13 };
    headerRow++;
    if (opts.subtitle) {
      ws.addRow([opts.subtitle]).font = { italic: true };
      headerRow++;
    }
    ws.addRow([]);
    headerRow++;
  }
  const border = {
    top: { style: "thin" as const },
    bottom: { style: "thin" as const },
    left: { style: "thin" as const },
    right: { style: "thin" as const },
  };
  const head = ws.addRow(opts.columns.map((c) => c.label));
  head.font = { bold: true };
  head.alignment = { vertical: "middle", wrapText: true };
  head.eachCell((c) => {
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFDCE6F2" },
    };
    c.border = border;
  });
  opts.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(6, Math.min(80, Math.round(c.width / 7)));
    if (c.numeric) col.numFmt = "#,##0.##";
  });
  for (const r of opts.rows) {
    const row = ws.addRow(opts.columns.map((_, i) => r[i] ?? null));
    row.alignment = { vertical: "top", wrapText: true };
  }
  if (opts.footer) {
    const row = ws.addRow(opts.columns.map((_, i) => opts.footer![i] ?? null));
    row.font = { bold: true };
    row.eachCell((c) => (c.border = border));
  }
  ws.views = [{ state: "frozen", ySplit: headerRow }];
  ws.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow, column: opts.columns.length },
  };
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const name = opts.filename.replace(/[^\p{L}\p{N}._ -]/gu, "-");
  a.download = name.endsWith(".xlsx") ? name : `${name}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
