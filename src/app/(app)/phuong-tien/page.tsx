import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { EntityListSection } from "@/components/entities/entity-list-section";

export const metadata: Metadata = { title: "Phương tiện" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePagePermission("vehicles.view");
  const sp = await searchParams;
  return (
    <>
      <PageHeader
        title="Phương tiện"
        description="Bấm vào mã xe để xem chi tiết: thông tin tài chính, lịch trả nợ và lịch sử sửa chữa, bảo dưỡng."
      />
      <EntityListSection entityKey="vehicles" searchParams={sp} revalidate="/phuong-tien" />
    </>
  );
}
