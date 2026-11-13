"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function safeNext(next: FormDataEntryValue | null): string {
  const v = typeof next === "string" ? next : "";
  // Chỉ cho phép đường dẫn nội bộ để tránh open redirect
  return v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

export async function signInWithGoogle(formData: FormData) {
  const supabase = await createClient();
  const h = await headers();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const next = safeNext(formData.get("next"));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) {
    redirect("/dang-nhap?loi=oauth");
  }
  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/dang-nhap");
}

// Tài khoản đăng nhập bằng tên (không có email thật) được lưu dạng <tên>@gha-tms.local
const LOGIN_DOMAIN = "@gha-tms.local";
function loginEmail(login: string): string {
  const v = login.trim().toLowerCase();
  return v.includes("@") ? v : `${v}${LOGIN_DOMAIN}`;
}

async function siteOrigin(): Promise<string> {
  const h = await headers();
  return process.env.NEXT_PUBLIC_SITE_URL ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

export async function signInWithPassword(formData: FormData) {
  const login = String(formData.get("login") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));
  if (!login.trim() || !password) {
    redirect(`/dang-nhap?loi=thieu-thong-tin&next=${encodeURIComponent(next)}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(login), password });
  if (error) {
    const loi = error.code === "email_not_confirmed" ? "chua-xac-nhan" : error.code === "invalid_credentials" ? "sai-mat-khau" : "ket-noi";
    const ma = encodeURIComponent(error.code ?? String(error.status ?? ""));
    redirect(`/dang-nhap?loi=${loi}&ma=${ma}&next=${encodeURIComponent(next)}`);
  }
  redirect(next);
}

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (email.includes("@") && !email.endsWith(LOGIN_DOMAIN)) {
    const supabase = await createClient();
    const origin = await siteOrigin();
    // Không báo email có tồn tại hay không
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/dat-lai-mat-khau")}`,
    });
  }
  redirect("/quen-mat-khau?da-gui=1");
}

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) redirect("/dat-lai-mat-khau?loi=ngan");
  if (password !== confirm) redirect("/dat-lai-mat-khau?loi=khong-khop");
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/dat-lai-mat-khau?loi=khac");
  redirect("/");
}
