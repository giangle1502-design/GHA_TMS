"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePermission, runAction, type ActionResult } from "@/lib/auth/action";

export async function markNotificationRead(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission();
    const supabase = await createClient();
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", z.uuid().parse(id)).is("read_at", null);
    if (error) throw error;
    revalidatePath("/", "layout");
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requirePermission();
    const supabase = await createClient();
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("recipient_id", me.id).is("read_at", null);
    if (error) throw error;
    revalidatePath("/", "layout");
  }, "Đã đánh dấu tất cả là đã đọc.");
}
