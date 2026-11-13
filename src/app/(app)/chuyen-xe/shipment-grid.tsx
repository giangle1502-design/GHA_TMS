"use client";
import { DriverPayCell } from "@/components/dispatch/driver-pay-cell";
import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
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
import { Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdvancedFilter } from "@/components/advanced-filter";
import { ColumnsMenu } from "@/components/grid/columns-menu";
import { AddFieldButton } from "@/components/entities/add-field-button";
import { encodeCondition, parseConditions, type AdvField } from "@/lib/advanced-filter";
import { formatValue } from "@/lib/entities/record";
import { computeFormula } from "@/lib/formula";
import { formulaVars } from "@/lib/entities/definitions";
import { resetTableView, saveTableView } from "@/lib/entities/actions";
import type { FieldDef, TableViewConfig } from "@/lib/entities/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { LOCKED_STATUSES, PRICING_UNITS } from "@/lib/status";
import { ASSIGNED_ROW_CELL, DROP_OFF_RE, SHIPMENT_ADV_FIELDS, isAssignedRow, isLate, type ShipmentListRow } from "@/lib/shipments";
import { StatusBadge } from "@/components/dispatch/status-badge";
import { updateShipmentField, type EditableField } from "./actions";
import { DriverInfoButton } from "@/components/dispatch/driver-info-button";

type Col = {
  key: string;
  label: string;
  width: number;
  align?: "right";
  edit?: EditableField;
  custom?: boolean;
  /** Ẩn khi người dùng chưa lưu cách hiển thị riêng (bật lại trong Chọn cột) */
  defaultHidden?: boolean;
  /** Cột lời/lỗ: chỉ hiện với người có quyền xem chi phí hoặc báo cáo */
  profit?: boolean;
  render: (r: ShipmentListRow) => ReactNode;
};

const COLS: Col[] = [
  { key: "pickup_at", label: "Ngày nhận", width: 110, render: (r) => formatDate(r.pickup_at) },
  {
    key: "shipment_code",
    label: "Mã chuyến",
    width: 170,
    render: (r) => (
      <Link href={`/chuyen-xe/${r.id}`} className="font-medium text-primary hover:underline">
        {r.shipment_code}
      </Link>
    ),
  },
  {
    key: "order_code",
    label: "Đơn hàng",
    width: 150,
    render: (r) => (
      <Link href={`/dieu-phoi/don-hang/${r.order_id}`} className="hover:text-primary hover:underline">
        {r.order_code}
      </Link>
    ),
  },
  {
    key: "customer_code",
    label: "Mã KH",
    width: 90,
    render: (r) => <span title={r.customer_name ?? undefined}>{r.customer_code ?? r.customer_name}</span>,
  },
  { key: "customer_name", label: "Khách hàng", width: 180, defaultHidden: true, render: (r) => r.customer_name },
  { key: "pickup_name", label: "Điểm nhận", width: 170, render: (r) => r.pickup_name },
  { key: "delivery_name", label: "Điểm giao", width: 170, render: (r) => r.delivery_name },
  { key: "route_label", label: "Tuyến đường", width: 240, render: (r) => r.route_label ?? `${r.pickup_name ?? ""} → ${r.delivery_name ?? ""}` },
  { key: "empty_return_name", label: "Điểm hạ rỗng", width: 160, render: (r) => r.empty_return_name },
  {
    key: "offroute_return_name",
    label: "Hạ rỗng trái tuyến",
    width: 160,
    render: (r) => (r.offroute_return_name ? <span className="font-medium text-amber-700 dark:text-amber-400">{r.offroute_return_name}</span> : null),
  },
  { key: "trip_order", label: "Thứ tự chuyến", width: 90, align: "right", render: (r) => (r.trip_order ? formatNumber(r.trip_order) : "") },
  { key: "driver_pay", label: "Lương chuyến", width: 110, align: "right", render: (r) => <DriverPayCell r={r} /> },
  {
    key: "delivery_days",
    label: "Số ngày giao",
    width: 84,
    align: "right",
    defaultHidden: true,
    render: (r) => r.delivery_days ?? (r.work_days && r.work_days > 1 ? r.work_days : ""),
  },
  { key: "plan_code", label: "Kế hoạch", width: 100, defaultHidden: true, render: (r) => r.plan_code },
  { key: "vehicle_type_name", label: "Loại xe", width: 120, render: (r) => r.vehicle_type_name },
  { key: "plate_number", label: "Biển số", width: 100, render: (r) => r.plate_number },
  { key: "driver_name", label: "Tài xế", width: 150, render: (r) => r.driver_name },
  { key: "quantity", label: "SL", width: 70, align: "right", edit: "quantity", render: (r) => formatNumber(r.quantity) },
  { key: "pricing_unit", label: "ĐVT", width: 76, render: (r) => PRICING_UNITS[r.pricing_unit] ?? r.pricing_unit },
  { key: "unit_price", label: "Đơn giá", width: 120, align: "right", edit: "unit_price", render: (r) => (Number(r.unit_price) ? formatVND(r.unit_price) : <span className="text-amber-700">Chưa có giá</span>) },
  { key: "freight_amount", label: "Cước (đơn giá × SL)", width: 130, align: "right", defaultHidden: true, render: (r) => formatVND(r.freight_amount) },
  { key: "surcharge_amount", label: "Phụ phí bảng giá", width: 120, align: "right", edit: "surcharge_amount", defaultHidden: true, render: (r) => formatVND(r.surcharge_amount) },
  {
    key: "fuel_support_rate",
    label: "% dầu",
    width: 72,
    align: "right",
    edit: "fuel_support_rate",
    render: (r) => (r.fuel_support_rate === null ? "–" : `${formatNumber(r.fuel_support_rate)}%`),
  },
  { key: "fuel_support_amount", label: "Hỗ trợ dầu", width: 115, align: "right", defaultHidden: true, render: (r) => formatVND(r.fuel_support_amount) },
  {
    key: "transport_fee",
    label: "Phí vận chuyển",
    width: 135,
    align: "right",
    render: (r) => <b title="Đơn giá × SL × (1 + % dầu) + phụ phí + phụ thu vé, hạ xa + BOT, neo">{formatVND(r.transport_fee ?? Number(r.freight_amount) + Number(r.surcharge_amount) + Number(r.fuel_support_amount))}</b>,
  },
  { key: "pass_through_fee", label: "Phí chi hộ", width: 115, align: "right", render: (r) => formatVND(r.pass_through_fee ?? 0) },
  { key: "declaration_fee", label: "Phí tờ khai", width: 110, align: "right", render: (r) => formatVND(r.declaration_fee ?? 0) },
  { key: "loading_fee", label: "Phí bốc xếp", width: 110, align: "right", render: (r) => formatVND(r.loading_fee ?? 0) },
  { key: "extra_fee_amount", label: "Phí khác (tính doanh thu)", width: 130, align: "right", defaultHidden: true, render: (r) => formatVND(r.extra_fee_amount) },
  { key: "total_revenue", label: "Doanh thu", width: 130, align: "right", render: (r) => formatVND(r.total_revenue) },
  { key: "pass_through_amount", label: "Không tính doanh thu (chi hộ + bốc xếp)", width: 115, align: "right", defaultHidden: true, render: (r) => formatVND(r.pass_through_amount) },
  { key: "amount_due", label: "Khách phải trả", width: 130, align: "right", render: (r) => <b>{formatVND(r.amount_due)}</b> },
  { key: "trip_cost", label: "Chi phí chuyến", width: 120, align: "right", profit: true, render: (r) => (r.trip_cost == null ? "" : formatVND(r.trip_cost)) },
  { key: "vehicle_cost", label: "Chi phí xe chia về", width: 120, align: "right", profit: true, defaultHidden: true, render: (r) => (r.vehicle_cost == null ? "" : formatVND(r.vehicle_cost)) },
  {
    key: "profit",
    label: "Lời/lỗ",
    width: 125,
    align: "right",
    profit: true,
    render: (r) =>
      r.profit == null ? (
        ""
      ) : (
        <b
          className={Number(r.profit) >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}
          title="Doanh thu − chi phí chuyến đã duyệt − chi phí xe chia về"
        >
          {formatVND(r.profit)}
        </b>
      ),
  },
  {
    key: "status",
    label: "Trạng thái",
    width: 190,
    render: (r) => (
      <span className="flex flex-wrap gap-1">
        <StatusBadge status={r.status} />
        {r.dispatch_approval === "pending" || r.dispatch_approval === "rejected" ? <StatusBadge kind="approval" status={r.dispatch_approval} /> : null}
        {isLate(r) ? <Badge variant="destructive">Trễ</Badge> : null}
      </span>
    ),
  },
  {
    key: "dispatch_approval",
    label: "Giám đốc duyệt",
    width: 150,
    render: (r) => (r.dispatch_approval ? <StatusBadge kind="approval" status={r.dispatch_approval} /> : null),
  },
  { key: "document_status", label: "Chứng từ", width: 140, render: (r) => <StatusBadge kind="document" status={r.document_status} /> },
  { key: "settlement_status", label: "Quyết toán", width: 160, render: (r) => <StatusBadge kind="settlement" status={r.settlement_status} /> },
  { key: "notes", label: "Ghi chú", width: 220, edit: "notes", render: (r) => r.notes },
];

const DEFAULT_PINNED = ["pickup_at", "shipment_code"];

/** Tuyến đường kèm dòng "Hạ hàng: ..." khi có trường bổ sung "Điểm hạ hàng" */
function routeWithDropOff(r: ShipmentListRow, d: FieldDef) {
  const route = r.route_label ?? `${r.pickup_name ?? ""} → ${r.delivery_name ?? ""}`;
  const v = formatValue(d, r.custom_fields?.[d.key]);
  if (!v) return route;
  return (
    <>
      <div className="whitespace-normal">{route}</div>
      <div className="truncate text-xs text-muted-foreground" title={`Điểm hạ hàng: ${v}`}>
        Hạ hàng: {v}
      </div>
    </>
  );
}

/** Bảng chuyến dạng Excel: chọn/ẩn cột, kéo đổi chỗ, kéo giãn cột và dòng, cố định cột, sửa nhanh các ô được phép */
export function ShipmentGrid({
  rows: initial,
  canEdit,
  view,
  adv,
  advLabels,
  customDefs,
  customAdv,
  canAddField = false,
  canSeeProfit = false,
  canFillDriver = false,
}: {
  rows: ShipmentListRow[];
  canEdit: boolean;
  view: TableViewConfig | null;
  adv: string[];
  advLabels: Record<string, string>;
  /** Trường bổ sung của chuyến (người dùng tự thêm): hiện thành cột */
  customDefs: FieldDef[];
  customAdv: AdvField[];
  canAddField?: boolean;
  canSeeProfit?: boolean;
  /** Điền nhanh CCCD / GPLX còn thiếu trong hộp Thông tin tài xế */
  canFillDriver?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();
  const [savePending, startSave] = useTransition();
  const [rows, setRows] = useState(initial);
  // Dữ liệu mới từ máy chủ (đổi bộ lọc, chuyển trang) thay cho bản đang sửa
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setRows(initial);
  }
  const [visibility, setVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries((view?.hidden ?? COLS.filter((c) => c.defaultHidden).map((c) => c.key)).map((k) => [k, false])),
  );
  const [order, setOrder] = useState<ColumnOrderState>(() => view?.order ?? []);
  const [sizing, setSizing] = useState<ColumnSizingState>(() => view?.widths ?? {});
  const [pinning, setPinning] = useState<ColumnPinningState>(() => ({ left: view?.pinned ?? DEFAULT_PINNED }));
  const [rowHeight, setRowHeight] = useState<number | null>(view?.rowHeight ?? null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const resizeRow = useRef<{ y: number; h: number } | null>(null);
  const advFields = useMemo(() => [...SHIPMENT_ADV_FIELDS, ...customAdv], [customAdv]);
  const advConds = useMemo(() => parseConditions(adv, advFields), [adv, advFields]);
  const dropDef = useMemo(() => customDefs.find((d) => DROP_OFF_RE.test(d.label.normalize("NFC"))), [customDefs]);
  const allCols = useMemo<Col[]>(
    () => [
      ...COLS.filter((c) => canSeeProfit || !c.profit).map((c) => (c.key === "route_label" && dropDef ? { ...c, render: (r: ShipmentListRow) => routeWithDropOff(r, dropDef) } : c)),
      ...customDefs.map((d) => ({
        key: `cf_${d.key}`,
        label: d.label,
        width: d.type === "textarea" ? 220 : 140,
        align: ["number", "currency", "percent", "formula"].includes(d.type) ? ("right" as const) : undefined,
        custom: true,
        render: (r: ShipmentListRow) => formatValue(d, d.type === "formula" ? computeFormula(d.formula, formulaVars("shipments", r as unknown as Record<string, unknown>, r.custom_fields)) : r.custom_fields?.[d.key]),
      })),
    ],
    [customDefs, canSeeProfit, dropDef],
  );

  const columns = useMemo<ColumnDef<ShipmentListRow>[]>(
    () =>
      allCols.map((c) => ({
        id: c.key,
        header: c.label,
        size: c.width,
        minSize: 50,
        meta: { col: c },
        cell: ({ row }) => {
          const r = row.original;
          const editable = canEdit && c.edit && (c.edit === "notes" || !LOCKED_STATUSES.includes(r.status));
          if (c.key === "driver_name" && r.driver_id)
            return (
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate">{r.driver_name}</span>
                <DriverInfoButton compact shipmentIds={[r.id]} canFill={canFillDriver} />
              </div>
            );
          return editable ? <EditCell row={r} col={c} onSaved={(nr) => setRows((rs) => rs.map((x) => (x.id === nr.id ? nr : x)))} /> : c.render(r);
        },
      })),
    [canEdit, allCols, canFillDriver],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
    columnResizeMode: "onChange",
    state: { columnVisibility: visibility, columnOrder: order, columnSizing: sizing, columnPinning: pinning },
    onColumnVisibilityChange: setVisibility,
    onColumnOrderChange: setOrder,
    onColumnSizingChange: setSizing,
    onColumnPinningChange: setPinning,
  });
  const ids = () => table.getAllLeafColumns().map((c) => c.id);

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
    const from = list.indexOf(dragCol);
    const to = list.indexOf(target);
    list.splice(to, 0, list.splice(from, 1)[0]);
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
  function setAdv(list: string[]) {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("a");
    sp.delete("trang");
    for (const a of list) sp.append("a", a);
    startNav(() => router.push(`${pathname}?${sp.toString()}`, { scroll: false }));
  }
  function pinStyle(col: Column<ShipmentListRow>, header = false): CSSProperties {
    const side = col.getIsPinned();
    return side
      ? { width: col.getSize(), minWidth: col.getSize(), maxWidth: col.getSize(), position: "sticky", left: col.getStart("left"), zIndex: header ? 30 : 10 }
      : { width: col.getSize(), minWidth: col.getSize(), maxWidth: col.getSize() };
  }
  const tall = rowHeight !== null && rowHeight >= 52;
  const label = (c: Column<ShipmentListRow>) => (c.columnDef.meta as { col: Col }).col.label;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <AdvancedFilter fields={advFields} value={advConds} valueLabels={advLabels} onApply={(conds) => setAdv(conds.map(encodeCondition))} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canAddField ? <AddFieldButton module="shipments" customRows={[]} label="Thêm cột (trường)" /> : null}
          <ColumnsMenu columns={table.getAllLeafColumns()} label={label} note={(c) => ((c.columnDef.meta as { col: Col }).col.custom ? "bổ sung" : null)} onMove={moveColumn} />
          <Button
            variant="outline"
            size="sm"
            disabled={savePending}
            onClick={() =>
              startSave(async () => {
                const r = await saveTableView("shipment_grid", {
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
                const r = await resetTableView("shipment_grid");
                if (!r.ok) return void toast.error(r.error);
                setVisibility({});
                setOrder([]);
                setSizing({});
                setPinning({ left: DEFAULT_PINNED });
                setRowHeight(null);
                toast.success(r.message);
              })
            }
          >
            <RotateCcw /> Mặc định
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-muted-foreground">Không có chuyến phù hợp với bộ lọc.</p>
      ) : (
        <div className={cn("max-h-[calc(100dvh-12rem)] overflow-auto transition-opacity", navPending && "opacity-60")}>
          <table className="border-separate border-spacing-0 text-sm" style={{ width: table.getTotalSize(), tableLayout: "fixed" }}>
            <thead className="sticky top-0 z-20 bg-muted text-left text-xs text-muted-foreground">
              <tr>
                {table.getFlatHeaders().map((h) => {
                  const col = h.column;
                  const c = (col.columnDef.meta as { col: Col }).col;
                  const lastPinned = col.getIsPinned() && col.getIsLastColumn("left");
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
                        "relative cursor-grab border-b bg-muted px-2 py-2 font-medium whitespace-nowrap active:cursor-grabbing",
                        c.align === "right" && "text-right",
                        lastPinned && "border-r",
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
              {table.getRowModel().rows.map((row) => {
                const r = row.original;
                const assigned = isAssignedRow(r);
                return (
                  <tr key={row.id} style={rowHeight ? { height: rowHeight } : undefined} className={cn("group", r.status === "cancelled" && "text-muted-foreground line-through decoration-muted-foreground/40")}>
                    {row.getVisibleCells().map((cell, ci) => {
                      const c = (cell.column.columnDef.meta as { col: Col }).col;
                      const lastPinned = cell.column.getIsPinned() && cell.column.getIsLastColumn("left");
                      return (
                        <td
                          key={cell.id}
                          style={pinStyle(cell.column)}
                          className={cn(
                            "border-b px-2 py-1.5",
                            assigned ? ASSIGNED_ROW_CELL : "bg-card group-hover:bg-muted/40",
                            c.align === "right" && "text-right tabular-nums",
                            tall ? "align-top break-words whitespace-normal" : "truncate whitespace-nowrap",
                            lastPinned && "border-r",
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
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function EditCell({ row, col, onSaved }: { row: ShipmentListRow; col: Col; onSaved: (r: ShipmentListRow) => void }) {
  const field = col.edit!;
  const raw = row[field as keyof ShipmentListRow] as number | string | null;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const isText = field === "notes";

  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  async function commit() {
    const original = raw === null ? "" : String(raw);
    if (val.trim() === original.trim()) return setEditing(false);
    let value: number | string | null;
    if (isText) value = val.trim() || null;
    else if (val.trim() === "") {
      if (field !== "fuel_support_rate") return void toast.error("Không được để trống.");
      value = null;
    } else {
      value = Number(val.replace(",", "."));
      if (!Number.isFinite(value)) return void toast.error("Giá trị phải là số.");
    }
    setSaving(true);
    const r = await updateShipmentField(row.id, field, value, row.version);
    setSaving(false);
    if (!r.ok || !r.data) return void toast.error(r.ok ? "Không lưu được" : r.error);
    onSaved(r.data);
    setEditing(false);
    toast.success(`${row.shipment_code}: đã lưu ${col.label.toLowerCase()}.`);
  }

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <input
          ref={ref}
          aria-label={`${col.label} chuyến ${row.shipment_code}`}
          className={cn("h-7 w-full min-w-0 rounded border border-ring bg-background px-1.5 text-sm outline-none", !isText && "text-right")}
          type={isText ? "text" : "number"}
          step="any"
          value={val}
          disabled={saving}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => !saving && commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") setEditing(false);
          }}
        />
        {saving ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : null}
      </span>
    );
  }
  return (
    <button
      type="button"
      title="Bấm để sửa"
      className={cn(
        "block w-full truncate rounded border border-dashed border-transparent px-1 py-0.5 hover:border-muted-foreground/50 hover:bg-background",
        col.align === "right" ? "text-right" : "text-left",
        "decoration-dotted underline-offset-4 [text-decoration-line:underline] [text-decoration-color:var(--color-muted-foreground)]",
      )}
      onClick={() => {
        setVal(raw === null ? "" : String(raw));
        setEditing(true);
      }}
    >
      {col.render(row) || <span className="text-muted-foreground">…</span>}
    </button>
  );
}
