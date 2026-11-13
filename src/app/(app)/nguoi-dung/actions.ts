"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { ALL_PERMISSIONS } from "@/lib/permissions";

const uuid = z.uuid({ message: "Mã không hợp lệ" });

const inviteSchema = z.object({
  email: z.email({ message: "Email không hợp lệ" }).transform((v) => v.trim().toLowerCase()),
  roleCodes: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).min(1, "Chọn ít nhất một vai trò"),
  driverId: uuid.optional().or(z.literal("").transform(() => undefined)),
  note: z.string().max(500).optional(),
});

export async function inviteUser(input: z.input<typeof inviteSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("users.create");
    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) throw new ActionError(parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const { email, roleCodes, driverId, note } = parsed.data;
    const supabase = await createClient();
    const { error } = await supabase.rpc("invite_user", {
      p_email: email,
      p_role_codes: roleCodes,
      p_driver_id: driverId ?? null,
      p_note: note ?? null,
    });
    if (error) throw error;
    revalidatePath("/nguoi-dung");
  }, "Đã cấp quyền truy cập. Người dùng có thể đăng nhập bằng Google với email này.");
}

export async function revokeInvitation(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("users.update");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("user_invitations")
      .update({ status: "revoked" })
      .eq("id", uuid.parse(id))
      .eq("status", "pending")
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Lời mời không còn ở trạng thái chờ.");
    revalidatePath("/nguoi-dung");
  }, "Đã thu hồi lời mời.");
}

export async function setUserStatus(userId: string, status: "active" | "disabled"): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requirePermission("users.update");
    const id = uuid.parse(userId);
    if (id === me.id) throw new ActionError("Không được tự đổi trạng thái tài khoản của chính mình.");
    if (!["active", "disabled"].includes(status)) throw new ActionError("Trạng thái không hợp lệ.");
    const supabase = await createClient();
    const { data, error } = await supabase.from("profiles").update({ status }).eq("id", id).select("id");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Không tìm thấy người dùng hoặc bạn không có quyền.");
    revalidatePath("/nguoi-dung");
    revalidatePath(`/nguoi-dung/${id}`);
  }, status === "active" ? "Đã mở khóa tài khoản." : "Đã khóa tài khoản.");
}

export async function setUserRoles(userId: string, roleIds: string[]): Promise<ActionResult<{ activated: boolean }>> {
  return runAction(async () => {
    const me = await requirePermission("users.configure");
    const id = uuid.parse(userId);
    if (id === me.id) throw new ActionError("Không được tự thay đổi vai trò của chính mình.");
    const wanted = new Set(z.array(uuid).parse(roleIds));
    const supabase = await createClient();
    const { data: current, error: e1 } = await supabase.from("user_roles").select("role_id").eq("user_id", id);
    if (e1) throw e1;
    const have = new Set((current ?? []).map((r) => r.role_id as string));
    const toAdd = [...wanted].filter((r) => !have.has(r));
    const toRemove = [...have].filter((r) => !wanted.has(r));
    // Trigger CSDL chặn tự cấp quyền / cấp Super Admin trái phép
    if (toAdd.length) {
      const { error } = await supabase.from("user_roles").insert(toAdd.map((role_id) => ({ user_id: id, role_id })));
      if (error) throw error;
    }
    if (toRemove.length) {
      const { error } = await supabase.from("user_roles").delete().eq("user_id", id).in("role_id", toRemove);
      if (error) throw error;
    }
    // Tài khoản đã đăng nhập nhưng đang chờ cấp quyền: gán vai trò là kích hoạt luôn
    let activated = false;
    if (wanted.size) {
      const { data, error } = await supabase.from("profiles").update({ status: "active" }).eq("id", id).eq("status", "pending").select("id");
      if (error) throw error;
      activated = Boolean(data?.length);
    }
    revalidatePath(`/nguoi-dung/${id}`);
    revalidatePath("/nguoi-dung");
    return { activated };
  }, "Đã cập nhật vai trò.");
}

const overrideSchema = z.object({
  userId: uuid,
  permission: z.enum(ALL_PERMISSIONS as [string, ...string[]]),
  effect: z.enum(["grant", "deny", "none"]),
  reason: z.string().max(500).optional(),
});

export async function setPermissionOverride(input: z.input<typeof overrideSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requirePermission("users.configure");
    const p = overrideSchema.parse(input);
    if (p.userId === me.id) throw new ActionError("Không được tự thay đổi quyền của chính mình.");
    const supabase = await createClient();
    if (p.effect === "none") {
      const { error } = await supabase
        .from("user_permission_overrides")
        .delete()
        .eq("user_id", p.userId)
        .eq("permission_code", p.permission);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("user_permission_overrides").upsert(
        { user_id: p.userId, permission_code: p.permission, effect: p.effect, reason: p.reason ?? null },
        { onConflict: "user_id,permission_code" },
      );
      if (error) throw error;
    }
    revalidatePath(`/nguoi-dung/${p.userId}`);
  }, "Đã cập nhật quyền riêng.");
}

export async function toggleRolePermission(roleId: string, permission: string, enabled: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("users.configure");
    const rid = uuid.parse(roleId);
    const perm = z.enum(ALL_PERMISSIONS as [string, ...string[]]).parse(permission);
    const supabase = await createClient();
    if (enabled) {
      const { error } = await supabase
        .from("role_permissions")
        .upsert({ role_id: rid, permission_code: perm }, { onConflict: "role_id,permission_code", ignoreDuplicates: true });
      if (error) throw error;
    } else {
      const { error } = await supabase.from("role_permissions").delete().eq("role_id", rid).eq("permission_code", perm);
      if (error) throw error;
    }
    revalidatePath("/nguoi-dung");
  });
}
