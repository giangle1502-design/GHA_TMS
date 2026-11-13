import type { Metadata } from "next";
import { requireActiveUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/layout/empty-state";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MarkAllReadButton, OpenNotification } from "./notification-actions";
import { SearchForm } from "@/components/layout/search-form";
import { sanitizeSearch } from "@/lib/entities/server";

export const metadata: Metadata = { title: "Thông báo" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireActiveUser();
  const term = sanitizeSearch((await searchParams).q ?? "");
  const supabase = await createClient();
  // Báo việc quá hạn (mỗi việc một lần) trước khi đọc thông báo
  await supabase.rpc("task_overdue_sweep");
  let query = supabase
    .from("notifications")
    .select("id, type, title, body, link, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (term) query = query.or(`title.ilike.*${term}*,body.ilike.*${term}*`);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];
  return (
    <>
      <PageHeader title="Thông báo" actions={rows.some((r) => !r.read_at) ? <MarkAllReadButton /> : null} />
      <SearchForm action="/thong-bao" q={term} placeholder="Tìm trong thông báo (mã chuyến, tên tài xế…)" className="mb-3 flex w-full gap-2 sm:w-96" />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={term ? "Không có thông báo phù hợp" : "Chưa có thông báo"} />
        ) : (
          <ul className="divide-y">
            {rows.map((n) => (
              <li key={n.id} className={cn("px-4 py-3 hover:bg-muted/40", !n.read_at && "bg-primary/5")}>
                <OpenNotification id={n.id} link={n.link} unread={!n.read_at}>
                  <div className="flex items-start gap-3">
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} />
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-sm", !n.read_at && "font-semibold")}>{n.title}</div>
                      {n.body ? <div className="text-sm text-muted-foreground">{n.body}</div> : null}
                      <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(n.created_at)}</div>
                    </div>
                  </div>
                </OpenNotification>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
