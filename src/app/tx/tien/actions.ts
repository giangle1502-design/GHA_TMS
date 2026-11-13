"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// Trang tiền của tài xế: theo tài khoản Google đã đăng nhập (CSDL nhận ra tài xế qua hồ sơ), không theo biển số xe.
type Result = { ok: true } | { ok: false; error: string };
type RpcResult = { ok: boolean; error?: string; ticket?: string; code?: string };

const NET_ERROR = "Không kết nối được máy chủ, vui lòng thử lại.";

async function callMe(fn: string, args: Record<string, unknown>, fallback: string): Promise<RpcResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: error.code === "42501" ? "Vui lòng đăng nhập Google lại." : NET_ERROR };
  const r = data as RpcResult;
  return r.ok ? r : { ...r, error: r.error ?? fallback };
}

function done(r: RpcResult): Result {
  revalidatePath("/tx");
  revalidatePath("/tx/tien");
  return r.ok ? { ok: true } : { ok: false, error: r.error! };
}

const advanceSchema = z.object({
  amount: z.number().positive().max(1_000_000_000),
  reason: z.string().trim().min(1, "Nhập lý do ứng tiền.").max(500),
  shipmentId: z.uuid().nullable(),
  clientRequestId: z.uuid(),
});

export async function requestAdvance(input: z.input<typeof advanceSchema>): Promise<Result> {
  const p = advanceSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  return done(
    await callMe(
      "driver_me_request_advance",
      { p_amount: p.data.amount, p_reason: p.data.reason, p_shipment_id: p.data.shipmentId, p_client_request_id: p.data.clientRequestId },
      "Không gửi được yêu cầu ứng tiền.",
    ),
  );
}

export async function cancelRequest(kind: "advance" | "expense", id: string): Promise<Result> {
  if (!["advance", "expense"].includes(kind) || !z.uuid().safeParse(id).success) return { ok: false, error: "Dữ liệu không hợp lệ." };
  return done(await callMe("driver_me_cancel", { p_kind: kind, p_id: id }, "Không hủy được."));
}

/** Vé tải ảnh hóa đơn khi sửa một khoản chi phí */
export async function requestExpenseTicket(expenseId: string): Promise<{ ok: true; ticket: string } | { ok: false; error: string }> {
  if (!z.uuid().safeParse(expenseId).success) return { ok: false, error: "Dữ liệu không hợp lệ." };
  const r = await callMe("driver_me_upload_ticket", { p_expense_id: expenseId }, "Không gửi được ảnh.");
  return r.ok && r.ticket ? { ok: true, ticket: r.ticket } : { ok: false, error: r.error ?? "Không gửi được ảnh." };
}

const updateExpenseSchema = z.object({
  expenseId: z.uuid(),
  categoryId: z.uuid("Chọn loại chi phí."),
  amount: z.number().positive("Nhập số tiền.").max(1_000_000_000),
  note: z.string().max(500).optional(),
  ticket: z.uuid().nullable(),
});

/** Sửa khoản chi phí chưa duyệt: máy chủ hủy khoản cũ và tạo khoản mới */
export async function updateExpense(input: z.input<typeof updateExpenseSchema>): Promise<Result> {
  const p = updateExpenseSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  return done(
    await callMe(
      "driver_me_update_expense",
      { p_expense_id: p.data.expenseId, p_category_id: p.data.categoryId, p_amount: p.data.amount, p_note: p.data.note ?? null, p_ticket: p.data.ticket },
      "Không sửa được chi phí.",
    ),
  );
}

/** Đăng xuất tài khoản Google trên điện thoại tài xế (link biển số vẫn giữ) */
export async function signOutDriver() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/tx/tien");
}
