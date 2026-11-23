/**
 * Tách thông tin từ chữ đọc được trên ảnh "Biên bản giao hàng" của khách (mẫu VAP, PLA…):
 * Ngày giao, Số phiếu (PXK), Số đơn hàng (SO), Công ty bán / mua (tên, địa chỉ, MST),
 * Đơn vị vận chuyển, Số xe, Thông tin tài xế và bảng hàng hóa (Mã hàng, Tên, ĐVT, Số lượng, Số bao).
 * Chữ đọc từ ảnh có thể sai dấu, lệch khoảng trắng: so nhãn theo chữ không dấu.
 */
import { plain } from "@/lib/paste-orders";

export type NoteParty = { name: string; address: string; taxCode: string };
export type NoteItem = { code: string; name: string; unit: string; quantity: number | null; bags: number | null };
export type ParsedDeliveryNote = {
  date: string | null; // YYYY-MM-DD
  voucherNo: string; // Số phiếu (PXK…)
  orderNo: string; // Số đơn hàng (SO…)
  seller: NoteParty;
  buyer: NoteParty;
  carrier: string;
  plate: string;
  driver: string;
  driverIdNo: string;
  items: NoteItem[];
  /** Tên các thông tin đọc được (để báo người dùng) */
  found: string[];
};

const emptyParty = (): NoteParty => ({ name: "", address: "", taxCode: "" });

/** "1,000" / "24.750" / "24,750.5" -> số; dấu , hoặc . theo sau đúng 3 chữ số là ngăn cách nghìn */
export function noteNumber(v: string | undefined): number | null {
  if (!v) return null;
  let s = v.replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  s = s.replace(/[.,](?=\d{3}(?:[.,]|$))/g, "");
  s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isoFrom(v: string): string | null {
  const m = /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})/.exec(v);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Giá trị sau dấu ":" (hoặc sau nhãn nếu ảnh mất dấu ":") */
function after(line: string, labelLen: number): string {
  const i = line.indexOf(":");
  const v = i >= 0 && i <= labelLen + 4 ? line.slice(i + 1) : line.slice(labelLen);
  return v.replace(/^[\s:;.]+/, "").trim();
}

const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9-]/g, "");

const LABELS: { key: string; re: RegExp }[] = [
  { key: "date", re: /^ngay giao\b/ },
  { key: "voucher", re: /^so phieu\b/ },
  { key: "order", re: /^so don hang\b/ },
  { key: "seller", re: /^cong ty ban\b/ },
  { key: "buyer", re: /^cong ty mua\b/ },
  { key: "address", re: /^dia chi\b/ },
  { key: "tax", re: /^ma so thue\b/ },
  { key: "carrier", re: /^don vi van chuyen\b/ },
  { key: "plate", re: /^so xe\b/ },
  { key: "driver", re: /^thong tin tai xe\b/ },
  { key: "items", re: /^thong tin hang hoa\b/ },
];

const UNITS = ["KG", "KGS", "TAN", "TON", "BAO", "CAI", "THUNG", "KIEN", "CUON", "TAM", "M3", "LIT"];

/** Một dòng hàng: "1 LDPE2426K Hạt nhựa nguyên sinh LDPE 2426K KG 1,000 40" */
function parseItemLine(line: string): NoteItem | null {
  const toks = line.replace(/[|]/g, " ").trim().split(/\s+/);
  if (toks.length < 3 || !/^\d{1,3}$/.test(toks[0])) return null;
  const uIdx = toks.findIndex((t, i) => i >= 2 && UNITS.includes(plain(t).toUpperCase().replace(/[^A-Z0-9]/g, "")));
  const code = cleanCode(toks[1]);
  if (!code) return null;
  if (uIdx >= 0) {
    const nums = toks.slice(uIdx + 1).map(noteNumber).filter((n): n is number => n !== null);
    return {
      code,
      name: toks.slice(2, uIdx).join(" ").trim(),
      unit: toks[uIdx].toUpperCase(),
      quantity: nums[0] ?? null,
      bags: nums[1] ?? null,
    };
  }
  // Không đọc được ĐVT: lấy các số ở cuối dòng
  const nums: number[] = [];
  let end = toks.length;
  while (end > 2 && nums.length < 2) {
    const n = noteNumber(toks[end - 1]);
    if (n === null) break;
    nums.unshift(n);
    end--;
  }
  if (!nums.length) return null;
  return { code, name: toks.slice(2, end).join(" ").trim(), unit: "", quantity: nums[0] ?? null, bags: nums[1] ?? null };
}

export function parseDeliveryNoteText(text: string): ParsedDeliveryNote {
  const out: ParsedDeliveryNote = {
    date: null,
    voucherNo: "",
    orderNo: "",
    seller: emptyParty(),
    buyer: emptyParty(),
    carrier: "",
    plate: "",
    driver: "",
    driverIdNo: "",
    items: [],
    found: [],
  };
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  let party: "seller" | "buyer" | null = null;
  let inItems = false;
  let last: NoteItem | null = null;

  for (const line of lines) {
    const p = plain(line).replace(/[^a-z0-9:/., -]/g, "").replace(/\s+/g, " ").trim();
    if (inItems) {
      if (/^tong cong\b/.test(p) || /^dai dien\b/.test(p)) {
        inItems = false;
        last = null;
        continue;
      }
      if (/^so thu\b|^tu\b|^ma hang\b|^stt\b/.test(p)) continue;
      const it = parseItemLine(line);
      if (it) {
        out.items.push(it);
        last = it;
      } else if (last && !/\d{3,}/.test(line) && line.length < 80) {
        // Tên hàng dài xuống dòng
        last.name = `${last.name} ${line}`.trim();
      }
      continue;
    }
    const lab = LABELS.find((l) => l.re.test(p));
    if (!lab) {
      // Bảng hàng không có tiêu đề "Thông tin hàng hóa" đọc được: dòng bắt đầu bằng STT + mã
      if (out.items.length === 0 && /^\d{1,2} [A-Z0-9]/.test(line) && /\b(KG|kg)\b/.test(line)) {
        const it = parseItemLine(line);
        if (it) {
          out.items.push(it);
          last = it;
          inItems = true;
        }
      }
      continue;
    }
    const m = lab.re.exec(p)!;
    const val = after(line, m[0].length);
    switch (lab.key) {
      case "date":
        out.date = isoFrom(val) ?? isoFrom(line);
        break;
      case "voucher":
        out.voucherNo = cleanCode(val.split(" ")[0] ?? "");
        break;
      case "order":
        out.orderNo = cleanCode(val.split(" ")[0] ?? "");
        break;
      case "seller":
      case "buyer":
        party = lab.key;
        out[party].name = val;
        break;
      case "address":
        if (party && !out[party].address) out[party].address = val;
        break;
      case "tax":
        if (party && !out[party].taxCode) out[party].taxCode = (val.match(/\d[\d-]{8,13}/)?.[0] ?? "").replace(/-$/, "");
        break;
      case "carrier":
        party = null;
        out.carrier = val;
        break;
      case "plate":
        out.plate = val.toUpperCase().replace(/\s+/g, "");
        break;
      case "driver": {
        const cccd = /(?:-|–)?\s*(?:cccd|cmnd|cmt)\s*:?\s*(\d{9,12})/i.exec(val);
        out.driverIdNo = cccd?.[1] ?? "";
        out.driver = (cccd ? val.slice(0, cccd.index) : val).replace(/[-–\s]+$/, "").trim();
        break;
      }
      case "items":
        party = null;
        inItems = true;
        break;
    }
  }

  const f = out.found;
  if (out.date) f.push("ngày giao");
  if (out.voucherNo) f.push("số phiếu");
  if (out.orderNo) f.push("số đơn hàng");
  if (out.seller.name) f.push("công ty bán");
  if (out.buyer.name) f.push("công ty mua");
  if (out.carrier) f.push("đơn vị vận chuyển");
  if (out.plate) f.push("số xe");
  if (out.driver) f.push("tài xế");
  if (out.items.length) f.push(`${out.items.length} dòng hàng`);
  return out;
}

/** Ghi chú đơn hàng từ phiếu: "SO… · PXK… · Vận chuyển LALAMOVE, xe 50E-51873, tài xế …" */
export function deliveryNoteSummary(p: ParsedDeliveryNote): string {
  const transport = [
    p.carrier && `Vận chuyển ${p.carrier}`,
    p.plate && `xe ${p.plate}`,
    p.driver && `tài xế ${p.driver}${p.driverIdNo ? ` (CCCD ${p.driverIdNo})` : ""}`,
  ]
    .filter(Boolean)
    .join(", ");
  return [p.orderNo && `Số đơn hàng ${p.orderNo}`, p.voucherNo && `Số phiếu ${p.voucherNo}`, transport].filter(Boolean).join(" · ");
}

/** Mức giống nhau của 2 địa chỉ (0–1): tỷ lệ từ (không dấu, bỏ từ chung chung) của địa chỉ trên phiếu có trong địa chỉ danh mục */
const STOP = new Set(["so", "duong", "phuong", "xa", "huyen", "quan", "tinh", "thanh", "pho", "tp", "p", "q", "tx", "kcn", "khu", "cong", "nghiep", "viet", "nam", "va", "tang", "toa", "nha", "ho", "chi", "minh", "hcm"]);
export function addressSimilarity(a: string, b: string): number {
  const words = (s: string) => plain(s).replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !STOP.has(w));
  const wa = [...new Set(words(a))];
  const wb = new Set(words(b));
  if (!wa.length || !wb.size) return 0;
  return wa.filter((w) => wb.has(w)).length / wa.length;
}
