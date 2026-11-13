import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Permission } from "@/lib/permissions";

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  status: "pending" | "active" | "disabled";
  roles: { code: string; name: string }[];
  permissions: Set<string>;
  isDriver: boolean;
};

/**
 * Người dùng hiện tại (xác thực JWT qua getClaims, đọc hồ sơ + quyền hiệu lực từ CSDL).
 * Được cache trong một request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const uid = claimsData?.claims?.sub;
  if (!uid) return null;

  const [{ data: profile }, { data: perms }, { data: roleRows }] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, avatar_url, phone, status").eq("id", uid).maybeSingle(),
    supabase.rpc("my_permissions"),
    supabase.from("user_roles").select("roles(code, name)").eq("user_id", uid),
  ]);

  if (!profile) {
    // Hồ sơ chưa được tạo (trigger chưa chạy) -> coi như chờ cấp quyền
    return {
      id: uid,
      email: String(claimsData?.claims?.email ?? ""),
      fullName: null,
      avatarUrl: null,
      phone: null,
      status: "pending",
      roles: [],
      permissions: new Set(),
      isDriver: false,
    };
  }

  const roles = ((roleRows ?? []) as unknown as { roles: { code: string; name: string } | null }[])
    .map((r) => r.roles)
    .filter((r): r is { code: string; name: string } => Boolean(r));
  const permissions = new Set<string>((perms as string[] | null) ?? []);

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    avatarUrl: profile.avatar_url,
    phone: profile.phone,
    status: profile.status,
    roles,
    permissions,
    // Chỉ coi là tài xế khi có vai trò tài xế hoặc được cấp riêng quyền ứng dụng tài xế (Super Admin có mọi quyền nhưng không phải tài xế)
    isDriver: roles.some((r) => r.code === "driver") || (permissions.has("driver_app.use") && !roles.some((r) => r.code === "super_admin")),
  };
});

/** Dùng trong trang: bắt buộc đăng nhập và tài khoản đang hoạt động. */
export async function requireActiveUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/dang-nhap");
  if (user.status !== "active") redirect("/cho-cap-quyen");
  return user;
}

/** Dùng trong trang: thiếu quyền thì chuyển tới trang báo không có quyền. */
export async function requirePagePermission(...anyOf: Permission[]): Promise<CurrentUser> {
  const user = await requireActiveUser();
  if (anyOf.length > 0 && !anyOf.some((p) => user.permissions.has(p))) {
    redirect("/khong-co-quyen");
  }
  return user;
}

/** Trang mặc định sau khi đăng nhập theo quyền. */
export function homePathFor(user: CurrentUser): string {
  if (user.status !== "active") return "/cho-cap-quyen";
  if (user.permissions.has("dashboard.view")) return "/tong-quan";
  if (user.isDriver) return "/tx";
  return "/tai-khoan";
}
