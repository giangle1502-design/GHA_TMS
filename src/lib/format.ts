// Ngày theo kiểu Việt Nam (dd/mm/yyyy), múi giờ Asia/Ho_Chi_Minh.
// Số theo cách công ty dùng: dấu phẩy phân cách hàng nghìn, dấu chấm thập phân (3,500,000 ₫; 39.5).
export const TIME_ZONE = "Asia/Ho_Chi_Minh";

const dateFmt = new Intl.DateTimeFormat("vi-VN", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat("vi-VN", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export const NUMBER_LOCALE = "en-US";
const vndFmt = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits: 2 });

type DateInput = string | number | Date | null | undefined;

function toDate(v: DateInput): Date | null {
  if (v === null || v === undefined || v === "") return null;
  // Chuỗi chỉ có ngày (YYYY-MM-DD) là ngày lịch, không chuyển múi giờ.
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 5)); // 12:00 giờ VN để không lệch ngày
  }
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 16/10/2026 */
export function formatDate(v: DateInput): string {
  const d = toDate(v);
  return d ? dateFmt.format(d) : "";
}

/** 16/10/2026 14:05 */
export function formatDateTime(v: DateInput): string {
  const d = toDate(v);
  if (!d) return "";
  const parts = Object.fromEntries(dateTimeFmt.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/** 3,500,000 ₫ */
export function formatVND(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? `${vndFmt.format(n)} ₫` : "";
}

export function formatNumber(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? numFmt.format(n) : "";
}

/** Ngày hôm nay theo giờ Việt Nam dạng YYYY-MM-DD */
export function todayVN(now: Date = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

/** Mốc bắt đầu ngày (00:00 giờ VN) dưới dạng ISO UTC, dùng để lọc timestamptz */
export function startOfDayVN(ymd: string): string {
  return new Date(`${ymd}T00:00:00+07:00`).toISOString();
}

/** Cộng số ngày vào một ngày dạng YYYY-MM-DD (ngày lịch, không phụ thuộc múi giờ) */
export function addDaysYMD(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
