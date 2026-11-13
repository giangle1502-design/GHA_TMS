"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { moduleCustomFields, splitCustom, validateRecord } from "@/lib/entities/record";
import { loadCustomFields, visibleCustomRows } from "@/lib/entities/server";

const uuid = z.uuid("Giá trị không hợp lệ");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Chọn ngày");

function refresh() {
  revalidatePath("/nghi-phep");
  revalidatePath("/phe-duyet");
  revalidatePath("/khach-hang");
}

const leaveSchema = z
  .object({
    leaveType: z.enum(["annual", "sick", "unpaid", "other"], { error: "Chọn loại nghỉ" }),
    startDate: day,
    endDate: day,
    days: z.number({ error: "Nhập số ngày nghỉ" }).positive("Số ngày nghỉ phải lớn hơn 0").max(366),
    reason: z.string().trim().max(1000).optional(),
    handoverNote: z.string().trim().max(2000).optional(),
    handovers: z
      .array(
        z.object({
          customerId: uuid.optional().nullable(),
          task: z.string().trim().max(1000).optional().nullable(),
          receiverId: uuid,
        }),
      )
      .max(200),
    custom: z.record(z.string(), z.unknown()).optional(),
    clientRequestId: uuid,
  })
  .refine((d) => d.endDate >= d.startDate, { message: "Ngày kết thúc phải từ ngày bắt đầu trở đi" });

export async function createLeave(input: z.input<typeof leaveSchema>): Promise<ActionResult<string>> {
  return runAction(async () => {
    const me = await requirePermission();
    const d = leaveSchema.parse(input);
    for (const h of d.handovers) {
      if (!h.customerId && !h.task?.trim()) throw new ActionError("Mỗi dòng bàn giao phải chọn khách hàng hoặc ghi công việc");
    }
    const supabase = await createClient();
    const rows = visibleCustomRows(await loadCustomFields(supabase, "leaves"), me.permissions);
    const fields = moduleCustomFields("leaves", rows, me.permissions).filter((f) => !f.readOnly && f.type !== "formula");
    let custom: Record<string, unknown> = {};
    if (fields.length) {
      const { data, errors } = validateRecord(fields, d.custom ?? {});
      const first = Object.values(errors)[0];
      if (first) throw new ActionError(first);
      custom = splitCustom(fields, data).custom;
    }
    const { data, error } = await supabase.rpc("create_leave_request", {
      p_leave_type: d.leaveType,
      p_start_date: d.startDate,
      p_end_date: d.endDate,
      p_days: d.days,
      p_reason: d.reason || null,
      p_handover_note: d.handoverNote || null,
      p_handovers: d.handovers.map((h) => ({ customer_id: h.customerId ?? null, task: h.task?.trim() || null, receiver_id: h.receiverId })),
      p_custom: custom,
      p_client_request_id: d.clientRequestId,
    });
    if (error) throw error;
    refresh();
    return data as string;
  }, "Đã gửi đơn xin nghỉ cho Giám đốc duyệt");
}

export async function cancelLeave(input: { id: string; reason?: string }): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission();
    const d = z.object({ id: uuid, reason: z.string().trim().max(500).optional() }).parse(input);
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_leave_request", { p_id: d.id, p_reason: d.reason || null });
    if (error) throw error;
    refresh();
  }, "Đã hủy đơn xin nghỉ");
}

export async function acceptHandover(input: { id: string; note?: string; all?: boolean }): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requirePermission();
    const d = z.object({ id: uuid, note: z.string().trim().max(1000).optional(), all: z.boolean().optional() }).parse(input);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("accept_leave_handover", { p_handover_id: d.id, p_note: d.note || null, p_all: d.all ?? false });
    if (error) throw error;
    refresh();
    return data as number;
  }, "Đã nhận bàn giao");
}

export type LeaveHandoverRow = {
  id: string;
  customer_name: string | null;
  customer_code: string | null;
  task: string | null;
  receiver_name: string | null;
  status: string;
  accepted_at: string | null;
  receiver_note: string | null;
};

/** Các dòng bàn giao của một đơn (hiện trong hộp xem đơn) */
export async function loadLeaveHandovers(leaveId: string): Promise<ActionResult<LeaveHandoverRow[]>> {
  return runAction(async () => {
    await requirePermission();
    const id = uuid.parse(leaveId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("leave_handover_list")
      .select("id, customer_name, customer_code, task, receiver_name, status, accepted_at, receiver_note")
      .eq("leave_request_id", id)
      .order("line_no");
    if (error) throw error;
    return (data ?? []) as LeaveHandoverRow[];
  });
}

/** Khách hàng do người dùng hiện tại phụ trách (gợi ý sẵn khi tạo đơn) */
export async function loadMyCustomers(): Promise<ActionResult<{ id: string; name: string; code: string }[]>> {
  return runAction(async () => {
    const me = await requirePermission();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("customers")
      .select("id, name, code")
      .eq("account_manager_id", me.id)
      .eq("status", "active")
      .order("name")
      .limit(200);
    if (error) throw error;
    return (data ?? []) as { id: string; name: string; code: string }[];
  });
}
