import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Quản lý biểu mẫu" };

export default async function Page() {
  await requirePagePermission("forms.view");
  return (
    <ComingSoon
      title="Quản lý biểu mẫu"
      phase={8}
      items={[
        "Hiện tại: thứ tự, bắt buộc, hiện/ẩn và quyền của từng trường được cấu hình ở “Quản lý trường dữ liệu”, biểu mẫu tự dựng theo cấu hình đó",
        "Giai đoạn 6: chia nhóm/tab trên biểu mẫu, điều kiện hiện trường, biểu mẫu riêng cho ứng tiền, chi phí, phê duyệt",
        "Lưu phiên bản bố cục và khôi phục",
      ]}
    />
  );
}
