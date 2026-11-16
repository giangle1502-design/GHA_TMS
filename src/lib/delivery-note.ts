/** Dữ liệu phiếu giao hàng (hàm CSDL delivery_note / driver_link_delivery_note). Không có cước, không có nhà xe 3PL. */
export type DeliveryNoteItem = {
  line_no: number;
  item_code: string | null;
  item_name: string | null;
  unit: string | null;
  quantity: number | string | null;
  /** Số bao: nhập tay ở dòng hàng, hoặc tự tính theo quy cách đóng gói của mã hàng (null khi không tính được) */
  bag_count?: number | string | null;
  note: string | null;
};

export type DeliveryNoteData = {
  shipment_code: string;
  order_code: string | null;
  voucher_no: string | null;
  ref_no: string | null;
  note_date: string | null;
  company: { name: string | null; tax_code: string | null; address: string | null; phone: string | null } | null;
  shipper_name: string | null;
  /** Địa chỉ công ty khách (VAP/PLA...). Phiếu không ghi kho/điểm nhận để không lộ thông tin khách. */
  shipper_address?: string | null;
  delivery_name: string | null;
  delivery_company: string | null;
  delivery_address: string | null;
  delivery_phone: string | null;
  plate_number: string | null;
  trailer_plate: string | null;
  container_no: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  quantity: number | string | null;
  items: DeliveryNoteItem[];
};

/** Thông tin công ty in trên phiếu khi Danh mục công ty còn trống (LE chốt 15/11/2026). */
export const GHA_COMPANY = {
  name: "CÔNG TY TNHH GHA LOGISTICS & SERVICE",
  tax_code: "3703489735",
  address: "Số nhà 67N2 KDC PTĐT Tân Bình, Tân Phước, Tân Đông Hiệp, TP. Hồ Chí Minh",
  phone: null as string | null,
};

export function noteCompany(d: DeliveryNoteData) {
  const c = d.company;
  return {
    name: c?.name?.trim() || GHA_COMPANY.name,
    tax_code: c?.tax_code?.trim() || GHA_COMPANY.tax_code,
    address: c?.address?.trim() || GHA_COMPANY.address,
    phone: c?.phone?.trim() || GHA_COMPANY.phone,
  };
}

/** "2026-11-15" -> "Ngày 15 tháng 11 năm 2026" */
export function noteDateText(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return "Ngày ...... tháng ...... năm 20......";
  return `Ngày ${m[3]} tháng ${m[2]} năm ${m[1]}`;
}

/** Bỏ ký tự không dùng được trong tên file (Windows/macOS/điện thoại), gộp khoảng trắng */
export function safeFilePart(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");
}

/** Tên phiếu (không đuôi): "<Điểm giao> - <Mã chuyến>", ví dụ "SP-ITC - SNOV-0004". Dùng làm tên file PDF và tiêu đề trang khi in. */
export function noteBaseName(place: string | null | undefined, code: string): string {
  const name = [safeFilePart(place), safeFilePart(code)].filter(Boolean).join(" - ");
  return (name || "Phieu giao hang").slice(0, 150).trim();
}

/** Số phiếu tối đa in một lần (giới hạn độ dài đường dẫn và thời gian dựng PDF) */
export const NOTE_BATCH_MAX = 200;

/**
 * Tên file khi in nhiều phiếu một lần (không đuôi):
 * - 1 phiếu: như in lẻ, "SP-ITC - SNOV-0004"
 * - cùng điểm giao, tối đa 3 chuyến: "SP-ITC - SNOV-0004, SNOV-0005"
 * - nhiều hơn: "SP-ITC - SNOV-0004 đến SNOV-0020 (17 chuyến)"
 * - khác điểm giao: "Nhiều điểm giao - ..."
 */
export function noteBatchBaseName(notes: { delivery_name?: string | null; shipment_code: string }[]): string {
  if (notes.length === 0) return "Phieu giao hang";
  if (notes.length === 1) return noteBaseName(notes[0].delivery_name, notes[0].shipment_code);
  const places = new Set(notes.map((n) => safeFilePart(n.delivery_name)));
  const place = places.size === 1 ? [...places][0] : "Nhiều điểm giao";
  const codes = notes.map((n) => safeFilePart(n.shipment_code));
  const codePart = codes.length <= 3 ? codes.join(", ") : `${codes[0]} đến ${codes[codes.length - 1]} (${codes.length} chuyến)`;
  return [place, codePart].filter(Boolean).join(" - ").slice(0, 150).trim();
}

/** Danh sách mã chuyến từ tham số ?ids=a,b,c: chỉ giữ UUID hợp lệ, bỏ trùng, tối đa NOTE_BATCH_MAX */
export function parseNoteIds(raw: string | string[] | undefined): string[] {
  const text = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const out: string[] = [];
  for (const p of text.split(",")) {
    const id = p.trim().toLowerCase();
    if (re.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= NOTE_BATCH_MAX) break;
  }
  return out;
}

/** Đường quay lại sau khi in: chỉ nhận đường nội bộ (bắt đầu bằng "/", không phải "//") */
export function safeBackHref(raw: string | string[] | undefined, fallback: string): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v.startsWith("/") && !v.startsWith("//") && !v.includes("\\") ? v : fallback;
}

/** Người nhận mặc định in trên dấu xác nhận hàng về Bãi xe GHA (sửa được trên trang in) */
export const GHA_YARD_RECEIVER = "Lê Văn Giang";

/** Điểm giao là Bãi xe GHA (không phân biệt dấu, hoa thường) */
export function isGhaYard(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toUpperCase()
    .replace(/\s+/g, " ");
  return n.includes("BAI XE GHA");
}

/** Giờ nhận in trên dấu: "16/11/2026 14:30" theo giờ Việt Nam; trống nếu chưa có */
export function noteTimeText(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(t);
  const g = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
}
