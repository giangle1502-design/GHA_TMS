import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState } from "@/components/layout/empty-state";
import { formatDateTime, startOfDayVN } from "@/lib/format";

export const metadata: Metadata = { title: "Nhật ký hệ thống" };

const PAGE_SIZE = 50;
const ACTIONS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  insert: { label: "Tạo", variant: "success" },
  update: { label: "Sửa", variant: "warning" },
  delete: { label: "Xóa", variant: "destructive" },
};

type SP = { bang?: string; hanh_dong?: string; tu?: string; den?: string; ma?: string; trang?: string };

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePagePermission("audit_logs.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.trang) || 1);
  const supabase = await createClient();

  let q = supabase
    .from("audit_logs")
    .select("id, occurred_at, actor_id, action, entity_type, entity_id, changed_fields, old_data, new_data, reason", { count: "exact" })
    .order("occurred_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (sp.bang) q = q.eq("entity_type", sp.bang);
  if (sp.hanh_dong) q = q.eq("action", sp.hanh_dong);
  if (sp.ma) q = q.eq("entity_id", sp.ma.trim());
  if (sp.tu && /^\d{4}-\d{2}-\d{2}$/.test(sp.tu)) q = q.gte("occurred_at", startOfDayVN(sp.tu));
  if (sp.den && /^\d{4}-\d{2}-\d{2}$/.test(sp.den)) {
    const next = new Date(new Date(startOfDayVN(sp.den)).getTime() + 86400000).toISOString();
    q = q.lt("occurred_at", next);
  }
  const { data, count, error } = await q;
  if (error) throw error;

  const actorIds = [...new Set((data ?? []).map((r) => r.actor_id).filter(Boolean))] as string[];
  const actors = new Map<string, string>();
  if (actorIds.length) {
    const { data: ps } = await supabase.from("profiles").select("id, email, full_name").in("id", actorIds);
    (ps ?? []).forEach((p) => actors.set(p.id, p.full_name || p.email));
  }
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (n: number) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    p.set("trang", String(n));
    return `/nhat-ky?${p}`;
  };

  return (
    <>
      <PageHeader title="Nhật ký hệ thống" description="Mọi thay đổi dữ liệu nghiệp vụ được ghi tự động trong CSDL. Nhật ký chỉ đọc, không ai sửa hoặc xóa được." />
      <Card>
        <form className="grid gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-6" action="/nhat-ky">
          <Input name="bang" defaultValue={sp.bang} placeholder="Bảng (vd: shipments)" />
          <NativeSelect name="hanh_dong" defaultValue={sp.hanh_dong ?? ""}>
            <option value="">Mọi hành động</option>
            <option value="insert">Tạo</option>
            <option value="update">Sửa</option>
            <option value="delete">Xóa</option>
          </NativeSelect>
          <Input name="ma" defaultValue={sp.ma} placeholder="Mã bản ghi (id)" />
          <Input name="tu" type="date" defaultValue={sp.tu} aria-label="Từ ngày" />
          <Input name="den" type="date" defaultValue={sp.den} aria-label="Đến ngày" />
          <div className="flex gap-2">
            <Button type="submit" className="flex-1">Lọc</Button>
            <Button asChild variant="outline"><Link href="/nhat-ky">Xóa lọc</Link></Button>
          </div>
        </form>
        {(data ?? []).length === 0 ? (
          <EmptyState title="Không có bản ghi nhật ký phù hợp" />
        ) : (
          <ul className="divide-y">
            {(data ?? []).map((r) => (
              <li key={r.id} className="px-3 py-2.5 text-sm">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="w-36 shrink-0 text-muted-foreground">{formatDateTime(r.occurred_at)}</span>
                    <Badge variant={ACTIONS[r.action]?.variant ?? "secondary"}>{ACTIONS[r.action]?.label ?? r.action}</Badge>
                    <code className="text-xs">{r.entity_type}</code>
                    <span className="truncate text-xs text-muted-foreground">{r.entity_id}</span>
                    <span className="ml-auto">{r.actor_id ? actors.get(r.actor_id) ?? r.actor_id : "Hệ thống"}</span>
                    {r.changed_fields?.length ? (
                      <span className="basis-full text-xs text-muted-foreground">Trường thay đổi: {r.changed_fields.join(", ")}</span>
                    ) : null}
                  </summary>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <JsonBlock title="Trước" value={r.old_data} highlight={r.changed_fields} />
                    <JsonBlock title="Sau" value={r.new_data} highlight={r.changed_fields} />
                  </div>
                  {r.reason ? <p className="mt-2 text-xs">Lý do: {r.reason}</p> : null}
                </details>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between border-t p-3 text-sm">
          <span className="text-muted-foreground">
            {total.toLocaleString("en-US")} bản ghi · Trang {page}/{pages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? <Button asChild size="sm" variant="outline"><Link href={qs(page - 1)}>Trước</Link></Button> : null}
            {page < pages ? <Button asChild size="sm" variant="outline"><Link href={qs(page + 1)}>Sau</Link></Button> : null}
          </div>
        </div>
      </Card>
    </>
  );
}

function JsonBlock({ title, value, highlight }: { title: string; value: unknown; highlight: string[] | null }) {
  if (!value) return <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">{title}: —</div>;
  const obj = value as Record<string, unknown>;
  const keys = highlight?.length ? highlight : Object.keys(obj);
  return (
    <div className="rounded-md bg-muted/50 p-2">
      <div className="mb-1 text-xs font-semibold">{title}</div>
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-2 gap-y-0.5 text-xs">
        {keys.map((k) => (
          <div key={k} className="contents">
            <dt className="truncate text-muted-foreground">{k}</dt>
            <dd className="break-all font-mono">{JSON.stringify(obj[k])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
