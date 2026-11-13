"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";

const uuid = z.uuid("Giá trị không hợp lệ");
const optNum = z.number().nonnegative().max(1_000_000_000_000).nullable().optional();

const lineSchema = z.object({
  kind: z.enum(["freight", "pass_through", "other"]),
  feeTypeId: uuid.nullable().optional(),
  description: z.string().max(200).optional(),
  quantity: optNum,
  unitPrice: optNum,
  amount: optNum,
  refNo: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

const costsSchema = z.object({
  shipmentId: uuid,
  supplierId: uuid.nullable(),
  invoiceNo: z.string().max(100).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  lines: z.array(lineSchema).max(100, "Tối đa 100 khoản"),
});

function refresh(shipmentId?: string) {
  if (shipmentId) revalidatePath(`/chuyen-xe/${shipmentId}`);
  revalidatePath("/thue-ngoai");
  revalidatePath("/cong-no");
  revalidatePath("/bao-cao");
}

/** Lưu cước, chi hộ, chi phí khác phải trả nhà xe 3PL của chuyến; tự lập/cập nhật công nợ phải trả */
export async function saveCarrierCosts(input: z.input<typeof costsSchema>): Promise<ActionResult<{ total: number; payable_code: string | null }>> {
  return runAction(async () => {
    await requirePermission("dispatch.update", "shipments.update", "receivables.create");
    const p = costsSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const d = p.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("set_shipment_carrier_costs", {
      p_shipment_id: d.shipmentId,
      p_supplier_id: d.supplierId,
      p_lines: d.lines.map((l) => ({
        kind: l.kind,
        fee_type_id: l.feeTypeId ?? null,
        description: l.description?.trim() || null,
        quantity: l.quantity ?? null,
        unit_price: l.unitPrice ?? null,
        amount: l.amount ?? null,
        ref_no: l.refNo?.trim() || null,
        note: l.note?.trim() || null,
      })),
      p_invoice_no: d.invoiceNo?.trim() || null,
      p_due_date: d.dueDate ?? null,
    });
    if (error) throw error;
    refresh(d.shipmentId);
    const r = data as { total: number; payable_code: string | null };
    return { total: Number(r.total), payable_code: r.payable_code };
  }, "Đã lưu chi phí 3PL của chuyến.");
}

export type OpenCarrierPayable = {
  payable_id: string;
  payable_code: string;
  shipment_code: string;
  report_date: string;
  plate_number: string | null;
  carrier_total: number;
  remaining_amount: number;
  due_date: string | null;
  overdue_days: number;
};

/** Các chuyến còn nợ của một nhà xe (để trả gộp) */
export async function listOpenCarrierPayables(supplierId: string): Promise<ActionResult<OpenCarrierPayable[]>> {
  return runAction(async () => {
    await requirePermission("receivables.pay");
    const id = uuid.parse(supplierId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("report_carrier_trips")
      .select("payable_id, payable_code, shipment_code, report_date, plate_number, carrier_total, remaining_amount, due_date, overdue_days")
      .eq("supplier_id", id)
      .in("pay_status", ["unpaid", "partial"])
      .order("report_date")
      .limit(500);
    if (error) throw error;
    return (data ?? []) as OpenCarrierPayable[];
  });
}

const bulkSchema = z.object({
  payableIds: z.array(uuid).min(1, "Chọn ít nhất một chuyến").max(500),
  paymentMethodId: uuid.optional(),
  bankAccountId: uuid.optional(),
  referenceNo: z.string().max(100).optional(),
  paidAt: z.string().optional(),
  note: z.string().max(1000).optional(),
});

/** Trả đủ số còn nợ của nhiều chuyến cùng một nhà xe (mỗi chuyến một phiếu chi, cùng số giao dịch) */
export async function payCarrierPayables(input: z.input<typeof bulkSchema>): Promise<ActionResult<{ count: number; total: number }>> {
  return runAction(async () => {
    await requirePermission("receivables.pay");
    const p = bulkSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const d = p.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("pay_carrier_payables", {
      p_payable_ids: d.payableIds,
      p_payment_method_id: d.paymentMethodId ?? null,
      p_company_bank_account_id: d.bankAccountId ?? null,
      p_reference_no: d.referenceNo ?? null,
      p_paid_at: d.paidAt ? new Date(d.paidAt).toISOString() : null,
      p_note: d.note ?? null,
    });
    if (error) throw error;
    refresh();
    const r = data as { count: number; total: number };
    return { count: Number(r.count), total: Number(r.total) };
  });
}
