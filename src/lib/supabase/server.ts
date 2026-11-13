import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "@/lib/env";

/**
 * Supabase client phía máy chủ, mang JWT của người dùng hiện tại (RLS luôn áp dụng).
 * Dùng trong Server Components, Server Actions và Route Handlers.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = getSupabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Gọi từ Server Component: không ghi được cookie; proxy.ts đã làm mới phiên.
        }
      },
    },
  });
}
