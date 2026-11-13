import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NoPermissionPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="max-w-md text-center">
        <ShieldAlert className="mx-auto size-12 text-destructive" />
        <h1 className="mt-4 text-lg font-semibold">Bạn không có quyền truy cập trang này</h1>
        <p className="mt-2 text-sm text-muted-foreground">Nếu cần quyền, hãy liên hệ quản trị viên.</p>
        <Button asChild className="mt-6">
          <Link href="/">Về trang chính</Link>
        </Button>
      </div>
    </main>
  );
}
