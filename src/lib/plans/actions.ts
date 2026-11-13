"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { assertActiveRefs } from "@/lib/entities/active-check";

const schema = z.object({
  planId: z.uuid("Kế hoạch không hợp lệ"),
  /** Ngày nhận hàng của các chuyến (YYYY-MM-DD); trống = ngày giao của kế hoạch hoặc hôm nay */
  pickupDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày nhận hàng không hợp lệ")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/** Tích chọn kế hoạch: tạo đúng số lượng cont đơn hàng trong Điều phối (mỗi cont một đơn, một chuyến) */
export async function createOrdersFromPlan(input: z.input<typeof schema>): Promise<ActionResult<{ count: number; orderCodes: string[] }>> {
  return runAction(async () => {
    await requirePermission("dispatch.create");
    const p = schema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { data: plan, error: pe } = await supabase.from("transport_plans").select("customer_id").eq("id", p.data.planId).maybeSingle();
    if (pe) throw pe;
    if (plan) {
      await assertActiveRefs(supabase, [{ ref: "customers", id: plan.customer_id as string | null, label: "Khách hàng của kế hoạch" }]);
    }
    const { data, error } = await supabase.rpc("plan_create_orders", {
      p_plan_id: p.data.planId,
      p_pickup_date: p.data.pickupDate ?? null,
    });
    if (error) throw error;
    const r = data as { count: number; order_codes: string[] };
    revalidatePath("/ke-hoach");
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
    return { count: r.count, orderCodes: r.order_codes };
  });
}
