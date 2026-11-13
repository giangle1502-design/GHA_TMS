import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="text-center">
        <p className="text-5xl font-bold text-primary">404</p>
        <h1 className="mt-3 text-lg font-semibold">Không tìm thấy trang</h1>
        <p className="mt-1 text-sm text-muted-foreground">Đường dẫn không tồn tại hoặc đã bị thay đổi.</p>
        <Button asChild className="mt-6">
          <Link href="/">Về trang chính</Link>
        </Button>
      </div>
    </main>
  );
}
