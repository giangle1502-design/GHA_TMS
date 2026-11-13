"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";

const opt = z.uuid().optional().or(z.literal("").transform(() => undefined));
const schema = z.object({
  customerId: opt,
  pickupId: opt,
  deliveryId: opt,
  vehicleTypeId: opt,
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ"),
});

export type PriceCandidate = {
  id: string;
  code: string;
  unit_price: number;
  pricing_unit: string;
  pricing_unit_label: string | null;
  fuel_support_rate: number | null;
  surcharge_amount: number;
  specificity: number;
  priority: number;
  effective_from: string;
  effective_to: string | null;
};

/** Tra cứu bảng giá áp dụng (dùng chung logic với điều phối ở Giai đoạn 4) */
export async function lookupPrice(input: z.input<typeof schema>): Promise<ActionResult<{ candidates: PriceCandidate[]; ambiguous: boolean }>> {
  return runAction(async () => {
    await requirePermission("price_lists.view");
    const p = schema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("find_price_lists", {
      p_customer_id: p.data.customerId ?? null,
      p_pickup_location_id: p.data.pickupId ?? null,
      p_delivery_location_id: p.data.deliveryId ?? null,
      p_vehicle_type_id: p.data.vehicleTypeId ?? null,
      p_on_date: p.data.onDate,
    });
    if (error) throw error;
    const candidates = (data ?? []) as PriceCandidate[];
    const ambiguous = candidates.length > 1 && candidates[0].specificity === candidates[1].specificity && candidates[0].priority === candidates[1].priority;
    return { candidates, ambiguous };
  });
}
