"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { matchKey } from "@/lib/paste-orders";
import { addressSimilarity } from "@/lib/delivery-note-parse";

type Supa = Awaited<ReturnType<typeof createClient>>;

export type NoteLocation = { id: string; label: string; address: string; score: number; how: "tax" | "alias" | "name" | "similar" };
export type NoteMatch = {
  customer: { id: string; label: string } | null;
  /** Điểm giao gợi ý, xếp theo mức giống địa chỉ trên phiếu */
  locations: NoteLocation[];
  /** Điểm giao tự chọn (chỉ khi chắc chắn: đúng MST, tên gọi khác đã lưu, hoặc tên + địa chỉ khớp) */
  autoLocationId: string | null;
  /** Mã hàng trên phiếu -> mã hàng trong danh mục (đúng mã, không phân biệt hoa thường / ký tự đặc biệt) */
  products: Record<string, { code: string; name: string; unit: string | null }>;
  /** Đơn đã có cùng số đơn hàng / số phiếu (chưa hủy) */
  duplicates: { orderId: string; orderCode: string; why: string }[];
};

const input = z.object({
  sellerName: z.string().max(300),
  sellerTax: z.string().max(20),
  buyerName: z.string().max(300),
  buyerAddress: z.string().max(500),
  buyerTax: z.string().max(20),
  itemCodes: z.array(z.string().max(100)).max(50),
  orderNo: z.string().max(100),
  voucherNo: z.string().max(100),
});

/** Bỏ ký tự có thể làm hỏng bộ lọc tìm kiếm của PostgREST */
const safe = (s: string) => s.replace(/[%,()*\\"':]/g, " ").replace(/\s+/g, " ").trim();
/** Tên công ty bỏ phần "Công ty TNHH / Cổ phần / XNK…" để tìm trong danh mục */
const GENERIC = /\b(cong ty|cty|tnhh|mtv|co phan|cp|xuat nhap khau|xnk|thuong mai|dich vu|san xuat|tm|dv|sx|mot thanh vien)\b/g;
function nameCore(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(GENERIC, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type Loc = { id: string; code: string; name: string; company_name: string | null; full_address: string | null; tax_code: string | null };
type Cus = { id: string; code: string | null; name: string; tax_code: string | null };

/** Đọc hết dòng đang hoạt động (máy chủ trả tối đa 1,000 dòng mỗi lần) */
async function loadAll<T>(sb: Supa, table: "customers" | "locations", cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < 50; p++) {
    const { data, error } = await sb.from(table).select(cols).eq("status", "active").order("id").range(p * 1000, p * 1000 + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function aliasTargets(sb: Supa, kind: "customer" | "location", name: string): Promise<string[]> {
  const key = matchKey(name).slice(0, 300);
  if (!key) return [];
  const r = await sb.from("name_aliases").select("target_id").eq("kind", kind).eq("alias_key", key).limit(5);
  return r.error ? [] : (r.data ?? []).map((a) => a.target_id as string);
}

/** Cùng tên: khóa tên (bỏ dấu, ký tự đặc biệt) bằng nhau, hoặc phần tên riêng (bỏ "Công ty TNHH…") bằng / chứa nhau */
function sameName(raw: string, ...names: (string | null | undefined)[]): boolean {
  const k = matchKey(raw);
  const c = nameCore(raw).replace(/ /g, "");
  if (!k || c.length < 3) return false;
  return names.some((n) => {
    if (!n) return false;
    if (matchKey(n) === k) return true;
    const nc = nameCore(n).replace(/ /g, "");
    return nc.length >= 3 && (nc === c || nc.includes(c) || (nc.length >= 5 && c.includes(nc)));
  });
}

async function findCustomer(sb: Supa, name: string, tax: string) {
  const list = await loadAll<Cus>(sb, "customers", "id, code, name, tax_code");
  const one = (xs: Cus[]) => (xs.length === 1 ? { id: xs[0].id, label: xs[0].name } : null);
  if (tax) {
    const r = one(list.filter((c) => (c.tax_code ?? "").replace(/\D/g, "") === tax.replace(/\D/g, "")));
    if (r) return r;
  }
  const al = await aliasTargets(sb, "customer", name);
  const r = one(list.filter((c) => al.includes(c.id)));
  if (r) return r;
  return one(list.filter((c) => sameName(name, c.name)));
}

async function findLocations(sb: Supa, name: string, address: string, tax: string): Promise<{ list: NoteLocation[]; auto: string | null }> {
  const all = await loadAll<Loc>(sb, "locations", "id, code, name, company_name, full_address, tax_code");
  const found = new Map<string, NoteLocation>();
  const add = (l: Loc, how: NoteLocation["how"]) => {
    if (found.has(l.id)) return;
    found.set(l.id, { id: l.id, label: l.name, address: l.full_address ?? "", score: address ? addressSimilarity(address, l.full_address ?? "") : 0, how });
  };
  const t = tax.replace(/\D/g, "");
  if (t.length >= 9) for (const l of all) if ((l.tax_code ?? "").replace(/\D/g, "") === t) add(l, "tax");
  const al = await aliasTargets(sb, "location", name);
  for (const l of all) if (al.includes(l.id)) add(l, "alias");
  if (name.trim()) for (const l of all) if (sameName(name, l.name, l.company_name)) add(l, "name");
  const list = [...found.values()].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "vi")).slice(0, 10);
  // Tự chọn khi chắc chắn: một kết quả theo MST / tên gọi khác, hoặc một kết quả cùng tên mà địa chỉ giống phần lớn
  const sure = list.filter((l) => l.how === "tax" || l.how === "alias");
  let auto: string | null = sure.length === 1 ? sure[0].id : null;
  if (!auto && !sure.length) {
    const close = list.filter((l) => l.score >= 0.6);
    if (close.length === 1) auto = close[0].id;
  }
  return { list, auto };
}

/** Ghép thông tin đọc từ ảnh biên bản giao hàng với danh mục. KHÔNG thêm gì vào danh mục. */
export async function matchDeliveryNote(raw: z.input<typeof input>): Promise<ActionResult<NoteMatch>> {
  return runAction(async () => {
    await requirePermission("dispatch.create");
    const d = input.parse(raw);
    const sb = await createClient();
    const [customer, loc] = await Promise.all([
      findCustomer(sb, d.sellerName, d.sellerTax.trim()),
      findLocations(sb, d.buyerName, d.buyerAddress, d.buyerTax.trim()),
    ]);

    const products: NoteMatch["products"] = {};
    const codes = [...new Set(d.itemCodes.map((c) => c.trim()).filter(Boolean))];
    if (codes.length) {
      const { data } = await sb.from("products").select("code, name, unit").eq("status", "active").limit(10000);
      const byKey = new Map(((data ?? []) as { code: string; name: string; unit: string | null }[]).map((p) => [matchKey(p.code), p]));
      for (const c of codes) {
        const p = byKey.get(matchKey(c));
        if (p) products[c] = p;
      }
    }

    const duplicates: NoteMatch["duplicates"] = [];
    const refs = [d.orderNo, d.voucherNo].map((s) => safe(s)).filter((s) => s.length >= 4);
    if (refs.length) {
      const or = refs.flatMap((r) => [`ref_no.ilike.%${r}%`, `voucher_no.ilike.%${r}%`, `notes.ilike.%${r}%`]).join(",");
      const { data } = await sb.from("transport_orders").select("id, order_code, status, ref_no, voucher_no, notes").or(or).neq("status", "cancelled").limit(10);
      for (const o of data ?? []) {
        const text = [o.ref_no, o.voucher_no, o.notes].filter(Boolean).join(" ").toUpperCase();
        const why = refs.filter((r) => text.includes(r.toUpperCase())).join(", ");
        duplicates.push({ orderId: o.id as string, orderCode: o.order_code as string, why });
      }
    }
    return { customer, locations: loc.list, autoLocationId: loc.auto, products, duplicates };
  });
}
