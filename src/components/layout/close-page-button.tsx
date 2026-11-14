"use client";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

/**
 * Nút "Đóng" nổi ở góc dưới bên phải các trang chi tiết (chuyến, đơn hàng, xe, tài xế...):
 * luôn thấy dù đã cuộn xuống nhập chi phí. Quay lại trang trước trong app, không có thì về danh sách.
 */
export function ClosePageButton({ fallbackHref, label = "Đóng" }: { fallbackHref: string; label?: string }) {
  const router = useRouter();
  function close() {
    let fromApp = false;
    try {
      fromApp = window.history.length > 1 && !!document.referrer && new URL(document.referrer).origin === window.location.origin;
    } catch {
      fromApp = false;
    }
    if (fromApp) router.back();
    else router.push(fallbackHref);
  }
  return (
    <button
      type="button"
      onClick={close}
      title="Đóng trang này, quay lại trang trước"
      className="fixed right-4 bottom-4 z-40 inline-flex h-10 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium shadow-lg hover:bg-muted print:hidden"
    >
      <X className="size-4" /> {label}
    </button>
  );
}
