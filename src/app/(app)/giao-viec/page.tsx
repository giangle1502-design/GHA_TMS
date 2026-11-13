import type { Metadata } from "next";
import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { EntityListSection, resolveEntityTabs } from "@/components/entities/entity-list-section";

export const metadata: Metadata = { title: "Giao việc" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireActiveUser();
  const sp = await searchParams;
  const supabase = await createClient();
  await supabase.rpc("task_overdue_sweep");
  const base = () => supabase.from("task_list").select("id", { count: "exact", head: true });
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const canAssign = me.permissions.has("tasks.create");
  const [mineOpen, mineNew, overdue, toConfirm, assignedOpen] = await Promise.all([
    count(base().eq("is_mine", true).in("status", ["todo", "in_progress"])),
    count(base().eq("is_new_for_me", true)),
    count(base().eq("is_overdue", true)),
    count(base().eq("can_confirm", true)),
    count(base().eq("assigned_by_me", true).in("status", ["todo", "in_progress", "submitted"])),
  ]);
  const { active, nav } = await resolveEntityTabs({
    basePath: "/giao-viec",
    searchParams: sp,
    tabs: [
      { key: "tasks", label: "Danh sách công việc" },
      { key: "report_task_by_person", label: "Kết quả theo người" },
    ],
  });
  const cards = [
    { label: "Việc của tôi đang mở", value: mineOpen, note: mineNew ? `${mineNew} việc mới chưa xem` : "Chưa bắt đầu hoặc đang làm", href: "/giao-viec?tab=tasks&f_is_mine=true", tone: "" },
    { label: "Quá hạn", value: overdue, note: "Chưa xong mà đã qua hạn", href: "/giao-viec?tab=tasks&f_is_overdue=true", tone: overdue ? "text-destructive" : "" },
    { label: "Chờ tôi xác nhận", value: toConfirm, note: "Người làm đã báo xong", href: "/giao-viec?tab=tasks&f_can_confirm=true", tone: toConfirm ? "text-amber-600" : "" },
    { label: "Tôi giao, chưa xong", value: assignedOpen, note: canAssign ? "Theo dõi việc đã giao" : "Việc bạn đã giao", href: "/giao-viec?tab=tasks&f_assigned_by_me=true", tone: "" },
  ];
  return (
    <>
      <PageHeader
        title="Giao việc"
        description={
          canAssign
            ? "Giao việc cho một hoặc nhiều nhân viên, đặt hạn và mức ưu tiên. Người được giao bấm Bắt đầu, cập nhật % tiến độ, Báo hoàn thành; bạn Xác nhận hoặc Yêu cầu làm lại. Bấm mã việc để xem chi tiết, trao đổi, đính kèm tệp."
            : "Việc được giao cho bạn: bấm mã việc để xem, Bắt đầu làm, cập nhật tiến độ, trao đổi và Báo hoàn thành cho người giao xác nhận."
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.label} href={c.href} className="rounded-lg border bg-card p-4 hover:border-primary">
            <p className="text-sm text-muted-foreground">{c.label}</p>
            <p className={`text-2xl font-semibold tabular-nums ${c.tone}`}>{c.value.toLocaleString("en-US")}</p>
            <p className="text-xs text-muted-foreground">{c.note}</p>
          </Link>
        ))}
      </div>
      {nav}
      {active ? <EntityListSection entityKey={active} searchParams={sp} revalidate="/giao-viec" /> : null}
    </>
  );
}
