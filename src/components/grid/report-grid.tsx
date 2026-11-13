"use client";
import { useMemo, useRef, useState, useTransition, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
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
import { Download, Printer, RotateCcw, Save, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AdvancedFilter } from "@/components/advanced-filter";
import { ColumnsMenu } from "@/components/grid/columns-menu";
import { matchCondition, type AdvCondition, type AdvField, type AdvFieldKind } from "@/lib/advanced-filter";
import { resetTableView, saveTableView } from "@/lib/entities/actions";
import type { TableViewConfig } from "@/lib/entities/types";
import { cn } from "@/lib/utils";

export type ReportColumn<T> = {
  key: string;
  label: string;
  width: number;
  align?: "right";
  /** Kiểu dữ liệu cho tìm kiếm nâng cao (mặc định: chữ) */
  kind?: AdvFieldKind;
  options?: { value: string; label: string }[];
  /** Giá trị thô để tìm kiếm / lọc */
  value: (r: T) => string | number | null | undefined;
  /** Cách hiển thị (mặc định: giá trị thô) */
  render?: (r: T) => ReactNode;
};

const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/**
 * Bảng báo cáo tính sẵn (dữ liệu đã có ở trình duyệt): ô tìm kiếm, tìm kiếm nâng cao, chọn/ẩn cột,
 * kéo đổi chỗ, kéo giãn cột và dòng, cố định cột, lưu cấu hình theo người dùng.
 */
export function ReportGrid<T>({
  tableKey,
  rows,
  columns: cols,
  view,
  getRowId,
  defaultPinned = [],
  searchPlaceholder = "Tìm trong bảng…",
  emptyText = "Không có dữ liệu.",
  toolbar,
  onExport,
  onPrint,
}: {
  tableKey: string;
  rows: T[];
  columns: ReportColumn<T>[];
  view: TableViewConfig | null;
  getRowId: (r: T) => string;
  defaultPinned?: string[];
  searchPlaceholder?: string;
  emptyText?: string;
  /** Nút/bộ lọc thêm bên trái thanh công cụ */
  toolbar?: ReactNode;
  /** Có thì hiện nút "Xuất Excel": nhận các cột đang hiện (đúng thứ tự) và các dòng đang lọc */
  onExport?: (columns: ReportColumn<T>[], rows: T[]) => void | Promise<void>;
  /** Có thì hiện nút "In": nhận các cột đang hiện (đúng thứ tự) và các dòng đang lọc */
  onPrint?: (columns: ReportColumn<T>[], rows: T[]) => void;
}) {
  const [savePending, startSave] = useTransition();
  const [term, setTerm] = useState("");
  const [exporting, setExporting] = useState(false);
  const [adv, setAdv] = useState<AdvCondition[]>([]);
  const [visibility, setVisibility] = useState<VisibilityState>(() => Object.fromEntries((view?.hidden ?? []).map((k) => [k, false])));
  const [order, setOrder] = useState<ColumnOrderState>(() => view?.order ?? []);
  const [sizing, setSizing] = useState<ColumnSizingState>(() => view?.widths ?? {});
  const [pinning, setPinning] = useState<ColumnPinningState>(() => ({ left: view?.pinned ?? defaultPinned }));
  const [rowHeight, setRowHeight] = useState<number | null>(view?.rowHeight ?? null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const resizeRow = useRef<{ y: number; h: number } | null>(null);

  const advFields = useMemo<AdvField[]>(() => cols.map((c) => ({ key: c.key, label: c.label, kind: c.kind ?? "text", options: c.options })), [cols]);
  const filtered = useMemo(() => {
    const t = fold(term.trim());
    return rows.filter(
      (r) =>
        (!t || cols.some((c) => fold(String(c.value(r) ?? "")).includes(t))) &&
        adv.every((a) => {
          const c = cols.find((x) => x.key === a.field);
          return !c || matchCondition(c.value(r), c.kind ?? "text", a.op, a.value);
        }),
    );
  }, [rows, cols, term, adv]);

  const columns = useMemo<ColumnDef<T>[]>(
    () =>
      cols.map((c) => ({
        id: c.key,
        header: c.label,
        size: c.width,
        minSize: 50,
        meta: { col: c },
        cell: ({ row }) => (c.render ? c.render(row.original) : (c.value(row.original) ?? "")),
      })),
    [cols],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    columnResizeMode: "onChange",
    state: { columnVisibility: visibility, columnOrder: order, columnSizing: sizing, columnPinning: pinning },
    onColumnVisibilityChange: setVisibility,
    onColumnOrderChange: setOrder,
    onColumnSizingChange: setSizing,
    onColumnPinningChange: setPinning,
  });
  const ids = () => table.getAllLeafColumns().map((c) => c.id);
  const meta = (c: Column<T>) => (c.columnDef.meta as { col: ReportColumn<T> }).col;

  function moveColumn(id: string, delta: number) {
    const list = ids();
    const i = list.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setOrder(list);
  }
  function dropColumn(target: string) {
    if (!dragCol || dragCol === target) return;
    const list = ids();
    list.splice(list.indexOf(target), 0, list.splice(list.indexOf(dragCol), 1)[0]);
    setOrder(list);
    setDragCol(null);
  }
  function startRowResize(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const tr = (e.currentTarget as HTMLElement).closest("tr");
    resizeRow.current = { y: e.clientY, h: tr?.getBoundingClientRect().height ?? 36 };
    const move = (ev: PointerEvent) => {
      if (resizeRow.current) setRowHeight(Math.round(Math.min(200, Math.max(28, resizeRow.current.h + ev.clientY - resizeRow.current.y))));
    };
    const up = () => {
      resizeRow.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  function pinStyle(col: Column<T>, header = false): CSSProperties {
    const size = { width: col.getSize(), minWidth: col.getSize(), maxWidth: col.getSize() };
    return col.getIsPinned() ? { ...size, position: "sticky", left: col.getStart("left"), zIndex: header ? 30 : 10 } : size;
  }
  const tall = rowHeight !== null && rowHeight >= 52;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={searchPlaceholder} aria-label="Tìm trong bảng" className="h-8 pl-8" />
        </div>
        <AdvancedFilter fields={advFields} value={adv} onApply={setAdv} />
        {toolbar}
        {onExport ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!filtered.length || exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await onExport(table.getVisibleLeafColumns().map((c) => meta(c)), filtered);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Không xuất được Excel");
              } finally {
                setExporting(false);
              }
            }}
          >
            <Download /> {exporting ? "Đang xuất…" : "Xuất Excel"}
          </Button>
        ) : null}
        {onPrint ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!filtered.length}
            title="In các cột đang hiện, hoặc chọn Lưu dưới dạng PDF"
            onClick={() => onPrint(table.getVisibleLeafColumns().map((c) => meta(c)), filtered)}
          >
            <Printer /> In / PDF
          </Button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ColumnsMenu columns={table.getAllLeafColumns()} label={(c) => meta(c).label} onMove={moveColumn} />
          <Button
            variant="outline"
            size="sm"
            disabled={savePending}
            onClick={() =>
              startSave(async () => {
                const r = await saveTableView(tableKey, {
                  hidden: Object.entries(visibility).filter(([, v]) => !v).map(([k]) => k),
                  order: ids(),
                  widths: sizing,
                  pinned: pinning.left ?? [],
                  rowHeight,
                  pageSize: 100,
                });
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
                const r = await resetTableView(tableKey);
                if (!r.ok) return void toast.error(r.error);
                setVisibility({});
                setOrder([]);
                setSizing({});
                setPinning({ left: defaultPinned });
                setRowHeight(null);
                toast.success(r.message);
              })
            }
          >
            <RotateCcw /> Mặc định
          </Button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-muted-foreground">{rows.length && (term || adv.length) ? "Không có dòng phù hợp với điều kiện tìm." : emptyText}</p>
      ) : (
        <div className="max-h-[calc(100dvh-12rem)] overflow-auto">
          <table className="border-separate border-spacing-0 text-sm" style={{ width: table.getTotalSize(), tableLayout: "fixed" }}>
            <thead className="sticky top-0 z-20 bg-sky-100 text-left text-xs text-sky-950 dark:bg-sky-950 dark:text-sky-100">
              <tr>
                {table.getFlatHeaders().map((h) => {
                  const col = h.column;
                  const c = meta(col);
                  return (
                    <th
                      key={h.id}
                      style={pinStyle(col, true)}
                      draggable={!col.getIsResizing()}
                      onDragStart={(e) => {
                        setDragCol(col.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", col.id);
                      }}
                      onDragOver={(e) => dragCol && e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        dropColumn(col.id);
                      }}
                      onDragEnd={() => setDragCol(null)}
                      title="Kéo để đổi vị trí cột"
                      className={cn(
                        "relative cursor-grab border-r border-b border-sky-200 bg-sky-100 px-2 py-2 font-bold whitespace-nowrap active:cursor-grabbing dark:border-sky-800 dark:bg-sky-950",
                        c.align === "right" && "text-right",
                        col.getIsPinned() && col.getIsLastColumn("left") && "border-r",
                        dragCol === col.id && "opacity-50",
                      )}
                    >
                      <span className="block truncate">{c.label}</span>
                      <div
                        onMouseDown={h.getResizeHandler()}
                        onTouchStart={h.getResizeHandler()}
                        onDoubleClick={() => col.resetSize()}
                        className={cn("absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-primary/40", col.getIsResizing() && "bg-primary")}
                        aria-hidden
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} style={rowHeight ? { height: rowHeight } : undefined} className="group">
                  {row.getVisibleCells().map((cell, ci) => {
                    const c = meta(cell.column);
                    return (
                      <td
                        key={cell.id}
                        style={pinStyle(cell.column)}
                        className={cn(
                          "border-r border-b bg-card px-2 py-1.5 group-hover:bg-muted/40",
                          c.align === "right" && "text-right tabular-nums",
                          tall ? "align-top break-words whitespace-normal" : "truncate whitespace-nowrap",
                          cell.column.getIsPinned() && cell.column.getIsLastColumn("left") && "border-r",
                          ci === 0 && "relative",
                        )}
                      >
                        {tall ? (
                          <div className="overflow-hidden" style={{ maxHeight: rowHeight! - 10 }}>
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
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        {filtered.length === rows.length ? `${rows.length} dòng` : `${filtered.length} / ${rows.length} dòng phù hợp`}
      </div>
    </>
  );
}
