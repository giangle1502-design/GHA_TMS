/**
 * Nhập đơn hàng / chuyến từ Excel: cột của file mẫu, đọc ô, chuẩn hóa giá trị.
 * Phần thuần (không gọi CSDL) để kiểm thử đơn vị; tra cứu danh mục nằm ở server action.
 */
import { compactUpper, parseNumberVN } from "@/lib/entities/record";

export type ImportCell = string | number | null;
export type ImportRaw = Record<string, ImportCell>;

export type ImportColumn = {
  key: string;
  header: string;
  required?: boolean;
  /** Gợi ý in ở dòng thứ 2 của file mẫu */
  hint: string;
  example: string | number;
  width: number;
  /** Danh sách chọn trong Excel */
  list?: string[];
  money?: boolean;
  /** Nhóm màu tiêu đề: core | custom | fee */
  kind?: "core" | "custom" | "fee";
  /** Tên khác người dùng hay đặt trong file theo dõi */
  aliases?: string[];
};

export const STATUS_LABELS = { draft: "Chờ phân công", assigned: "Đã phân công", completed: "Đã hoàn thành" } as const;
export type ImportStatus = keyof typeof STATUS_LABELS;
export const UNIT_LABELS: Record<string, string> = { trip: "Chuyến", km: "Km", ton: "Tấn" };

export const CORE_COLUMNS: ImportColumn[] = [
  { key: "nhom", header: "Gộp đơn", hint: "Các dòng cùng giá trị và cùng khách hàng gộp thành MỘT đơn hàng nhiều chuyến. Để trống: mỗi dòng một đơn.", example: "DH1", width: 10, aliases: ["nhóm đơn", "gộp đơn hàng", "số đơn"] },
  { key: "ma_kh", header: "Mã khách hàng", required: true, hint: "Mã khách hàng trong Danh mục (ví dụ KH001). Ghi đúng tên khách hàng cũng được.", example: "KH001", width: 14, aliases: ["khách hàng", "mã kh", "khach hang"] },
  { key: "ma_kh_tt", header: "Mã khách thanh toán", hint: "Để trống = khách hàng ở cột trước trả tiền.", example: "", width: 14, aliases: ["khách thanh toán", "mã kh thanh toán"] },
  { key: "ngay_don", header: "Ngày đơn hàng", hint: "dd/mm/yyyy. Để trống = ngày nhận hàng.", example: "20/10/2026", width: 13 },
  { key: "ngay_nhan", header: "Ngày nhận hàng", required: true, hint: "dd/mm/yyyy, ví dụ 20/10/2026.", example: "20/10/2026", width: 13, aliases: ["ngày nhận", "ngày đóng hàng", "ngày"] },
  { key: "ngay_giao", header: "Ngày giao dự kiến", hint: "dd/mm/yyyy. Dùng để tính giao trễ.", example: "21/10/2026", width: 13, aliases: ["ngày giao"] },
  { key: "diem_nhan", header: "Điểm nhận", required: true, hint: "Mã hoặc tên địa điểm trong Danh mục. Chưa có thì có thể cho tạo mới khi nhập.", example: "Cảng Cát Lái", width: 22, aliases: ["nơi nhận", "điểm đi", "noi nhan"] },
  { key: "diem_giao", header: "Điểm giao", required: true, hint: "Mã hoặc tên địa điểm trong Danh mục.", example: "KCN Sóng Thần", width: 22, aliases: ["nơi giao", "điểm đến", "noi giao"] },
  { key: "loai_xe", header: "Loại xe", hint: "Mã hoặc tên loại xe. Để trống = lấy theo xe.", example: "", width: 14 },
  { key: "bien_so", header: "Biển số xe", hint: "Viết liền, không dấu: 61K31295 (gõ 61K-312.95 cũng được, tự chuẩn hóa).", example: "61K31295", width: 12, aliases: ["biển số", "số xe", "xe"] },
  { key: "tai_xe", header: "Tài xế", hint: "Mã, số điện thoại hoặc họ tên tài xế. Để trống = tài xế phụ trách xe.", example: "", width: 18, aliases: ["lái xe", "tên tài xế"] },
  {
    key: "trang_thai",
    header: "Trạng thái",
    hint: "Chờ phân công / Đã phân công (gửi Giám đốc duyệt) / Đã hoàn thành (chuyến đã chạy, không cần duyệt). Để trống: có tài xế = Đã phân công.",
    example: STATUS_LABELS.completed,
    width: 15,
    list: Object.values(STATUS_LABELS),
  },
  { key: "ngay_hoan_thanh", header: "Ngày hoàn thành", hint: "Cho chuyến Đã hoàn thành. Để trống = ngày giao dự kiến.", example: "21/10/2026", width: 13 },
  { key: "so_luong", header: "Số lượng", hint: "Số chuyến / km / tấn theo đơn vị tính. Để trống = 1.", example: 1, width: 9 },
  { key: "don_vi", header: "Đơn vị tính", hint: "Chuyến, Km hoặc Tấn. Để trống = Chuyến.", example: "Chuyến", width: 10, list: Object.values(UNIT_LABELS) },
  { key: "don_gia", header: "Đơn giá", hint: "Có số: dùng đúng giá này. Để trống: lấy bảng giá; chưa có bảng giá thì nhập giá sau.", example: 2500000, width: 13, money: true, aliases: ["cước", "giá cước", "cước vận chuyển"] },
  { key: "phu_phi", header: "Phụ phí", hint: "Số tiền, dấu phẩy hàng nghìn: 200,000.", example: "", width: 12, money: true },
  { key: "ho_tro_dau", header: "Hỗ trợ dầu (%)", hint: "Ví dụ 39. Để trống = theo bảng giá / quy tắc hỗ trợ dầu.", example: "", width: 10 },
  { key: "ghi_chu", header: "Ghi chú", hint: "Tối đa 1000 ký tự.", example: "", width: 24 },
];

/** Bỏ dấu, chữ thường, bỏ dấu * và khoảng trắng thừa để so tiêu đề cột */
export function normalizeHeader(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ghép tiêu đề trong file với cột của mẫu: tên đúng trước, tên khác (alias) sau */
export function mapHeaders(headers: string[], columns: ImportColumn[]): { map: Map<number, string>; unknown: string[]; missing: string[] } {
  const exact = new Map<string, string>();
  const alias = new Map<string, string>();
  for (const c of columns) {
    exact.set(normalizeHeader(c.header), c.key);
    for (const a of c.aliases ?? []) alias.set(normalizeHeader(a), c.key);
  }
  const map = new Map<number, string>();
  const used = new Set<string>();
  const unknown: string[] = [];
  headers.forEach((h, i) => {
    const n = normalizeHeader(h ?? "");
    if (!n) return;
    const key = exact.get(n) ?? alias.get(n);
    if (key && !used.has(key)) {
      map.set(i, key);
      used.add(key);
    } else unknown.push(h);
  });
  const missing = columns.filter((c) => c.required && !used.has(c.key)).map((c) => c.header);
  return { map, unknown, missing };
}

/** Giá trị một ô exceljs → chuỗi / số; ngày → dd/mm/yyyy */
export function cellToRaw(v: unknown): ImportCell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${String(v.getUTCDate()).padStart(2, "0")}/${String(v.getUTCMonth() + 1).padStart(2, "0")}/${v.getUTCFullYear()}`;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? "x" : "";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("result" in o) return cellToRaw(o.result);
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join("").trim() || null;
    if ("text" in o) return cellToRaw(o.text);
    if ("error" in o) return null;
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}

export const str = (v: ImportCell | undefined): string => (v === null || v === undefined ? "" : String(v).trim());

/** Ngày trong file → YYYY-MM-DD. Nhận dd/mm/yyyy, d/m/yy, yyyy-mm-dd, số ngày kiểu Excel */
export function parseDateVN(v: ImportCell | undefined): string | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  let y: number, m: number, d: number;
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return "invalid";
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else {
    const s = String(v).trim().split(/[ T]/)[0];
    let r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
    if (r) {
      [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
      if (y < 100) y += 2000;
    } else if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
      [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
    } else return "invalid";
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 2000 || y > 2100) return "invalid";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Số trong file: ô số giữ nguyên; chữ theo kiểu 1,200,000 */
export function parseNum(v: ImportCell | undefined, currency = false): number | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  const n = parseNumberVN(v, currency);
  if (n === null) return null;
  return Number.isNaN(n) ? "invalid" : n;
}

export function parseStatus(v: ImportCell | undefined): ImportStatus | null | "invalid" {
  const n = normalizeHeader(str(v));
  if (!n) return null;
  if (/hoan thanh|da chay|xong|giao xong/.test(n)) return "completed";
  if (/cho phan cong|chua phan cong|nhap|draft/.test(n)) return "draft";
  if (/da phan cong|phan cong|cho duyet|cho tai xe/.test(n)) return "assigned";
  return "invalid";
}

export function parseUnit(v: ImportCell | undefined): string | null | "invalid" {
  const n = normalizeHeader(str(v));
  if (!n) return null;
  if (["chuyen", "trip", "c"].includes(n)) return "trip";
  if (["km", "kilomet", "kilometer"].includes(n)) return "km";
  if (["tan", "ton", "t"].includes(n)) return "ton";
  return "invalid";
}

/** Biển số: chữ hoa liền, bỏ ký tự đặc biệt (61K-312.95 → 61K31295) */
export const normalizePlate = (v: ImportCell | undefined) => compactUpper(str(v));

/** So tên không phân biệt hoa thường / dấu cách thừa (giữ dấu tiếng Việt) */
export const looseKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Dòng trống hoàn toàn (bỏ qua) */
export function isBlankRow(raw: ImportRaw): boolean {
  return Object.values(raw).every((v) => v === null || v === "");
}

/** Khóa gộp đơn: cùng "Gộp đơn" + cùng khách hàng; trống = mỗi dòng một đơn */
export function groupKey(raw: ImportRaw, rowNo: number): string {
  const g = str(raw.nhom);
  return g ? `${looseKey(g)}|${looseKey(str(raw.ma_kh))}|${looseKey(str(raw.ma_kh_tt))}` : `#${rowNo}`;
}
