import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { EntityListSection, resolveEntityTabs } from "@/components/entities/entity-list-section";

export const metadata: Metadata = { title: "Ứng tiền và chi phí" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePagePermission("expenses.view", "advances.view", "settlements.view");
  const sp = await searchParams;
  const { active, nav } = await resolveEntityTabs({
    basePath: "/chi-phi",
    searchParams: sp,
    tabs: [{ key: "advances", label: "Ứng tiền" }, { key: "expenses", label: "Chi phí chuyến" }, { key: "payrolls", label: "Đối soát lương" }],
  });
  return (
    <>
      <PageHeader
        title="Ứng tiền và chi phí"
        description="Tài xế gửi yêu cầu trên điện thoại, Giám đốc duyệt, Kế toán chuyển tiền. Chi phí tài xế tự trả và tiền đã ứng được đối soát vào lương cuối tháng."
      />
      {nav}
      {active ? <EntityListSection entityKey={active} searchParams={sp} revalidate="/chi-phi" /> : null}
    </>
  );
}
