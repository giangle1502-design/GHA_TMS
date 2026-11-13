import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { EntityListSection, resolveEntityTabs } from "@/components/entities/entity-list-section";
import { PriceLookup } from "./price-lookup";

export const metadata: Metadata = { title: "Bảng giá" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePagePermission("price_lists.view");
  const sp = await searchParams;
  const { active, nav } = await resolveEntityTabs({
    basePath: "/bang-gia",
    searchParams: sp,
    tabs: [{ key: "price_lists" }, { key: "fuel_rules" }],
  });
  return (
    <>
      <PageHeader
        title="Bảng giá"
        description="Bảng giá cụ thể nhất được ưu tiên (khách hàng > loại xe > điểm nhận/giao), sau đó theo độ ưu tiên. Hai bảng giá cùng phạm vi, cùng độ ưu tiên không được trùng thời gian hiệu lực."
        actions={<PriceLookup />}
      />
      {nav}
      {active ? <EntityListSection entityKey={active} searchParams={sp} revalidate="/bang-gia" /> : null}
    </>
  );
}
