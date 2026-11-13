"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission, runAction, type ActionResult } from "@/lib/auth/action";

const uuid = z.string().uuid();
const month = z.string().regex(/^\d{4}-\d{2}-01$/, "Tháng không hợp lệ");
const numOrNull = z.number().finite().nonnegative().nullable();

const saveSchema = z.object({
  vehicleId: uuid,
  month,
  values: z
    .object({
      km_start: numOrNull,
      km_end: numOrNull,
      fuel_opening: numOrNull,
      fuel_added: numOrNull,
      fuel_remaining: numOrNull,
      fuel_ratio: numOrNull,
      fuel_price: numOrNull,
      note: z.string().max(500).nullable(),
    })
    .partial()
    .strict(),
});

/** Nhập / sửa một ô số liệu dầu của một xe (null = để trống, lấy số tự động) */
export async function saveVehicleFuel(input: z.input<typeof saveSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("fuel.update");
    const d = saveSchema.parse(input);
    const supabase = await createClient();
    const { error } = await supabase.rpc("save_vehicle_fuel", { p_vehicle_id: d.vehicleId, p_month: d.month, p_values: d.values });
    if (error) throw error;
    revalidatePath("/dau-xe");
  });
}

const finalSchema = z.object({ vehicleId: uuid, month, final: numOrNull, note: z.string().max(500).optional() });

/** Giám đốc nhập số lít chốt (chưa khóa) */
export async function setVehicleFuelFinal(input: z.input<typeof finalSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("fuel.approve");
    const d = finalSchema.parse(input);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_vehicle_fuel_final", {
      p_vehicle_id: d.vehicleId,
      p_month: d.month,
      p_final: d.final,
      p_note: d.note?.trim() || null,
    });
    if (error) throw error;
    revalidatePath("/dau-xe");
  });
}

const lockSchema = z.object({
  vehicleIds: z.array(uuid).min(1, "Chọn xe cần chốt").max(2000),
  month,
  locked: z.boolean(),
  fill: z.enum(["none", "actual", "norm"]).default("none"),
});

/** Giám đốc chốt / mở chốt các xe đã chọn */
export async function lockVehicleFuel(input: z.input<typeof lockSchema>): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requirePermission("fuel.approve");
    const d = lockSchema.parse(input);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("lock_vehicle_fuel", {
      p_vehicle_ids: d.vehicleIds,
      p_month: d.month,
      p_locked: d.locked,
      p_fill: d.fill,
    });
    if (error) throw error;
    revalidatePath("/dau-xe");
    return data as number;
  });
}

const importSchema = z.object({
  month,
  rows: z
    .array(
      z
        .object({
          row: z.number().int(),
          plate: z.string().min(1).max(20),
          km_start: numOrNull,
          km_end: numOrNull,
          fuel_opening: numOrNull,
          fuel_added: numOrNull,
          fuel_remaining: numOrNull,
          fuel_ratio: numOrNull,
          fuel_price: numOrNull,
          note: z.string().max(500).nullable(),
        })
        .partial({ km_start: true, km_end: true, fuel_opening: true, fuel_added: true, fuel_remaining: true, fuel_ratio: true, fuel_price: true, note: true })
        .strict(),
    )
    .min(1, "File không có dòng nào")
    .max(2000, "Mỗi lần nhập tối đa 2000 dòng"),
});

export type FuelImportResult = { saved: number; errors: { row: number; plate: string; error: string }[] };

/** Nhập Excel số liệu dầu một tháng: dòng đúng được lưu, dòng sai trả về để sửa */
export async function importVehicleFuel(input: z.input<typeof importSchema>): Promise<ActionResult<FuelImportResult>> {
  return runAction(async () => {
    await requirePermission("fuel.update");
    const d = importSchema.parse(input);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("import_vehicle_fuel", { p_month: d.month, p_rows: d.rows });
    if (error) throw error;
    revalidatePath("/dau-xe");
    return data as FuelImportResult;
  });
}
