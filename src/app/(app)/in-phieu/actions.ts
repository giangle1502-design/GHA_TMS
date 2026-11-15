"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { formTotal } from "@/lib/payment-request-form";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ");
const optYmd = z.union([ymd, z.literal("")]);
const money = z.number().finite().nonnegative().max(1e13);

const formSchema = z.object({
  id: z.string().uuid().optional(),
  form_type: z.enum(["payment", "advance"]),
  form_date: ymd,
  recipient: z.string().max(300),
  requester_name: z.string().trim().min(1, "Nhập họ tên người đề nghị").max(150),
  department: z.string().max(200),
  content: z.string().max(2000),
  amount: money,
  advance_amount: money,
  due_date: optYmd,
  payment_method: z.enum(["cash", "transfer"]),
  bank_account_no: z.string().max(50),
  bank_name: z.string().max(200),
  account_holder: z.string().max(150),
  attachment_count: z.number().int().nonnegative().max(9999).nullable(),
  items: z
    .array(z.object({ content: z.string().max(500), invoice_no: z.string().max(100), invoice_date: optYmd, amount: money }))
    .max(200),
  overhead_ids: z.array(z.string().uuid()).max(500),
  notes: z.string().max(1000),
});

const nul = (s: string) => (s.trim() ? s.trim() : null);

/** Lưu (thêm mới hoặc sửa) giấy đề nghị thanh toán / tạm ứng. Trả về id và số phiếu. */
export async function savePaymentForm(input: z.input<typeof formSchema>): Promise<ActionResult<{ id: string; code: string }>> {
  return runAction(async () => {
    const d = formSchema.parse(input);
    await requirePermission(d.id ? "overhead.update" : "overhead.create", "overhead.create");
    const supabase = await createClient();
    const items = d.form_type === "payment" ? d.items.filter((i) => i.content.trim() || i.amount) : [];
    const row = {
      form_type: d.form_type,
      form_date: d.form_date,
      recipient: nul(d.recipient),
      requester_name: d.requester_name.trim(),
      department: nul(d.department),
      content: nul(d.content),
      amount: formTotal({ form_type: d.form_type, items, amount: d.amount }),
      advance_amount: d.form_type === "payment" ? d.advance_amount : 0,
      due_date: d.form_type === "advance" && d.due_date ? d.due_date : null,
      payment_method: d.payment_method,
      bank_account_no: d.payment_method === "transfer" ? nul(d.bank_account_no) : null,
      bank_name: d.payment_method === "transfer" ? nul(d.bank_name) : null,
      account_holder: d.payment_method === "transfer" ? nul(d.account_holder) : null,
      attachment_count: d.attachment_count,
      items: items.map((i) => ({ ...i, content: i.content.trim(), invoice_no: i.invoice_no.trim() })),
      overhead_ids: d.form_type === "payment" ? d.overhead_ids : [],
      notes: nul(d.notes),
    };
    const q = d.id
      ? supabase.from("payment_request_forms").update(row).eq("id", d.id).select("id, code").single()
      : supabase.from("payment_request_forms").insert(row).select("id, code").single();
    const { data, error } = await q;
    if (error) throw error;
    revalidatePath("/in-phieu");
    return data as { id: string; code: string };
  }, "Đã lưu phiếu.");
}

export async function deletePaymentForm(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("overhead.delete");
    const supabase = await createClient();
    const { error, count } = await supabase.from("payment_request_forms").delete({ count: "exact" }).eq("id", z.string().uuid().parse(id));
    if (error) throw error;
    if (!count) throw new Error("Không xóa được phiếu.");
    revalidatePath("/in-phieu");
  }, "Đã xóa phiếu.");
}

export type OverheadPick = {
  id: string;
  code: string;
  expense_date: string;
  category_name: string;
  plate_number: string | null;
  description: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  total_amount: number;
  paid_by: string;
  payment_status: string;
  spender_name: string | null;
};

const pickSchema = z.object({ from: ymd, to: ymd, onlyUnpaid: z.boolean() });

/** Các khoản chi ngoài chuyến để đưa vào giấy đề nghị thanh toán */
export async function listOverheadForForm(input: z.input<typeof pickSchema>): Promise<ActionResult<OverheadPick[]>> {
  return runAction(async () => {
    await requirePermission("overhead.view");
    const d = pickSchema.parse(input);
    const supabase = await createClient();
    let q = supabase
      .from("overhead_expenses")
      .select("id, code, expense_date, description, invoice_no, invoice_date, total_amount, paid_by, payment_status, spender_name, overhead_categories(name), vehicles(plate_number)")
      .gte("expense_date", d.from)
      .lte("expense_date", d.to)
      .order("expense_date")
      .limit(1000);
    if (d.onlyUnpaid) q = q.eq("payment_status", "unpaid");
    const { data, error } = await q;
    if (error) throw error;
    type Raw = Omit<OverheadPick, "category_name" | "plate_number"> & {
      overhead_categories: { name: string } | null;
      vehicles: { plate_number: string } | null;
    };
    return ((data ?? []) as unknown as Raw[]).map(({ overhead_categories, vehicles, ...r }) => ({
      ...r,
      total_amount: Number(r.total_amount),
      category_name: overhead_categories?.name ?? "",
      plate_number: vehicles?.plate_number ?? null,
    }));
  });
}

/** Sau khi chi tiền theo phiếu: đánh dấu các khoản chi ngoài chuyến của phiếu là đã thanh toán */
export async function markOverheadPaid(input: { ids: string[]; date: string }): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("overhead.update");
    const ids = z.array(z.string().uuid()).min(1).max(500).parse(input.ids);
    const date = ymd.parse(input.date);
    const supabase = await createClient();
    const { error } = await supabase.from("overhead_expenses").update({ payment_status: "paid", paid_date: date }).in("id", ids);
    if (error) throw error;
    revalidatePath("/chi-phi-ngoai");
  }, "Đã đánh dấu các khoản là đã thanh toán.");
}
