"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { isUuid } from "@/lib/entities/record";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type TripPriceRow = {
  customer_id: string;
  customer_name: string;
  pickup_location_id: string;
  pickup_name: string;
  delivery_location_id: string;
  delivery_name: string;
  empty_return_location_id: string | null;
  empty_return_name: string | null;
  container_size: string | null;
  trip_count: number;
  last_unit_price: number;
  common_unit_price: number;
  price_min: number;
  price_max: number;
  last_fuel_rate: number | null;
  last_carrier_unit_price: number | null;
  last_trip_date: string;
  last_shipment_code: string;
  current_id: string | null;
  current_unit_price: number | null;
};

const loadSchema = z.object({
  from: z.string().regex(YMD, "Từ ngày không hợp lệ"),
  to: z.string().regex(YMD, "Đến ngày không hợp lệ"),
  customerId: z.string().optional(),
});

/** Gom các chuyến cont đã chạy thành dòng giá (đơn giá chưa hỗ trợ dầu) */
export async function loadPricesFromTrips(input: z.input<typeof loadSchema>): Promise<ActionResult<TripPriceRow[]>> {
  return runAction(async () => {
    await requirePermission("price_lists.view");
    const p = loadSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    if (p.data.to < p.data.from) throw new ActionError("Đến ngày phải sau Từ ngày.");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("container_prices_from_trips", {
      p_from: p.data.from,
      p_to: p.data.to,
      p_customer_id: p.data.customerId && isUuid(p.data.customerId) ? p.data.customerId : null,
    });
    if (error) throw error;
    return ((data ?? []) as TripPriceRow[]).map((r) => ({
      ...r,
      last_unit_price: Number(r.last_unit_price),
      common_unit_price: Number(r.common_unit_price),
      price_min: Number(r.price_min),
      price_max: Number(r.price_max),
      last_fuel_rate: r.last_fuel_rate === null ? null : Number(r.last_fuel_rate),
      last_carrier_unit_price: r.last_carrier_unit_price === null ? null : Number(r.last_carrier_unit_price),
      current_unit_price: r.current_unit_price === null ? null : Number(r.current_unit_price),
    }));
  });
}

const applyRow = z.object({
  customer_id: z.uuid(),
  pickup_location_id: z.uuid(),
  delivery_location_id: z.uuid(),
  empty_return_location_id: z.uuid().nullable(),
  container_size: z.enum(["20", "40", "45"]).nullable(),
  unit_price: z.number().finite().min(0),
  fuel_support_rate: z.number().finite().min(0).max(100).nullable(),
  carrier_unit_price: z.number().finite().min(0).nullable(),
  trip_count: z.number().int().min(0),
  price_min: z.number().finite().nullable(),
  price_max: z.number().finite().nullable(),
  last_trip_date: z.string().regex(YMD).nullable(),
  last_shipment_code: z.string().max(50).nullable(),
});
export type ApplyRow = z.input<typeof applyRow>;

/** Tạo / cập nhật bảng giá xe cont từ các dòng đã chọn */
export async function applyContainerPrices(rows: ApplyRow[]): Promise<ActionResult<{ inserted: number; updated: number }>> {
  return runAction(async () => {
    await requirePermission("price_lists.update");
    await requirePermission("price_lists.create");
    const p = z.array(applyRow).min(1, "Chưa chọn dòng nào").max(2000).safeParse(rows);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("upsert_container_prices", { p_rows: p.data.map((r) => ({ ...r, source: "trips" })) });
    if (error) throw error;
    revalidatePath("/bang-gia/xe-cont");
    return data as { inserted: number; updated: number };
  });
}

const editSchema = z.object({
  id: z.uuid(),
  unit_price: z.number().finite().min(0),
  fuel_support_rate: z.number().finite().min(0).max(100).nullable(),
  carrier_unit_price: z.number().finite().min(0).nullable(),
  effective_from: z.string().regex(YMD, "Ngày áp dụng không hợp lệ"),
  status: z.enum(["active", "inactive"]),
  notes: z.string().max(1000).nullable(),
});

export async function updateContainerPrice(input: z.input<typeof editSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("price_lists.update");
    const p = editSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const { id, ...patch } = p.data;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("container_price_lists")
      .update({ ...patch, notes: patch.notes?.trim() || null, source: "manual" })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Không tìm thấy dòng giá.");
    revalidatePath("/bang-gia/xe-cont");
  }, "Đã lưu giá.");
}

export async function deleteContainerPrices(ids: string[]): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("price_lists.delete");
    if (!ids.length || ids.some((x) => !isUuid(x))) throw new ActionError("Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.from("container_price_lists").delete().in("id", ids);
    if (error) throw error;
    revalidatePath("/bang-gia/xe-cont");
  }, "Đã xóa.");
}
