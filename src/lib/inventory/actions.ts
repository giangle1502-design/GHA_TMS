"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { todayVN } from "@/lib/format";

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
      p_header: { ...h, to_bin_id: h.kind === "transfer" ? h.to_bin_id : "", shipment_id: uuid.safeParse(h.shipment_id).success ? h.shipment_id : "" },
      p_lines: lines,
    });
    if (error) throw error;
    revalidatePath("/kho");
    return String(data ?? "");
  });
}

/** Tồn hiện có của một vị trí đến ngày (để cảnh báo khi xuất quá tồn): { product_id: số lượng } */
export async function stockOnHand(binId: string, date?: string): Promise<ActionResult<Record<string, number>>> {
  return runAction(async () => {
    await requirePermission("inventory.view");
    if (!uuid.safeParse(binId).success) return {};
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("stock_balance_report", {
      p_from: "2000-01-01",
      p_to: date && YMD.test(date) ? date : todayVN(),
      p_bin_id: binId,
    });
    if (error) throw error;
    const out: Record<string, number> = {};
    for (const r of (data ?? []) as { product_id: string; closing_qty: number }[]) out[r.product_id] = Number(r.closing_qty);
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
export async function stockCard(input: { productId: string; binId?: string | null; warehouseId?: string | null; tu: string; den: string }): Promise<
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
