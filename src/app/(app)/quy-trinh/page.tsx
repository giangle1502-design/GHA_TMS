import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Quản lý quy trình" };

export default async function Page() {
  await requirePagePermission("workflows.view");
  return (
    <ComingSoon
      title="Quản lý quy trình"
      phase={8}
      items={["Cấu hình người gửi, người duyệt cấp 1/2, hạn mức, điều kiện chuyển cấp", "Bắt buộc chứng từ, bắt buộc lý do từ chối, cho phép tự duyệt (mặc định không)", "Người nhận thông báo, thời hạn xử lý; mỗi lần lưu tạo phiên bản mới"]}
    />
  );
}
