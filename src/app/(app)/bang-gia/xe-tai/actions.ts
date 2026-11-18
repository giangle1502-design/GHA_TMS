"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { isUuid } from "@/lib/entities/record";
import { validateCard, type TruckRateCard } from "@/lib/truck-rate";

const num = z.number().finite();
const cardSchema = z.object({
  id: z.string().nullable().optional(),
  name: z.string().trim().min(1, "Chưa nhập tên bảng giá").max(200),
  customer_id: z.string().nullable().optional(),
  default_fuel_pct: num.min(0).max(100),
  distance_bands: z.array(z.object({ from_km: num, to_km: num, label: z.string().trim().max(100) })).min(1).max(100),
  weight_bands: z.array(z.object({ from_ton: num, to_ton: num, label: z.string().trim().max(100), loading_fee: num.min(0).nullable() })).min(1).max(40),
  prices: z.array(z.array(num.min(0).nullable())),
  fuel_bands: z.array(z.object({ from_price: num, to_price: num, factor: num.positive() })).max(60),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày hiệu lực không hợp lệ"),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal("").transform(() => null)),
  status: z.enum(["active", "inactive"]),
  notes: z.string().max(2000).nullable().optional(),
  source_file: z.string().max(300).nullable().optional(),
});

/** Lưu bảng giá xe tải (thêm mới khi chưa có id) */
export async function saveTruckRateCard(input: TruckRateCard): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const p = cardSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const c = p.data;
    const errs = validateCard({ ...c, customer_id: c.customer_id ?? null } as TruckRateCard);
    if (errs.length) throw new ActionError(errs[0]);
    if (c.effective_to && c.effective_to < c.effective_from) throw new ActionError("Ngày hết hiệu lực phải sau ngày bắt đầu.");
    const row = {
      name: c.name,
      customer_id: c.customer_id && isUuid(c.customer_id) ? c.customer_id : null,
      default_fuel_pct: c.default_fuel_pct,
      distance_bands: c.distance_bands,
      weight_bands: c.weight_bands,
      prices: c.prices,
      fuel_bands: c.fuel_bands,
      effective_from: c.effective_from,
      effective_to: c.effective_to || null,
      status: c.status,
      notes: c.notes?.trim() || null,
      source_file: c.source_file || null,
    };
    const supabase = await createClient();
    let id: string;
    if (c.id) {
      await requirePermission("price_lists.update");
      if (!isUuid(c.id)) throw new ActionError("Dữ liệu không hợp lệ");
      const { data, error } = await supabase.from("truck_rate_cards").update(row).eq("id", c.id).select("id");
      if (error) throw error;
      if (!data?.length) throw new ActionError("Không tìm thấy bảng giá (có thể đã bị xóa).");
      id = c.id;
    } else {
      await requirePermission("price_lists.create");
      const { data, error } = await supabase.from("truck_rate_cards").insert(row).select("id").single();
      if (error) throw error;
      id = data.id as string;
    }
    revalidatePath("/bang-gia/xe-tai");
    return { id };
  }, "Đã lưu bảng giá xe tải.");
}

export async function deleteTruckRateCard(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("price_lists.delete");
    if (!isUuid(id)) throw new ActionError("Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.from("truck_rate_cards").delete().eq("id", id);
    if (error) throw error;
    revalidatePath("/bang-gia/xe-tai");
  }, "Đã xóa bảng giá.");
}
