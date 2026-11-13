"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission, runAction, type ActionResult } from "@/lib/auth/action";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const setSchema = z.object({
  cells: z.array(z.object({ driverId: uuid, date })).min(1, "Chọn ô ngày công").max(2000),
  reasonId: uuid.nullable(),
  note: z.string().max(500).optional(),
});

/** Điều phối / kế toán xác nhận hoặc sửa ngày công theo lý do (reasonId null = trả về tự động) */
export async function setAttendance(input: z.input<typeof setSchema>): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requirePermission("dispatch.update", "settlements.update");
    const d = setSchema.parse(input);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("set_driver_attendance_reason", {
      p_driver_ids: d.cells.map((c) => c.driverId),
      p_dates: d.cells.map((c) => c.date),
      p_reason_id: d.reasonId,
      p_note: d.note?.trim() || null,
    });
    if (error) throw error;
    revalidatePath("/cham-cong");
    revalidatePath("/dieu-phoi");
    return data as number;
  }, "Đã lưu ngày công");
}

const lockSchema = z.object({ month: date, locked: z.boolean() });

export async function lockAttendance(input: z.input<typeof lockSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("settlements.update");
    const d = lockSchema.parse(input);
    const supabase = await createClient();
    const { error } = await supabase.rpc("lock_attendance_month", { p_month: d.month, p_locked: d.locked });
    if (error) throw error;
    revalidatePath("/cham-cong");
  }, input.locked ? "Đã chốt công tháng" : "Đã mở chốt công");
}
