"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { createClient } from "@/lib/supabase/server";

const lineSchema = z.object({
  plate: z.string().trim().min(4, "Nhập số xe (ví dụ 61K31295)").max(20),
  driverName: z.string().trim().max(150).optional(),
  driverPhone: z.string().trim().max(20).optional(),
  nationalId: z.string().trim().max(20).optional(),
  quantities: z.record(z.string(), z.number().min(0)).optional(),
  quantity: z.number().min(0).optional(),
});
const registerSchema = z.object({ shipmentId: z.uuid(), lines: z.array(lineSchema).min(1, "Nhập ít nhất một xe").max(60) });

export type RegisterResult = { updated: string; created: string[]; full: boolean };

/** Nhà xe 3PL đăng ký số xe, tài xế, số lượng từng xe cho chuyến (chia đơn lớn thành nhiều xe) */
export async function registerVehicles(input: z.input<typeof registerSchema>): Promise<ActionResult<RegisterResult>> {
  return runAction(async () => {
    await requirePermission("carrier_portal.use", "dispatch.update");
    const p = registerSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("carrier_register_vehicles", {
      p_shipment_id: p.data.shipmentId,
      p_lines: p.data.lines.map((l) => ({
        plate: l.plate,
        driver_name: l.driverName || null,
        driver_phone: l.driverPhone || null,
        national_id: l.nationalId || null,
        quantities: l.quantities ?? null,
        quantity: l.quantity ?? null,
      })),
    });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") throw new ActionError("CSDL chưa nâng cấp Cổng nhà xe 3PL (9030). Nhờ quản trị chạy SQL nâng cấp.");
      throw error;
    }
    revalidatePath("/nha-xe");
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
    return data as RegisterResult;
  });
}
