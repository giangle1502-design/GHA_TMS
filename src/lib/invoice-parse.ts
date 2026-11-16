/**
 * Tách thông tin hóa đơn GTGT / hóa đơn bán hàng từ chữ đọc được trên ảnh (OCR) để điền Chi phí ngoài chuyến.
 * Chạy ở trình duyệt; ảnh không được lưu. Mọi số trả về là gợi ý, người dùng kiểm tra trước khi lưu.
 * Không đặt trong tệp "use client" (có kiểm thử).
 */

export type ParsedInvoice = {
  invoice_date: string | null; // YYYY-MM-DD
  invoice_no: string | null;
  invoice_symbol: string | null; // Ký hiệu (VD C26MAV)
  seller_name: string | null;
  seller_tax_code: string | null;
  buyer_name: string | null; // tên đơn vị mua (hóa đơn GHA xuất cho khách)
  buyer_tax_code: string | null;
  /** MST của GHA nằm ở phần người bán: đây là hóa đơn GHA xuất (bán ra) */
  gha_is_seller: boolean;
  /** MST của GHA nằm ở phần người mua: hóa đơn nhà cung cấp xuất cho GHA (mua vào) */
  gha_is_buyer: boolean;
  description: string | null; // tên hàng (VD Xăng E10 RON 95)
  quantity: number | null;
  unit_price: number | null;
  amount: number | null; // tiền chưa thuế
  vat_rate: number | null; // KKKNT / KCT -> 0
  vat_label: string | null; // "10%", "KKKNT"…
  vat_amount: number | null;
  total: number | null;
  is_fuel: boolean;
  found: string[]; // tên các trường đọc được
};

/** Bỏ dấu, chữ thường, gộp khoảng trắng */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const MONEY_RE = /\d{1,3}(?:[.,]\d{3})+(?![.,]?\d)|\d{4,}(?![.,]?\d)/g;
/** "500.000" / "500,000" / "500000" -> 500000 */
export function parseMoney(tok: string): number {
  return Number(tok.replace(/[^\d]/g, "")) || 0;
}
function moneys(line: string): number[] {
  return (line.match(MONEY_RE) ?? []).map(parseMoney);
}

/**
 * Số tiền đi kèm nhãn: ưu tiên dòng có số NGAY SAU nhãn (lấy số cuối), rồi mới tới dòng kế tiếp của dòng nhãn đầu tiên.
 * zeroOk: nhận cả "0" (tiền thuế bằng 0).
 */
function labelAmount(lines: string[], fl: string[], re: RegExp, zeroOk = false): number | null {
  const hits: number[] = [];
  for (let i = 0; i < fl.length; i++) {
    const m = re.exec(fl[i]);
    if (!m) continue;
    hits.push(i);
    // vị trí trên dòng gốc ~ vị trí trên dòng bỏ dấu (cùng số ký tự sau khi gộp khoảng trắng)
    const after = lines[i].slice(Math.min(lines[i].length, m.index + m[0].length));
    const ms = moneys(after);
    if (ms.length) return ms[ms.length - 1];
    if (zeroOk && /(^|[^\d.,])0(?![\d.,])/.test(after)) return 0;
  }
  if (hits.length) {
    const ms = moneys(lines[hits[0] + 1] ?? "");
    if (ms.length) return ms[ms.length - 1];
  }
  return null;
}

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

const BUYER_TAX = "3703489735"; // MST GHA (bên mua)

export function parseInvoiceText(text: string): ParsedInvoice {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[|]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const fl = lines.map(fold);
  const out: ParsedInvoice = {
    invoice_date: null,
    invoice_no: null,
    invoice_symbol: null,
    seller_name: null,
    seller_tax_code: null,
    buyer_name: null,
    buyer_tax_code: null,
    gha_is_seller: false,
    gha_is_buyer: false,
    description: null,
    quantity: null,
    unit_price: null,
    amount: null,
    vat_rate: null,
    vat_label: null,
    vat_amount: null,
    total: null,
    is_fuel: false,
    found: [],
  };
  const find = (re: RegExp, from = 0) => fl.findIndex((l, i) => i >= from && re.test(l));

  // Ngày lập: "Ngày 27 tháng 07 năm 2026" (OCR có thể đọc sai chữ: chỉ cần 3 số)
  for (const l of fl) {
    const m = /ngay\D{0,4}(\d{1,2})\D{1,12}?(\d{1,2})\D{1,12}?(20\d{2})/.exec(l) ?? /\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b/.exec(l);
    if (m) {
      const d = Number(m[1]);
      const mo = Number(m[2]);
      if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
        out.invoice_date = `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        break;
      }
    }
  }

  // Ký hiệu, số hóa đơn
  for (let i = 0; i < lines.length; i++) {
    const sym = /ky hieu\s*(?:\([^)]*\))?\s*[:.]?\s*([a-z0-9]{4,10})\b/.exec(fl[i]);
    if (sym && !out.invoice_symbol) out.invoice_symbol = sym[1].toUpperCase();
    const no = /(?:^|\s)so(?: hoa don)?\s*(?:\([^)]*\))?\s*[:.]\s*0*(\d{1,8})\b/.exec(fl[i]);
    if (no && !out.invoice_no && !/so (thue|tai khoan|ho chieu|bang ke|dien thoai|luong)/.test(fl[i])) out.invoice_no = no[1].padStart(1, "0");
  }

  // Người bán và MST người bán (trước phần người mua)
  const iSeller = find(/(ten )?(nguoi ban|don vi ban)( hang)?\s*:/);
  const iBuyer = find(/(ten )?(nguoi mua|don vi mua)( hang)?\s*:/);
  if (iSeller >= 0) {
    const v = lines[iSeller].split(/:/).slice(1).join(":").trim().replace(/[.:;,]+$/, "");
    if (v) out.seller_name = v;
  }
  const taxIn = (from: number, to: number) => {
    for (let i = Math.max(0, from); i < (to < 0 ? lines.length : to); i++) {
      if (!/(ma so thue|mst)/.test(fl[i])) continue;
      const m = /(\d[\d\s-]{8,16}\d)/.exec(lines[i].split(/:/).slice(1).join(":") || lines[i]);
      const code = m?.[1].replace(/[\s]/g, "");
      if (code && code.replace(/\D/g, "").length >= 10 && code.replace(/\D/g, "") !== BUYER_TAX) return code;
    }
    return null;
  };
  out.seller_tax_code = taxIn(iSeller >= 0 ? iSeller : 0, iBuyer > iSeller ? iBuyer : -1) ?? taxIn(0, -1);
  const hasGha = (from: number, to: number) => lines.slice(Math.max(0, from), to).some((l) => l.replace(/\D/g, "").includes(BUYER_TAX));
  if (iBuyer >= 0) {
    out.gha_is_seller = hasGha(0, iBuyer);
    out.gha_is_buyer = hasGha(iBuyer, iBuyer + 8);
    // Tên đơn vị mua: "Tên đơn vị: …" (ưu tiên) hoặc "Đơn vị mua hàng: …" / "Họ tên người mua hàng: …"
    const valueOf = (i: number) => lines[i].split(/:/).slice(1).join(":").trim().replace(/[.:;,]+$/, "");
    const win = fl.slice(iBuyer, iBuyer + 6);
    const iUnit = win.findIndex((l) => /(ten don vi|don vi mua( hang)?|ten cong ty)\s*:/.test(l));
    const name = iUnit >= 0 ? valueOf(iBuyer + iUnit) : valueOf(iBuyer);
    if (name) out.buyer_name = name;
    for (let i = iBuyer; i < Math.min(lines.length, iBuyer + 8); i++) {
      if (!/(ma so thue|mst)/.test(fl[i])) continue;
      const m = /(\d[\d\s-]{8,16}\d)/.exec(lines[i].split(/:/).slice(1).join(":") || lines[i]);
      const code = m?.[1].replace(/\s/g, "");
      if (code && code.replace(/\D/g, "").length >= 10) {
        out.buyer_tax_code = code;
        break;
      }
    }
  }

  // Tổng tiền
  out.total = labelAmount(lines, fl, /tong (cong )?(tien )?(thanh toan|cong tien thanh toan)(?! bang chu)/);
  out.amount = labelAmount(lines, fl, /(tong tien chua (co )?thue|cong tien hang|tong tien hang)( \([^)]*\))?/);
  out.vat_amount = labelAmount(lines, fl, /(tong )?tien thue( gtgt| vat)?( \([^)]*\))?(?! suat)/, true);

  // Thuế suất
  const all = fl.join("\n");
  if (/\bkkknt\b|khong ke khai/.test(all)) [out.vat_rate, out.vat_label] = [0, "KKKNT"];
  else if (/\bkct\b|khong chiu thue/.test(all)) [out.vat_rate, out.vat_label] = [0, "KCT"];
  else {
    const iRate = find(/thue suat/);
    const scope = iRate >= 0 ? fl.slice(iRate, iRate + 6).join(" ") : all;
    const m = /\b(0|5|8|10)\s*%/.exec(scope) ?? /\b(0|5|8|10)\s*%/.exec(all);
    if (m) [out.vat_rate, out.vat_label] = [Number(m[1]), `${m[1]}%`];
  }

  // Hàng hóa: xăng dầu
  const iItem = find(/\b(xang|dau|diesel|do 0[,.]0|ron ?9[25]|e[15]0? ?ron|nhot)\b/, iBuyer >= 0 ? iBuyer : 0);
  out.is_fuel = /\b(xang|dau do|diesel|ron ?9[25]|e[15]0?\b)/.test(all);
  if (iItem >= 0) {
    const raw = lines[iItem];
    // Tên hàng: từ chữ "Xăng/Dầu…" đến trước đơn vị tính hoặc số lượng
    const start = raw.search(/x[aă]ng|d[aầ]u|diesel|nh[oớ]t/i);
    let desc = start >= 0 ? raw.slice(start) : "";
    const cut = desc.search(/\s(l[ií]t|lit)\b|\s\d{1,5}[.,]\d{1,3}(\s|$)|\s\d{4,}|\s\[|,\s|\s\S{1,3},/i);
    if (cut > 0) desc = desc.slice(0, cut);
    out.description = desc.replace(/\s+/g, " ").trim().slice(0, 80) || null;
    // số lít dạng 23,33 và đơn giá dạng 21.430 trên dòng hàng (và 2 dòng kế)
    const near = lines.slice(iItem, iItem + 3).join(" ");
    const prices = moneys(near).filter((p) => p >= 5000 && p <= 100000);
    const amt = out.amount ?? (out.total !== null && out.vat_amount !== null ? out.total - out.vat_amount : out.total);
    for (const p of prices) {
      if (amt && amt / p >= 0.5 && amt / p <= 5000) {
        out.unit_price = p;
        break;
      }
    }
    // Số lượng có phần thập phân (VN dùng dấu phẩy): 23,33 ; nhận khi khớp đơn giá × số lượng ≈ thành tiền
    for (const tok of near.split(/\s+/)) {
      if (!/^\d{1,5}[.,]\d{1,3}$/.test(tok)) continue;
      const q = Number(tok.replace(",", "."));
      if (q <= 0 || (tok.includes(".") && /\.\d{3}$/.test(tok))) continue; // 21.430 là số nghìn
      if (!out.unit_price || !amt || Math.abs(q * out.unit_price - amt) <= amt * 0.02) {
        out.quantity = q;
        break;
      }
    }
    if (!out.quantity && out.unit_price && amt) out.quantity = Math.round((amt / out.unit_price) * 100) / 100;
  }

  // Suy ra số còn thiếu
  if (out.amount === null && out.total !== null) {
    if (out.vat_amount !== null) out.amount = out.total - out.vat_amount;
    else if (out.vat_rate !== null) out.amount = Math.round(out.total / (1 + out.vat_rate / 100));
  }
  if (out.vat_amount === null && out.amount !== null && out.total !== null) out.vat_amount = out.total - out.amount;
  if (out.total === null && out.amount !== null) out.total = out.amount + (out.vat_amount ?? 0);
  if (out.vat_rate === null && out.amount && out.vat_amount !== null) {
    const r = Math.round((out.vat_amount / out.amount) * 100);
    if ([0, 5, 8, 10].includes(r)) [out.vat_rate, out.vat_label] = [r, `${r}%`];
  }

  const names: [keyof ParsedInvoice, string][] = [
    ["invoice_date", "ngày"],
    ["invoice_no", "số hóa đơn"],
    ["seller_name", "người bán"],
    ["seller_tax_code", "MST người bán"],
    ["buyer_name", "người mua"],
    ["quantity", "số lít"],
    ["unit_price", "đơn giá"],
    ["amount", "tiền chưa thuế"],
    ["vat_rate", "thuế suất"],
    ["total", "tổng tiền"],
  ];
  out.found = names.filter(([k]) => out[k] !== null && out[k] !== "").map(([, n]) => n);
  return out;
}

/** Giá trị biểu mẫu (định dạng như ô nhập) từ hóa đơn đọc được; chỉ trả các trường đọc được */
export function invoiceToFormValues(p: ParsedInvoice, currentNotes: string): Record<string, unknown> {
  const v: Record<string, unknown> = { has_invoice: true };
  if (p.invoice_date) {
    v.expense_date = p.invoice_date;
    v.invoice_date = p.invoice_date;
  }
  if (p.invoice_no) v.invoice_no = p.invoice_no;
  if (p.seller_name) v.seller_name = p.seller_name;
  if (p.description) v.description = p.description;
  if (p.quantity !== null) v.quantity = String(p.quantity);
  if (p.unit_price !== null) v.unit_price = fmt(p.unit_price);
  if (p.amount !== null) v.amount = fmt(p.amount);
  if (p.vat_rate !== null && [0, 5, 8, 10].includes(p.vat_rate)) v.vat_rate = String(p.vat_rate);
  const extra = [
    p.invoice_symbol ? `Ký hiệu HĐ ${p.invoice_symbol}` : "",
    p.seller_tax_code ? `MST người bán ${p.seller_tax_code}` : "",
    p.vat_label && p.vat_rate === 0 && p.vat_label !== "0%" ? `Thuế suất ${p.vat_label}` : "",
  ].filter(Boolean);
  if (extra.length) {
    const add = extra.filter((e) => !currentNotes.includes(e)).join(" · ");
    if (add) v.notes = currentNotes ? `${currentNotes} · ${add}` : add;
  }
  return v;
}


/**
 * Giá trị biểu mẫu Sổ hóa đơn (bán ra / mua vào) từ hóa đơn đọc được.
 * Bán ra: đối tác là người mua (khách); mua vào: đối tác là người bán. Tiền thuế lấy đúng số ghi trên hóa đơn.
 */
export function invoiceToTaxInvoiceValues(p: ParsedInvoice, dir: "sale" | "purchase", currentNotes: string): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  if (p.invoice_date) v.invoice_date = p.invoice_date;
  if (p.invoice_symbol) v.invoice_symbol = p.invoice_symbol;
  if (p.invoice_no) v.invoice_no = p.invoice_no;
  const name = dir === "sale" ? p.buyer_name : p.seller_name;
  const tax = dir === "sale" ? (p.buyer_tax_code !== BUYER_TAX ? p.buyer_tax_code : null) : p.seller_tax_code;
  if (name) v.partner_name = name;
  if (tax) v.partner_tax_code = tax;
  if (p.description) v.description = p.quantity !== null && p.is_fuel ? `${p.description}, ${fmt(p.quantity).replace(".", ",")} lít` : p.description;
  if (p.amount !== null) v.amount = fmt(p.amount);
  if (p.vat_label === "KKKNT" || p.vat_label === "KCT") v.vat_rate = p.vat_label;
  else if (p.vat_rate !== null && [0, 5, 8, 10].includes(p.vat_rate)) v.vat_rate = String(p.vat_rate);
  if (p.vat_amount !== null) v.vat_amount = fmt(p.vat_amount);
  if (p.unit_price !== null && p.is_fuel) {
    const add = `Đơn giá ${fmt(p.unit_price)} đ/lít`;
    if (!currentNotes.includes(add)) v.notes = currentNotes ? `${currentNotes} · ${add}` : add;
  }
  return v;
}

/** Ảnh dán vào có vẻ thuộc sổ kia (GHA là người bán mà đang nhập mua vào, hoặc ngược lại) */
export function invoiceDirectionHint(p: ParsedInvoice, dir: "sale" | "purchase"): string | null {
  if (dir === "purchase" && p.gha_is_seller && !p.gha_is_buyer) return "Hóa đơn này do GHA xuất (GHA là người bán): nên nhập ở Hóa đơn bán ra.";
  if (dir === "sale" && p.gha_is_buyer && !p.gha_is_seller) return "Hóa đơn này GHA là người mua: nên nhập ở Hóa đơn mua vào.";
  return null;
}
