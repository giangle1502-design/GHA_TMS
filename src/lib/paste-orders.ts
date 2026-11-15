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
  | "ghi_chu";

export type PasteColumn = { key: PasteField; label: string; aliases: string[] };

/** Cột theo đúng thứ tự bảng theo dõi của GHA (dán không kèm dòng tiêu đề thì hiểu theo thứ tự này) */
export const PASTE_COLUMNS: PasteColumn[] = [
  { key: "bct", label: "BCT", aliases: ["bct", "so bct", "bo chung tu"] },
  { key: "phap_nhan", label: "Pháp nhân", aliases: ["phap nhan", "khach hang", "cong ty", "ma kh"] },
  { key: "ncc", label: "NCC", aliases: ["ncc", "nha cung cap", "shipper"] },
  { key: "so_to_khai", label: "Số tờ khai", aliases: ["so to khai", "to khai", "tk", "so tk"] },
  { key: "ngay_khai", label: "Ngày khai", aliases: ["ngay khai", "ngay to khai", "ngay tk"] },
  { key: "luong_khai", label: "Luồng khai", aliases: ["luong khai", "luong", "phan luong"] },
  { key: "ma_hang", label: "Mã hàng", aliases: ["ma hang", "san pham", "hang hoa"] },
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
  { key: "ghi_chu", label: "Ghi chú", aliases: ["ghi chu", "note"] },
];
const DEFAULT_ORDER = PASTE_COLUMNS.filter((c) => c.key !== "ghi_chu").map((c) => c.key);

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
const GENERIC = /^(kho|cang|bai|ben|cty|congty|cong ty|nha may|depot|icd)\s+/;
export function coreKey(s: string): string {
  let p = plain(s).replace(/[^a-z0-9]+/g, " ").trim();
  for (let i = 0; i < 2; i++) p = p.replace(GENERIC, "");
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

/** Ghép một tiêu đề cột với trường; không nhận ra thì null */
export function headerField(h: string): PasteField | null {
  const k = matchKey(h);
  if (!k) return null;
  for (const c of PASTE_COLUMNS) if (matchKey(c.label) === k || c.aliases.some((a) => matchKey(a) === k)) return c.key;
  return null;
}

export type ColumnMap = (PasteField | null)[];

/**
 * Tìm dòng tiêu đề trong phần dán (dòng nhận ra từ 3 cột trở lên). Có tiêu đề: ghép theo tên cột.
 * Không có: hiểu theo thứ tự cột của bảng theo dõi GHA.
 */
export function detectColumns(rows: string[][]): { map: ColumnMap; headerRow: number | null } {
  for (let r = 0; r < Math.min(rows.length, 3); r++) {
    const used = new Set<PasteField>();
    const map: ColumnMap = rows[r].map((h) => {
      const f = headerField(h);
      if (!f || used.has(f)) return null;
      used.add(f);
      return f;
    });
    if (used.size >= 3) return { map, headerRow: r };
  }
  const width = Math.max(0, ...rows.map((r) => r.length));
  return { map: Array.from({ length: width }, (_, i) => DEFAULT_ORDER[i] ?? null), headerRow: null };
}

export type PasteRecord = Partial<Record<PasteField, string>>;

export function toRecords(rows: string[][], map: ColumnMap, headerRow: number | null): PasteRecord[] {
  return rows
    .filter((_, i) => headerRow === null || i > headerRow)
    .map((r) => {
      const rec: PasteRecord = {};
      map.forEach((f, i) => {
        if (f && r[i]) rec[f] = r[i];
      });
      return rec;
    })
    .filter((rec) => Object.keys(rec).length > 0);
}

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
  const d = parseDateVN(v ?? null);
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
  return [
    tk,
    d("bct", "BCT"),
    d("ncc", "NCC"),
    r.loai_cont ? `Cont ${r.loai_cont}${/^\d+$/.test(r.loai_cont) ? "'" : ""}` : "",
    d("pxk", "PXK"),
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
