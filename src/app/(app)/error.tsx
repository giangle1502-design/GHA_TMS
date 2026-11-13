"use client";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <AlertTriangle className="size-10 text-destructive" />
      <h2 className="text-lg font-semibold">Không tải được dữ liệu</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Có thể kết nối tới máy chủ dữ liệu đang gián đoạn. Vui lòng thử lại. Nếu lỗi lặp lại, gửi mã lỗi
        {error.digest ? <code className="mx-1 rounded bg-muted px-1">{error.digest}</code> : " "}cho quản trị viên.
      </p>
      <Button onClick={reset}>Thử lại</Button>
    </div>
  );
}
