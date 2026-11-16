"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Mở lại app sau ít nhất ngần này thì tải lại dữ liệu chuyến */
const STALE_MS = 30_000;

/**
 * Ứng dụng tài xế: điện thoại hay giữ nguyên trang cũ khi mở lại tab / quay lại từ app khác,
 * nên điều phối sửa chuyến (điểm nhận, điểm giao, giờ...) mà tài xế vẫn thấy thông tin cũ.
 * Mở lại app (sau 30 giây) hoặc trình duyệt khôi phục trang từ bộ nhớ thì tự lấy dữ liệu mới.
 * Đang mở khung nhập (chụp ảnh, khai chi phí) thì không tải lại để khỏi làm phiền.
 */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let hiddenAt = 0;
    const busy = () => Boolean(document.querySelector("[role=dialog]"));
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt >= STALE_MS && !busy()) router.refresh();
      hiddenAt = 0;
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && !busy()) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [router]);
  return null;
}
