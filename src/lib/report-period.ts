import { addDaysYMD, todayVN } from "@/lib/format";

/** Kỳ báo cáo: từ ngày – đến ngày, tuần (ISO, thứ Hai đầu tuần), tháng, năm */
export type PeriodKind = "ngay" | "tuan" | "thang" | "nam";
export type BucketBy = "ngay" | "tuan" | "thang";
export type Period = { kind: PeriodKind; from: string; to: string; label: string; by: BucketBy; value: Record<string, string> };

const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const isYmd = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Thứ Hai của tuần chứa ngày ymd */
export function mondayOf(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return addDaysYMD(ymd, -((d.getUTCDay() + 6) % 7));
}
/** Tuần ISO dạng 2026-W44 của ngày ymd */
export function isoWeek(ymd: string): string {
  const thu = addDaysYMD(mondayOf(ymd), 3);
  const year = Number(thu.slice(0, 4));
  const jan4 = `${year}-01-04`;
  const week = Math.round((Date.parse(mondayOf(thu)) - Date.parse(mondayOf(jan4))) / (7 * 86400000)) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}
/** Thứ Hai của tuần ISO "2026-W44" */
export function weekStart(w: string): string | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(w);
  if (!m) return null;
  return addDaysYMD(mondayOf(`${m[1]}-01-04`), (Number(m[2]) - 1) * 7);
}
const lastDayOfMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export function resolvePeriod(sp: Record<string, string | string[] | undefined>, now = todayVN()): Period {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined))?.trim();
  const kind = (["ngay", "tuan", "thang", "nam"].includes(one("ky") ?? "") ? one("ky") : "thang") as PeriodKind;
  const byParam = one("chia");
  let p: Omit<Period, "by">;
  if (kind === "ngay") {
    let from = isYmd(one("tu")) ? one("tu")! : `${now.slice(0, 7)}-01`;
    let to = isYmd(one("den")) ? one("den")! : now;
    if (from > to) [from, to] = [to, from];
    // Tối đa 3 năm để không tải quá nhiều dữ liệu
    if (Date.parse(to) - Date.parse(from) > 1096 * 86400000) from = addDaysYMD(to, -1096);
    p = { kind, from, to, label: `Từ ${dmy(from)} đến ${dmy(to)}`, value: { tu: from, den: to } };
  } else if (kind === "tuan") {
    const w = one("tuan") && weekStart(one("tuan")!) ? one("tuan")! : isoWeek(now);
    const from = weekStart(w)!;
    const to = addDaysYMD(from, 6);
    p = { kind, from, to, label: `Tuần ${Number(w.slice(6))}/${w.slice(0, 4)} (${dmy(from)} – ${dmy(to)})`, value: { tuan: w } };
  } else if (kind === "nam") {
    const y = /^\d{4}$/.test(one("nam") ?? "") ? one("nam")! : now.slice(0, 4);
    p = { kind, from: `${y}-01-01`, to: `${y}-12-31`, label: `Năm ${y}`, value: { nam: y } };
  } else {
    const ym = /^\d{4}-\d{2}$/.test(one("thang") ?? "") ? one("thang")! : now.slice(0, 7);
    p = { kind, from: `${ym}-01`, to: lastDayOfMonth(ym), label: `Tháng ${ym.slice(5)}/${ym.slice(0, 4)}`, value: { thang: ym } };
  }
  const defBy: BucketBy = kind === "nam" ? "thang" : "ngay";
  const by = (["ngay", "tuan", "thang"].includes(byParam ?? "") ? byParam : defBy) as BucketBy;
  return { ...p, by };
}

/** Khóa và nhãn của kỳ con (ngày / tuần / tháng) chứa ngày ymd */
export function bucketOf(ymd: string, by: BucketBy): { key: string; label: string } {
  if (by === "thang") return { key: ymd.slice(0, 7), label: `${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` };
  if (by === "tuan") {
    const w = isoWeek(ymd);
    const mon = mondayOf(ymd);
    return { key: w, label: `Tuần ${Number(w.slice(6))}/${w.slice(0, 4)} (${dmy(mon).slice(0, 5)}–${dmy(addDaysYMD(mon, 6)).slice(0, 5)})` };
  }
  return { key: ymd, label: dmy(ymd) };
}
