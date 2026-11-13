"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";

export type TestDataCounts = Record<string, number>;
type RpcResult = { ok: boolean; error?: string; counts?: TestDataCounts };

const ADMIN_ROLES = ["super_admin", "admin"];
const pw = z.string().min(1, "Nhập mật khẩu xóa dữ liệu").max(200);

/** Chỉ Super Admin/Admin (CSDL kiểm tra lại vai trò và mật khẩu) */
async function requireAdmin() {
  const me = await requirePermission();
  if (!me.roles.some((r) => ADMIN_ROLES.includes(r.code))) throw new ActionError("Chỉ Super Admin hoặc Admin được xóa dữ liệu thử.");
  return me;
}

/** Đặt (lần đầu) hoặc đổi mật khẩu xóa dữ liệu */
export async function setPurgePassword(input: { newPassword: string; oldPassword?: string }): Promise<ActionResult> {
  return runAction(async () => {
    await requireAdmin();
    const next = z.string().min(8, "Mật khẩu cần ít nhất 8 ký tự").max(200).parse(input.newPassword);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_purge_password", { p_new: next, p_old: input.oldPassword || null });
    if (error) throw error;
    revalidatePath("/cau-hinh");
  }, "Đã lưu mật khẩu xóa dữ liệu.");
}

/** Bước 1: nhập mật khẩu, xem trước số dòng sẽ xóa */
export async function checkPurgePassword(password: string): Promise<ActionResult<TestDataCounts>> {
  return runAction(async () => {
    await requireAdmin();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("test_data_counts", { p_password: pw.parse(password) });
    if (error) throw error;
    const r = data as RpcResult;
    if (!r.ok) throw new ActionError(r.error ?? "Mật khẩu xóa dữ liệu không đúng.");
    return r.counts ?? {};
  });
}

/** Bước 2: gõ chữ xác nhận rồi xóa (CSDL kiểm tra lại mật khẩu và chữ xác nhận) */
export async function purgeTestData(input: { password: string; confirm: string }): Promise<ActionResult<TestDataCounts>> {
  return runAction(async () => {
    await requireAdmin();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("purge_test_data", { p_password: pw.parse(input.password), p_confirm: input.confirm });
    if (error) throw error;
    const r = data as RpcResult;
    if (!r.ok) throw new ActionError(r.error ?? "Mật khẩu xóa dữ liệu không đúng.");
    revalidatePath("/", "layout");
    return r.counts ?? {};
  }, "Đã xóa dữ liệu thử. Danh mục, người dùng và cấu hình được giữ nguyên.");
}
