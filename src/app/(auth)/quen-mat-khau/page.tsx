import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requestPasswordReset } from "@/app/auth/actions";

export const metadata: Metadata = { title: "Quên mật khẩu" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ "da-gui"?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm rounded-xl bg-card p-8 shadow-xl">
        <h1 className="mb-2 text-xl font-semibold">Quên mật khẩu</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Nhập email của tài khoản. Hệ thống gửi link để anh/chị đặt mật khẩu mới. Tài khoản đăng nhập bằng tên (không có
          email) thì nhờ quản trị viên đặt lại.
        </p>
        {sp["da-gui"] ? (
          <Alert className="mb-4">
            <AlertDescription>Nếu email có tài khoản, link đặt lại mật khẩu đã được gửi. Kiểm tra cả thư mục Spam.</AlertDescription>
          </Alert>
        ) : null}
        <form action={requestPasswordReset} className="space-y-3">
          <Input name="email" type="email" placeholder="email@congty.com" autoComplete="email" required />
          <Button type="submit" className="w-full">Gửi link đặt lại mật khẩu</Button>
        </form>
        <div className="mt-4 text-center text-sm">
          <Link href="/dang-nhap" className="text-primary hover:underline">Quay lại đăng nhập</Link>
        </div>
      </div>
    </main>
  );
}
