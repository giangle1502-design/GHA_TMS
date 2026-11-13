"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";

const schema = z.object({
  fullName: z.string().trim().min(2, "Họ tên tối thiểu 2 ký tự").max(120),
  phone: z
    .string()
    .trim()
    .regex(/^(\+84|0)[0-9]{8,10}$/, "Số điện thoại không hợp lệ")
    .or(z.literal("")),
});

export async function updateMyProfile(input: z.input<typeof schema>): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requirePermission();
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new ActionError(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: parsed.data.fullName, phone: parsed.data.phone || null })
      .eq("id", me.id);
    if (error) throw error;
    revalidatePath("/", "layout");
  }, "Đã cập nhật hồ sơ.");
}
