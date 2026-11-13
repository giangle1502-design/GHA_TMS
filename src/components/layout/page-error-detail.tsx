import { unstable_rethrow } from "next/navigation";
import { AlertTriangle } from "lucide-react";

/**
 * Bọc trang máy chủ: lỗi dữ liệu thì hiện nội dung lỗi thật (mã, thông báo của CSDL) thay cho mã digest,
 * để người dùng chụp gửi quản trị. notFound / redirect vẫn hoạt động bình thường.
 */
export async function withErrorDetail(render: () => Promise<React.ReactNode>): Promise<React.ReactNode> {
  try {
    return await render();
  } catch (e) {
    unstable_rethrow(e);
    const err = e as { code?: string; message?: string; details?: string; hint?: string };
    console.error("page error", e);
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-16 text-center">
        <AlertTriangle className="size-10 text-destructive" />
        <h2 className="text-lg font-semibold">Không tải được dữ liệu</h2>
        <p className="text-sm text-muted-foreground">Vui lòng chụp màn hình phần chi tiết bên dưới gửi quản trị viên.</p>
        <pre data-page-error className="w-full whitespace-pre-wrap break-words rounded-md border bg-muted p-3 text-left text-xs">
          {[err.code ? `Mã: ${err.code}` : null, err.message ?? String(e), err.details ? `Chi tiết: ${err.details}` : null, err.hint ? `Gợi ý: ${err.hint}` : null]
            .filter(Boolean)
            .join("\n")}
        </pre>
      </div>
    );
  }
}
