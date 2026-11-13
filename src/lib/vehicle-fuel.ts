// Dầu theo từng xe theo tháng (0068): tính toán, tổng hợp, cột Excel mẫu, đọc file nhập.
// Dùng được ở cả máy chủ và trình duyệt (không "use client").

/** Một dòng do public.fuel_month trả về */
export type FuelRowRaw = {
  vehicle_id: string;
  plate_number: string;
  vehicle_code: string | null;
  vehicle_type: string | null;
  driver_name: string | null;
  vehicle_status: string;
  km_start: number | null;
  km_start_auto: boolean;
  km_end: number | null;
  fuel_opening: number | string | null;
  fuel_opening_auto: boolean;
  fuel_added: number | string | null;
  fuel_remaining: number | string | null;
  fuel_ratio: number | string | null;
  fuel_ratio_auto: boolean;
  /** Có từ bản nâng cấp 0069 */
  fuel_price?: number | string | null;
  fuel_price_auto?: boolean;
  final_fuel: number | string | null;
  final_note: string | null;
  note: string | null;
  locked_at: string | null;
  locked_by_name: string | null;
  has_row: boolean;
};

export type FuelMonth = {
  month: string;
  can_edit: boolean;
  can_lock: boolean;
  can_export: boolean;
  rows: FuelRowRaw[];
};

export type FuelRow = {
  id: string;
  plate: string;
  code: string;
  type: string;
  driver: string;
  kmStart: number | null;
  kmStartAuto: boolean;
  kmEnd: number | null;
  /** KM chạy trong tháng = KM cuối − KM đầu */
  kmRun: number | null;
  opening: number | null;
  openingAuto: boolean;
  added: number | null;
  remaining: number | null;
  /** Dầu thực tế tiêu hao = tồn đầu + đổ thêm − còn lại */
  actual: number | null;
  ratio: number | null;
  ratioAuto: boolean;
  /** Dầu theo KM và tỷ trọng = (KM cuối − KM đầu) × tỷ trọng */
  norm: number | null;
  /** Chênh lệch = thực tế − theo KM (dương: tốn hơn định mức) */
  diff: number | null;
  final: number | null;
  /** Đơn giá dầu (đồng/lít) */
  price: number | null;
  priceAuto: boolean;
  /** Thành tiền = số chốt × đơn giá; chưa có số chốt thì tạm tính theo dầu thực tế */
  amount: number | null;
  amountTemp: boolean;
  finalNote: string;
  note: string;
  locked: boolean;
  lockedBy: string;
  lockedAt: string | null;
};

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** Làm tròn 2 chữ số thập phân, bỏ sai số dấu phẩy động */
export const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeFuelRow(r: FuelRowRaw): FuelRow {
  const kmStart = num(r.km_start);
  const kmEnd = num(r.km_end);
  const opening = num(r.fuel_opening);
  const added = num(r.fuel_added);
  const remaining = num(r.fuel_remaining);
  const ratio = num(r.fuel_ratio);
  const kmRun = kmStart !== null && kmEnd !== null ? kmEnd - kmStart : null;
  // Không đổ thêm (trống) tính là 0; tồn đầu và còn lại phải có mới tính được thực tế
  const actual = opening !== null && remaining !== null ? round2(opening + (added ?? 0) - remaining) : null;
  const norm = kmRun !== null && ratio !== null ? round2(kmRun * ratio) : null;
  const final = num(r.final_fuel);
  const price = num(r.fuel_price);
  const liters = final ?? actual;
  return {
    id: r.vehicle_id,
    plate: r.plate_number,
    code: r.vehicle_code ?? "",
    type: r.vehicle_type ?? "Chưa chọn loại xe",
    driver: r.driver_name ?? "",
    kmStart,
    kmStartAuto: r.km_start_auto,
    kmEnd,
    kmRun,
    opening,
    openingAuto: r.fuel_opening_auto,
    added,
    remaining,
    actual,
    ratio,
    ratioAuto: r.fuel_ratio_auto,
    norm,
    diff: actual !== null && norm !== null ? round2(actual - norm) : null,
    final,
    price,
    priceAuto: !!r.fuel_price_auto,
    amount: price !== null && liters !== null ? Math.round(liters * price) : null,
    amountTemp: final === null && actual !== null,
    finalNote: r.final_note ?? "",
    note: r.note ?? "",
    locked: !!r.locked_at,
    lockedBy: r.locked_by_name ?? "",
    lockedAt: r.locked_at,
  };
}

export type FuelTotals = {
  label: string;
  vehicles: number;
  locked: number;
  kmRun: number;
  opening: number;
  added: number;
  remaining: number;
  actual: number;
  norm: number;
  diff: number;
  final: number;
  amount: number;
};

export function sumFuel(label: string, rows: FuelRow[]): FuelTotals {
  const s = (f: (r: FuelRow) => number | null) => round2(rows.reduce((a, r) => a + (f(r) ?? 0), 0));
  return {
    label,
    vehicles: rows.length,
    locked: rows.filter((r) => r.locked).length,
    kmRun: s((r) => r.kmRun),
    opening: s((r) => r.opening),
    added: s((r) => r.added),
    remaining: s((r) => r.remaining),
    actual: s((r) => r.actual),
    norm: s((r) => r.norm),
    diff: s((r) => r.diff),
    final: s((r) => r.final),
    amount: s((r) => r.amount),
  };
}

/** Tổng theo loại xe (xe cont, xe tải…) theo thứ tự xuất hiện */
export function summarizeByType(rows: FuelRow[]): FuelTotals[] {
  const groups = new Map<string, FuelRow[]>();
  for (const r of rows) groups.set(r.type, [...(groups.get(r.type) ?? []), r]);
  return [...groups.entries()].map(([k, v]) => sumFuel(k, v));
}

/** Cột của file Excel mẫu / nhập Excel. key là tên ô gửi lên save_vehicle_fuel */
export type FuelImportColumn = {
  key: "plate" | "km_start" | "km_end" | "fuel_opening" | "fuel_added" | "fuel_remaining" | "fuel_ratio" | "fuel_price" | "note";
  label: string;
  hint: string;
  numeric: boolean;
  width: number;
};

export const FUEL_IMPORT_COLUMNS: FuelImportColumn[] = [
  {
    key: "plate", label: "Số xe", numeric: false, width: 14,
    hint: "BẮT BUỘC. Biển số đúng như trong Phương tiện, viết liền không dấu chấm, gạch (ví dụ 61K31295). Chữ thường tự đổi thành chữ hoa.",
  },
  {
    key: "km_start", label: "Số KM đầu tháng", numeric: true, width: 16,
    hint: "Số nguyên (km), ví dụ 125000. Để trống: tự lấy Số KM cuối tháng của tháng trước.",
  },
  {
    key: "km_end", label: "Số KM cuối tháng", numeric: true, width: 16,
    hint: "Số nguyên (km), ví dụ 131500. Phải lớn hơn hoặc bằng KM đầu tháng.",
  },
  {
    key: "fuel_opening", label: "Tồn dầu đầu tháng", numeric: true, width: 16,
    hint: "Số lít, ví dụ 120 hoặc 120.5 (dấu chấm là thập phân). Để trống: tự lấy Số lượng dầu còn lại của tháng trước.",
  },
  {
    key: "fuel_added", label: "Số lượng dầu đổ thêm", numeric: true, width: 18,
    hint: "Tổng số lít đổ thêm trong tháng, ví dụ 2,150 hoặc 2150. Không đổ thì để trống hoặc 0.",
  },
  {
    key: "fuel_remaining", label: "Số lượng dầu còn lại", numeric: true, width: 18,
    hint: "Số lít còn trong bình cuối tháng (đo thực tế), ví dụ 95. Thành Tồn dầu đầu tháng sau.",
  },
  {
    key: "fuel_ratio", label: "Tỷ trọng dầu theo xe (lít/km)", numeric: true, width: 20,
    hint: "Số lít cho 1 km, ví dụ 0.35 (35 lít/100 km). Để trống: lấy Tỷ trọng dầu của xe trong Phương tiện.",
  },
  {
    key: "fuel_price", label: "Đơn giá dầu (đồng/lít)", numeric: true, width: 18,
    hint: "Giá 1 lít dầu, ví dụ 20,500. Để trống: tự lấy đơn giá tháng trước của xe. Thành tiền = số lít Giám đốc chốt × đơn giá.",
  },
  {
    key: "note", label: "Ghi chú", numeric: false, width: 30,
    hint: "Không bắt buộc, tối đa 500 ký tự.",
  },
];

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Đọc số theo cách công ty viết: "," hàng nghìn, "." thập phân (2,150.5). Trả undefined nếu không phải số. */
export function parseFuelNumber(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const s = String(v).trim().replace(/\s/g, "");
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export type FuelImportRow = { row: number; plate: string; note?: string | null } & Partial<
  Record<Exclude<FuelImportColumn["key"], "plate" | "note">, number | null>
>;
export type FuelImportParse = { rows: FuelImportRow[]; errors: { row: number; error: string }[]; missing: string[] };

/**
 * Đọc bảng (dòng đầu là tiêu đề như file mẫu) thành dòng gửi lên máy chủ.
 * Cột không có trong file thì không đổi số đã nhập; ô trống trong cột có mặt = để trống (lấy số tự động).
 */
export function parseFuelSheet(table: unknown[][], headerRowIndex = 0): FuelImportParse {
  const head = (table[headerRowIndex] ?? []).map((h) => fold(String(h ?? "")));
  const idx = new Map<FuelImportColumn["key"], number>();
  for (const c of FUEL_IMPORT_COLUMNS) {
    const want = fold(c.label);
    const i = head.findIndex((h) => h === want || (c.key === "plate" && (h === "soxe" || h === "bienso")));
    if (i >= 0) idx.set(c.key, i);
  }
  const missing = idx.has("plate") ? [] : ["Số xe"];
  const rows: FuelImportRow[] = [];
  const errors: { row: number; error: string }[] = [];
  if (missing.length) return { rows, errors, missing };
  for (let r = headerRowIndex + 1; r < table.length; r++) {
    const line = table[r] ?? [];
    const rowNo = r + 1;
    const cells = [...idx.values()].map((i) => line[i]);
    if (cells.every((c) => c === null || c === undefined || String(c).trim() === "")) continue;
    const plate = String(line[idx.get("plate")!] ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!plate) {
      errors.push({ row: rowNo, error: "Thiếu số xe" });
      continue;
    }
    const out: FuelImportRow = { row: rowNo, plate };
    let bad = "";
    for (const c of FUEL_IMPORT_COLUMNS) {
      if (c.key === "plate" || !idx.has(c.key)) continue;
      const raw = line[idx.get(c.key)!];
      if (c.key === "note") {
        out.note = raw === null || raw === undefined ? null : String(raw).trim().slice(0, 500) || null;
        continue;
      }
      const n = parseFuelNumber(raw);
      if (n === undefined) bad ||= `${c.label} không phải số`;
      else if (n !== null && n < 0) bad ||= `${c.label} không được âm`;
      else out[c.key] = n;
    }
    if (bad) errors.push({ row: rowNo, error: bad });
    else rows.push(out);
  }
  return { rows, errors, missing };
}

/** "2026-11" → "11/2026" */
export const monthLabel = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

export function shiftMonth(m: string, delta: number) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + delta, 1)).toISOString().slice(0, 7);
}
