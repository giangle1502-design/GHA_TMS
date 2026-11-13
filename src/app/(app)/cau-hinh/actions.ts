"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";

export async function updateSystemSetting(key: string, rawValue: string): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("settings.configure");
    const k = z.string().regex(/^[a-z][a-z0-9_.]*$/).parse(key);
    let value: unknown;
    try {
      value = JSON.parse(rawValue);
    } catch {
      throw new ActionError('Giá trị phải là JSON hợp lệ (ví dụ: 30, true, "văn bản").');
    }
    const supabase = await createClient();
    const { data, error } = await supabase.from("system_settings").update({ value }).eq("key", k).select("key");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Không tìm thấy tham số hoặc bạn không có quyền.");
    revalidatePath("/cau-hinh");
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
    revalidatePath("/tx", "layout");
  }, "Đã lưu cấu hình.");
}
