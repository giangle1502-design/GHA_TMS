"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { DRIVER_LINK_COOKIE, DRIVER_LINK_MAX_AGE, anonClient, driverLinkToken, normalizePlate } from "@/lib/driver-link/server";

type Result = { ok: true } | { ok: false; error: string };
type RpcResult = { ok: boolean; error?: string; token?: string; expired?: boolean };

export async function openByPlate(plate: string): Promise<Result> {
  const p = normalizePlate(String(plate ?? ""));
  if (p.length < 5) return { ok: false, error: "Nhập đủ biển số xe, ví dụ 61K31295." };
  const { data, error } = await anonClient().rpc("driver_link_login", { p_plate: p });
  if (error) return { ok: false, error: "Không kết nối được máy chủ, vui lòng thử lại." };
  const r = data as RpcResult;
  if (!r.ok || !r.token) return { ok: false, error: r.error ?? "Không mở được." };
  (await cookies()).set(DRIVER_LINK_COOKIE, r.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/tx",
    maxAge: DRIVER_LINK_MAX_AGE,
  });
  revalidatePath("/tx");
  return { ok: true };
}

export async function acceptTrip(shipmentId: string): Promise<Result> {
  if (!z.uuid().safeParse(shipmentId).success) return { ok: false, error: "Chuyến không hợp lệ." };
  const token = await driverLinkToken();
  if (!token) return { ok: false, error: "Phiên đã hết hạn. Vui lòng nhập lại số xe." };
  const { data, error } = await anonClient().rpc("driver_link_accept", { p_token: token, p_shipment_id: shipmentId });
  if (error) return { ok: false, error: "Không kết nối được máy chủ, vui lòng thử lại." };
  const r = data as RpcResult;
  revalidatePath("/tx");
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Không nhận được chuyến." };
}

export async function changeVehicle(): Promise<void> {
  const token = await driverLinkToken();
  if (token) await anonClient().rpc("driver_link_logout", { p_token: token });
  (await cookies()).delete({ name: DRIVER_LINK_COOKIE, path: "/tx" });
  revalidatePath("/tx");
}

const NET_ERROR = "Không kết nối được máy chủ, vui lòng thử lại.";
const optUuid = z.uuid().nullable().optional();

async function callRpc(fn: string, args: Record<string, unknown>, fallback: string): Promise<RpcResult & { ticket?: string; code?: string }> {
  const token = await driverLinkToken();
  if (!token) return { ok: false, error: "Phiên đã hết hạn. Vui lòng nhập lại số xe.", expired: true };
  const { data, error } = await anonClient().rpc(fn, { p_token: token, ...args });
  if (error) return { ok: false, error: NET_ERROR };
  const r = data as RpcResult & { ticket?: string; code?: string };
  return r.ok ? r : { ...r, error: r.error ?? fallback };
}

/** Vé tải ảnh (hết hạn sau 2 giờ, tối đa 10 tệp) */
export async function requestUploadTicket(shipmentId: string | null, purpose: "delivery" | "expense"): Promise<{ ok: true; ticket: string } | { ok: false; error: string }> {
  if (!optUuid.safeParse(shipmentId).success || !["delivery", "expense"].includes(purpose)) return { ok: false, error: "Dữ liệu không hợp lệ." };
  const r = await callRpc("driver_link_upload_ticket", { p_shipment_id: shipmentId, p_purpose: purpose }, "Không gửi được ảnh.");
  return r.ok && r.ticket ? { ok: true, ticket: r.ticket } : { ok: false, error: r.error ?? "Không gửi được ảnh." };
}

export async function startTrip(shipmentId: string): Promise<Result> {
  if (!z.uuid().safeParse(shipmentId).success) return { ok: false, error: "Chuyến không hợp lệ." };
  const r = await callRpc("driver_link_start", { p_shipment_id: shipmentId }, "Không bắt đầu được chuyến.");
  revalidatePath("/tx");
  return r.ok ? { ok: true } : { ok: false, error: r.error! };
}

const completeSchema = z.object({
  shipmentId: z.uuid(),
  ticket: z.uuid().nullable(),
  result: z.enum(["full", "partial", "failed"]),
  note: z.string().max(500).optional(),
  noExpense: z.boolean(),
});

export async function completeTrip(input: z.input<typeof completeSchema>): Promise<Result> {
  const p = completeSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Dữ liệu không hợp lệ." };
  const r = await callRpc(
    "driver_link_complete",
    { p_shipment_id: p.data.shipmentId, p_ticket: p.data.ticket, p_result: p.data.result, p_note: p.data.note ?? null, p_no_expense: p.data.noExpense },
    "Không hoàn thành được chuyến.",
  );
  // Không revalidatePath ở đây: làm mới ngay sẽ gỡ thẻ chuyến khi hộp thoại hoàn thành còn mở (kẹt màn hình).
  // Màn hình tài xế tự làm mới sau khi đóng hộp thoại (trang /tx luôn đọc dữ liệu mới).
  return r.ok ? { ok: true } : { ok: false, error: r.error! };
}

const expenseSchema = z.object({
  shipmentId: z.uuid("Chọn chuyến."),
  categoryId: z.uuid("Chọn loại chi phí."),
  amount: z.number().positive("Nhập số tiền.").max(1_000_000_000),
  note: z.string().max(500).optional(),
  ticket: z.uuid().nullable(),
  clientRequestId: z.uuid(),
});

export async function addExpense(input: z.input<typeof expenseSchema>): Promise<Result & { needsApproval?: boolean }> {
  const p = expenseSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };
  const r = await callRpc(
    "driver_link_add_expense",
    {
      p_shipment_id: p.data.shipmentId,
      p_category_id: p.data.categoryId,
      p_amount: p.data.amount,
      p_note: p.data.note ?? null,
      p_ticket: p.data.ticket,
      p_client_request_id: p.data.clientRequestId,
    },
    "Không lưu được chi phí.",
  );
  // Nơi gọi tự router.refresh() khi gửi xong (xem completeTrip)
  return r.ok ? { ok: true, needsApproval: (r as { needs_approval?: boolean }).needs_approval } : { ok: false, error: r.error! };
}

/** Gửi thêm ảnh phiếu chi phí sau khi hoàn thành chuyến (văn phòng nhập chi phí theo phiếu) */
export async function addExpenseSheet(input: { shipmentId: string; ticket: string }): Promise<Result> {
  if (!z.uuid().safeParse(input.shipmentId).success || !z.uuid().safeParse(input.ticket).success) return { ok: false, error: "Dữ liệu không hợp lệ." };
  const r = await callRpc("driver_link_add_sheet", { p_shipment_id: input.shipmentId, p_ticket: input.ticket }, "Không gửi được phiếu chi phí.");
  return r.ok ? { ok: true } : { ok: false, error: r.error! };
}
