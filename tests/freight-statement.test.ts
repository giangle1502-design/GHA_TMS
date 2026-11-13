import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
vi.mock("server-only", () => ({}));
import { buildStatementWorkbook } from "@/lib/freight-statement-excel";
import {
  BASE_STATEMENT_COLUMNS,
  defaultStatementConfig,
  formatStatementCell,
  monthRange,
  resolveColumns,
  statementHeading,
  statementTotals,
  vndInWords,
} from "@/lib/freight-statement";

describe("vndInWords", () => {
  it("đọc số tiền tiếng Việt", () => {
    expect(vndInWords(0)).toBe("Không đồng");
    expect(vndInWords(15)).toBe("Mười lăm đồng");
    expect(vndInWords(21)).toBe("Hai mươi mốt đồng");
    expect(vndInWords(105)).toBe("Một trăm linh năm đồng");
    expect(vndInWords(1_250_000)).toBe("Một triệu hai trăm năm mươi nghìn đồng");
    expect(vndInWords(1_000_005)).toBe("Một triệu không trăm linh năm đồng");
    expect(vndInWords(34_514_000)).toBe("Ba mươi tư triệu năm trăm mười bốn nghìn đồng");
    expect(vndInWords(2_000_000_000)).toBe("Hai tỷ đồng");
  });
});

describe("bảng kê", () => {
  it("tiêu đề theo tháng và khoảng ngày", () => {
    expect(statementHeading("BẢNG KÊ CƯỚC PHÍ VẬN CHUYỂN", "2026-11-01", "2026-11-30")).toEqual({
      title: "BẢNG KÊ CƯỚC PHÍ VẬN CHUYỂN 11-2026",
      range: "(Từ ngày 01/11/2026 đến ngày 30/11/2026)",
    });
    expect(statementHeading("", "2026-10-26", "2026-11-25").title).toBe("BẢNG KÊ CƯỚC PHÍ VẬN CHUYỂN 10-2026 – 11-2026");
  });
  it("khoảng tháng", () => {
    expect(monthRange("2026-02-10")).toEqual({ tu: "2026-02-01", den: "2026-02-28" });
    expect(monthRange("2026-01-10", -1)).toEqual({ tu: "2025-12-01", den: "2025-12-31" });
  });
  it("cột theo mẫu, đổi tên, bỏ cột không còn, cộng tổng", () => {
    const catalog = [...BASE_STATEMENT_COLUMNS, { key: "cf_so_cont", label: "Số cont", kind: "text" as const, group: "x", width: 14 }];
    const def = defaultStatementConfig(catalog);
    expect(def.columns.slice(0, 3)).toEqual(["stt", "pickup_at", "cf_so_cont"]);
    const cols = resolveColumns(catalog, { columns: ["stt", "khong_co", "quantity", "amount_due", "quantity"], labels: { amount_due: "Thành tiền" }, widths: { stt: 5 } });
    expect(cols.map((c) => c.title)).toEqual(["STT", "SL", "Thành tiền"]);
    expect(cols[0].w).toBe(5);
    const t = statementTotals(cols, [
      { id: "a", cells: { stt: 1, quantity: 2, amount_due: 1_000_000 } },
      { id: "b", cells: { stt: 2, quantity: 1, amount_due: null } },
    ]);
    expect(t).toEqual({ quantity: 3, amount_due: 1_000_000 });
  });
  it("tổng thanh toán theo khoản chọn, bỏ cộng tổng từng cột", async () => {
    const { paymentSummary } = await import("@/lib/freight-statement");
    const rows = [
      { id: "a", cells: { transport_fee: 1000, pass_through_fee: 200, loading_fee: 0, quantity: 1 } },
      { id: "b", cells: { transport_fee: 500, pass_through_fee: 0, loading_fee: 0, quantity: 2 } },
    ];
    const p = paymentSummary(BASE_STATEMENT_COLUMNS, { payColumns: ["transport_fee", "pass_through_fee", "loading_fee", "quantity"], labels: { transport_fee: "Cước vận chuyển" } }, rows);
    expect(p.lines).toEqual([
      { key: "transport_fee", label: "Cước vận chuyển", amount: 1500 },
      { key: "pass_through_fee", label: "Phí chi hộ", amount: 200 },
    ]);
    expect(p.total).toBe(1700);
    const cols = resolveColumns(BASE_STATEMENT_COLUMNS, { columns: ["quantity", "transport_fee"], labels: {}, widths: {} });
    expect(statementTotals(cols, rows, ["quantity"])).toEqual({ transport_fee: 1500 });
  });
  it("định dạng số: dấu phẩy hàng nghìn", () => {
    expect(formatStatementCell("money", 3500000)).toBe("3,500,000");
    expect(formatStatementCell("percent", 39.5)).toBe("39.5%");
    expect(formatStatementCell("text", null)).toBe("");
  });
});

describe("Excel bảng kê", () => {
  it("đầu trang 3 khối, bảng, tổng, bằng chữ, chữ ký", async () => {
    const catalog = BASE_STATEMENT_COLUMNS;
    const cfg = defaultStatementConfig(catalog);
    const cols = resolveColumns(catalog, cfg);
    const rows = [
      { cells: { stt: 1, pickup_at: "01/11/2026", route_label: "Cát Lái → Bình Dương", plate_number: "61K31295", quantity: 1, unit_price: 2_000_000, fuel_support_rate: 39, transport_fee: 2_780_000, pass_through_fee: 500_000, declaration_fee: 0, loading_fee: 0, amount_due: 3_280_000, notes: null } },
      { cells: { stt: 2, pickup_at: "02/11/2026", route_label: "Cát Lái → Đồng Nai", plate_number: "51C12345", quantity: 2, unit_price: 1_500_000, fuel_support_rate: 39, transport_fee: 4_170_000, pass_through_fee: 0, declaration_fee: 300_000, loading_fee: 0, amount_due: 4_470_000, notes: "Ghi chú" } },
    ];
    const buf = await buildStatementWorkbook(cfg, { name: "Công ty ABC", tax_code: "0301234567", billing_address: "1 Lê Lợi, Q1" }, "2026-11-01", "2026-11-30", cols, rows, catalog);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as ArrayBuffer);
    const ws = wb.worksheets[0];
    const texts: string[] = [];
    ws.eachRow((r) => r.eachCell((c) => texts.push(String(c.value))));
    expect(ws.getCell(1, 1).value).toBe("CÔNG TY ABC");
    expect(texts).toContain("BẢNG KÊ CƯỚC PHÍ VẬN CHUYỂN 11-2026");
    expect(texts).toContain("(Từ ngày 01/11/2026 đến ngày 30/11/2026)");
    expect(texts).toContain("CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ VẬN TẢI KHÁNH HÀ");
    expect(texts).toContain("Mã số thuế: 0313167085");
    expect(texts).toContain("TỔNG CỘNG");
    expect(texts).toContain("7750000");
    expect(texts.some((t) => t === "Bằng chữ: Bảy triệu bảy trăm năm mươi nghìn đồng.")).toBe(true);
    expect(texts).toContain("ĐẠI DIỆN KHÁCH HÀNG");
    expect(texts).toContain("   - Phí vận chuyển: 6,950,000 đồng");
    expect(texts).toContain("   - Phí chi hộ: 500,000 đồng");
    expect(texts).not.toContain("   - Phí bốc xếp: 0 đồng");
    expect(texts).toContain("Tổng số tiền thanh toán: 7,750,000 đồng");
    // Tiêu đề cột nền đen chữ trắng
    const head = ws.getRow(5).getCell(1);
    expect(head.value).toBe("STT");
    expect((head.fill as { fgColor: { argb: string } }).fgColor.argb).toBe("FF000000");
    expect(ws.pageSetup.orientation).toBe("landscape");
  });
});
