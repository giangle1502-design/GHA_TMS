"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { isUuid } from "@/lib/entities/record";

/** Nối chuyến vào vỏ cont của chuyến trước (prevId null = gỡ nối). Phí trả rỗng, cược gộp về chuyến đầu chuỗi. */
export async function setContainerPrev(shipmentId: string, prevId: string | null): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("dispatch.update", "shipments.update");
    if (!isUuid(shipmentId) || (prevId !== null && !isUuid(prevId))) throw new ActionError("Dữ liệu không hợp lệ.");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_container_prev", { p_shipment_id: shipmentId, p_prev_id: prevId });
    if (error) throw error;
    revalidatePath(`/chuyen-xe/${shipmentId}`);
    if (prevId) revalidatePath(`/chuyen-xe/${prevId}`);
    revalidatePath("/chuyen-xe/vo-chua-tra");
    return undefined;
  }, prevId ? "Đã nối vỏ cont" : "Đã gỡ nối vỏ cont");
}
