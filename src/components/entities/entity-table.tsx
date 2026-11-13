"use client";
import { useMemo, useRef, useState, useTransition, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnPinningState,
  type ColumnSizingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Eye,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Rows3,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { TONE_BADGE } from "@/lib/tones";
import { getEntity } from "@/lib/entities/definitions";
import { advancedFields, effectiveFields, formatValue } from "@/lib/entities/record";
import { encodeCondition, parseConditions } from "@/lib/advanced-filter";
import { AdvancedFilter } from "@/components/advanced-filter";
import { deleteRecord, resetTableView, saveTableView } from "@/lib/entities/actions";
import type { EntityAccess } from "@/lib/entities/access";
import type { RefLabels } from "@/lib/entities/server";
import type { CustomFieldRow, FieldDef, TableViewConfig } from "@/lib/entities/types";
import { EntityFormDialog } from "./entity-form-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { ExportButton, ImportDialog } from "./excel-buttons";
import { ColumnsMenu } from "@/components/grid/columns-menu";
import { AddFieldButton } from "./add-field-button";
import { CREATE_ACTIONS, LEAD_ACTIONS, ROW_ACTIONS, ROW_ACTION_WIDTH } from "@/components/finance/registry";

type Row = Record<string, unknown>;

export type EntityTableProps = {
  entityKey: string;
  customRows: CustomFieldRow[];
  rows: Row[];
  refLabels: RefLabels;
  total: number;
  page: number;
  size: number;
  sort?: string;
  dir?: "asc" | "desc";
  q?: string;
  filters: Record<string, string>;
  /** Điều kiện tìm kiếm nâng cao trên URL */
  adv: string[];
  advLabels: Record<string, string>;
  filterOptions: Record<string, { value: string; label: string }[]>;
  view: TableViewConfig | null;
  access: EntityAccess;
  /** Đường dẫn cần làm mới sau khi ghi */
  revalidate: string;
  /** Số bản ghi theo từng trạng thái cho dãy tab lọc (null nếu thực thể không có tab) */
  statusCounts?: { field: string; counts: Record<string, number> } | null;
};

const ACTIONS_COL = "__actions";
/** Cột thao tác đứng đầu bảng (ví dụ ô tích tạo đơn từ kế hoạch), luôn cố định bên trái */
const LEAD_COL = "__lead";
const isSysCol = (id: string) => id === ACTIONS_COL || id === LEAD_COL;

function defaultView(fields: FieldDef[]): Required<Omit<TableViewConfig, "pageSize" | "rowHeight" | "sort">> {
  return {
    hidden: fields.filter((f) => !f.list).map((f) => f.key),
    order: [],
    widths: {},
    pinned: fields.some((f) => f.key === "code") ? ["code"] : [],
    density: "normal",
  };
}

export function EntityTable(props: EntityTableProps) {
  const { entityKey, customRows, rows, refLabels, total, page, size, access } = props;
  const entity = getEntity(entityKey);
  const fields = useMemo(() => effectiveFields(entity, customRows), [entity, customRows]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();
  const [savePending, startSave] = useTransition();

  const base = defaultView(fields);
  const initial = props.view ?? base;
  const [visibility, setVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries(fields.map((f) => [f.key, !(initial.hidden ?? base.hidden).includes(f.key)])),
  );
  const [order, setOrder] = useState<ColumnOrderState>(() => initial.order ?? []);
  const [sizing, setSizing] = useState<ColumnSizingState>(() => initial.widths ?? {});
  const LeadAction = entity.leadAction ? LEAD_ACTIONS[entity.leadAction] : undefined;
  const leftPins = (pins: string[]) => (LeadAction ? [LEAD_COL, ...pins.filter((p) => p !== LEAD_COL)] : pins);
  const [pinning, setPinning] = useState<ColumnPinningState>(() => ({ left: leftPins(initial.pinned ?? base.pinned), right: [ACTIONS_COL] }));
  const [density, setDensity] = useState<"compact" | "normal">(initial.density ?? "normal");
  const [rowHeight, setRowHeight] = useState<number | null>(props.view?.rowHeight ?? null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const resizeRow = useRef<{ y: number; h: number } | null>(null);
  const advFields = useMemo(() => advancedFields(fields), [fields]);
  const advConds = useMemo(() => parseConditions(props.adv, advFields), [props.adv, advFields]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [delPending, startDelete] = useTransition();
  const [q, setQ] = useState(props.q ?? "");
  const CreateAction = entity.createAction ? CREATE_ACTIONS[entity.createAction] : undefined;
  // Mở sẵn biểu mẫu nghiệp vụ khi đường dẫn có ?new=1 (ví dụ bấm "Lập công nợ" từ danh sách chuyến)
  const [createOpen, setCreateOpenRaw] = useState(() => Boolean(CreateAction && access.create && searchParams.get("new") === "1"));
  const [prefill] = useState<Record<string, string>>(() => (searchParams.get("new") === "1" ? Object.fromEntries(searchParams.entries()) : {}));
  const RowAction = entity.rowActions ? ROW_ACTIONS[entity.rowActions] : undefined;

  function setCreateOpen(o: boolean) {
    setCreateOpenRaw(o);
    if (!o && searchParams.get("new") === "1") setParams({ new: null, customer: null, shipment: null });
  }

  function setParams(patch: Record<string, string | null>) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    startNav(() => router.push(`${pathname}?${sp.toString()}`, { scroll: false }));
  }

  function setAdv(list: string[]) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("a");
    sp.delete("page");
    for (const a of list) sp.append("a", a);
    startNav(() => router.push(`${pathname}?${sp.toString()}`, { scroll: false }));
  }

  /** Kéo mép dưới của một dòng để đổi chiều cao mọi dòng */
  function startRowResize(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const tr = (e.currentTarget as HTMLElement).closest("tr");
    resizeRow.current = { y: e.clientY, h: tr?.getBoundingClientRect().height ?? 36 };
    const move = (ev: PointerEvent) => {
      if (!resizeRow.current) return;
      setRowHeight(Math.round(Math.min(200, Math.max(28, resizeRow.current.h + ev.clientY - resizeRow.current.y))));
    };
    const up = () => {
      resizeRow.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function dropColumn(target: string) {
    if (!dragCol || dragCol === target) return;
    const ids = table.getAllLeafColumns().map((c) => c.id).filter((x) => !isSysCol(x));
    const from = ids.indexOf(dragCol);
    const to = ids.indexOf(target);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setOrder(ids);
    setDragCol(null);
  }

  const pk = entity.pk ?? "id";
  const detailHref = (r: Row) => (entity.detailPath ? entity.detailPath.replace("{id}", String(r[pk])) : null);

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const cols: ColumnDef<Row>[] = fields.map((f) => ({
      id: f.key,
      accessorFn: (r) => r[f.key],
      header: f.label,
      size: f.type === "textarea" || f.wide ? 240 : f.type === "boolean" ? 110 : f.key === "code" ? 100 : f.type === "date" ? 120 : f.options?.some((o) => o.tone) ? 136 : 124,
      minSize: 60,
      enableSorting: !["reference", "formula", "multiselect", "file"].includes(f.type),
      meta: { field: f },
      cell: ({ row }) => {
        const r = row.original;
        const v = r[f.key];
        const text = formatValue(f, v, f.type === "reference" ? refLabels[f.key]?.[String(v)] : null);
        if (f.key === "code" || (entity.labelCols[0] === f.key && !fields.some((x) => x.key === "code"))) {
          const href = detailHref(r);
          if (href) {
            return (
              <Link href={href} className="font-medium text-primary hover:underline">
                {text || "(chưa có)"}
              </Link>
            );
          }
          return (
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => {
                setEditing(r);
                setFormOpen(true);
              }}
            >
              {text || "(chưa có)"}
            </button>
          );
        }
        if (f.type === "select" && v != null && v !== "") {
          const opt = f.options?.find((o) => o.value === v);
          if (opt?.tone) return <Badge variant={TONE_BADGE[opt.tone]}>{opt.label}</Badge>;
        }
        if (f.type === "url" && typeof v === "string") {
          return (
            <a href={v} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Mở liên kết
            </a>
          );
        }
        if (f.type === "phone" && typeof v === "string") {
          return (
            <a href={`tel:${v.replace(/[^0-9+]/g, "")}`} className="hover:underline">
              {v}
            </a>
          );
        }
        if (f.type === "currency" || f.type === "number" || f.type === "percent" || f.type === "formula") {
          return <span className="block text-right tabular-nums">{text}</span>;
        }
        return <span title={text.length > 40 ? text : undefined}>{text}</span>;
      },
    }));
    if (LeadAction) {
      cols.unshift({
        id: LEAD_COL,
        header: entity.leadAction === "plan" ? "Tạo đơn" : "",
        size: 76,
        enableResizing: false,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => <LeadAction row={row.original} onDone={() => router.refresh()} />,
      });
    }
    cols.push({
      id: ACTIONS_COL,
      header: "",
      size: entity.rowActions ? (ROW_ACTION_WIDTH[entity.rowActions] ?? 200) : 92,
      enableResizing: false,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          {RowAction ? <RowAction row={row.original} onDone={() => router.refresh()} /> : null}
          {entity.readOnlyRows ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Xem chi tiết"
              title="Xem chi tiết"
              onClick={() => {
                setEditing(row.original);
                setFormOpen(true);
              }}
            >
              <Eye className="size-3.5" />
            </Button>
          ) : null}
          {access.update ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label="Sửa"
              title="Sửa"
              onClick={() => {
                setEditing(row.original);
                setFormOpen(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
          ) : null}
          {access.delete ? (
            <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="Xóa" title="Xóa" onClick={() => setDeleting(row.original)}>
              <Trash2 className="size-3.5" />
            </Button>
          ) : null}
        </div>
      ),
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, refLabels, access.update, access.delete]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => String(r[pk]),
    manualSorting: true,
    manualPagination: true,
    columnResizeMode: "onChange",
    state: { columnVisibility: visibility, columnOrder: order, columnSizing: sizing, columnPinning: pinning },
    onColumnVisibilityChange: setVisibility,
    onColumnOrderChange: setOrder,
    onColumnSizingChange: setSizing,
    onColumnPinningChange: setPinning,
  });

  const pageCount = Math.max(1, Math.ceil(total / size));
  const leafColumns = table.getAllLeafColumns().filter((c) => !isSysCol(c.id));

  function currentConfig(): TableViewConfig {
    return {
      hidden: Object.entries(visibility).filter(([, v]) => !v).map(([k]) => k),
      order: table.getAllLeafColumns().map((c) => c.id).filter((id) => !isSysCol(id)),
      widths: sizing,
      pinned: (pinning.left ?? []).filter((id) => id !== LEAD_COL),
      density,
      rowHeight,
      pageSize: size,
    };
  }

  function moveColumn(id: string, delta: number) {
    const ids = table.getAllLeafColumns().map((c) => c.id).filter((x) => !isSysCol(x));
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrder(ids);
  }

  function pinStyle(col: Column<Row>, header = false): CSSProperties {
    const side = col.getIsPinned();
    if (!side) return { width: col.getSize() };
    return {
      width: col.getSize(),
      position: "sticky",
      left: side === "left" ? col.getStart("left") : undefined,
      right: side === "right" ? col.getAfter("right") : undefined,
      zIndex: header ? 3 : 1,
    };
  }

  const tabField = props.statusCounts ? fields.find((f) => f.key === props.statusCounts!.field) : undefined;
  const filterFields = fields.filter(
    (f) => f.filter && f !== tabField && (f.type === "select" || f.type === "boolean" || f.type === "reference"),
  );
  const cellPad = density === "compact" ? "px-2 py-1" : "px-3 py-2";
  const tall = rowHeight !== null && rowHeight >= 52;

  return (
    <Card className="overflow-hidden">
      {tabField && props.statusCounts ? (
        <div className="flex gap-1 overflow-x-auto border-b px-3 pt-2" role="tablist" aria-label={`Lọc theo ${tabField.label.toLowerCase()}`}>
          {[{ value: "", label: "Tất cả" }, ...(tabField.options ?? [])].map((o) => {
            const active = (props.filters[tabField.key] ?? "") === o.value;
            const n = props.statusCounts!.counts[o.value || "all"] ?? 0;
            return (
              <button
                key={o.value || "all"}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setParams({ [`f_${tabField.key}`]: o.value, page: null })}
                className={cn(
                  "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
                  active ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[11px] tabular-nums",
                    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {n.toLocaleString("en-US")}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <form
          className="relative w-full sm:w-64"
          onSubmit={(e) => {
            e.preventDefault();
            setParams({ q, page: null });
          }}
        >
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm kiếm… (Enter)" className="pl-8" aria-label="Tìm kiếm" />
        </form>
        {filterFields.map((f) => (
          <NativeSelect
            key={f.key}
            aria-label={`Lọc theo ${f.label}`}
            className="h-9 w-auto max-w-48"
            value={props.filters[f.key] ?? ""}
            onChange={(e) => setParams({ [`f_${f.key}`]: e.target.value, page: null })}
          >
            <option value="">{f.label}: tất cả</option>
            {f.type === "boolean" ? (
              <>
                <option value="true">{f.label}: Có</option>
                <option value="false">{f.label}: Không</option>
              </>
            ) : (
              (f.type === "select" ? f.options ?? [] : props.filterOptions[f.key] ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))
            )}
          </NativeSelect>
        ))}
        <AdvancedFilter fields={advFields} value={advConds} valueLabels={props.advLabels} onApply={(conds) => setAdv(conds.map(encodeCondition))} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {access.configureFields && entity.customModule ? <AddFieldButton module={entity.customModule} entityKey={entityKey} customRows={customRows} /> : null}
          <ColumnsMenu
            columns={leafColumns}
            label={(c) => (c.columnDef.meta as { field: FieldDef } | undefined)?.field?.label ?? c.id}
            note={(c) => ((c.columnDef.meta as { field: FieldDef } | undefined)?.field?.custom ? "bổ sung" : null)}
            onMove={moveColumn}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDensity(density === "compact" ? "normal" : "compact")}
            title={density === "compact" ? "Giãn dòng" : "Thu gọn dòng"}
          >
            <Rows3 /> {density === "compact" ? "Thu gọn" : "Thường"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={savePending}
            onClick={() =>
              startSave(async () => {
                const r = await saveTableView(entityKey, currentConfig());
                if (r.ok) toast.success(r.message);
                else toast.error(r.error);
              })
            }
          >
            <Save /> Lưu cấu hình
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={savePending}
            title="Khôi phục cấu hình mặc định"
            onClick={() =>
              startSave(async () => {
                const r = await resetTableView(entityKey);
                if (r.ok) {
                  setVisibility(Object.fromEntries(fields.map((f) => [f.key, !base.hidden.includes(f.key)])));
                  setOrder([]);
                  setSizing({});
                  setPinning({ left: leftPins(base.pinned), right: [ACTIONS_COL] });
                  setDensity("normal");
                  setRowHeight(null);
                  toast.success(r.message);
                } else toast.error(r.error);
              })
            }
          >
            <RotateCcw /> Mặc định
          </Button>
          {access.export ? (
            <ExportButton
              entityKey={entityKey}
              params={{ q: props.q, sort: props.sort, dir: props.dir, filters: props.filters, adv: props.adv }}
              visibleColumns={table.getVisibleLeafColumns().map((c) => c.id).filter((id) => !isSysCol(id))}
            />
          ) : null}
          {access.import ? <ImportDialog entityKey={entityKey} revalidate={props.revalidate} /> : null}
          {access.create ? (
            <Button
              size="sm"
              onClick={() => {
                if (CreateAction) {
                  setCreateOpen(true);
                  return;
                }
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus /> {entity.createAction ? `Tạo ${entity.singular}` : "Thêm mới"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className={cn("max-h-[calc(100dvh-12rem)] overflow-auto transition-opacity", navPending && "opacity-60")}>
        <table className="w-full border-collapse text-sm" style={{ minWidth: table.getTotalSize(), tableLayout: "fixed" }}>
          <thead className="sticky top-0 z-20 bg-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const col = h.column;
                  const sorted = props.sort === col.id ? props.dir : null;
                  return (
                    <th
                      key={h.id}
                      style={pinStyle(col, true)}
                      draggable={!isSysCol(col.id) && !col.getIsResizing()}
                      onDragStart={(e) => {
                        setDragCol(col.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", col.id);
                      }}
                      onDragOver={(e) => {
                        if (dragCol && !isSysCol(col.id)) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        dropColumn(col.id);
                      }}
                      onDragEnd={() => setDragCol(null)}
                      title={!isSysCol(col.id) ? "Kéo để đổi vị trí cột" : undefined}
                      className={cn(
                        "relative border-b bg-muted text-left text-xs font-medium whitespace-nowrap text-muted-foreground",
                        !isSysCol(col.id) && "cursor-grab active:cursor-grabbing",
                        dragCol === col.id && "opacity-50",
                        cellPad,
                      )}
                    >
                      {col.getCanSort() ? (
                        <button
                          type="button"
                          className="inline-flex max-w-full items-center gap-1 hover:text-foreground"
                          onClick={() => setParams({ sort: col.id, dir: sorted === "asc" ? "desc" : "asc", page: null })}
                          title="Sắp xếp"
                        >
                          <span className="truncate">{flexRender(col.columnDef.header, h.getContext())}</span>
                          {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                        </button>
                      ) : (
                        <span className="truncate">{flexRender(col.columnDef.header, h.getContext())}</span>
                      )}
                      {col.getCanResize() ? (
                        <div
                          onMouseDown={h.getResizeHandler()}
                          onTouchStart={h.getResizeHandler()}
                          onDoubleClick={() => col.resetSize()}
                          className={cn("absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-primary/40", col.getIsResizing() && "bg-primary")}
                          aria-hidden
                        />
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} className="px-3 py-12 text-center text-muted-foreground">
                  {props.q || Object.keys(props.filters).length || advConds.length ? "Không có dữ liệu phù hợp với điều kiện tìm/lọc." : `Chưa có ${entity.singular} nào.`}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="group border-b last:border-0 hover:bg-muted/40" style={rowHeight ? { height: rowHeight } : undefined}>
                  {row.getVisibleCells().map((cell, ci) => (
                    <td
                      key={cell.id}
                      style={pinStyle(cell.column)}
                      className={cn("bg-card group-hover:bg-muted", tall ? "align-top break-words whitespace-normal" : "truncate", ci === 0 && "relative", cellPad)}
                    >
                      {tall ? (
                        <div className="overflow-hidden" style={{ maxHeight: rowHeight! - 12 }}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                      ) : (
                        flexRender(cell.column.columnDef.cell, cell.getContext())
                      )}
                      {ci === 0 ? (
                        <div
                          onPointerDown={startRowResize}
                          onDoubleClick={() => setRowHeight(null)}
                          className="absolute right-0 bottom-0 left-0 h-1.5 cursor-row-resize hover:bg-primary/40"
                          title="Kéo để đổi chiều cao dòng (bấm đúp để trả về mặc định)"
                          aria-hidden
                        />
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
        <span>
          {total === 0 ? "0 bản ghi" : `${(page - 1) * size + 1}–${Math.min(page * size, total)} / ${total} bản ghi`}
        </span>
        <div className="flex items-center gap-2">
          <NativeSelect className="h-8 w-auto" aria-label="Số dòng mỗi trang" value={size} onChange={(e) => setParams({ size: e.target.value, page: null })}>
            {[20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} dòng/trang
              </option>
            ))}
          </NativeSelect>
          <Button variant="outline" size="icon" className="size-8" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) })} aria-label="Trang trước">
            <ChevronLeft />
          </Button>
          <span>
            Trang {page}/{pageCount}
          </span>
          <Button variant="outline" size="icon" className="size-8" disabled={page >= pageCount} onClick={() => setParams({ page: String(page + 1) })} aria-label="Trang sau">
            <ChevronRight />
          </Button>
        </div>
      </div>

      {access.create || access.update || access.view ? (
        <EntityFormDialog
          readOnly={Boolean(editing) && !access.update}
          key={editing ? String(editing[pk]) : "new"}
          entityKey={entityKey}
          customRows={customRows}
          open={formOpen}
          onOpenChange={setFormOpen}
          record={editing}
          refLabels={refLabels}
          revalidate={props.revalidate}
          onSaved={() => router.refresh()}
          canAddField={access.configureFields}
        />
      ) : null}
      {CreateAction && createOpen ? (
        <CreateAction
          open={createOpen}
          onOpenChange={setCreateOpen}
          customRows={customRows}
          canAddField={access.configureFields}
          prefill={prefill}
          onDone={() => {
            setCreateOpen(false);
            router.refresh();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Xóa ${entity.singular}?`}
        description={
          <>
            Bản ghi <b>{deleting ? String(deleting.code ?? deleting[entity.labelCols[0]] ?? "") : ""}</b> sẽ bị xóa vĩnh viễn. Nếu dữ liệu đã được sử dụng ở chuyến, bảng giá hoặc
            chứng từ, hệ thống sẽ từ chối và bạn nên chuyển sang trạng thái ngừng sử dụng.
          </>
        }
        confirmLabel="Xóa"
        destructive
        pending={delPending}
        onConfirm={() =>
          startDelete(async () => {
            const r = await deleteRecord(entityKey, String(deleting?.[pk]), props.revalidate);
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
