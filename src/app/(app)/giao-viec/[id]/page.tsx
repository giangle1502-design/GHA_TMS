import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Eye, EyeOff } from "lucide-react";
import { requireActiveUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatValue, isUuid, moduleCustomFields } from "@/lib/entities/record";
import { loadCustomFields, visibleCustomRows } from "@/lib/entities/server";
import { TASK_PRIORITY, TASK_STATUS } from "@/lib/entities/definitions";
import { TONE_BADGE } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { EditTaskButton } from "@/components/tasks/task-dialogs";
import { CommentBox, MarkSeen, TaskFiles, TaskWorkPanel } from "@/components/tasks/task-detail";

export const metadata: Metadata = { title: "Chi tiết công việc" };

type Task = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  progress: number;
  assigned_by: string;
  assigner_name: string | null;
  start_date: string | null;
  due_date: string | null;
  due_time: string | null;
  is_overdue: boolean;
  days_left: number | null;
  done_late: boolean;
  customer_id: string | null;
  customer_name: string | null;
  result_note: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  cancel_reason: string | null;
  file_count: number;
  is_mine: boolean;
  assigned_by_me: boolean;
  can_work: boolean;
  can_edit: boolean;
  custom_fields: Record<string, unknown>;
  created_at: string;
};

function badge(options: { value: string; label: string; tone?: string }[], v: string) {
  const o = options.find((x) => x.value === v);
  return <Badge variant={(o?.tone ? TONE_BADGE[o.tone as keyof typeof TONE_BADGE] : "muted") as "muted"}>{o?.label ?? v}</Badge>;
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireActiveUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [{ data: task }, { data: people }, { data: comments }, fieldRows] = await Promise.all([
    supabase.from("task_list").select("*").eq("id", id).maybeSingle(),
    supabase.from("task_assignee_list").select("user_id, user_name, seen_at").eq("task_id", id).order("created_at"),
    supabase.from("task_comment_list").select("id, author_name, kind, body, created_at, is_mine").eq("task_id", id).order("created_at"),
    loadCustomFields(supabase, "tasks"),
  ]);
  if (!task) notFound();
  const t = task as Task;
  const assignees = (people ?? []) as { user_id: string; user_name: string | null; seen_at: string | null }[];
  const timeline = (comments ?? []) as { id: string; author_name: string | null; kind: string; body: string; created_at: string; is_mine: boolean }[];
  const customRows = visibleCustomRows(fieldRows, me.permissions);
  const customFields = moduleCustomFields("tasks", customRows, me.permissions);
  const manage = t.assigned_by_me || me.permissions.has("tasks.delete");
  const due = t.due_date ? `${formatDate(t.due_date)}${t.due_time ? ` ${t.due_time.slice(0, 5)}` : ""}` : "Không có hạn";
  const dueNote =
    t.status === "done"
      ? t.done_late
        ? "Xong trễ hạn"
        : "Xong đúng hạn"
      : t.is_overdue
        ? `Quá hạn ${Math.abs(t.days_left ?? 0)} ngày`
        : t.days_left === 0
          ? "Hạn hôm nay"
          : t.days_left != null && t.status !== "cancelled"
            ? `Còn ${t.days_left} ngày`
            : "";

  return (
    <>
      <MarkSeen taskId={t.id} enabled={t.is_mine} />
      <div className="mb-2">
        <Button asChild variant="ghost" size="sm" className="px-2">
          <Link href="/giao-viec">
            <ArrowLeft className="size-4" /> Giao việc
          </Link>
        </Button>
      </div>
      <PageHeader
        title={`${t.code} · ${t.title}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {badge(TASK_STATUS, t.status)}
            {badge(TASK_PRIORITY, t.priority)}
            {t.is_overdue ? <Badge variant="destructive">Quá hạn</Badge> : null}
            <span>
              Giao bởi {t.assigner_name ?? ""} lúc {formatDateTime(t.created_at)}
            </span>
          </span>
        }
        actions={
          t.can_edit ? (
            <EditTaskButton
              customRows={customRows}
              canAddField={me.permissions.has("fields.configure")}
              initial={{
                id: t.id,
                title: t.title,
                description: t.description,
                priority: t.priority,
                startDate: t.start_date,
                dueDate: t.due_date,
                dueTime: t.due_time,
                customerId: t.customer_id,
                customerLabel: t.customer_name,
                assignees: assignees.map((a) => ({ id: a.user_id, name: a.user_name ?? "" })),
                custom: t.custom_fields ?? {},
              }}
            />
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nội dung</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="whitespace-pre-wrap text-sm">{t.description || <span className="text-muted-foreground">Không ghi nội dung.</span>}</p>
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <span>Tiến độ</span>
                  <span className="font-medium tabular-nums">{t.progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", t.status === "done" ? "bg-green-600" : t.is_overdue ? "bg-destructive" : "bg-primary")}
                    style={{ width: `${t.progress}%` }}
                  />
                </div>
              </div>
              {t.result_note ? (
                <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
                  <p className="font-medium">Kết quả báo cáo{t.submitted_at ? ` (${formatDateTime(t.submitted_at)})` : ""}</p>
                  <p className="whitespace-pre-wrap">{t.result_note}</p>
                </div>
              ) : null}
              {t.cancel_reason ? <p className="text-sm text-destructive">Lý do hủy: {t.cancel_reason}</p> : null}
              <TaskWorkPanel
                taskId={t.id}
                flags={{ status: t.status, progress: t.progress, canWork: t.can_work, canManage: manage, isMine: t.is_mine, assignedByMe: t.assigned_by_me }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trao đổi và lịch sử ({timeline.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {timeline.length ? (
                <ol className="space-y-3">
                  {timeline.map((m) =>
                    m.kind === "event" ? (
                      <li key={m.id} className="flex gap-2 text-xs text-muted-foreground">
                        <Clock className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          {formatDateTime(m.created_at)} · {m.body}
                        </span>
                      </li>
                    ) : (
                      <li key={m.id} className={cn("rounded-lg border p-3 text-sm", m.is_mine ? "border-primary/30 bg-primary/5" : "bg-card")}>
                        <p className="mb-1 text-xs text-muted-foreground">
                          <b className="text-foreground">{m.author_name ?? ""}</b> · {formatDateTime(m.created_at)}
                        </p>
                        <p className="whitespace-pre-wrap">{m.body}</p>
                      </li>
                    ),
                  )}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">Chưa có trao đổi.</p>
              )}
              {t.status !== "cancelled" ? <CommentBox taskId={t.id} /> : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Thông tin</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Hạn</dt>
                <dd>
                  {due}
                  {dueNote ? <span className={cn("ml-1 text-xs", t.is_overdue || t.done_late ? "text-destructive" : "text-muted-foreground")}>({dueNote})</span> : null}
                </dd>
                <dt className="text-muted-foreground">Bắt đầu</dt>
                <dd>{t.start_date ? formatDate(t.start_date) : "—"}</dd>
                <dt className="text-muted-foreground">Khách hàng</dt>
                <dd>{t.customer_name ?? "—"}</dd>
                {t.completed_at ? (
                  <>
                    <dt className="text-muted-foreground">Hoàn thành</dt>
                    <dd>{formatDateTime(t.completed_at)}</dd>
                  </>
                ) : null}
                {customFields.map((f) => (
                  <div key={f.key} className="contents">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd>{formatValue(f, (t.custom_fields ?? {})[f.key]) || "—"}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Người được giao ({assignees.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm">
                {assignees.map((a) => (
                  <li key={a.user_id} className="flex items-center justify-between gap-2">
                    <span>{a.user_name}</span>
                    {a.seen_at ? (
                      <span className="flex items-center gap-1 text-xs text-green-700" title={`Xem lúc ${formatDateTime(a.seen_at)}`}>
                        <Eye className="size-3.5" /> Đã xem
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <EyeOff className="size-3.5" /> Chưa xem
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tệp đính kèm ({t.file_count})</CardTitle>
            </CardHeader>
            <CardContent>
              <TaskFiles taskId={t.id} count={Number(t.file_count)} canUpload={t.status !== "cancelled"} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
