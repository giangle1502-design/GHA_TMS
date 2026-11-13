// Bảng kê cước phí vận chuyển gửi khách hàng: định nghĩa cột, mẫu bảng kê, tiêu đề, số tiền bằng chữ.
// Dùng chung cho máy chủ (xuất Excel) và trình duyệt (xem trước, in / lưu PDF) nên KHÔNG đặt "use client" ở đây.
import { z } from "zod";

/** Kiểu cột: quyết định căn lề, định dạng số và có cộng ở dòng Tổng cộng hay không */
/** price = số tiền nhưng không cộng ở dòng Tổng cộng (đơn giá) */
export type StatementColumnKind = "text" | "money" | "price" | "number" | "percent" | "index";

export type StatementColumn = {
  key: string;
  label: string;
  kind: StatementColumnKind;
  /** Nhóm để dễ tìm trong hộp chọn cột */
  group: string;
  /** Độ rộng mặc định (ký tự Excel) */
  width: number;
};

export type StatementRow = { id: string; cells: Record<string, string | number | null> };

export type StatementCustomer = { id: string; code: string; name: string; tax_code: string | null; billing_address: string | null };

/** Công ty phát hành bảng kê (góc phải); người dùng sửa được trong mẫu */
export const COMPANY_DEFAULT = {
  name: "CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ VẬN TẢI KHÁNH HÀ",
  address: "650/5c Vườn Lài, Tổ 28, khu phố 2, Phường An Phú Đông, Thành Phố Hồ Chí Minh, Việt Nam",
  taxCode: "0313167085",
};

/** Mẫu bảng kê lưu trong table_view_preferences với table_key này (không cần nâng cấp CSDL) */
export const STATEMENT_TABLE_KEY = "freight_statement";

/** Lọc chuyến đưa vào bảng kê */
export const STATEMENT_STATUS_OPTIONS = [
  { value: "giao", label: "Chuyến đã giao và đã đóng", statuses: ["driver_completed", "closed"] },
  { value: "tat-ca", label: "Tất cả chuyến (trừ chuyến hủy)", statuses: ["draft", "assigned", "accepted", "in_transit", "driver_completed", "closed"] },
] as const;
export type StatementStatusFilter = (typeof STATEMENT_STATUS_OPTIONS)[number]["value"];

/** Các cột có sẵn (ngoài trường bổ sung và từng loại phí, sinh theo dữ liệu) */
export const BASE_STATEMENT_COLUMNS: StatementColumn[] = [
  { key: "stt", label: "STT", kind: "index", group: "Chung", width: 6 },
  { key: "pickup_at", label: "Ngày", kind: "text", group: "Chung", width: 12 },
  { key: "expected_delivery_at", label: "Ngày giao", kind: "text", group: "Chung", width: 12 },
  { key: "shipment_code", label: "Mã chuyến", kind: "text", group: "Chung", width: 14 },
  { key: "order_code", label: "Mã đơn hàng", kind: "text", group: "Chung", width: 14 },
  { key: "route_label", label: "Tuyến đường", kind: "text", group: "Tuyến", width: 32 },
  { key: "pickup_name", label: "Điểm nhận", kind: "text", group: "Tuyến", width: 22 },
  { key: "delivery_name", label: "Điểm giao", kind: "text", group: "Tuyến", width: 22 },
  { key: "empty_return_name", label: "Điểm hạ rỗng", kind: "text", group: "Tuyến", width: 20 },
  { key: "offroute_return_name", label: "Hạ rỗng trái tuyến", kind: "text", group: "Tuyến", width: 20 },
  { key: "vehicle_type_name", label: "Loại xe", kind: "text", group: "Xe", width: 12 },
  { key: "plate_number", label: "Số xe", kind: "text", group: "Xe", width: 12 },
  { key: "driver_name", label: "Tài xế", kind: "text", group: "Xe", width: 18 },
  { key: "quantity", label: "SL", kind: "number", group: "Cước", width: 7 },
  { key: "pricing_unit", label: "ĐVT", kind: "text", group: "Cước", width: 8 },
  { key: "unit_price", label: "Đơn giá", kind: "price", group: "Cước", width: 13 },
  { key: "freight_amount", label: "Cước (đơn giá × SL)", kind: "money", group: "Cước", width: 14 },
  { key: "fuel_support_rate", label: "% dầu", kind: "percent", group: "Cước", width: 8 },
  { key: "fuel_support_amount", label: "Hỗ trợ dầu", kind: "money", group: "Cước", width: 13 },
  { key: "surcharge_amount", label: "Phụ phí bảng giá", kind: "money", group: "Cước", width: 13 },
  { key: "transport_fee", label: "Phí vận chuyển", kind: "money", group: "Tổng theo nhóm phí", width: 14 },
  { key: "pass_through_fee", label: "Phí chi hộ", kind: "money", group: "Tổng theo nhóm phí", width: 13 },
  { key: "declaration_fee", label: "Phí tờ khai", kind: "money", group: "Tổng theo nhóm phí", width: 13 },
  { key: "loading_fee", label: "Phí bốc xếp", kind: "money", group: "Tổng theo nhóm phí", width: 13 },
  { key: "other_fee", label: "Phí khác", kind: "money", group: "Tổng theo nhóm phí", width: 13 },
  { key: "total_revenue", label: "Doanh thu (chưa gồm chi hộ)", kind: "money", group: "Tổng theo nhóm phí", width: 15 },
  { key: "amount_due", label: "Tổng cộng", kind: "money", group: "Tổng theo nhóm phí", width: 15 },
  { key: "notes", label: "Ghi chú", kind: "text", group: "Chung", width: 24 },
];

/** Cột mẫu mặc định khi chưa có mẫu nào */
export const DEFAULT_STATEMENT_COLUMNS = [
  "stt",
  "pickup_at",
  "route_label",
  "plate_number",
  "quantity",
  "unit_price",
  "fuel_support_rate",
  "transport_fee",
  "pass_through_fee",
  "declaration_fee",
  "loading_fee",
  "amount_due",
  "notes",
];

/** Trường bổ sung có tên "Số cont" được đưa vào mẫu mặc định ngay sau Ngày */
export const CONT_NO_RE = /s[oố]\s*cont/i;

export const statementConfigSchema = z.object({
  columns: z.array(z.string().min(1).max(80)).min(1).max(60),
  labels: z.record(z.string().max(80), z.string().max(120)).default({}),
  widths: z.record(z.string().max(80), z.number().min(4).max(80)).default({}),
  title: z.string().max(150).default("BẢNG KÊ CƯỚC PHÍ VẬN CHUYỂN"),
  companyName: z.string().max(200).default(COMPANY_DEFAULT.name),
  companyAddress: z.string().max(400).default(COMPANY_DEFAULT.address),
  companyTaxCode: z.string().max(40).default(COMPANY_DEFAULT.taxCode),
  leftSign: z.string().max(120).default("ĐẠI DIỆN KHÁCH HÀNG"),
  rightSign: z.string().max(120).default("ĐẠI DIỆN CÔNG TY KHÁNH HÀ"),
  signPlace: z.string().max(80).default("TP. Hồ Chí Minh"),
  note: z.string().max(1000).default(""),
  showWords: z.boolean().default(true),
  /** Cột tiền/số lượng KHÔNG cộng ở dòng TỔNG CỘNG của bảng */
  noSum: z.array(z.string().max(80)).max(100).default([]),
  /** Các khoản ghi rõ trong phần "Tổng tiền thanh toán"; tổng thanh toán = cộng các khoản này */
  payColumns: z.array(z.string().max(80)).max(30).default(["transport_fee", "pass_through_fee", "declaration_fee", "loading_fee", "other_fee"]),
  /** Mẫu tự chọn khi chọn khách hàng này */
  customerId: z.string().uuid().nullable().default(null),
});
export type StatementConfig = z.infer<typeof statementConfigSchema>;

export function defaultStatementConfig(catalog: StatementColumn[]): StatementConfig {
  const cont = catalog.find((c) => c.key.startsWith("cf_") && CONT_NO_RE.test(c.label)) ?? catalog.find((c) => c.key.startsWith("ocf_") && CONT_NO_RE.test(c.label));
  const cols = [...DEFAULT_STATEMENT_COLUMNS];
  if (cont) cols.splice(2, 0, cont.key);
  return statementConfigSchema.parse({ columns: cols.filter((k) => catalog.some((c) => c.key === k)) });
}

/** Đọc mẫu đã lưu (bỏ qua giá trị hỏng, giữ phần dùng được) */
export function parseStatementConfig(raw: unknown, catalog: StatementColumn[]): StatementConfig {
  const r = statementConfigSchema.safeParse(raw);
  return r.success ? r.data : defaultStatementConfig(catalog);
}

export type ResolvedColumn = StatementColumn & { title: string; w: number };

/** Các cột đang hiện theo đúng thứ tự trong mẫu, với tên và độ rộng người dùng đặt */
export function resolveColumns(catalog: StatementColumn[], config: Pick<StatementConfig, "columns" | "labels" | "widths">): ResolvedColumn[] {
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const seen = new Set<string>();
  const out: ResolvedColumn[] = [];
  for (const k of config.columns) {
    const c = byKey.get(k);
    if (!c || seen.has(k)) continue;
    seen.add(k);
    out.push({ ...c, title: config.labels[k]?.trim() || c.label, w: config.widths[k] ?? c.width });
  }
  return out;
}

/** Cột được cộng ở dòng Tổng cộng */
export const isSummed = (c: Pick<StatementColumn, "kind">) => c.kind === "money" || c.kind === "number";

/** Cột có số tổng ở dòng TỔNG CỘNG (người dùng bỏ được từng cột) */
export const sumsInTable = (c: Pick<StatementColumn, "kind" | "key">, noSum: string[] = []) => isSummed(c) && !noSum.includes(c.key);

export function statementTotals(cols: StatementColumn[], rows: StatementRow[], noSum: string[] = []): Record<string, number> {
  const t: Record<string, number> = {};
  for (const c of cols) {
    if (!sumsInTable(c, noSum)) continue;
    t[c.key] = rows.reduce((a, r) => a + (typeof r.cells[c.key] === "number" ? (r.cells[c.key] as number) : 0), 0);
  }
  return t;
}

/** Cột chọn được cho phần Tổng tiền thanh toán: các cột tiền (không gồm đơn giá) */
export const isPayable = (c: Pick<StatementColumn, "kind">) => c.kind === "money";

/**
 * Phần "Tổng tiền thanh toán": từng khoản người dùng chọn (khoản bằng 0 được ẩn) và tổng cộng.
 * Tổng = cộng các khoản được chọn, nên không chọn trùng (ví dụ "Tổng cộng" cùng "Phí vận chuyển").
 */
export function paymentSummary(
  catalog: StatementColumn[],
  cfg: Pick<StatementConfig, "payColumns" | "labels">,
  rows: StatementRow[],
): { lines: { key: string; label: string; amount: number }[]; total: number } {
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const all = [...new Set(cfg.payColumns)]
    .map((k) => byKey.get(k))
    .filter((c): c is StatementColumn => Boolean(c && isPayable(c)))
    .map((c) => ({
      key: c.key,
      label: cfg.labels[c.key]?.trim() || c.label,
      amount: rows.reduce((a, r) => a + (typeof r.cells[c.key] === "number" ? (r.cells[c.key] as number) : 0), 0),
    }));
  const total = all.reduce((a, l) => a + l.amount, 0);
  const nonZero = all.filter((l) => l.amount !== 0);
  return { lines: nonZero.length ? nonZero : all, total };
}

const pad = (n: number) => String(n).padStart(2, "0");
const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

/** "BẢNG KÊ CƯỚC PHÍ VẬN CHUYỂN 11-2026" và "(Từ ngày 01/11/2026 đến ngày 30/11/2026)" */
export function statementHeading(title: string, tu: string, den: string) {
  const m1 = `${tu.slice(5, 7)}-${tu.slice(0, 4)}`;
  const m2 = `${den.slice(5, 7)}-${den.slice(0, 4)}`;
  return {
    title: `${title.trim() || "BẢNG KÊ CƯỚC PHÍ VẬN CHUYỂN"} ${m1 === m2 ? m1 : `${m1} – ${m2}`}`,
    range: `(Từ ngày ${dmy(tu)} đến ngày ${dmy(den)})`,
  };
}

/** Ngày đầu và cuối tháng chứa ngày ymd, dịch đi `shift` tháng */
export function monthRange(ymd: string, shift = 0): { tu: string; den: string } {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7)) - 1 + shift;
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const f = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return { tu: f(first), den: f(last) };
}

/** Tên tệp: Bang-ke-cuoc_KH001_11-2026 */
export function statementFileName(customerCode: string, tu: string, den: string) {
  const m1 = `${tu.slice(5, 7)}-${tu.slice(0, 4)}`;
  const m2 = `${den.slice(5, 7)}-${den.slice(0, 4)}`;
  const code = customerCode.replace(/[^\p{L}\p{N}_-]/gu, "") || "KH";
  return `Bang-ke-cuoc_${code}_${m1 === m2 ? m1 : `${tu}_${den}`}`;
}

/** Hiển thị một ô: số có dấu phẩy ngăn cách hàng nghìn, % dầu kèm ký hiệu % */
export function formatStatementCell(kind: StatementColumnKind, v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string") return v;
  if (kind === "percent") return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v)}%`;
  if (kind === "money" || kind === "price") return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(v);
}

const DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
const UNITS = ["", " nghìn", " triệu", " tỷ", " nghìn tỷ", " triệu tỷ"];

/** Đọc một nhóm 3 chữ số; `full` = phải đọc đủ "không trăm ... linh" vì có nhóm lớn hơn đứng trước */
function readTriple(n: number, full: boolean): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const parts: string[] = [];
  if (h > 0 || full) parts.push(`${DIGITS[h]} trăm`);
  if (t === 0) {
    if (u > 0 && (h > 0 || full)) parts.push("linh");
  } else if (t === 1) parts.push("mười");
  else parts.push(`${DIGITS[t]} mươi`);
  if (u > 0) {
    if (u === 1 && t > 1) parts.push("mốt");
    else if (u === 5 && t > 0) parts.push("lăm");
    else if (u === 4 && t > 1) parts.push("tư");
    else parts.push(DIGITS[u]);
  }
  return parts.join(" ");
}

/** 1,250,000 → "Một triệu hai trăm năm mươi nghìn đồng" (làm tròn đến đồng) */
export function vndInWords(amount: number): string {
  let n = Math.round(Math.abs(amount));
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "Không đồng";
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const words: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g === 0) continue;
    words.push(readTriple(g, i < groups.length - 1) + (UNITS[i] ?? ""));
  }
  const s = `${amount < 0 ? "âm " : ""}${words.join(" ")} đồng`.replace(/\s+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
