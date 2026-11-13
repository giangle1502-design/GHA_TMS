import type { Metadata } from "next";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { EntityListSection, resolveEntityTabs } from "@/components/entities/entity-list-section";

export const metadata: Metadata = { title: "Xin nghỉ, bàn giao" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireActiveUser();
  const sp = await searchParams;
  const supabase = await createClient();
  const [onLeave, toApprove, toAccept, acting] = await Promise.all([
    supabase.from("leave_list").select("id", { count: "exact", head: true }).eq("on_leave_now", true),
    supabase.from("leave_list").select("id", { count: "exact", head: true }).eq("can_approve", true),
    supabase.from("leave_handover_list").select("id", { count: "exact", head: true }).eq("can_accept", true),
    supabase
      .from("leave_handover_list")
      .select("id, customer_name, task, requester_name, end_date")
      .eq("is_mine", true)
      .eq("active_now", true)
      .order("end_date")
      .limit(20),
  ]);
  const { active, nav } = await resolveEntityTabs({
    basePath: "/nghi-phep",
    searchParams: sp,
    tabs: [{ key: "leave_requests", label: "Đơn xin nghỉ" }, { key: "leave_handovers", label: "Bàn giao công việc" }],
  });
  const cards = [
    { label: "Đang nghỉ hôm nay", value: onLeave.count ?? 0, href: "/nghi-phep?tab=leave_requests&f_on_leave_now=true" },
    { label: "Đơn chờ tôi duyệt", value: toApprove.count ?? 0, href: "/nghi-phep?tab=leave_requests&f_can_approve=true" },
    { label: "Bàn giao chờ tôi nhận", value: toAccept.count ?? 0, href: "/nghi-phep?tab=leave_handovers&f_can_accept=true" },
  ];
  const actingRows = acting.data ?? [];
  return (
    <>
      <PageHeader
        title="Xin nghỉ, bàn giao"
        description="Nhân viên tạo đơn nghỉ phép/ốm kèm bàn giao khách hàng, công việc → Giám đốc duyệt → người nhận bấm Nhận bàn giao. Ai duyệt sửa ở Phê duyệt → Cấu hình cấp duyệt (loại Xin nghỉ)."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="rounded-lg border bg-card p-4 hover:border-primary">
            <p className="text-sm text-muted-foreground">{c.label}</p>
            <p className="text-2xl font-semibold tabular-nums">{c.value.toLocaleString("en-US")}</p>
          </Link>
        ))}
      </div>
      {actingRows.length ? (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
          <p className="font-medium">Hôm nay bạn đang phụ trách thay:</p>
          <ul className="mt-1 list-disc pl-5">
            {actingRows.map((r) => (
              <li key={r.id}>
                {r.customer_name ? `Khách ${r.customer_name}` : r.task} (thay {r.requester_name}, đến {formatDate(r.end_date)})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {nav}
      {active ? <EntityListSection entityKey={active} searchParams={sp} revalidate="/nghi-phep" /> : null}
    </>
  );
}
