import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DelegateNotice, TripDelegationManager, type DelegationInfo } from "@/components/dispatch/trip-delegation";
import { PageHeader } from "@/components/layout/page-header";
import { EntityListSection, resolveEntityTabs } from "@/components/entities/entity-list-section";

export const metadata: Metadata = { title: "Phê duyệt" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePagePermission("approvals.view");
  const sp = await searchParams;
  const supabase = await createClient();
  const delegation = ((await supabase.rpc("trip_delegation_info")).data ?? null) as DelegationInfo | null;
  const { active, nav } = await resolveEntityTabs({
    basePath: "/phe-duyet",
    searchParams: sp,
    tabs: [{ key: "approvals", label: "Yêu cầu" }, { key: "approval_rules", label: "Cấu hình cấp duyệt" }],
  });
  return (
    <>
      <PageHeader
        title="Phê duyệt"
        description="Lọc “Tôi duyệt được: Có” để xem các yêu cầu đang chờ bạn. Người gửi không tự duyệt được khoản của mình."
        actions={<TripDelegationManager info={delegation} />}
      />
      <DelegateNotice info={delegation} />
      {nav}
      {active ? <EntityListSection entityKey={active} searchParams={sp} revalidate="/phe-duyet" /> : null}
    </>
  );
}
