import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { EntityListSection, resolveEntityTabs } from "@/components/entities/entity-list-section";

export const metadata: Metadata = { title: "Công nợ" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePagePermission("receivables.view", "payments.view");
  const sp = await searchParams;
  const { active, nav } = await resolveEntityTabs({
    basePath: "/cong-no",
    searchParams: sp,
    tabs: [
      { key: "receivables", label: "Phải thu khách hàng" },
      { key: "billing", label: "Chuyến chưa lập công nợ" },
      { key: "payables", label: "Phải trả nhà cung cấp" },
      { key: "payments", label: "Phiếu thu chi" },
    ],
  });
  return (
    <>
      <PageHeader
        title="Công nợ"
        description="Lập công nợ từ các chuyến đã hoàn thành, thu hoặc trả nhiều lần, theo dõi tuổi nợ quá hạn. Đây là sổ theo dõi nội bộ, không thay cho hóa đơn điện tử."
      />
      {nav}
      {active ? <EntityListSection entityKey={active} searchParams={sp} revalidate="/cong-no" /> : null}
    </>
  );
}
