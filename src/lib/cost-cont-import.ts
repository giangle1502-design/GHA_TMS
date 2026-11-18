/**
 * Nhập đơn từ file Excel theo dõi hàng (sheet "COST CONT"): đọc file ngay trên trình duyệt,
 * chỉ lấy các dòng có Nhà vận chuyển (cột AA) = GHA, lọc theo ngày giao, rồi đưa vào bước "Dán từ Excel"
 * như khi copy kèm dòng tiêu đề.
 */
import { cellToRaw } from "@/lib/import-trips";
import { isoDate, matchKey, plain } from "@/lib/paste-orders";

export type SheetData = { fileName: string; sheet: string; header: string[]; rows: string[][] };

/** Cột AA (Nhà vận chuyển) và cột M (Ngày giao) khi không đọc được tiêu đề */
const CARRIER_COL = 26;
const DATE_COL = 12;

const cellText = (v: unknown): string => {
  // Ô công thức chưa có kết quả lưu sẵn (VD =VLOOKUP trả rỗng): coi là trống
  if (v && typeof v === "object" && !(v instanceof Date) && ("formula" in v || "sharedFormula" in v) && !("result" in v)) return "";
  const r = cellToRaw(v);
  if (typeof r === "string" && r === "[object Object]") return "";
  if (r === null || r === undefined) return "";
  return String(r).replace(/[\t\r\n]+/g, " ").trim();
};

/** Đọc sheet COST CONT (không có thì sheet đầu tiên có cột "Nhà vận chuyển") */
export async function readCostContFile(file: File): Promise<SheetData> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error("Không đọc được file. Chọn file Excel .xlsx hoặc .xlsm (file .xls đời cũ: mở bằng Excel rồi Lưu thành .xlsx).");
  }
  const headerOf = (ws: (typeof wb.worksheets)[number]) => {
    const row = ws.getRow(1);
    const out: string[] = [];
    for (let c = 1; c <= Math.max(ws.columnCount, row.cellCount); c++) out.push(cellText(row.getCell(c).value));
    return out;
  };
  const ws =
    wb.worksheets.find((w) => matchKey(w.name) === "costcont") ??
    wb.worksheets.find((w) => matchKey(w.name).includes("costcont")) ??
    wb.worksheets.find((w) => headerOf(w).some((h) => matchKey(h) === "nhavanchuyen"));
  if (!ws) throw new Error(`File không có sheet "COST CONT". Các sheet trong file: ${wb.worksheets.map((w) => w.name).join(", ")}.`);
  const header = headerOf(ws);
  const width = header.length;
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const r: string[] = [];
    for (let c = 1; c <= width; c++) r.push(cellText(row.getCell(c).value));
    if (r.some((x) => x !== "")) rows.push(r);
  });
  return { fileName: file.name, sheet: ws.name, header, rows };
}

export type CarrierFilter = { carrier: string; from: string; to: string; onlyPending: boolean };

/** Vị trí cột theo tiêu đề (không thấy thì dùng vị trí mặc định của COST CONT) */
function colOf(header: string[], keys: string[], fallback: number) {
  const i = header.findIndex((h) => keys.includes(matchKey(h)));
  return i >= 0 ? i : fallback;
}

/** Các giá trị khác nhau ở cột Nhà vận chuyển, nhiều dòng nhất trước */
export function carrierValues(data: SheetData): { value: string; rows: number }[] {
  const c = colOf(data.header, ["nhavanchuyen", "donvivantai"], CARRIER_COL);
  const m = new Map<string, { value: string; rows: number }>();
  for (const r of data.rows) {
    const v = (r[c] ?? "").trim();
    if (!v) continue;
    const k = matchKey(v);
    const cur = m.get(k) ?? { value: v, rows: 0 };
    cur.rows++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.rows - a.rows);
}

/**
 * Lọc dòng: Nhà vận chuyển đúng bằng giá trị chọn (bỏ dấu, bỏ khoảng trắng: "GHA" = "gha"),
 * Ngày giao trong khoảng (trống = không giới hạn), tùy chọn chỉ dòng "Chưa giao".
 */
export function filterCostCont(data: SheetData, f: CarrierFilter) {
  const cc = colOf(data.header, ["nhavanchuyen", "donvivantai"], CARRIER_COL);
  const dc = colOf(data.header, ["ngaygiao"], DATE_COL);
  const sc = colOf(data.header, ["tinhtranggiao", "tinhtrang"], 15);
  const want = matchKey(f.carrier);
  let carrierRows = 0;
  let noDate = 0;
  const rows = data.rows.filter((r) => {
    if (matchKey(r[cc] ?? "") !== want) return false;
    carrierRows++;
    if (f.onlyPending && /da giao|xong|hoan thanh/.test(plain(r[sc] ?? ""))) return false;
    if (!f.from && !f.to) return true;
    const d = isoDate(r[dc]);
    if (!d) {
      noDate++;
      return false;
    }
    return (!f.from || d >= f.from) && (!f.to || d <= f.to);
  });
  return { rows, carrierRows, noDate };
}

/** Ghép tiêu đề + dòng thành dạng copy từ Excel (tab giữa các cột) để đưa vào ô dán */
export const toTSV = (header: string[], rows: string[][]) => [header, ...rows].map((r) => r.join("\t")).join("\n");
