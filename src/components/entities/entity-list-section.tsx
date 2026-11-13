import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getEntity } from "@/lib/entities/definitions";
import { entityAccess } from "@/lib/entities/access";
import { advValueLabels, countByStatus, listRows, loadCustomFields, loadFilterOptions, loadTableView, parseListParams, visibleCustomRows } from "@/lib/entities/server";
import { cn } from "@/lib/utils";
import { EntityTable } from "./entity-table";

type SP = Record<string, string | string[] | undefined>;

/** Danh sách một thực thể: đọc tham số URL, truy vấn qua RLS, hiển thị bảng dữ liệu cấu hình được */
export async function EntityListSection({ entityKey, searchParams, revalidate }: { entityKey: string; searchParams: SP; revalidate: string }) {
  const me = await requireActiveUser();
  const entity = getEntity(entityKey);
  const access = entityAccess(entity, me.permissions);
  if (!access.view) {
    return <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Bạn không có quyền xem {entity.label.toLowerCase()}.</p>;
  }
  const supabase = await createClient();
  const [customAll, view] = await Promise.all([loadCustomFields(supabase, entity.customModule), loadTableView(supabase, entity.key, me.id)]);
  const customRows = visibleCustomRows(customAll, me.permissions);
  const params = parseListParams(searchParams);
  if (!params.size) params.size = view?.pageSize ?? 20;
  const { rows, total, page, size, refLabels, fields } = await listRows(supabase, entity, customRows, params);
  const [filterOptions, statusCounts, advLabels] = await Promise.all([
    loadFilterOptions(supabase, fields),
    countByStatus(supabase, entity, fields, params),
    advValueLabels(supabase, fields, params.adv),
  ]);
  return (
    <EntityTable
      key={entity.key}
      entityKey={entity.key}
      customRows={customRows}
      rows={rows}
      refLabels={refLabels}
      total={total}
      page={page}
      size={size}
      sort={params.sort}
      dir={params.dir}
      q={params.q}
      filters={params.filters ?? {}}
      adv={params.adv ?? []}
      advLabels={advLabels}
      filterOptions={filterOptions}
      view={view}
      access={access}
      statusCounts={statusCounts}
      revalidate={revalidate}
    />
  );
}

/** Thanh tab giữa các thực thể trên cùng một trang (chỉ hiện tab người dùng được xem) */
export async function resolveEntityTabs({
  basePath,
  tabs,
  searchParams,
}: {
  basePath: string;
  tabs: { key: string; label?: string }[];
  searchParams: SP;
}) {
  const me = await requireActiveUser();
  const allowed = tabs.filter((t) => entityAccess(getEntity(t.key), me.permissions).view);
  const tabParam = typeof searchParams.tab === "string" ? searchParams.tab : undefined;
  const active = allowed.find((t) => t.key === tabParam)?.key ?? allowed[0]?.key;
  return {
    active,
    nav:
      allowed.length > 1 ? (
        <div className="mb-4 flex gap-1 overflow-x-auto border-b">
          {allowed.map((t) => (
            <Link
              key={t.key}
              href={`${basePath}?tab=${t.key}`}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-4 py-2 text-sm whitespace-nowrap",
                active === t.key ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label ?? getEntity(t.key).label}
            </Link>
          ))}
        </div>
      ) : null,
  };
}
