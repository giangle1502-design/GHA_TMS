"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";

const uuid = z.uuid("Giá trị không hợp lệ");
const setSchema = z.object({ shipmentIds: z.array(uuid).min(2, "Chọn ít nhất 2 chuyến để ghép chung xe").max(20, "Mỗi lần ghép tối đa 20 chuyến") });

function refresh() {
  revalidatePath("/dieu-phoi", "layout");
  revalidatePath("/chuyen-xe", "layout");
}

/** Ghép các chuyến (của nhiều đơn) đi chung một xe, cùng lượt: Điều phối, Quản lý chuyến, bảng kê hiện 1 dòng */
export async function setLoadGroup(input: z.input<typeof setSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("dispatch.update", "dispatch.create");
    const p = setSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_shipment_load_group", { p_ids: p.data.shipmentIds });
    if (error) throw error;
    refresh();
  }, "Đã ghép chung xe, các chuyến hiện thành 1 dòng.");
}

/** Tách nhóm ghép xe: các chuyến lại hiện riêng từng dòng (giữ nguyên xe, cước) */
export async function clearLoadGroup(input: { groupId: string }): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("dispatch.update", "dispatch.create");
    const p = z.object({ groupId: uuid }).safeParse(input);
    if (!p.success) throw new ActionError("Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.rpc("clear_shipment_load_group", { p_group_id: p.data.groupId });
    if (error) throw error;
    refresh();
  }, "Đã tách, các chuyến hiện riêng từng dòng.");
}
