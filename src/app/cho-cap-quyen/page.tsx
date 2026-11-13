import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Clock, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/auth/actions";
import { getCurrentUser, homePathFor } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Chờ cấp quyền" };

export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/dang-nhap");
  if (user.status === "active") redirect(homePathFor(user));
  const disabled = user.status === "disabled";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-warning/15">
          {disabled ? <ShieldOff className="size-6 text-destructive" /> : <Clock className="size-6 text-[oklch(0.5_0.12_70)]" />}
        </div>
        <h1 className="text-lg font-semibold">{disabled ? "Tài khoản đã bị khóa" : "Tài khoản đang chờ cấp quyền"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Bạn đã đăng nhập bằng <strong>{user.email}</strong>.{" "}
          {disabled
            ? "Tài khoản này không còn quyền truy cập. Vui lòng liên hệ quản trị viên."
            : "Quản trị viên đã được thông báo. Sau khi được cấp quyền, hãy tải lại trang này."}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild variant="outline">
            <a href="/cho-cap-quyen">Tải lại</a>
          </Button>
          <form action={signOut}>
            <Button type="submit" variant="ghost">
              Đăng xuất
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
