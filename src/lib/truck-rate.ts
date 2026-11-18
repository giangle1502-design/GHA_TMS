/**
 * Bảng giá xe tải (SQL 9022, bảng truck_rate_cards): ma trận khoảng km × trọng tải,
 * phí bốc xếp theo trọng tải, hệ số hỗ trợ dầu theo giá dầu.
 *
 * Giá trong bảng cước ĐÃ cộng hỗ trợ dầu (fuel_pct_included, vd 20%):
 *   Đơn giá chưa dầu = Giá trong bảng / (1 + % đã cộng / 100)
 *   Cước = Đơn giá chưa dầu × (1 + % hỗ trợ dầu / 100)
 * % hỗ trợ dầu lấy theo giá dầu (bảng hệ số: hệ số 1.2 = 20%), không nhập giá dầu thì dùng đúng % đã cộng.
 */

export type DistanceBand = { from_km: number; to_km: number; label: string };
export type WeightBand = { from_ton: number; to_ton: number; label: string; loading_fee: number | null };
export type FuelBand = { from_price: number; to_price: number; factor: number };

export type TruckRateCard = {
  id?: string | null;
  code?: string | null;
  name: string;
  customer_id?: string | null;
  customer_name?: string | null;
  fuel_pct_included: number;
  distance_bands: DistanceBand[];
  weight_bands: WeightBand[];
  /** prices[i][j]: khoảng km i, trọng tải j; null = chưa có giá */
  prices: (number | null)[][];
  fuel_bands: FuelBand[];
  effective_from: string;
  effective_to?: string | null;
  status: "active" | "inactive";
  notes?: string | null;
  source_file?: string | null;
};

export const round0 = (n: number) => Math.round(n);

/** Đơn giá chưa dầu từ giá trong bảng */
export function basePrice(cardPrice: number, fuelPctIncluded: number): number {
  return cardPrice / (1 + (fuelPctIncluded || 0) / 100);
}

/** Hệ số dầu theo giá dầu (đ/lít). Ngoài bảng thì lấy dòng gần nhất và báo. */
export function fuelFactor(bands: FuelBand[], fuelPrice: number): { factor: number; index: number; outside: "below" | "above" | null } | null {
  const list = [...bands].filter((b) => Number.isFinite(b.factor)).sort((a, b) => a.from_price - b.from_price);
  if (!list.length) return null;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (fuelPrice >= b.from_price && fuelPrice <= b.to_price) return { factor: b.factor, index: bands.indexOf(b), outside: null };
    // khoảng hở giữa 2 dòng (vd 21,999.5): lấy dòng dưới
    if (i + 1 < list.length && fuelPrice > b.to_price && fuelPrice < list[i + 1].from_price) return { factor: b.factor, index: bands.indexOf(b), outside: null };
  }
  if (fuelPrice < list[0].from_price) return { factor: list[0].factor, index: bands.indexOf(list[0]), outside: "below" };
  const last = list[list.length - 1];
  return { factor: last.factor, index: bands.indexOf(last), outside: "above" };
}

/** Vị trí khoảng: dòng đầu tiên có giá trị <= cận trên */
function bandIndex<T>(bands: T[], value: number, to: (b: T) => number): number {
  if (!(value >= 0)) return -1;
  // Khoảng ghi 15.001 - 25: 15.0005 km vẫn thuộc dòng 15.001 - 25 (dòng đầu tiên có cận trên >= giá trị)
  for (let i = 0; i < bands.length; i++) if (value <= to(bands[i]) + 1e-9) return i;
  return -1;
}

export type TruckQuote = {
  distanceIndex: number;
  weightIndex: number;
  /** Giá trong bảng (đã gồm % dầu của bảng) */
  cardPrice: number | null;
  /** Đơn giá chưa dầu */
  unitPrice: number | null;
  /** % hỗ trợ dầu áp dụng */
  fuelPct: number;
  /** Cước = Đơn giá × (1 + % dầu) */
  freight: number | null;
  loadingFee: number | null;
  warnings: string[];
};

export function quoteTruck(card: Pick<TruckRateCard, "distance_bands" | "weight_bands" | "prices" | "fuel_bands" | "fuel_pct_included">, input: { km: number | null; tons: number | null; fuelPrice?: number | null }): TruckQuote {
  const warnings: string[] = [];
  const di = input.km === null ? -1 : bandIndex(card.distance_bands, input.km, (b) => b.to_km);
  const wi = input.tons === null ? -1 : bandIndex(card.weight_bands, input.tons, (b) => b.to_ton);
  if (input.km !== null && di < 0) {
    const max = card.distance_bands.at(-1)?.to_km;
    warnings.push(max !== undefined && input.km > max ? `Quãng đường vượt bảng giá (tối đa ${max} km).` : "Quãng đường không hợp lệ.");
  }
  if (input.tons !== null && wi < 0) {
    const max = card.weight_bands.at(-1)?.to_ton;
    warnings.push(max !== undefined && input.tons > max ? `Trọng lượng vượt bảng giá (tối đa ${max} tấn).` : "Trọng lượng không hợp lệ.");
  }
  let fuelPct = card.fuel_pct_included || 0;
  if (input.fuelPrice) {
    const f = fuelFactor(card.fuel_bands, input.fuelPrice);
    if (f) {
      fuelPct = Math.round((f.factor - 1) * 100 * 1000) / 1000;
      if (f.outside === "below") warnings.push("Giá dầu thấp hơn bảng hệ số: lấy hệ số thấp nhất.");
      if (f.outside === "above") warnings.push("Giá dầu cao hơn bảng hệ số: lấy hệ số cao nhất.");
    } else warnings.push("Chưa có bảng hệ số hỗ trợ dầu: dùng % dầu của bảng giá.");
  }
  const raw = di >= 0 && wi >= 0 ? card.prices[di]?.[wi] : null;
  const cardPrice = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  if (di >= 0 && wi >= 0 && cardPrice === null) warnings.push("Ô giá này chưa có giá.");
  const unitPrice = cardPrice === null ? null : basePrice(cardPrice, card.fuel_pct_included);
  const freight = unitPrice === null ? null : round0(unitPrice * (1 + fuelPct / 100));
  const loadingFee = wi >= 0 ? (card.weight_bands[wi].loading_fee ?? null) : null;
  return { distanceIndex: di, weightIndex: wi, cardPrice, unitPrice: unitPrice === null ? null : round0(unitPrice), fuelPct, freight, loadingFee, warnings };
}

/** Kiểm tra bảng giá trước khi lưu: trả về danh sách lỗi (rỗng = hợp lệ) */
export function validateCard(card: TruckRateCard): string[] {
  const errs: string[] = [];
  if (!card.name.trim()) errs.push("Chưa nhập tên bảng giá.");
  if (!card.distance_bands.length) errs.push("Chưa có khoảng km nào.");
  if (!card.weight_bands.length) errs.push("Chưa có trọng tải nào.");
  if (!(card.fuel_pct_included >= 0 && card.fuel_pct_included <= 100)) errs.push("% hỗ trợ dầu đã gồm phải từ 0 đến 100.");
  const asc = <T,>(list: T[], from: (b: T) => number, to: (b: T) => number, what: string) => {
    list.forEach((b, i) => {
      if (!Number.isFinite(from(b)) || !Number.isFinite(to(b)) || to(b) < from(b)) errs.push(`${what} dòng ${i + 1}: "từ" phải nhỏ hơn hoặc bằng "đến".`);
      if (i > 0 && from(b) < to(list[i - 1])) errs.push(`${what} dòng ${i + 1} chồng lên dòng trên.`);
    });
  };
  asc(card.distance_bands, (b) => b.from_km, (b) => b.to_km, "Khoảng km");
  asc(card.weight_bands, (b) => b.from_ton, (b) => b.to_ton, "Trọng tải");
  asc(card.fuel_bands, (b) => b.from_price, (b) => b.to_price, "Giá dầu");
  card.fuel_bands.forEach((b, i) => {
    if (!(b.factor > 0)) errs.push(`Hệ số dầu dòng ${i + 1} không hợp lệ.`);
  });
  if (card.prices.length !== card.distance_bands.length) errs.push("Số dòng giá không khớp số khoảng km.");
  card.prices.forEach((row, i) => {
    if (row.length !== card.weight_bands.length) errs.push(`Dòng giá ${i + 1} không đủ cột trọng tải.`);
    row.forEach((v, j) => {
      if (v !== null && !(v >= 0)) errs.push(`Giá dòng ${i + 1}, cột ${j + 1} không hợp lệ.`);
    });
  });
  return errs;
}

// -----------------------------------------------------------------------------
// Đọc file Excel theo mẫu BANG_GIA_NOI_BO.xlsx
// -----------------------------------------------------------------------------

/** Ô Excel đã đọc: số, chữ, hoặc công thức chưa có kết quả lưu sẵn */
export type GridCell = string | number | null | { formula: string };
export type Grid = GridCell[][];

const colIndex = (letters: string) => letters.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Tính công thức đơn giản dạng =B30+4000, =B18+0.001, =A5, =B3*1.2 (đủ cho mẫu bảng giá) */
export function resolveGrid(grid: Grid): (string | number | null)[][] {
  const memo = new Map<string, string | number | null>();
  const get = (r: number, c: number, depth = 0): string | number | null => {
    const key = `${r}:${c}`;
    if (memo.has(key)) return memo.get(key)!;
    const v = grid[r]?.[c] ?? null;
    let out: string | number | null;
    if (v !== null && typeof v === "object") {
      out = depth > 50 ? null : evalFormula(v.formula, (rr, cc) => get(rr, cc, depth + 1));
    } else out = v;
    memo.set(key, out);
    return out;
  };
  return grid.map((row, r) => row.map((_, c) => get(r, c)));
}

function evalFormula(f: string, get: (r: number, c: number) => string | number | null): number | null {
  const m = /^=?\s*\$?([A-Z]{1,3})\$?(\d+)\s*(?:([+\-*/])\s*(-?\d+(?:\.\d+)?))?\s*$/i.exec(f);
  if (!m) return null;
  const base = toNum(get(Number(m[2]) - 1, colIndex(m[1])));
  if (base === null) return null;
  if (!m[3]) return base;
  const k = Number(m[4]);
  switch (m[3]) {
    case "+": return base + k;
    case "-": return base - k;
    case "*": return base * k;
    default: return k === 0 ? null : base / k;
  }
}

export function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const norm = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function findCell(grid: (string | number | null)[][], re: RegExp, startRow = 0): { r: number; c: number } | null {
  for (let r = startRow; r < grid.length; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) if (typeof row[c] === "string" && re.test(norm(row[c]))) return { r, c };
  }
  return null;
}

/** "Dưới 2.5 tấn" → 0..2.5; "2.5 - 3.5 tấn" → 2.5..3.5; "5.0 tấn - 6.0 tấn" → 5..6 */
export function parseWeightLabel(label: string): { from: number; to: number } | null {
  const s = norm(label).replace(/tan/g, "");
  const below = /^(duoi|<)\s*(\d+(?:\.\d+)?)/.exec(s);
  if (below) return { from: 0, to: Number(below[2]) };
  const range = /(\d+(?:\.\d+)?)\s*(?:-|den|–)\s*(\d+(?:\.\d+)?)/.exec(s);
  if (range) return { from: Number(range[1]), to: Number(range[2]) };
  const above = /^(tren|>)\s*(\d+(?:\.\d+)?)/.exec(s);
  if (above) return { from: Number(above[2]), to: 999 };
  return null;
}

export type ParsedCard = { card: TruckRateCard; warnings: string[] };

/** Đọc một sheet theo mẫu: bảng cước (Từ (KM) / Đến (KM) / Khoảng cách / các cột trọng tải), bảng phí bốc xếp, bảng hỗ trợ dầu */
export function parseRateSheet(rawGrid: Grid, opts: { sheetName?: string; fileName?: string; today: string }): ParsedCard {
  const grid = resolveGrid(rawGrid);
  const warnings: string[] = [];
  const head = findCell(grid, /^tu\s*\(?km\)?$/);
  if (!head) throw new Error("Không thấy bảng cước: cần ô tiêu đề \"Từ (KM)\" như file mẫu.");

  // Tiêu đề và % dầu đã gồm
  let title = "";
  for (let r = head.r - 1; r >= 0 && !title; r--) {
    const t = (grid[r] ?? []).find((v) => typeof v === "string" && v.trim());
    if (typeof t === "string") title = t.trim();
  }
  const pctMatch = /(\d+(?:[.,]\d+)?)\s*%/.exec(title);
  const fuelPct = pctMatch ? Number(pctMatch[1].replace(",", ".")) : 0;
  if (!pctMatch) warnings.push("Tiêu đề không ghi % hỗ trợ dầu đã gồm: tạm để 0%, sửa lại nếu cần.");

  // Cột trọng tải: các ô có chữ bên phải cột "Khoảng cách"
  const hr = grid[head.r];
  const labelCol = head.c + 2;
  const weightCols: number[] = [];
  for (let c = labelCol + 1; c < hr.length; c++) {
    if (typeof hr[c] === "string" && String(hr[c]).trim()) weightCols.push(c);
    else if (weightCols.length) break;
  }
  if (!weightCols.length) throw new Error("Không thấy các cột trọng tải bên phải cột \"Khoảng cách\".");

  const distance_bands: DistanceBand[] = [];
  const prices: (number | null)[][] = [];
  for (let r = head.r + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const from = toNum(row[head.c]);
    const to = toNum(row[head.c + 1]);
    if (from === null || to === null) break;
    const label = typeof row[labelCol] === "string" && String(row[labelCol]).trim() ? String(row[labelCol]).trim() : `Từ ${from} - ${to} KM`;
    distance_bands.push({ from_km: from, to_km: to, label });
    prices.push(weightCols.map((c) => toNum(row[c])));
  }
  if (!distance_bands.length) throw new Error("Bảng cước chưa có dòng khoảng km nào.");

  // Bảng phí bốc xếp theo trọng tải (nếu có)
  type Load = { from: number | null; to: number | null; label: string; fee: number | null };
  const loads: Load[] = [];
  const lh = findCell(grid, /^tu\s*\(?tan\)?$/);
  if (lh) {
    const lhr = grid[lh.r];
    let feeCol = -1;
    for (let c = lh.c + 1; c < lhr.length; c++) if (/boc xep/.test(norm(lhr[c]))) feeCol = c;
    for (let r = lh.r + 1; r < grid.length; r++) {
      const row = grid[r] ?? [];
      const to = toNum(row[lh.c + 1]);
      const label = typeof row[lh.c + 2] === "string" ? String(row[lh.c + 2]).trim() : "";
      if (to === null && !label) break;
      if (to === null) continue;
      loads.push({ from: toNum(row[lh.c]), to, label, fee: feeCol >= 0 ? toNum(row[feeCol]) : null });
    }
  } else warnings.push("Không thấy bảng phí bốc xếp (ô \"Từ (Tấn)\"): để trống phí bốc xếp.");

  const weight_bands: WeightBand[] = weightCols.map((c, j) => {
    const label = String(hr[c]).trim();
    const byLabel = loads.find((l) => l.label && norm(l.label) === norm(label));
    const l = byLabel ?? (loads.length === weightCols.length ? loads[j] : undefined);
    const parsed = parseWeightLabel(label);
    let from = l?.from ?? null;
    let to = l?.to ?? null;
    if (to === null && parsed) to = parsed.to;
    if (from === null && parsed) from = j === 0 ? parsed.from : parsed.from + 0.001;
    if (to === null || from === null) {
      warnings.push(`Không hiểu trọng tải "${label}": cần sửa "từ/đến" bằng tay.`);
      from = from ?? 0;
      to = to ?? 0;
    }
    return { from_ton: from, to_ton: to, label, loading_fee: l?.fee ?? null };
  });

  // Hệ số hỗ trợ dầu theo giá dầu
  const fuel_bands: FuelBand[] = [];
  const fh = findCell(grid, /^tu\s*\(?(vnd|dong|d)\)?$/);
  if (fh) {
    for (let r = fh.r + 1; r < grid.length; r++) {
      const row = grid[r] ?? [];
      const from = toNum(row[fh.c]);
      const to = toNum(row[fh.c + 1]);
      let f = toNum(row[fh.c + 2]);
      if (from === null || to === null || f === null) break;
      if (f >= 3) f = 1 + f / 100; // ghi 20 (%) thay vì 1.2
      else if (f < 0.9) f = 1 + f; // ghi 0.2 thay vì 1.2
      fuel_bands.push({ from_price: from, to_price: to, factor: Math.round(f * 10000) / 10000 });
    }
  } else warnings.push("Không thấy bảng hệ số hỗ trợ dầu (ô \"Từ (VNĐ)\").");

  return {
    card: {
      id: null,
      name: title || opts.sheetName || "Bảng giá xe tải",
      fuel_pct_included: fuelPct,
      distance_bands,
      weight_bands,
      prices,
      fuel_bands,
      effective_from: opts.today,
      effective_to: null,
      status: "active",
      notes: opts.fileName ? `Nhập từ file ${opts.fileName}${opts.sheetName ? ` (sheet ${opts.sheetName})` : ""}.` : null,
      source_file: opts.fileName ?? null,
    },
    warnings,
  };
}

/** Bảng giá trống để bắt đầu (cùng khung km/tấn với bảng đang có nếu đưa vào) */
export function blankCard(today: string, like?: TruckRateCard | null): TruckRateCard {
  const distance_bands = like?.distance_bands.map((b) => ({ ...b })) ?? [{ from_km: 0, to_km: 15, label: "Từ 0 - 15 KM" }];
  const weight_bands = like?.weight_bands.map((b) => ({ ...b })) ?? [{ from_ton: 0, to_ton: 2.5, label: "Dưới 2.5 tấn", loading_fee: null }];
  return {
    id: null,
    name: like ? `${like.name} (bản sao)` : "Bảng giá xe tải mới",
    customer_id: like?.customer_id ?? null,
    customer_name: like?.customer_name ?? null,
    fuel_pct_included: like?.fuel_pct_included ?? 0,
    distance_bands,
    weight_bands,
    prices: like ? like.prices.map((r) => [...r]) : distance_bands.map(() => weight_bands.map(() => null)),
    fuel_bands: like?.fuel_bands.map((b) => ({ ...b })) ?? [],
    effective_from: today,
    effective_to: null,
    status: "active",
    notes: null,
    source_file: null,
  };
}
