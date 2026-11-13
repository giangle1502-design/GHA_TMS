import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { signInWithGoogle } from "@/app/auth/actions";
import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentUser, homePathFor } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Đăng nhập" };

const ERRORS: Record<string, string> = {
  oauth: "Không khởi tạo được đăng nhập Google. Kiểm tra cấu hình Google provider trên Supabase.",
  "thieu-ma": "Đăng nhập bị hủy hoặc thiếu mã xác thực.",
  "xac-thuc": "Xác thực không thành công. Vui lòng thử lại.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; loi?: string }> }) {
  const { next, loi } = await searchParams;
  const configured = isSupabaseConfigured();
  if (configured) {
    const user = await getCurrentUser();
    if (user) redirect(homePathFor(user));
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm rounded-xl bg-card p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Truck className="size-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">KHÁNH HÀ TMS</h1>
            <p className="text-sm text-muted-foreground">Phần mềm quản lý vận tải – Công ty Vận tải Khánh Hà</p>
          </div>
        </div>

        {loi && ERRORS[loi] ? (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{ERRORS[loi]}</AlertDescription>
          </Alert>
        ) : null}

        {configured ? (
          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value={next ?? "/"} />
            <Button type="submit" variant="outline" size="lg" className="w-full">
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
                <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
                <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
                <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
                <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
              </svg>
              Đăng nhập bằng Google
            </Button>
          </form>
        ) : (
          <Alert variant="warning">
            <AlertTitle>Chưa cấu hình kết nối Supabase</AlertTitle>
            <AlertDescription>
              Khai báo <code>NEXT_PUBLIC_SUPABASE_URL</code> và <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> trong
              biến môi trường (xem <code>.env.example</code> và README).
            </AlertDescription>
          </Alert>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Chỉ tài khoản Google đã được quản trị viên cấp quyền mới truy cập được dữ liệu.
        </p>
      </div>
    </main>
  );
}
