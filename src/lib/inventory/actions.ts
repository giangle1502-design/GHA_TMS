"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { todayVN } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth/session";

const uuid = z.string().uuid();
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const voucherSchema = z
  .object({
    kind: z.enum(["opening", "receipt", "issue", "transfer"]),
    entry_date: z.string().regex(YMD, "Ngày không hợp lệ"),
    voucher_no: z.string().trim().max(50).optional().default(""),
    bin_id: uuid,
    to_bin_id: z.string().optional().default(""),
    ref_no: z.string().trim().max(100).optional().default(""),
    partner: z.string().trim().max(300).optional().default(""),
    notes: z.string().trim().max(1000).optional().default(""),
    shipment_id: z.string().optional().default(""),
    owner_customer_id: z.string().optional().default(""),
    lines: z
      .array(z.object({ product_id: uuid, quantity: z.number().positive("Số lượng phải lớn hơn 0").max(1e12) }))
      .min(1, "Phiếu chưa có mã hàng nào")
      .max(300),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "transfer" && !uuid.safeParse(d.to_bin_id).success) ctx.addIssue({ code: "custom", message: "Chọn vị trí chuyển tới" });
    if (d.kind === "transfer" && d.to_bin_id === d.bin_id) ctx.addIssue({ code: "custom", message: "Vị trí chuyển tới phải khác vị trí chuyển đi" });
  });

export type StockVoucherInput = z.input<typeof voucherSchema>;

/** Lập một phiếu kho nhiều mã hàng (cùng số phiếu). Trả về số phiếu. */
export async function createStockVoucher(input: StockVoucherInput): Promise<ActionResult<string>> {
  return runAction(async () => {
    await requirePermission("inventory.create");
    const parsed = voucherSchema.safeParse(input);
    if (!parsed.success) throw new ActionError(parsed.error.issues[0]?.message ?? "Dữ liệu chưa đúng");
    const { lines, ...h } = parsed.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_stock_voucher", {
      p_header: { ...h, to_bin_id: h.kind === "transfer" ? h.to_bin_id : "", shipment_id: uuid.safeParse(h.shipment_id).success ? h.shipment_id : "",
        owner_customer_id: uuid.safeParse(h.owner_customer_id).success ? h.owner_customer_id : "" },
      p_lines: lines,
    });
    if (error) throw error;
    revalidatePath("/kho");
    return String(data ?? "");
  });
}

/** Tồn hiện có của một vị trí đến ngày (để cảnh báo khi xuất quá tồn): { product_id: số lượng } */
export async function stockOnHand(binId: string, date?: string, ownerId?: string): Promise<ActionResult<Record<string, number>>> {
  return runAction(async () => {
    await requirePermission("inventory.view");
    if (!uuid.safeParse(binId).success) return {};
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("stock_balance_report", {
      p_from: "2000-01-01",
      p_to: date && YMD.test(date) ? date : todayVN(),
      p_bin_id: binId,
      p_customer_id: ownerId && uuid.safeParse(ownerId).success ? ownerId : null,
    });
    if (error) throw error;
    const out: Record<string, number> = {};
    for (const r of (data ?? []) as { product_id: string; closing_qty: number }[]) out[r.product_id] = (out[r.product_id] ?? 0) + Number(r.closing_qty);
    return out;
  });
}

export type StockCardLine = {
  entry_date: string;
  kind: string;
  voucher_no: string;
  qty_in: number;
  qty_out: number;
  balance: number;
  ref_no: string | null;
  partner: string | null;
  notes: string | null;
};

/** Thẻ kho: phát sinh của một mã hàng tại một vị trí (hoặc cả kho) trong kỳ, kèm tồn lũy kế */
export async function stockCard(input: { productId: string; binId?: string | null; warehouseId?: string | null; ownerId?: string | null; tu: string; den: string }): Promise<
  ActionResult<{ opening: number; lines: StockCardLine[] }>
> {
  return runAction(async () => {
    await requirePermission("inventory.view");
    if (!uuid.safeParse(input.productId).success || !YMD.test(input.tu) || !YMD.test(input.den)) throw new ActionError("Thiếu mã hàng hoặc kỳ báo cáo");
    const supabase = await createClient();
    const byBin = Boolean(input.binId);
    let binIds: string[] | null = null;
    if (byBin) binIds = [input.binId!];
    else if (input.warehouseId) {
      const { data } = await supabase.from("warehouse_bins").select("id").eq("warehouse_id", input.warehouseId);
      binIds = (data ?? []).map((r) => String(r.id));
    }
    let q = supabase
      .from("stock_moves")
      .select("entry_id, entry_date, kind, voucher_no, bin_id, qty_in, qty_out")
      .eq("product_id", input.productId)
      .lte("entry_date", input.den)
      .order("entry_date")
      .limit(20000);
    if (binIds) q = q.in("bin_id", binIds.length ? binIds : ["00000000-0000-0000-0000-000000000000"]);
    if (!byBin) q = q.neq("kind", "transfer");
    if (input.ownerId && uuid.safeParse(input.ownerId).success) q = q.eq("owner_customer_id", input.ownerId);
    else q = q.is("owner_customer_id", null);
    const { data, error } = await q;
    if (error) throw error;
    const moves = (data ?? []) as { entry_id: string; entry_date: string; kind: string; voucher_no: string; qty_in: number; qty_out: number }[];
    let opening = 0;
    const inPeriod = [];
    for (const m of moves) {
      if (m.entry_date < input.tu || m.kind === "opening") opening += Number(m.qty_in) - Number(m.qty_out);
      else inPeriod.push(m);
    }
    const ids = [...new Set(inPeriod.map((m) => m.entry_id))];
    const extra = new Map<string, { ref_no: string | null; partner: string | null; notes: string | null }>();
    if (ids.length) {
      const { data: es } = await supabase.from("stock_entries").select("id, ref_no, partner, notes").in("id", ids.slice(0, 1000));
      for (const e of (es ?? []) as { id: string; ref_no: string | null; partner: string | null; notes: string | null }[]) extra.set(e.id, e);
    }
    let bal = opening;
    const lines: StockCardLine[] = inPeriod.map((m) => {
      bal += Number(m.qty_in) - Number(m.qty_out);
      const x = extra.get(m.entry_id);
      return {
        entry_date: m.entry_date,
        kind: m.kind,
        voucher_no: m.voucher_no,
        qty_in: Number(m.qty_in),
        qty_out: Number(m.qty_out),
        balance: bal,
        ref_no: x?.ref_no ?? null,
        partner: x?.partner ?? null,
        notes: x?.notes ?? null,
      };
    });
    return { opening, lines };
  });
}

/** Ô "Kho GHA" trên đơn / chuyến: "" = theo địa điểm, "none" = không qua kho, "receipt:<vị trí>" / "issue:<vị trí>" (vị trí trống = chọn khi hoàn thành) */
export type StockTargetValue = string;
export type StockTargetOptions = {
  bins: { id: string; label: string }[];
  value: StockTargetValue;
  /** Chuyến: giá trị đang theo đơn hàng (chưa chọn riêng) */
  inherited?: boolean;
  /** Đơn hàng: ô Kho GHA đang có của từng chuyến (chuyến chưa chọn riêng thì theo đơn) */
  shipments?: Record<string, StockTargetValue>;
  /** Chuyến đi qua kho GHA (đã chọn nhập / xuất, hoặc địa điểm gắn với kho) nhưng chưa có vị trí */
  needsBin?: boolean;
  /** Chuyến đi qua kho GHA theo địa điểm (không chọn trên đơn) */
  viaLocation?: boolean;
};

const encode = (kind: string | null, bin: string | null) => (kind === "receipt" || kind === "issue" ? `${kind}:${bin ?? ""}` : kind === "none" ? "none" : "");
function decode(v: string): { kind: string | null; bin: string | null } {
  if (v === "none") return { kind: "none", bin: null };
  const m = /^(receipt|issue):(.*)$/.exec(v);
  if (!m) return { kind: null, bin: null };
  return { kind: m[1], bin: uuid.safeParse(m[2]).success ? m[2] : null };
}

/** Vị trí kho đang dùng (cho ô chọn); null khi không có quyền lập phiếu kho hoặc CSDL chưa nâng cấp 9026 */
export async function stockTargetOptions(input: { orderId?: string | null; shipmentId?: string | null }): Promise<ActionResult<StockTargetOptions | null>> {
  return runAction(async () => {
    const me = await getCurrentUser();
    if (!me || me.status !== "active" || !me.permissions.has("inventory.create")) return null;
    const supabase = await createClient();
    const binsRes = await supabase.from("warehouse_bins").select("id, code, name").eq("is_active", true).order("sort_order").order("code").limit(50);
    if (binsRes.error) return null;
    const bins = (binsRes.data ?? []).map((b) => ({ id: String(b.id), label: String(b.code) }));
    if (input.shipmentId && uuid.safeParse(input.shipmentId).success) {
      const { data, error } = await supabase
        .from("shipments")
        .select("stock_kind, stock_bin_id, transport_orders(stock_kind, stock_bin_id)")
        .eq("id", input.shipmentId)
        .maybeSingle();
      if (error || !data) return null;
      const o = (data as unknown as { transport_orders: { stock_kind: string | null; stock_bin_id: string | null } | null }).transport_orders;
      const own = data.stock_kind as string | null;
      const value = own ? encode(own, (data.stock_bin_id as string | null) ?? (own === o?.stock_kind ? (o?.stock_bin_id ?? null) : null)) : encode(o?.stock_kind ?? null, (data.stock_bin_id as string | null) ?? o?.stock_bin_id ?? null);
      const sug = await supabase.from("stock_shipment_suggestions").select("needs_bin").eq("shipment_id", input.shipmentId).maybeSingle();
      const viaLocation = !value && Boolean(sug.data);
      return { bins, value, inherited: !own, needsBin: Boolean(sug.data?.needs_bin), viaLocation };
    }
    if (input.orderId && uuid.safeParse(input.orderId).success) {
      const [{ data, error }, shipRes] = await Promise.all([
        supabase.from("transport_orders").select("stock_kind, stock_bin_id").eq("id", input.orderId).maybeSingle(),
        supabase.from("shipments").select("id, stock_kind, stock_bin_id").eq("order_id", input.orderId).limit(500),
      ]);
      if (error || shipRes.error) return null;
      const ok = (data?.stock_kind as string | null) ?? null;
      const ob = (data?.stock_bin_id as string | null) ?? null;
      const shipments: Record<string, string> = {};
      for (const x of (shipRes.data ?? []) as { id: string; stock_kind: string | null; stock_bin_id: string | null }[]) {
        shipments[x.id] = x.stock_kind ? encode(x.stock_kind, x.stock_bin_id ?? (x.stock_kind === ok ? ob : null)) : encode(ok, x.stock_bin_id ?? ob);
      }
      return { bins, value: encode(ok, ob), shipments };
    }
    // CSDL chưa chạy 9026 thì ẩn ô Kho GHA
    const probe = await supabase.from("transport_orders").select("stock_kind").limit(1);
    if (probe.error) return null;
    return { bins, value: "" };
  });
}

/** Lưu ô "Kho GHA" cho đơn hàng (orderId) hoặc riêng một chuyến (shipmentId) */
export async function setStockTarget(input: { orderId?: string | null; shipmentId?: string | null; value: StockTargetValue }): Promise<ActionResult<null>> {
  return runAction(async () => {
    await requirePermission("inventory.create");
    const orderId = input.orderId && uuid.safeParse(input.orderId).success ? input.orderId : null;
    const shipmentId = input.shipmentId && uuid.safeParse(input.shipmentId).success ? input.shipmentId : null;
    if (!orderId && !shipmentId) throw new ActionError("Thiếu đơn hàng hoặc chuyến");
    const { kind, bin } = decode(input.value);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_stock_target", { p_order_id: orderId, p_shipment_id: shipmentId, p_kind: kind, p_bin_id: bin });
    if (error) throw error;
    revalidatePath("/kho");
    return null;
  });
}
