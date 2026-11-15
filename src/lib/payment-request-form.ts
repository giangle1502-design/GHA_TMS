/** Giấy đề nghị thanh toán / đề nghị tạm ứng (GHA 9011). Không đặt trong tệp "use client". */

export type PaymentFormType = "payment" | "advance";

export type PaymentFormItem = { content: string; invoice_no: string; invoice_date: string; amount: number };

export type PaymentFormData = {
  id?: string;
  code?: string;
  form_type: PaymentFormType;
  form_date: string;
  recipient: string;
  requester_name: string;
  department: string;
  content: string;
  amount: number;
  advance_amount: number;
  due_date: string;
  payment_method: "cash" | "transfer";
  bank_account_no: string;
  bank_name: string;
  account_holder: string;
  attachment_count: number | null;
  items: PaymentFormItem[];
  overhead_ids: string[];
  notes: string;
};

export const FORM_TITLES: Record<PaymentFormType, string> = {
  payment: "GIẤY ĐỀ NGHỊ THANH TOÁN",
  advance: "GIẤY ĐỀ NGHỊ TẠM ỨNG",
};

export const DEFAULT_RECIPIENT = "Giám đốc Công ty TNHH GHA Logistics & Service";

export function blankForm(type: PaymentFormType, today: string): PaymentFormData {
  return {
    form_type: type,
    form_date: today,
    recipient: DEFAULT_RECIPIENT,
    requester_name: "",
    department: "",
    content: "",
    amount: 0,
    advance_amount: 0,
    due_date: "",
    payment_method: "cash",
    bank_account_no: "",
    bank_name: "",
    account_holder: "",
    attachment_count: null,
    items: [],
    overhead_ids: [],
    notes: "",
  };
}

/** Tổng tiền: thanh toán có danh sách khoản thì cộng các khoản, không thì lấy số nhập tay */
export function formTotal(d: Pick<PaymentFormData, "form_type" | "items" | "amount">): number {
  if (d.form_type === "payment" && d.items.length) return d.items.reduce((a, i) => a + (Number(i.amount) || 0), 0);
  return Number(d.amount) || 0;
}

const DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

/** Đọc một nhóm 3 chữ số. full = có nhóm đứng trước (phải đọc "không trăm", "lẻ") */
function readTriple(n: number, full: boolean): string {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const u = n % 10;
  const out: string[] = [];
  if (h > 0 || full) out.push(`${DIGITS[h]} trăm`);
  if (t > 1) {
    out.push(`${DIGITS[t]} mươi`);
    if (u === 1) out.push("mốt");
    else if (u === 4) out.push("tư");
    else if (u === 5) out.push("lăm");
    else if (u > 0) out.push(DIGITS[u]);
  } else if (t === 1) {
    out.push("mười");
    if (u === 5) out.push("lăm");
    else if (u > 0) out.push(DIGITS[u]);
  } else if (u > 0) {
    if (h > 0 || full) out.push("lẻ");
    out.push(DIGITS[u]);
  }
  return out.join(" ");
}

function readBelowBillion(n: number, full: boolean): string {
  const groups: [number, string][] = [
    [Math.floor(n / 1_000_000), " triệu"],
    [Math.floor((n % 1_000_000) / 1000), " nghìn"],
    [n % 1000, ""],
  ];
  const out: string[] = [];
  let lead = full;
  for (const [g, unit] of groups) {
    if (g === 0) continue;
    out.push(readTriple(g, lead) + unit);
    lead = true;
  }
  return out.join(" ");
}

function readNumber(n: number): string {
  if (n >= 1_000_000_000) {
    const lo = n % 1_000_000_000;
    return `${readNumber(Math.floor(n / 1_000_000_000))} tỷ${lo ? ` ${readBelowBillion(lo, true)}` : ""}`;
  }
  return readBelowBillion(n, false);
}

/** 1.250.000 -> "Một triệu hai trăm năm mươi nghìn đồng" */
export function numberToVietnameseWords(value: number): string {
  const n = Math.round(Math.abs(Number(value) || 0));
  if (n === 0) return "Không đồng";
  const s = readNumber(n).replace(/\s+/g, " ").trim();
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} đồng${value < 0 ? " (âm)" : ""}`;
}

export function formFileName(d: Pick<PaymentFormData, "form_type" | "code" | "form_date">) {
  const base = d.form_type === "advance" ? "De-nghi-tam-ung" : "De-nghi-thanh-toan";
  return `${base}-${(d.code || d.form_date).replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`;
}
