import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { EntityListSection, resolveEntityTabs } from "@/components/entities/entity-list-section";

export const metadata: Metadata = { title: "Khách hàng và địa điểm" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePagePermission("customers.view", "locations.view");
  const sp = await searchParams;
  const { active, nav } = await resolveEntityTabs({
    basePath: "/khach-hang",
    searchParams: sp,
    tabs: [{ key: "customers" }, { key: "suppliers" }, { key: "locations" }, { key: "routes" }],
  });
  return (
    <>
      <PageHeader
        title="Khách hàng và địa điểm"
        description="Khách hàng, nhà cung cấp, địa điểm nhận/giao hàng và tuyến đường dùng chung cho điều phối và bảng giá."
      />
      {nav}
      {active ? <EntityListSection entityKey={active} searchParams={sp} revalidate="/khach-hang" /> : null}
    </>
  );
}
