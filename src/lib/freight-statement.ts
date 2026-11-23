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
  name: "CÔNG TY TNHH GHA LOGISTICS & SERVICE",
  address: "",
  taxCode: "3703489735",
};

/** Giá trị ô Khách hàng: "Tất cả khách hàng được gán" (chỉ tài khoản khách gắn nhiều công ty) */
export const STATEMENT_ALL_CUSTOMERS = "all";

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
  { key: "container_no", label: "Số cont", kind: "text", group: "Chung", width: 14 },
  { key: "order_code", label: "Mã đơn hàng", kind: "text", group: "Chung", width: 14 },
  { key: "customer_code", label: "Khách hàng", kind: "text", group: "Chung", width: 10 },
  { key: "route_label", label: "Tuyến đường", kind: "text", group: "Tuyến", width: 32 },
  { key: "invoice_info", label: "Thông tin xuất hóa đơn", kind: "text", group: "Tuyến", width: 34 },
  { key: "pickup_name", label: "Điểm nhận", kind: "text", group: "Tuyến", width: 22 },
  { key: "delivery_name", label: "Điểm giao", kind: "text", group: "Tuyến", width: 22 },
  { key: "empty_return_name", label: "Điểm hạ rỗng", kind: "text", group: "Tuyến", width: 20 },
  { key: "offroute_return_name", label: "Hạ rỗng trái tuyến", kind: "text", group: "Tuyến", width: 20 },
  { key: "vehicle_type_name", label: "Loại xe", kind: "text", group: "Xe", width: 12 },
  { key: "plate_number", label: "Số xe", kind: "text", group: "Xe", width: 12 },
  { key: "driver_name", label: "Tài xế", kind: "text", group: "Xe", width: 18 },
  { key: "trip_count", label: "SL chuyến", kind: "number", group: "Chung", width: 8 },
  { key: "goods_tons", label: "Số lượng vận chuyển (tấn)", kind: "number", group: "Hàng hóa", width: 11 },
  { key: "goods_detail", label: "Chi tiết mã hàng", kind: "text", group: "Hàng hóa", width: 30 },
  { key: "quantity", label: "SL tính cước", kind: "number", group: "Cước", width: 7 },
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
  { key: "trip_notes", label: "Ghi chú chuyến (file Excel / cho tài xế)", kind: "text", group: "Chung", width: 24 },
];

/** Cột mẫu mặc định khi chưa có mẫu nào */
export const DEFAULT_STATEMENT_COLUMNS = [
  "stt",
  "pickup_at",
  "route_label",
  "empty_return_name",
  "invoice_info",
  "plate_number",
  "trip_count",
  "goods_tons",
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
/**
 * Tuyến đường trên bảng kê. Chuyến container lấy từ cảng (có Điểm hạ rỗng) nối thêm điểm hạ rỗng:
 * "Điểm nhận → Điểm giao → Điểm hạ rỗng". Chuyến không có điểm hạ rỗng giữ tuyến như cũ.
 */
export function statementRouteLabel(r: { route_label?: string | null; pickup_name?: string | null; delivery_name?: string | null; empty_return_name?: string | null }): string {
  const base = r.route_label?.trim() || [r.pickup_name, r.delivery_name].filter(Boolean).join(" → ");
  const er = r.empty_return_name?.trim();
  if (!er) return base;
  return base ? `${base} → ${er}` : er;
}

/**
 * "Thông tin xuất hóa đơn" giống app QLVT cũ: Cước vận chuyển hạt nhựa từ <TT HĐ điểm nhận> đến <TT HĐ điểm giao>.
 * Thông tin lấy ở ô "Địa chỉ xuất hóa đơn" của địa điểm. Điểm phổ biến (để trống) thì bỏ qua phần đó.
 */
export function invoiceText(fromInfo: string | null | undefined, toInfo: string | null | undefined): string {
  const f = String(fromInfo ?? "").trim();
  const t = String(toInfo ?? "").trim();
  if (!f && !t) return "";
  return `Cước vận chuyển hạt nhựa${f ? ` từ ${f}` : ""}${t ? ` đến ${t}` : ""}`;
}

export const CONT_NO_RE = /s[oố]\s*cont/i;

export const statementConfigSchema = z.object({
  columns: z.array(z.string().min(1).max(80)).min(1).max(60),
  labels: z.record(z.string().max(80), z.string().max(120)).default({}),
  widths: z.record(z.string().max(80), z.number().min(4).max(80)).default({}),
  /** Căn ngang từng cột (trống = mặc định: STT giữa, chữ trái, số phải) */
  align: z.record(z.string().max(80), z.enum(["left", "center", "right"])).default({}),
  /** Căn dọc từng cột (trống = giữa dòng) */
  valign: z.record(z.string().max(80), z.enum(["top", "middle", "bottom"])).default({}),
  title: z.string().max(150).default("BẢNG KÊ CƯỚC PHÍ VẬN CHUYỂN"),
  companyName: z.string().max(200).default(COMPANY_DEFAULT.name),
  companyAddress: z.string().max(400).default(COMPANY_DEFAULT.address),
  companyTaxCode: z.string().max(40).default(COMPANY_DEFAULT.taxCode),
  leftSign: z.string().max(120).default("ĐẠI DIỆN KHÁCH HÀNG"),
  rightSign: z.string().max(120).default("ĐẠI DIỆN CÔNG TY GHA"),
  signPlace: z.string().max(80).default("TP. Hồ Chí Minh"),
  note: z.string().max(1000).default(""),
  showWords: z.boolean().default(true),
  /** Cột tiền/số lượng KHÔNG cộng ở dòng TỔNG CỘNG của bảng */
  noSum: z.array(z.string().max(80)).max(100).default([]),
  /** Các khoản ghi rõ trong phần "Tổng tiền thanh toán"; tổng thanh toán = cộng các khoản này */
  payColumns: z.array(z.string().max(80)).max(30).default(["transport_fee", "pass_through_fee", "declaration_fee", "loading_fee", "other_fee"]),
  /** Mẫu tự chọn khi chọn khách hàng này */
  customerId: z.string().uuid().nullable().default(null),
  /** Phiên bản mẫu: mẫu lưu trước bản 2 được tự thêm cột Điểm hạ rỗng + Thông tin xuất hóa đơn một lần */
  v: z.number().int().min(1).max(99).default(1),
});
export type StatementConfig = z.infer<typeof statementConfigSchema>;

/** Cột số cont: trường bổ sung "Số cont" (nếu có) hoặc số cont của chuyến */
function contColumn(catalog: StatementColumn[]): string {
  const cf = catalog.find((c) => c.key.startsWith("cf_") && CONT_NO_RE.test(c.label)) ?? catalog.find((c) => c.key.startsWith("ocf_") && CONT_NO_RE.test(c.label));
  return cf?.key ?? "container_no";
}

export function defaultStatementConfig(catalog: StatementColumn[]): StatementConfig {
  const cols = [...DEFAULT_STATEMENT_COLUMNS];
  cols.splice(2, 0, contColumn(catalog));
  return statementConfigSchema.parse({ columns: cols.filter((k) => catalog.some((c) => c.key === k)), v: STATEMENT_CONFIG_VERSION });
}

export const STATEMENT_CONFIG_VERSION = 3;

/**
 * Nâng mẫu cũ một lần:
 * - bản 2: thêm cột Điểm hạ rỗng và Thông tin xuất hóa đơn ngay sau Tuyến đường (nếu chưa có)
 * - bản 3: thêm SL chuyến + Số lượng vận chuyển (tấn) thay chỗ cột SL tính cước (cột SL tính cước vẫn chọn lại được),
 *   thêm Số cont sau cột Ngày nếu mẫu chưa có cột số cont
 */
function upgradeConfig(c: StatementConfig, catalog: StatementColumn[]): StatementConfig {
  if (c.v >= STATEMENT_CONFIG_VERSION) return c;
  let cols = [...c.columns];
  if (c.v < 2) {
    const add = ["empty_return_name", "invoice_info"].filter((k) => !cols.includes(k));
    const at = cols.indexOf("route_label");
    cols.splice(at >= 0 ? at + 1 : cols.length, 0, ...add);
  }
  if (c.v < 3) {
    const add = ["trip_count", "goods_tons"].filter((k) => !cols.includes(k));
    const q = cols.indexOf("quantity");
    const plate = cols.indexOf("plate_number");
    if (q >= 0) cols.splice(q, 1, ...add);
    else cols.splice(plate >= 0 ? plate + 1 : cols.length, 0, ...add);
    // Số cont: mẫu chưa có cột số cont nào thì thêm ngay sau Ngày
    const contKeys = new Set(["container_no", ...catalog.filter((x) => CONT_NO_RE.test(x.label)).map((x) => x.key)]);
    if (!cols.some((k) => contKeys.has(k))) {
      const d = cols.indexOf("pickup_at");
      cols.splice(d >= 0 ? d + 1 : Math.min(1, cols.length), 0, contColumn(catalog));
    }
    cols = [...new Set(cols)];
  }
  return { ...c, columns: cols.slice(0, 60), v: STATEMENT_CONFIG_VERSION };
}

/** Đọc mẫu đã lưu (bỏ qua giá trị hỏng, giữ phần dùng được) */
export function parseStatementConfig(raw: unknown, catalog: StatementColumn[], variant: StatementVariant = "customer"): StatementConfig {
  const r = statementConfigSchema.safeParse(raw);
  if (variant === "carrier") return r.success ? upgradeConfig(r.data, catalog) : defaultCarrierStatementConfig(catalog);
  return r.success ? upgradeConfig(r.data, catalog) : defaultStatementConfig(catalog);
}

// ---------------------------------------------------------------------------
// Bảng kê 3PL: chi phí GHA phải trả nhà xe thuê ngoài (cùng bố cục, cùng cách tick / cộng dồn như bảng kê khách hàng)
// ---------------------------------------------------------------------------

/** customer = bảng kê GHA gửi khách hàng; carrier = bảng kê chi phí trả nhà xe 3PL */
export type StatementVariant = "customer" | "carrier";

/** Mẫu bảng kê 3PL lưu trong table_view_preferences với table_key này (không cần nâng cấp CSDL) */
export const CARRIER_STATEMENT_TABLE_KEY = "carrier_statement";

/** Cột chung (không gồm cước / phí thu khách: bảng kê 3PL không lộ doanh thu GHA) */
const CARRIER_COMMON_KEYS = [
  "stt",
  "pickup_at",
  "expected_delivery_at",
  "shipment_code",
  "container_no",
  "order_code",
  "customer_code",
  "route_label",
  "pickup_name",
  "delivery_name",
  "empty_return_name",
  "offroute_return_name",
  "vehicle_type_name",
  "plate_number",
  "driver_name",
  "trip_count",
  "goods_tons",
  "goods_detail",
  "invoice_info",
  "quantity",
  "pricing_unit",
  "notes",
  "trip_notes",
];

/** Các khoản trả nhà xe 3PL (từ Nhập chi phí 3PL của chuyến) */
export const CARRIER_MONEY_COLUMNS: StatementColumn[] = [
  { key: "c_quantity", label: "SL tính cước 3PL", kind: "number", group: "Chi phí trả 3PL", width: 8 },
  { key: "c_unit_price", label: "Đơn giá 3PL", kind: "price", group: "Chi phí trả 3PL", width: 13 },
  { key: "c_freight_base", label: "Cước 3PL chưa dầu", kind: "money", group: "Chi phí trả 3PL", width: 14 },
  { key: "c_fuel_pct", label: "% dầu", kind: "percent", group: "Chi phí trả 3PL", width: 8 },
  { key: "c_fuel_amount", label: "Hỗ trợ dầu 3PL", kind: "money", group: "Chi phí trả 3PL", width: 13 },
  { key: "c_freight", label: "Cước vận chuyển", kind: "money", group: "Chi phí trả 3PL", width: 14 },
  { key: "c_pass_through", label: "Phí chi hộ", kind: "money", group: "Chi phí trả 3PL", width: 13 },
  { key: "c_loading", label: "Phí bốc xếp", kind: "money", group: "Chi phí trả 3PL", width: 13 },
  { key: "c_other", label: "Chi phí khác", kind: "money", group: "Chi phí trả 3PL", width: 13 },
  { key: "c_total", label: "Tổng cộng", kind: "money", group: "Chi phí trả 3PL", width: 15 },
  { key: "c_paid", label: "Đã trả", kind: "money", group: "Thanh toán 3PL", width: 14 },
  { key: "c_remaining", label: "Còn phải trả", kind: "money", group: "Thanh toán 3PL", width: 14 },
  { key: "c_pay_status", label: "Tình trạng thanh toán", kind: "text", group: "Thanh toán 3PL", width: 16 },
  { key: "c_invoice_no", label: "Số hóa đơn 3PL", kind: "text", group: "Thanh toán 3PL", width: 14 },
  { key: "c_note", label: "Ghi chú chi phí 3PL", kind: "text", group: "Chi phí trả 3PL", width: 24 },
];

export const CARRIER_BASE_COLUMNS: StatementColumn[] = [
  ...CARRIER_COMMON_KEYS.map((k) => BASE_STATEMENT_COLUMNS.find((c) => c.key === k)!).filter(Boolean),
  ...CARRIER_MONEY_COLUMNS,
];

export const DEFAULT_CARRIER_COLUMNS = [
  "stt",
  "pickup_at",
  "route_label",
  "invoice_info",
  "plate_number",
  "trip_count",
  "goods_tons",
  "c_quantity",
  "c_unit_price",
  "c_fuel_pct",
  "c_freight",
  "c_pass_through",
  "c_loading",
  "c_other",
  "c_total",
  "notes",
];

export function defaultCarrierStatementConfig(catalog: StatementColumn[]): StatementConfig {
  const cols = [...DEFAULT_CARRIER_COLUMNS];
  cols.splice(2, 0, contColumn(catalog));
  return statementConfigSchema.parse({
    columns: cols.filter((k) => catalog.some((c) => c.key === k)),
    leftSign: "ĐẠI DIỆN NHÀ XE",
    rightSign: "ĐẠI DIỆN CÔNG TY GHA",
    payColumns: ["c_freight", "c_pass_through", "c_loading", "c_other"],
    v: STATEMENT_CONFIG_VERSION,
  });
}

/** Tên tệp: Bang-ke-3PL_NX01_11-2026 */
export function carrierStatementFileName(supplierCode: string, tu: string, den: string) {
  return statementFileName(supplierCode, tu, den).replace(/^Bang-ke-cuoc_/, "Bang-ke-3PL_");
}

export type StatementHAlign = "left" | "center" | "right";
export type StatementVAlign = "top" | "middle" | "bottom";
export type ResolvedColumn = StatementColumn & { title: string; w: number; h: StatementHAlign; v: StatementVAlign };

/** Căn ngang mặc định theo kiểu cột */
export const defaultHAlign = (kind: StatementColumnKind): StatementHAlign => (kind === "index" ? "center" : kind === "text" ? "left" : "right");

/** Các cột đang hiện theo đúng thứ tự trong mẫu, với tên và độ rộng người dùng đặt */
export function resolveColumns(
  catalog: StatementColumn[],
  config: Pick<StatementConfig, "columns" | "labels" | "widths"> & Partial<Pick<StatementConfig, "align" | "valign">>,
): ResolvedColumn[] {
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const seen = new Set<string>();
  const out: ResolvedColumn[] = [];
  for (const k of config.columns) {
    const c = byKey.get(k);
    if (!c || seen.has(k)) continue;
    seen.add(k);
    out.push({
      ...c,
      title: config.labels[k]?.trim() || c.label,
      w: config.widths[k] ?? c.width,
      h: config.align?.[k] ?? defaultHAlign(c.kind),
      v: config.valign?.[k] ?? "middle",
    });
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
