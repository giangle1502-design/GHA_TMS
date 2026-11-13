"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getEntity } from "@/lib/entities/definitions";
import { effectiveFields, flattenRow, formatValue, isFieldShown } from "@/lib/entities/record";
import { deleteRecord } from "@/lib/entities/actions";
import type { EntityAccess } from "@/lib/entities/access";
import type { RefLabels } from "@/lib/entities/server";
import type { CustomFieldRow } from "@/lib/entities/types";
import { EntityFormDialog } from "./entity-form-dialog";
import { ConfirmDialog } from "./confirm-dialog";

/** Thẻ hiển thị một bản ghi (bản ghi chính hoặc bản ghi đơn theo cha) với nút sửa */
export function RecordCard({
  entityKey,
  customRows = [],
  record,
  refLabels = {},
  parentId,
  canEdit,
  title,
  emptyText,
  revalidate,
}: {
  entityKey: string;
  customRows?: CustomFieldRow[];
  record: Record<string, unknown> | null;
  refLabels?: RefLabels;
  parentId?: string;
  canEdit: boolean;
  title: string;
  emptyText?: string;
  revalidate: string;
}) {
  const entity = getEntity(entityKey);
  const fields = useMemo(() => effectiveFields(entity, customRows).filter((f) => f.key !== entity.parentKey), [entity, customRows]);
  const flat = record ? flattenRow(fields, record) : null;
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        {canEdit ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {record ? <Pencil /> : <Plus />} {record ? "Sửa" : "Nhập thông tin"}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {flat ? (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {fields
              .filter((f) => isFieldShown(f, flat))
              .map((f) => {
                const v = flat[f.key];
                const text = formatValue(f, v, f.type === "reference" ? refLabels[f.key]?.[String(v)] : null);
                return (
                  <div key={f.key} className={cn((f.wide || f.type === "textarea") && "sm:col-span-2 lg:col-span-3")}>
                    <dt className="text-xs text-muted-foreground">{f.label}</dt>
                    <dd className="mt-0.5 break-words whitespace-pre-wrap">
                      {f.type === "url" && typeof v === "string" ? (
                        <a className="text-primary hover:underline" href={v} target="_blank" rel="noopener noreferrer">
                          {v}
                        </a>
                      ) : (
                        text || <span className="text-muted-foreground">—</span>
                      )}
                    </dd>
                  </div>
                );
              })}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{emptyText ?? "Chưa có thông tin."}</p>
        )}
      </CardContent>
      {canEdit ? (
        <EntityFormDialog
          entityKey={entityKey}
          customRows={customRows}
          open={open}
          onOpenChange={setOpen}
          record={record}
          parentId={parentId}
          refLabels={refLabels}
          revalidate={revalidate}
          onSaved={() => router.refresh()}
        />
      ) : null}
    </Card>
  );
}

/** Danh sách bản ghi con của một bản ghi cha (lịch trả nợ, sửa chữa, tài khoản ngân hàng...) */
export function ChildList({
  entityKey,
  parentId,
  rows,
  refLabels = {},
  access,
  title,
  revalidate,
}: {
  entityKey: string;
  parentId: string;
  rows: Record<string, unknown>[];
  refLabels?: RefLabels;
  access: EntityAccess;
  title: string;
  revalidate: string;
}) {
  const entity = getEntity(entityKey);
  const fields = useMemo(() => effectiveFields(entity, []).filter((f) => f.list && f.key !== entity.parentKey), [entity]);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<Record<string, unknown> | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const pk = entity.pk ?? "id";
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">
          {title} <span className="text-sm font-normal text-muted-foreground">({rows.length})</span>
        </CardTitle>
        {access.create ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus /> Thêm
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">Chưa có dữ liệu.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  {fields.map((f) => (
                    <th key={f.key} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                      {f.label}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={String(r[pk])} className="border-t">
                    {fields.map((f) => (
                      <td key={f.key} className={cn("px-3 py-2 whitespace-nowrap", ["currency", "number", "percent"].includes(f.type) && "text-right tabular-nums")}>
                        {formatValue(f, r[f.key], f.type === "reference" ? refLabels[f.key]?.[String(r[f.key])] : null)}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      {access.update ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label="Sửa"
                          onClick={() => {
                            setEditing(r);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      ) : null}
                      {access.delete ? (
                        <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="Xóa" onClick={() => setDeleting(r)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      {access.create || access.update ? (
        <EntityFormDialog
          key={editing ? String(editing[pk]) : "new"}
          entityKey={entityKey}
          customRows={[]}
          open={open}
          onOpenChange={setOpen}
          record={editing}
          parentId={parentId}
          refLabels={refLabels}
          revalidate={revalidate}
          onSaved={() => router.refresh()}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Xóa ${entity.singular}?`}
        confirmLabel="Xóa"
        destructive
        pending={pending}
        onConfirm={() =>
          start(async () => {
            const r = await deleteRecord(entityKey, String(deleting?.[pk]), revalidate);
            if (r.ok) {
              toast.success(r.message);
              setDeleting(null);
              router.refresh();
            } else toast.error(r.error);
          })
        }
      />
    </Card>
  );
}
