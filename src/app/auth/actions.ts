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
