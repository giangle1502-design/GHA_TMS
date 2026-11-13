/** Bảng phân công lịch vận chuyển (kế hoạch xe theo ngày) dùng chung cho Excel và ảnh */

export const DAY_PLAN_TITLE = "BẢNG PHÂN CÔNG LỊCH VẬN CHUYỂN HÀNG HOÁ BẰNG CONTAINER";
export const DAY_PLAN_ADDRESS = "650/5C ĐƯỜNG VƯỜN LÀI, TỔ 28, KP 2, P. AN PHÚ ĐÔNG, TP. HCM";

export type DayPlanRow = {
  stt: number;
  date: string;
  customer: string;
  driver: string;
  plate: string;
  pickup: string;
  stuffing: string;
  dropoff: string;
  c20: number | null;
  c40: number | null;
  kind: string;
  containerNo: string;
};

export type DayPlan = { date: string; rows: DayPlanRow[] };

/** Cột của bảng: [nhãn, nhóm tiêu đề (gộp ô), độ rộng Excel, độ rộng ảnh px] */
export const DAY_PLAN_COLUMNS: { key: keyof DayPlanRow; label: string; group?: string; xl: number; px: number }[] = [
  { key: "stt", label: "STT", xl: 6, px: 48 },
  { key: "date", label: "Ngày", xl: 12, px: 110 },
  { key: "customer", label: "Khách hàng", xl: 14, px: 120 },
  { key: "driver", label: "Tài xế", xl: 22, px: 170 },
  { key: "plate", label: "Số xe", xl: 14, px: 120 },
  { key: "containerNo", label: "Số cont", xl: 18, px: 170 },
  { key: "c20", label: "20", group: "Cont", xl: 6, px: 56 },
  { key: "c40", label: "40", group: "Cont", xl: 6, px: 56 },
  { key: "kind", label: "Loại hình", xl: 10, px: 100 },
  { key: "pickup", label: "Nơi lấy cont", group: "Tuyến vận tải", xl: 16, px: 150 },
  { key: "stuffing", label: "Nơi đóng hàng", group: "Tuyến vận tải", xl: 32, px: 280 },
  { key: "dropoff", label: "Nơi hạ", group: "Tuyến vận tải", xl: 16, px: 150 },
];

/** Loại cont 20 hoặc 40 (45 tính vào 40) đọc từ tên loại xe/loại cont, ví dụ "Cont 40", "40HC", "20'" */
export function contSize(name: string | null | undefined): 20 | 40 | null {
  const m = /(?:^|\D)(20|40|45)(?:\D|$)/.exec(name ?? "");
  if (!m) return null;
  return m[1] === "20" ? 20 : 40;
}

/** Số container chuẩn ISO 6346 (4 chữ + 7 số), ví dụ NWSU4222719 */
export const CONTAINER_NO_RE = /\b[A-Z]{4}\s?\d{6,7}\b/g;
/** Trường bổ sung "Số cont" / "Số container" (không phải "Số lượng cont") */
export const CONTAINER_FIELD_RE = /^\s*s[oố]\s*(cont|container)\b/i;
/** Trường bổ sung chỉ nơi lấy cont / đóng hàng / hạ hàng (nếu công ty tự thêm) */
export const PICKUP_FIELD_RE = /(n[oơ]i|đi[eể]m)\s*l[aấ]y\s*(cont|container|r[oỗ]ng)/i;
export const STUFFING_FIELD_RE = /(n[oơ]i|đi[eể]m|kho)\s*(đ[oó]ng|r[uú]t)\s*h[aà]ng/i;
export const DROPOFF_FIELD_RE = /(n[oơ]i|đi[eể]m)\s*h[aạ]\s*(h[aà]ng|cont|container)/i;

/** Dòng tổng dưới bảng: tổng cont 20, tổng cont 40, Total = cont 20 + cont 40 */
export function dayPlanTotals(rows: DayPlanRow[]) {
  const c20 = rows.reduce((a, r) => a + (r.c20 ?? 0), 0);
  const c40 = rows.reduce((a, r) => a + (r.c40 ?? 0), 0);
  return { c20, c40, total: c20 + c40 };
}
/** Vị trí cột cont 20 (cột 40 ngay sau) */
export const C20_INDEX = DAY_PLAN_COLUMNS.findIndex((c) => c.key === "c20");
