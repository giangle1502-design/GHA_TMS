"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ActionError, runAction, type ActionResult } from "@/lib/auth/action";

/** Lưu đơn giá bốc xếp mặc định (đ/tấn) dùng khi thêm khoản Bốc xếp 3PL cho chuyến */
export async function saveLoadingUnitPrice(price: number): Promise<ActionResult<null>> {
  return runAction(async () => {
    if (!Number.isFinite(price) || price <= 0 || price > 100_000_000) throw new ActionError("Đơn giá không hợp lệ.");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("system_settings")
      .update({ value: Math.round(price) })
      .eq("key", "loading.unit_price_per_ton")
      .select("key");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Bạn không có quyền sửa cấu hình, hoặc CSDL chưa nâng cấp (chạy file 9005).");
    revalidatePath("/thue-ngoai/boc-xep");
    return null;
  }, "Đã lưu đơn giá bốc xếp mặc định.");
}
