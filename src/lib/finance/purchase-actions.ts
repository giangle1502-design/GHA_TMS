"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { moduleCustomFields, splitCustom, validateRecord } from "@/lib/entities/record";
import { loadCustomFields, visibleCustomRows } from "@/lib/entities/server";

const uuid = z.uuid("Giá trị không hợp lệ");

function refresh() {
  revalidatePath("/de-nghi");
  revalidatePath("/phe-duyet");
  revalidatePath("/cong-no");
  revalidatePath("/bao-cao");
}

const itemSchema = z.object({
  name: z.string().trim().max(200),
  qty: z.number().positive("Số lượng phải lớn hơn 0").max(1_000_000_000).nullable().optional(),
  unit: z.string().trim().max(30).optional(),
  price: z.number().min(0, "Đơn giá không âm").max(1_000_000_000_000).nullable().optional(),
});

const createSchema = z.object({
  typeId: z.uuid("Chọn loại đề nghị"),
  title: z.string().trim().min(1, "Nhập nội dung đề nghị").max(300),
  amount: z.number().positive("Số tiền phải lớn hơn 0").max(1_000_000_000_000).optional(),
  items: z.array(itemSchema).max(100).optional(),
  neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  supplierId: uuid.optional(),
  payee: z.string().max(200).optional(),
  note: z.string().max(1000).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
  clientRequestId: uuid,
});

/** Lập phiếu đề nghị: gửi Giám đốc duyệt ngay */
export async function createPurchaseRequest(input: z.input<typeof createSchema>): Promise<ActionResult<string>> {
  return runAction(async () => {
    const me = await requirePermission("purchase_requests.create");
    const d = createSchema.parse(input);
    const items = (d.items ?? []).filter((i) => i.name.trim() || (i.price ?? 0) > 0);
    if (items.some((i) => !i.name.trim())) throw new ActionError("Nhập tên hàng hóa / hạng mục cho từng dòng");
    if (!items.length && !d.amount) throw new ActionError("Nhập số tiền đề nghị hoặc danh sách hàng hóa");
    const supabase = await createClient();
    const rows = visibleCustomRows(await loadCustomFields(supabase, "purchase_requests"), me.permissions);
    const fields = moduleCustomFields("purchase_requests", rows, me.permissions).filter((f) => !f.readOnly && f.type !== "formula");
    let custom: Record<string, unknown> = {};
    if (fields.length) {
      const { data, errors } = validateRecord(fields, d.custom ?? {});
      const first = Object.values(errors)[0];
      if (first) throw new ActionError(first);
      custom = splitCustom(fields, data).custom;
    }
    const { data, error } = await supabase.rpc("create_purchase_request", {
      p_type_id: d.typeId,
      p_title: d.title,
      p_amount: d.amount ?? null,
      p_items: items.map((i) => ({ name: i.name.trim(), qty: i.qty ?? 1, unit: i.unit?.trim() || null, price: i.price ?? 0 })),
      p_needed_by: d.neededBy ?? null,
      p_supplier_id: d.supplierId ?? null,
      p_payee: d.payee?.trim() || null,
      p_note: d.note?.trim() || null,
      p_custom: custom,
      p_client_request_id: d.clientRequestId,
    });
    if (error) throw error;
    refresh();
    return data as string;
  }, "Đã gửi phiếu đề nghị cho Giám đốc duyệt");
}

const reasonSchema = z.object({ id: uuid, reason: z.string().trim().min(1, "Nhập lý do").max(500) });

export async function cancelPurchaseRequest(input: z.input<typeof reasonSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("purchase_requests.create", "purchase_requests.delete");
    const d = reasonSchema.parse(input);
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_purchase_request", { p_id: d.id, p_reason: d.reason });
    if (error) throw error;
    refresh();
  }, "Đã hủy phiếu đề nghị");
}

const paySchema = z.object({
  id: uuid,
  amount: z.number().positive("Số tiền chi phải lớn hơn 0").max(1_000_000_000_000),
  paymentMethodId: uuid.optional(),
  bankAccountId: uuid.optional(),
  referenceNo: z.string().max(100).optional(),
  paidAt: z.string().optional(),
  note: z.string().max(1000).optional(),
});

/** Kế toán ghi nhận đã chi tiền (một lần hoặc nhiều lần, tối đa số đã duyệt) */
export async function payPurchaseRequest(input: z.input<typeof paySchema>): Promise<ActionResult<string>> {
  return runAction(async () => {
    await requirePermission("purchase_requests.pay");
    const d = paySchema.parse(input);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("pay_purchase_request", {
      p_id: d.id,
      p_amount: d.amount,
      p_payment_method_id: d.paymentMethodId ?? null,
      p_company_bank_account_id: d.bankAccountId ?? null,
      p_reference_no: d.referenceNo ?? null,
      p_paid_at: d.paidAt ? new Date(d.paidAt).toISOString() : null,
      p_note: d.note ?? null,
    });
    if (error) throw error;
    refresh();
    return data as string;
  }, "Đã ghi nhận chi tiền");
}

const completeSchema = z.object({ id: uuid, note: z.string().max(500).optional() });

export async function completePurchaseRequest(input: z.input<typeof completeSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("purchase_requests.pay");
    const d = completeSchema.parse(input);
    const supabase = await createClient();
    const { error } = await supabase.rpc("complete_purchase_request", { p_id: d.id, p_note: d.note?.trim() || null });
    if (error) throw error;
    refresh();
  }, "Đã hoàn tất phiếu đề nghị");
}

export type PurchaseHistoryItem = { acted_at: string; action: string; actor_name: string | null; comment: string | null };

/** Lịch sử gửi, duyệt, chi tiền của một phiếu */
export async function purchaseRequestHistory(id: string): Promise<ActionResult<PurchaseHistoryItem[]>> {
  return runAction(async () => {
    await requirePermission();
    const pid = uuid.parse(id);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("purchase_request_history", { p_id: pid });
    if (error) throw error;
    return (data ?? []) as PurchaseHistoryItem[];
  });
}

/** Một phiếu (theo quyền xem của người dùng), dùng cho nút Xem phiếu ở màn hình Phê duyệt */
export async function getPurchaseRequest(id: string): Promise<ActionResult<Record<string, unknown> | null>> {
  return runAction(async () => {
    await requirePermission();
    const pid = uuid.parse(id);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("purchase_request_list")
      .select("id, code, type_name, title, items, amount_requested, amount_approved, amount_to_pay, paid_amount, remaining_amount, requester_name, payee, status")
      .eq("id", pid)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new ActionError("Không tìm thấy phiếu hoặc bạn không có quyền xem");
    return data as Record<string, unknown>;
  });
}
