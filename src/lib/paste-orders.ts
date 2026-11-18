/**
 * "Dán từ Excel": chọn các dòng trong bảng theo dõi hàng (BCT, Pháp nhân, Số tờ khai, Mã hàng, Số cont,
 * Ngày giao, Điểm giao, Điểm lấy cont…), Ctrl+C rồi dán vào phần mềm để tạo đơn + chuyến.
 * Phần thuần (không gọi CSDL): đọc dữ liệu dạng tab, ghép cột, ghép tên với danh mục, gộp đơn.
 */
import { parseNumberVN } from "@/lib/entities/record";
import { parseDateVN } from "@/lib/import-trips";

export type PasteField =
  | "bct"
  | "phap_nhan"
  | "ncc"
  | "so_to_khai"
  | "ngay_khai"
  | "luong_khai"
  | "ma_hang"
  | "tong_don"
  | "hinh_thuc"
  | "so_luong"
  | "loai_cont"
  | "so_cont"
  | "ngay_giao"
  | "diem_giao"
  | "pxk"
  | "tinh_trang"
  | "luu_bai"
  | "ngay_gia_han"
  | "luu_cont"
  | "phi_gia_han"
  | "hd_gia_han"
  | "diem_lay_cont"
  | "hang_tau"
  | "so_bill"
  | "hang_cam"
  | "phi_boc_xep"
  | "ghi_chu"
  // Ecount: phiếu chuyển kho / phiếu giao hàng
  | "so_sto"
  | "so_phieu"
  | "diem_di"
  | "kho_xuat"
  | "diem_den"
  | "kho_nhap"
  | "ma_kh_nhan"
  | "ten_kh_nhan"
  | "don_vi_vt"
  | "so_xe"
  | "kien_xa";

export type PasteColumn = { key: PasteField; label: string; aliases: string[] };

/**
 * Cột theo đúng thứ tự sheet COST CONT (bảng theo dõi hàng) của GHA, từ cột A đến cột AA "Nhà vận chuyển".
 * Dán không kèm dòng tiêu đề thì hiểu theo thứ tự này.
 */
export const PASTE_COLUMNS: PasteColumn[] = [
  { key: "bct", label: "BCT", aliases: ["bct", "so bct", "bo chung tu"] },
  { key: "phap_nhan", label: "Pháp nhân", aliases: ["phap nhan", "khach hang", "cong ty", "ma kh"] },
  { key: "ncc", label: "NCC", aliases: ["ncc", "nha cung cap", "shipper"] },
  { key: "so_to_khai", label: "Số tờ khai", aliases: ["so to khai", "to khai", "tk", "so tk"] },
  { key: "ngay_khai", label: "Ngày khai", aliases: ["ngay khai", "ngay to khai", "ngay tk"] },
  { key: "luong_khai", label: "Luồng khai", aliases: ["luong khai", "luong", "phan luong"] },
  { key: "ma_hang", label: "Mã hàng", aliases: ["ma hang", "san pham", "hang hoa"] },
  { key: "tong_don", label: "Tổng đơn", aliases: ["tong don", "tong so luong", "tong sl"] },
  { key: "hinh_thuc", label: "Hình thức giao", aliases: ["hinh thuc van chuyen", "hinh thuc giao", "hinh thuc giao hang", "hinh thuc", "pallet xa"] },
  { key: "so_luong", label: "Số lượng 1 cont", aliases: ["so luong 1 cont", "so luong", "sl", "trong luong", "kg"] },
  { key: "loai_cont", label: "Loại cont", aliases: ["loai cont", "loai", "loai c", "cont", "size"] },
  { key: "so_cont", label: "Số cont", aliases: ["so cont", "so container", "container", "cont no"] },
  { key: "ngay_giao", label: "Ngày giao", aliases: ["ngay giao", "ngay giao hang", "ngay"] },
  { key: "diem_giao", label: "Điểm giao", aliases: ["diem giao", "noi giao", "kho giao", "diem den"] },
  { key: "pxk", label: "PXK", aliases: ["pxk", "phieu xuat kho", "so pxk"] },
  { key: "tinh_trang", label: "Tình trạng giao", aliases: ["tinh trang giao", "tinh trang", "trang thai"] },
  { key: "luu_bai", label: "Lưu bãi", aliases: ["luu bai", "han luu bai"] },
  { key: "ngay_gia_han", label: "Ngày gia hạn", aliases: ["ngay gia han", "gia han"] },
  { key: "luu_cont", label: "Lưu cont", aliases: ["luu cont", "han luu cont"] },
  { key: "phi_gia_han", label: "Phí gia hạn", aliases: ["phi gia han"] },
  { key: "hd_gia_han", label: "Hóa đơn gia hạn", aliases: ["hoa don gia han", "hd gia han"] },
  { key: "diem_lay_cont", label: "Điểm lấy cont", aliases: ["diem lay cont", "lay cont", "noi lay cont", "diem nhan", "cang"] },
  { key: "hang_tau", label: "Hãng tàu", aliases: ["hang tau"] },
  { key: "so_bill", label: "Số Bill", aliases: ["so bill", "bill", "so bl", "bl"] },
  { key: "hang_cam", label: "Hàng cầm", aliases: ["hang cam"] },
  { key: "phi_boc_xep", label: "Phí bốc xếp", aliases: ["phi boc xep"] },
  { key: "don_vi_vt", label: "Nhà vận chuyển", aliases: ["nha van chuyen", "don vi van tai", "nha xe"] },
  { key: "ghi_chu", label: "Ghi chú", aliases: ["ghi chu", "note"] },
];

const C = (key: PasteField, label: string, aliases: string[]): PasteColumn => ({ key, label, aliases });

/** Mẫu phiếu chuyển kho chụp/copy từ Ecount */
export const ECOUNT_TRANSFER_COLUMNS: PasteColumn[] = [
  C("ngay_giao", "Ngày", ["ngay", "ngay chuyen"]),
  C("phap_nhan", "Công ty", ["cong ty", "cong ty ten"]),
  C("so_sto", "Số STO", ["so sto", "sto"]),
  C("so_phieu", "Số phiếu chuyển kho", ["so phieu chuyen kho", "phieu chuyen kho", "so phieu"]),
  C("diem_di", "Điểm đi", ["diem di"]),
  C("kho_xuat", "Tên kho xuất", ["ten kho xuat", "kho xuat"]),
  C("diem_den", "Điểm đến", ["diem den"]),
  C("kho_nhap", "Tên kho nhập", ["ten kho nhap", "kho nhap"]),
  C("ma_hang", "Mã hàng", ["ma hang"]),
  C("so_luong", "Số lượng", ["so luong"]),
  C("don_vi_vt", "Đơn vị vận tải", ["don vi van tai", "don vi van tai ten", "don vi van taiten"]),
  C("so_xe", "Số xe / cont", ["so xe", "so cont"]),
  C("kien_xa", "Nhập kiện/xá", ["nhap kien xa", "kien xa"]),
];

/** Mẫu phiếu giao hàng (xuất kho) chụp/copy từ Ecount */
export const ECOUNT_DELIVERY_COLUMNS: PasteColumn[] = [
  C("ngay_giao", "Ngày", ["ngay"]),
  C("pxk", "Số phiếu giao hàng", ["so phieu giao hang", "phieu giao hang", "so phieu"]),
  C("phap_nhan", "Công ty", ["cong ty ten", "cong ty"]),
  C("kho_xuat", "Kho xuất", ["kho xuat", "ten kho xuat"]),
  C("diem_di", "Điểm đi", ["diem di"]),
  C("ma_kh_nhan", "Mã KH/NCC nhận", ["ma khach hang nha cung cap", "ma khach hang", "ma kh"]),
  C("ten_kh_nhan", "Tên KH/NCC nhận", ["khach hang nha cung cap ten", "ten khach hang", "khach hang nha cung cap"]),
  C("don_vi_vt", "Đơn vị vận tải", ["don vi van tai ten", "don vi van tai"]),
  C("so_xe", "Số xe / cont", ["so xe"]),
  C("ma_hang", "Mã hàng", ["ma hang"]),
  C("so_luong", "Số lượng", ["so luong"]),
  C("kien_xa", "Xuất kiện", ["xuat kien"]),
];

export type PasteTemplate = "theo_doi" | "ecount_ck" | "ecount_gh";
export const TEMPLATES: { id: PasteTemplate; label: string; columns: PasteColumn[]; /** cột chỉ mẫu này có, để nhận ra mẫu */ marks: PasteField[] }[] = [
  { id: "theo_doi", label: "Bảng theo dõi hàng (Excel)", columns: PASTE_COLUMNS, marks: ["so_to_khai", "diem_lay_cont", "bct"] },
  { id: "ecount_ck", label: "Ecount: phiếu chuyển kho", columns: ECOUNT_TRANSFER_COLUMNS, marks: ["so_sto", "so_phieu", "kho_nhap"] },
  { id: "ecount_gh", label: "Ecount: phiếu giao hàng", columns: ECOUNT_DELIVERY_COLUMNS, marks: ["pxk", "ma_kh_nhan", "ten_kh_nhan", "kien_xa"] },
];
export const templateOf = (id: PasteTemplate) => TEMPLATES.find((t) => t.id === id)!;

/** Tên hiển thị của mọi trường (cho ô chọn cột) */
export const FIELD_LABELS: Record<PasteField, string> = Object.fromEntries(
  [...ECOUNT_DELIVERY_COLUMNS, ...ECOUNT_TRANSFER_COLUMNS, ...PASTE_COLUMNS].map((c) => [c.key, c.label]),
) as Record<PasteField, string>;

/** Bỏ dấu tiếng Việt, chữ thường */
export function plain(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/** Khóa so tên: bỏ dấu, bỏ mọi ký tự không phải chữ/số ("SP - ITC" = "SPITC" = "sp-itc") */
export const matchKey = (s: string) => plain(s).replace(/[^a-z0-9]/g, "");

/** Bỏ chữ chung chung ở đầu tên địa điểm: "KHO LINH PHÁT" ~ "LINHPHAT", "Cảng Cát Lái" ~ "CATLAI" */
const GENERIC = /^(kho|cang|bai|ben|cty|congty|cong ty|nha may|depot|icd|tnhh|mtv|co phan|cp)\s+/;
export function coreKey(s: string): string {
  let p = plain(s).replace(/[^a-z0-9]+/g, " ").trim();
  for (let i = 0; i < 4; i++) p = p.replace(GENERIC, "");
  return p.replace(/ /g, "");
}

/** Đọc dữ liệu Excel copy ra (tab giữa các cột, xuống dòng giữa các dòng; ô có xuống dòng nằm trong "…") */
export function parseTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let atStart = true;
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && atStart) {
      quoted = true;
      atStart = false;
      continue;
    }
    if (ch === "\t") {
      row.push(cell);
      cell = "";
      atStart = true;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      atStart = true;
      continue;
    }
    cell += ch;
    atStart = false;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.replace(/\s+/g, " ").trim())).filter((r) => r.some((c) => c !== ""));
}

/** Ghép một tiêu đề cột với trường; không nhận ra thì null. Chịu được chữ thừa do ảnh (nút lọc "v", "JY"…) */
export function headerField(h: string, columns: PasteColumn[] = PASTE_COLUMNS): PasteField | null {
  const keys = (c: PasteColumn) => [c.label, ...c.aliases].map(matchKey);
  const tokens = plain(h).split(/[^a-z0-9]+/).filter(Boolean);
  // Bỏ dần các mẩu ngắn (≤ 2 ký tự, không phải số) ở cuối: "BCT SN" → "BCT", "NGÀY GIAO JY" → "NGÀY GIAO"
  const tries = [tokens.join("")];
  for (let t = tokens.slice(); t.length > 1 && t[t.length - 1].length <= 2 && !/^\d+$/.test(t[t.length - 1]); ) {
    t = t.slice(0, -1);
    tries.push(t.join(""));
  }
  for (const k of tries) {
    if (!k) continue;
    for (const c of columns) if (keys(c).includes(k)) return c.key;
  }
  // Tiêu đề bị cắt cuối ("Tình trạng gia") hoặc thừa chữ: ghép theo phần đầu, lấy khớp dài nhất
  const k = tries[tries.length - 1];
  let best: { key: PasteField; len: number } | null = null;
  for (const c of columns)
    for (const a of keys(c)) {
      const len = k.startsWith(a) && a.length >= 4 ? a.length : a.startsWith(k) && k.length >= 6 ? k.length : 0;
      if (len && (!best || len > best.len)) best = { key: c.key, len };
    }
  return best?.key ?? null;
}

export type ColumnMap = (PasteField | null)[];

/**
 * Tìm dòng tiêu đề trong phần dán (dòng nhận ra từ 3 cột trở lên). Có tiêu đề: ghép theo tên cột.
 * Không có: hiểu theo thứ tự cột của bảng theo dõi GHA.
 */
export function detectColumns(
  rows: string[][],
  force?: PasteTemplate,
): { map: ColumnMap; headerRow: number | null; template: PasteTemplate } {
  let best: { map: ColumnMap; headerRow: number; template: PasteTemplate; score: number } | null = null;
  for (const t of force ? [templateOf(force)] : TEMPLATES)
    for (let r = 0; r < Math.min(rows.length, 3); r++) {
      const used = new Set<PasteField>();
      const map: ColumnMap = rows[r].map((h) => {
        const f = headerField(h, t.columns);
        if (!f || used.has(f)) return null;
        used.add(f);
        return f;
      });
      // Ưu tiên mẫu có cột đặc trưng (Số STO, Số phiếu giao hàng, Số tờ khai…)
      const score = used.size + 3 * t.marks.filter((m) => used.has(m)).length;
      if (used.size >= 3 && (!best || score > best.score)) best = { map, headerRow: r, template: t.id, score };
    }
  if (best) return { map: best.map, headerRow: best.headerRow, template: best.template };
  const t = templateOf(force ?? "theo_doi");
  let order = t.columns.filter((c) => c.key !== "ghi_chu").map((c) => c.key);
  if (t.id === "theo_doi") order = pickTrackingOrder(rows, order);
  const width = Math.max(0, ...rows.map((r) => r.length));
  return { map: Array.from({ length: width }, (_, i) => order[i] ?? null), headerRow: null, template: t.id };
}

/**
 * Không có dòng tiêu đề: bảng theo dõi bản cũ không có 2 cột "Tổng đơn", "Hình thức vận chuyển" (sheet COST CONT có).
 * Chọn thứ tự cột nào mà Số cont / Ngày giao rơi đúng chỗ ở nhiều dòng hơn (bằng nhau thì theo COST CONT).
 */
function pickTrackingOrder(rows: string[][], order: PasteField[]): PasteField[] {
  const old = order.filter((k) => k !== "tong_don" && k !== "hinh_thuc");
  const score = (o: PasteField[]) => {
    const ci = o.indexOf("so_cont");
    const di = o.indexOf("ngay_giao");
    return rows.reduce(
      (n, r) => n + (/^[A-Z]{4}\s?\d{6,7}/i.test((r[ci] ?? "").trim()) ? 1 : 0) + (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test((r[di] ?? "").trim()) ? 1 : 0),
      0,
    );
  };
  return score(old) > score(order) ? old : order;
}

export type PasteRecord = Partial<Record<PasteField, string>>;

/** Dòng dữ liệu kèm vị trí dòng trong phần dán (để đối chiếu ô đọc từ ảnh chưa chắc) */
export function toRecordRows(rows: string[][], map: ColumnMap, headerRow: number | null): { src: number; rec: PasteRecord }[] {
  const out: { src: number; rec: PasteRecord }[] = [];
  rows.forEach((r, src) => {
    if (headerRow !== null && src <= headerRow) return;
    const rec: PasteRecord = {};
    map.forEach((f, i) => {
      if (f && r[i]) rec[f] = r[i];
    });
    // bỏ mảnh dòng thừa (ảnh chụp cắt ngang dòng trên: chỉ còn đuôi chữ của ô xuống dòng)
    if (rec.ma_hang || rec.so_luong || rec.so_cont || rec.so_xe || rec.ngay_giao) out.push({ src, rec });
  });
  return out;
}

export const toRecords = (rows: string[][], map: ColumnMap, headerRow: number | null): PasteRecord[] => toRecordRows(rows, map, headerRow).map((x) => x.rec);

// ---------------------------------------------------------------------------
// Đọc một dòng theo nghĩa (dùng chung cho mọi mẫu)
// ---------------------------------------------------------------------------

const nonEmpty = (xs: (string | undefined)[]) => xs.map((x) => (x ?? "").trim()).filter(Boolean);

/** Tên điểm nhận có thể có, theo thứ tự ưu tiên ghép */
export const pickupNames = (r: PasteRecord) => nonEmpty([r.diem_lay_cont, r.diem_di, r.kho_xuat]);
/** Tên điểm giao có thể có: theo dõi hàng → Điểm giao; chuyển kho → Điểm đến / Kho nhập; giao hàng → Mã / Tên KH nhận */
export const deliveryNames = (r: PasteRecord) => nonEmpty([r.diem_giao, r.diem_den, r.ma_kh_nhan, r.ten_kh_nhan, r.kho_nhap]);
/** Khi chưa ghép được: tên dễ đọc nhất để người dùng chọn tay */
export const deliveryDisplay = (r: PasteRecord) => nonEmpty([r.diem_giao, r.diem_den, r.ten_kh_nhan, r.kho_nhap, r.ma_kh_nhan])[0] ?? "";

/** Số cont: cột Số cont, hoặc cột Số xe khi giá trị có dạng số cont (Ecount ghi số cont vào Số xe) */
export function containerOf(r: PasteRecord): string {
  const c = normalizeContainer(r.so_cont);
  if (c) return c;
  const x = normalizeContainer(r.so_xe);
  // biển số xe bắt đầu bằng số (51C12345); số cont bắt đầu bằng chữ. Đọc ảnh có thể sai vài ký tự
  // (TEMU8427340 → TEXIU8427340) nên vẫn coi là số cont để báo lỗi số kiểm tra cho người dùng sửa
  return /^[A-Z]{4,6}\d{5,7}$/.test(x) && x.length >= 10 && x.length <= 12 ? x : "";
}

/** Hình thức giao (Pallet / Xá…): cột "Hình thức vận chuyển" của COST CONT, hoặc "Nhập/Xuất kiện" của Ecount */
export const deliveryMethodOf = (r: PasteRecord) => (r.hinh_thuc || (kienXaIsMethod(r.kien_xa) ? r.kien_xa : "") || "").trim().slice(0, 100);
/** Ô kiện/xá của Ecount là chữ (Kiện, Xá, Pallet) thì là hình thức giao; là số thì chỉ ghi chú */
const kienXaIsMethod = (v: string | undefined) => !!v && /[a-zA-ZÀ-ỹ]/.test(v) && !/^[\d.,\s]+$/.test(v);

/** Số tham chiếu để gộp đơn: số tờ khai / số phiếu chuyển kho / số phiếu giao hàng */
export const groupRef = (r: PasteRecord) => (r.so_to_khai || r.so_phieu || r.pxk || "").trim();

// ---------------------------------------------------------------------------
// Ghép tên với danh mục
// ---------------------------------------------------------------------------

export type CatalogEntry = { id: string; code: string | null; name: string };
export type AliasEntry = { alias: string; target_id: string };
export type MatchHow = "alias" | "code" | "name" | "core";
export type MatchResult =
  | { status: "ok"; id: string; how: MatchHow }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "none"; candidates: string[] }
  | { status: "empty" };

export type Matcher = (raw: string) => MatchResult;

function index<T>(list: T[], keys: (x: T) => (string | null | undefined)[]) {
  const m = new Map<string, Set<string>>();
  return {
    add(id: string, x: T) {
      for (const k of keys(x)) {
        if (!k) continue;
        const s = m.get(k) ?? new Set<string>();
        s.add(id);
        m.set(k, s);
      }
    },
    get: (k: string) => [...(m.get(k) ?? [])],
  };
}

/**
 * Thứ tự ghép: tên gọi khác đã lưu → mã → tên (bỏ dấu, bỏ ký tự đặc biệt) → tên bỏ chữ "Kho/Cảng/Bãi" ở đầu.
 * Chỉ nhận khi ra đúng MỘT kết quả; nhiều kết quả (VD "KHO SOTRAN" có cả cũ và mới) thì để người dùng chọn.
 * Không tự đoán theo "chứa chuỗi": chỉ đưa vào danh sách gợi ý.
 */
export function buildMatcher(list: CatalogEntry[], aliases: AliasEntry[] = [], opts: { core?: boolean } = {}): Matcher {
  const ids = new Set(list.map((x) => x.id));
  const byAlias = new Map<string, string>();
  for (const a of aliases) if (ids.has(a.target_id)) byAlias.set(matchKey(a.alias), a.target_id);
  const byCode = index(list, (x) => [x.code ? matchKey(x.code) : null]);
  const byName = index(list, (x) => [matchKey(x.name)]);
  const byCore = index(list, (x) => [coreKey(x.name), x.code ? coreKey(x.code) : null]);
  for (const x of list) {
    byCode.add(x.id, x);
    byName.add(x.id, x);
    if (opts.core) byCore.add(x.id, x);
  }
  const keyed = list.map((x) => ({ id: x.id, k: matchKey(x.name), c: coreKey(x.name) }));
  return (raw: string) => {
    const k = matchKey(raw ?? "");
    if (!k) return { status: "empty" };
    const a = byAlias.get(k);
    if (a) return { status: "ok", id: a, how: "alias" };
    for (const [how, hit] of [
      ["code", byCode.get(k)],
      ["name", byName.get(k)],
      ["core", opts.core ? byCore.get(coreKey(raw)) : []],
    ] as const) {
      if (hit.length === 1) return { status: "ok", id: hit[0], how };
      if (hit.length > 1) return { status: "ambiguous", candidates: hit };
    }
    const c = coreKey(raw);
    const sugg = c.length >= 3 ? keyed.filter((x) => x.k.includes(c) || x.c.includes(c) || (x.c.length >= 4 && c.includes(x.c))).map((x) => x.id) : [];
    return { status: "none", candidates: sugg.slice(0, 8) };
  };
}

// ---------------------------------------------------------------------------
// Đọc giá trị một dòng
// ---------------------------------------------------------------------------

export const isoDate = (v: string | undefined): string | null => {
  // ảnh chụp đôi khi mất dấu "/" (03/11/2026 → 03112026)
  const t = (v ?? "").trim();
  const d = parseDateVN(/^\d{8}$/.test(t) ? `${t.slice(0, 2)}/${t.slice(2, 4)}/${t.slice(4)}` : t || null);
  return d && d !== "invalid" ? d : null;
};

export function parseQty(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseNumberVN(v);
  return n === null || Number.isNaN(n) || n < 0 ? null : n;
}

/** Số cont: chữ hoa liền (MEDU 745068-2 → MEDU7450682) */
export const normalizeContainer = (v: string | undefined) => (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Số cont chuẩn ISO 6346: 4 chữ + 7 số (chữ số cuối là số kiểm tra) */
export function containerCheckOk(no: string): boolean {
  if (!/^[A-Z]{4}\d{7}$/.test(no)) return false;
  const val = (ch: string) => {
    if (/\d/.test(ch)) return Number(ch);
    let n = ch.charCodeAt(0) - 55; // A = 10
    n += Math.floor((n - 1) / 10); // bỏ 11, 22, 33
    return n;
  };
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += val(no[i]) * 2 ** i;
  return (sum % 11) % 10 === Number(no[10]);
}

/** Ô số dài bị Excel đổi sang dạng 1.08801E+11 */
export const looksScientific = (v: string | undefined) => !!v && /^\d+(\.\d+)?e\+\d+$/i.test(v.trim());

/** Tình trạng giao có vẻ đã giao xong */
export const looksDelivered = (v: string | undefined) => {
  const p = plain(v ?? "");
  return !!p && !/chua|cho|dang/.test(p) && /da giao|xong|hoan thanh|done/.test(p);
};

/** Ghi chú chuyến: gom các cột không có ô riêng trong phần mềm */
export function tripNote(r: PasteRecord): string {
  const d = (k: PasteField, label: string) => (r[k] ? `${label} ${r[k]}` : "");
  const tk = r.so_to_khai ? `Tờ khai ${r.so_to_khai}${r.ngay_khai ? ` ngày ${r.ngay_khai}` : ""}${r.luong_khai ? ` (luồng ${r.luong_khai})` : ""}` : "";
  const xe = r.so_xe && !containerOf({ so_xe: r.so_xe }) ? r.so_xe : "";
  return [
    tk,
    d("so_phieu", "Phiếu chuyển kho"),
    d("so_sto", "STO"),
    d("bct", "BCT"),
    d("ncc", "NCC"),
    r.ten_kh_nhan ? `Giao cho ${r.ten_kh_nhan}${r.ma_kh_nhan ? ` (${r.ma_kh_nhan})` : ""}` : "",
    d("kho_xuat", "Kho xuất"),
    d("kho_nhap", "Kho nhập"),
    r.hinh_thuc ? `Hình thức giao ${r.hinh_thuc}` : "",
    r.loai_cont ? `Cont ${r.loai_cont}${/^\d+$/.test(r.loai_cont) ? "'" : ""}` : "",
    d("pxk", "PXK"),
    d("tong_don", "Tổng đơn"),
    d("hang_tau", "Hãng tàu"),
    d("so_bill", "Bill"),
    r.hang_cam && !/^khong$/.test(plain(r.hang_cam)) ? `Hàng cầm: ${r.hang_cam}` : "",
    d("don_vi_vt", "ĐVVT"),
    r.kien_xa && !kienXaIsMethod(r.kien_xa) ? `Kiện/xá ${r.kien_xa}` : "",
    xe ? `Số xe ${xe}` : "",
    d("luu_bai", "Lưu bãi đến"),
    d("ngay_gia_han", "Gia hạn đến"),
    d("luu_cont", "Lưu cont đến"),
    d("phi_gia_han", "Phí gia hạn"),
    d("hd_gia_han", "HĐ gia hạn"),
    r.ghi_chu ?? "",
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 1000);
}

/** Khóa gộp đơn: cùng khách + cùng số tờ khai + cùng điểm giao + cùng ngày giao = một đơn nhiều cont */
export function orderGroupKey(p: { customerId: string; toKhai: string; deliveryId: string; date: string }, rowIdx: number, merge: boolean): string {
  const tk = matchKey(p.toKhai);
  return merge && tk ? [p.customerId, tk, p.deliveryId, p.date].join("|") : `#${rowIdx}`;
}
