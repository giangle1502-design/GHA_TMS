import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";

/** Cookie giữ mã phiên của xe trên điện thoại tài xế (httpOnly, 30 ngày). */
export const DRIVER_LINK_COOKIE = "kh_tx";
export const DRIVER_LINK_MAX_AGE = 60 * 60 * 24 * 30;

/** Client ẩn danh: ứng dụng tài xế không dùng tài khoản; quyền nằm ở các hàm driver_link_* trong CSDL. */
export function anonClient() {
  const { url, key } = getSupabaseEnv();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function driverLinkToken() {
  return (await cookies()).get(DRIVER_LINK_COOKIE)?.value ?? null;
}

/** Biển số chuẩn: chữ hoa, chỉ chữ và số (61K31295). */
export function normalizePlate(v: string) {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
