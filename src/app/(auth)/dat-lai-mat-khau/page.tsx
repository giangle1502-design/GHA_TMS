import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { updatePassword } from "@/app/auth/actions";

export const metadata: Metadata = { title: "Đặt mật khẩu mới" };

const ERRORS: Record<string, string> = {
  ngan: "Mật khẩu cần ít nhất 8 ký tự.",
  "khong-khop": "Hai lần nhập mật khẩu không giống nhau.",
  khac: "Không đặt được mật khẩu. Link có thể đã hết hạn, hãy gửi lại từ trang Quên mật khẩu.",
};

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ loi?: string }> }) {
  const { loi } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm rounded-xl bg-card p-8 shadow-xl">
        <h1 className="mb-4 text-xl font-semibold">Đặt mật khẩu mới</h1>
        {loi && ERRORS[loi] ? (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{ERRORS[loi]}</AlertDescription>
          </Alert>
        ) : null}
        <form action={updatePassword} className="space-y-3">
          <Input name="password" type="password" placeholder="Mật khẩu mới (ít nhất 8 ký tự)" autoComplete="new-password" required />
          <Input name="confirm" type="password" placeholder="Nhập lại mật khẩu mới" autoComplete="new-password" required />
          <Button type="submit" className="w-full">Lưu mật khẩu</Button>
        </form>
      </div>
    </main>
  );
}
