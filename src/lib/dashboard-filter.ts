import { addDaysYMD, todayVN } from "@/lib/format";
import { mondayOf, type BucketBy } from "@/lib/report-period";

/** Bộ lọc trang Tổng quan: khoảng thời gian (theo ngày nhận hàng) + khách hàng, tài xế, xe, tuyến */
export type DashPreset = "hom-nay" | "7-ngay" | "tuan" | "thang" | "30-ngay" | "nam" | "tuy-chon";
export type DashFilter = {
  ky: DashPreset;
  tu: string;
  den: string;
  kh: string;
  tx: string;
  xe: string;
  tuyen: string;
};
export type DateRange = { from: string; to: string };

export const DASH_PRESETS: { value: DashPreset; label: string }[] = [
  { value: "hom-nay", label: "Hôm nay" },
  { value: "7-ngay", label: "7 ngày" },
  { value: "tuan", label: "Tuần này" },
  { value: "thang", label: "Tháng này" },
  { value: "30-ngay", label: "30 ngày" },
  { value: "nam", label: "Năm nay" },
];

const MAX_DAYS = 1096; // tối đa 3 năm để không tải quá nhiều dữ liệu
const isYmd = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isUuid = (v: string | undefined): v is string => !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

/** Số ngày lịch từ a đến b (tính cả hai đầu) */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
}

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
/** Lùi một ngày đi n tháng, giữ ngày trong tháng (kẹp về cuối tháng nếu tháng đích ngắn hơn) */
export function addMonthsYMD(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const ty = t.getUTCFullYear();
  const tm = t.getUTCMonth() + 1;
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, lastDay(ty, tm))).padStart(2, "0")}`;
}

export function parseDashFilter(sp: Record<string, string | string[] | undefined>, today = todayVN()): DashFilter {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined))?.trim() || "";
  const ids = { kh: one("kh"), tx: one("tx"), xe: one("xe"), tuyen: one("tuyen") };
  for (const k of Object.keys(ids) as (keyof typeof ids)[]) if (!isUuid(ids[k])) ids[k] = "";

  let ky = one("ky") as DashPreset;
  const tu = one("tu");
  const den = one("den");
  if (!DASH_PRESETS.some((p) => p.value === ky) && ky !== "tuy-chon") ky = isYmd(tu) || isYmd(den) ? "tuy-chon" : "thang";

  let range: DateRange;
  if (ky === "tuy-chon") {
    let from = isYmd(tu) ? tu : `${today.slice(0, 7)}-01`;
    let to = isYmd(den) ? den : today;
    if (from > to) [from, to] = [to, from];
    if (daysBetween(from, to) > MAX_DAYS) from = addDaysYMD(to, -(MAX_DAYS - 1));
    range = { from, to };
  } else {
    range = presetRange(ky, today);
  }
  return { ky, tu: range.from, den: range.to, ...ids };
}

/** Khoảng ngày của kỳ có sẵn, tính đến hôm nay */
export function presetRange(ky: Exclude<DashPreset, "tuy-chon">, today: string): DateRange {
  switch (ky) {
    case "hom-nay":
      return { from: today, to: today };
    case "7-ngay":
      return { from: addDaysYMD(today, -6), to: today };
    case "30-ngay":
      return { from: addDaysYMD(today, -29), to: today };
    case "tuan":
      return { from: mondayOf(today), to: today };
    case "nam":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

/**
 * Kỳ trước để so sánh:
 * - kỳ bắt đầu từ ngày 1/1 và nằm trong một năm → cùng kỳ năm trước
 * - kỳ bắt đầu từ ngày 1 và nằm trong một tháng → cùng kỳ tháng trước
 * - còn lại → khoảng ngay trước đó, cùng số ngày
 */
export function previousRange({ from, to }: DateRange, ky?: DashPreset): { range: DateRange; label: string } {
  if (ky === "hom-nay" || ky === "7-ngay" || ky === "30-ngay") return shiftBack({ from, to });
  if (from.slice(5) === "01-01" && from.slice(0, 4) === to.slice(0, 4) && daysBetween(from, to) > 31) {
    return { range: { from: addMonthsYMD(from, -12), to: addMonthsYMD(to, -12) }, label: "cùng kỳ năm trước" };
  }
  if (from.slice(8) === "01" && from.slice(0, 7) === to.slice(0, 7)) {
    return { range: { from: addMonthsYMD(from, -1), to: addMonthsYMD(to, -1) }, label: "cùng kỳ tháng trước" };
  }
  return shiftBack({ from, to });
}

function shiftBack({ from, to }: DateRange): { range: DateRange; label: string } {
  const n = daysBetween(from, to);
  const label = n === 1 ? "hôm trước" : n === 7 && new Date(`${from}T00:00:00Z`).getUTCDay() === 1 ? "tuần trước" : `${n} ngày trước đó`;
  return { range: { from: addDaysYMD(from, -n), to: addDaysYMD(from, -1) }, label };
}

/** Cách chia cột cho biểu đồ số chuyến theo độ dài kỳ */
export function bucketForRange({ from, to }: DateRange): BucketBy {
  const n = daysBetween(from, to);
  if (n <= 62) return "ngay";
  if (n <= 190) return "tuan";
  return "thang";
}

/** Các tháng (YYYY-MM) của biểu đồ sản lượng: ít nhất 6 tháng kết thúc ở tháng của ngày cuối kỳ */
export function monthsForTrend({ from, to }: DateRange): string[] {
  const end = `${to.slice(0, 7)}-01`;
  let start = addMonthsYMD(end, -5);
  const fromMonth = `${from.slice(0, 7)}-01`;
  if (fromMonth < start) start = fromMonth;
  const out: string[] = [];
  for (let m = start; m <= end && out.length < 40; m = addMonthsYMD(m, 1)) out.push(m.slice(0, 7));
  return out;
}

/** Ngày (giờ Việt Nam) của một mốc timestamptz */
export function vnDate(iso: string): string {
  return new Date(Date.parse(iso) + 7 * 3600000).toISOString().slice(0, 10);
}

/** Chuỗi tham số URL của bộ lọc (bỏ các ô trống); kỳ có sẵn thì không cần ghi ngày */
export function dashFilterQuery(f: DashFilter): string {
  const q = new URLSearchParams();
  if (f.ky !== "thang") q.set("ky", f.ky);
  if (f.ky === "tuy-chon") {
    q.set("tu", f.tu);
    q.set("den", f.den);
  }
  for (const k of ["kh", "tx", "xe", "tuyen"] as const) if (f[k]) q.set(k, f[k]);
  return q.toString();
}
