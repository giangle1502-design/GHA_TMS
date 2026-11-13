import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { EntityListSection } from "@/components/entities/entity-list-section";

export const metadata: Metadata = { title: "Tài xế" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePagePermission("drivers.view");
  const sp = await searchParams;
  return (
    <>
      <PageHeader
        title="Tài xế"
        description="Bấm vào mã tài xế để xem chi tiết, giấy tờ tùy thân, tài khoản ngân hàng và tài khoản đăng nhập."
      />
      <EntityListSection entityKey="drivers" searchParams={sp} revalidate="/tai-xe" />
    </>
  );
}
