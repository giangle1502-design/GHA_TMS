"use client";
import { useMemo, useRef, useState, useTransition, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnPinningState,
  type ColumnSizingState,
  type Row,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { toast } from "sonner";
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, Download, Loader2, Pencil, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ColumnsMenu } from "@/components/grid/columns-menu";
import { AddFieldButton } from "@/components/entities/add-field-button";
import { resetTableView, saveTableView } from "@/lib/entities/actions";
import { exportTableView } from "@/lib/table-export-actions";
import type { TableViewConfig } from "@/lib/entities/types";
import type { DispatchExtraColumn, DispatchExtraValues } from "@/lib/dispatch-columns";
import { formatDate, formatNumber } from "@/lib/format";
import { ASSIGNABLE_STATUSES, CANCELLABLE_STATUSES, LOCKED_STATUSES, shipmentStatus, tripApprovalStatus } from "@/lib/status";
import { ASSIGNED_ROW_CELL, isAssignedRow, isLate, type ShipmentListRow } from "@/lib/shipments";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";
import { ActForDriverQuick } from "./act-for-driver-quick";
import { AssignDialog } from "./assign-dialog";
import { CrewChangeDialog } from "./crew-change-dialog";
import { CORRECT_CREW_STATUSES, UNACCEPT_STATUSES } from "@/lib/crew-change";
import { VehicleOrderCell } from "./vehicle-order-cell";
import { DeliveryDaysCell } from "./delivery-days-cell";
import { DriverPayCell } from "./driver-pay-cell";
import { CancelDialog, DeleteCancelledButton, RestoreShipmentButton } from "./cancel-dialog";
import { ResubmitTripButton, TripApprovalButtons } from "./trip-approval";
import { DriverInfoButton } from "./driver-info-button";

type SortVal = string | number | null | undefined;
type Col = {
  key: string;
  label: string;
  width: number;
  align?: "right";
  /** Chỉ có khi bảng hiện đơn hàng/khách (màn hình Điều phối) */
  orderOnly?: boolean;
  defaultHidden?: boolean;
  /** Cột bổ sung do người dùng tự thêm */
  custom?: boolean;
  /** Ghi chú khi rê chuột lên tiêu đề */
  hint?: string;
  sort?: (r: ShipmentListRow) => SortVal;
  /** Giá trị khi xuất Excel (mặc định lấy giá trị sắp xếp) */
  text?: (r: ShipmentListRow, now: number) => string | number | null;
  render: (r: ShipmentListRow, now: number) => ReactNode;
};

const SERVICE_KIND_PLACEHOLDER = "service_kind";

/** Ô Tuyến đường: điểm nhận → điểm giao, kèm Hạ hàng (trường "Điểm hạ hàng" nếu có), Hạ rỗng, Hạ rỗng trái tuyến */
function routeCell(r: ShipmentListRow, dropOff?: string) {
  return (
      <>
        <div className="truncate" title={r.pickup_name ?? undefined}>
          {r.pickup_name}
        </div>
        <div className="flex items-center gap-1 text-muted-foreground" title={r.delivery_name ?? undefined}>
          <ArrowRight className="size-3.5 shrink-0" />
          <span className="truncate">{r.delivery_name}</span>
        </div>
        {dropOff ? (
          <div className="truncate text-xs text-muted-foreground" title={`Điểm hạ hàng: ${dropOff}`}>
            Hạ hàng: {dropOff}
          </div>
        ) : null}
        {r.empty_return_name ? (
          <div className="truncate text-xs text-muted-foreground" title={`Điểm hạ rỗng: ${r.empty_return_name}`}>
            Hạ rỗng: {r.empty_return_name}
          </div>
        ) : null}
        {r.offroute_return_name ? (
          <div className="truncate text-xs font-medium text-amber-700 dark:text-amber-400" title={`Điểm hạ rỗng trái tuyến: ${r.offroute_return_name}`}>
            Hạ rỗng trái tuyến: {r.offroute_return_name}
          </div>
        ) : null}
      </>
  );
}

/** Ô Tuyến đường dạng chữ cho Excel */
function routeText(r: ShipmentListRow, dropOff?: string) {
  return [
    `${r.pickup_name ?? ""} → ${r.delivery_name ?? ""}`,
    dropOff ? `Hạ hàng: ${dropOff}` : "",
    r.empty_return_name ? `Hạ rỗng: ${r.empty_return_name}` : "",
    r.offroute_return_name ? `Hạ rỗng trái tuyến: ${r.offroute_return_name}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const BASE_COLS: Col[] = [
  {
    key: "pickup_at",
    label: "Ngày nhận",
    width: 104,
    sort: (r) => r.pickup_at,
    text: (r) => formatDate(r.pickup_at),
    render: (r) => (
      <>
        <div className="font-medium">{formatDate(r.pickup_at)}</div>
        {r.expected_delivery_at && formatDate(r.expected_delivery_at) !== formatDate(r.pickup_at) ? (
          <div className="text-xs text-muted-foreground">Giao {formatDate(r.expected_delivery_at)}</div>
        ) : null}
      </>
    ),
  },
  {
    key: "shipment_code",
    label: "Mã chuyến",
    width: 150,
    sort: (r) => r.shipment_code,
    render: (r) => (
      <>
        <Link href={`/chuyen-xe/${r.id}`} className="font-medium whitespace-nowrap text-primary hover:underline">
          {r.shipment_code}
        </Link>
        {r.trip_order || r.plan_code ? (
          <div className="truncate text-xs text-muted-foreground">
            {r.trip_order ? <b className="text-primary">Thứ tự {r.trip_order}</b> : null}
            {r.trip_order && r.plan_code ? " · " : null}
            {r.plan_code ? (
              <Link href={`/ke-hoach?q=${encodeURIComponent(r.plan_code)}`} className="hover:text-primary hover:underline">
                KH {r.plan_code}
              </Link>
            ) : null}
          </div>
        ) : null}
      </>
    ),
  },
  {
    key: "customer",
    label: "Khách hàng",
    width: 130,
    orderOnly: true,
    sort: (r) => r.customer_code ?? r.customer_name,
    render: (r) => (
      <div className="truncate" title={r.customer_name ?? undefined}>
        {r.customer_code ?? r.customer_name}
      </div>
    ),
  },
  { key: "customer_name", label: "Tên khách hàng", width: 180, orderOnly: true, defaultHidden: true, sort: (r) => r.customer_name, render: (r) => <div className="truncate">{r.customer_name}</div> },
  {
    key: "order_code",
    label: "Đơn hàng",
    width: 130,
    orderOnly: true,
    sort: (r) => r.order_code,
    render: (r) => (
      <Link href={`/dieu-phoi/don-hang/${r.order_id}`} className="whitespace-nowrap hover:text-primary hover:underline">
        {r.order_code}
      </Link>
    ),
  },
  {
    key: SERVICE_KIND_PLACEHOLDER,
    label: "Loại hình vận chuyển",
    width: 140,
    hint: "Chưa có trường \"Loại hình vận chuyển\". Bấm Thêm cột (trường), đặt tên Loại hình vận chuyển (ví dụ kiểu Lựa chọn: Nhập, Xuất, Nội địa) để nhập ở form tạo đơn và hiện ở cột này.",
    text: () => null,
    render: () => null,
  },
  { key: "vehicle_type_name", label: "Loại cont", width: 100, hint: "Loại cont / loại xe của chuyến (danh mục Loại xe)", sort: (r) => r.vehicle_type_name, render: (r) => <div className="truncate">{r.vehicle_type_name}</div> },
  {
    key: "route",
    label: "Tuyến đường",
    width: 240,
    sort: (r) => r.route_label ?? `${r.pickup_name ?? ""} ${r.delivery_name ?? ""}`,
    text: (r) => routeText(r),
    render: (r) => routeCell(r),
  },
  { key: "pickup_name", label: "Điểm nhận", width: 170, defaultHidden: true, sort: (r) => r.pickup_name, render: (r) => <div className="truncate">{r.pickup_name}</div> },
  { key: "delivery_name", label: "Điểm giao", width: 170, defaultHidden: true, sort: (r) => r.delivery_name, render: (r) => <div className="truncate">{r.delivery_name}</div> },
  { key: "empty_return_name", label: "Điểm hạ rỗng", width: 160, defaultHidden: true, sort: (r) => r.empty_return_name, render: (r) => <div className="truncate">{r.empty_return_name}</div> },
  {
    key: "offroute_return_name",
    label: "Hạ rỗng trái tuyến",
    width: 160,
    defaultHidden: true,
    sort: (r) => r.offroute_return_name,
    render: (r) => <div className="truncate font-medium text-amber-700 dark:text-amber-400">{r.offroute_return_name}</div>,
  },
  {
    key: "vehicle_driver",
    label: "Xe / Tài xế",
    width: 150,
    sort: (r) => r.plate_number ?? (r.driver_name ? `~${r.driver_name}` : null),
    text: (r) =>
      r.plate_number || r.driver_id
        ? [r.plate_number ? `${r.plate_number}${r.vehicle_day_order ? ` (chuyến ${r.vehicle_day_order})` : ""}` : "Chưa chọn xe", r.driver_name].filter(Boolean).join(" - ")
        : "Chưa phân công",
    render: (r) =>
      r.driver_id ? (
        <>
          <div className="font-medium whitespace-nowrap">
            {r.plate_number ?? <span className="text-muted-foreground">Chưa chọn xe</span>}
            {r.vehicle_day_order ? <DayOrder n={r.vehicle_day_order} /> : null}
          </div>
          <div className="truncate text-xs text-muted-foreground">{r.driver_name}</div>
        </>
      ) : (
        <span className="whitespace-nowrap text-muted-foreground">
          {r.plate_number ?? "Chưa phân công"}
          {r.plate_number && r.vehicle_day_order ? <DayOrder n={r.vehicle_day_order} /> : null}
        </span>
      ),
  },
  { key: "plate_number", label: "Biển số", width: 100, defaultHidden: true, sort: (r) => r.plate_number, render: (r) => r.plate_number },
  { key: "driver_name", label: "Tài xế", width: 150, defaultHidden: true, sort: (r) => r.driver_name, render: (r) => <div className="truncate">{r.driver_name}</div> },
  { key: "trip_order", label: "Thứ tự chuyến", width: 90, align: "right", defaultHidden: true, sort: (r) => r.trip_order, render: (r) => (r.trip_order ? formatNumber(r.trip_order) : "") },
  {
    key: "vehicle_day_order",
    label: "Thứ tự xe",
    width: 84,
    align: "right",
    hint: "Thứ tự chạy của xe trong ngày (1, 2, 3…). Tài xế nhập số xe chỉ thấy chuyến có thứ tự nhỏ nhất, xong chuyến mới thấy chuyến tiếp theo. Bấm vào ô để sửa.",
    sort: (r) => r.vehicle_day_order ?? r.trip_order,
    text: (r) => r.vehicle_day_order ?? null,
    render: () => null,
  },
  {
    key: "driver_pay",
    label: "Lương chuyến",
    width: 110,
    align: "right",
    hint: "Lương tài xế của chuyến, tự lấy từ Lương tài xế → Đơn giá lương chuyến (tuyến, địa điểm, vùng, giá mặc định). Chữ đỏ Chưa có giá: bấm để điền giá cho tuyến. Số có dấu * là kế toán đã sửa tay.",
    sort: (r) => r.driver_pay ?? null,
    text: (r) => (r.driver_pay_source === "missing" ? "Chưa có giá" : (r.driver_pay ?? null)),
    render: () => null,
  },
  {
    key: "delivery_days",
    label: "Số ngày giao",
    width: 84,
    align: "right",
    hint: "Chuyến đi xa nhiều ngày thì nhập số ngày (2, 3…). Bảng chấm công tính công từ ngày nhận tới hết số ngày này. Để trống = 1 ngày, hoặc tự tính theo Ngày giao dự kiến (số nhạt). Bấm vào ô để sửa.",
    sort: (r) => r.work_days ?? 1,
    text: (r) => r.delivery_days ?? (r.work_days && r.work_days > 1 ? r.work_days : null),
    render: () => null,
  },
  { key: "plan_code", label: "Kế hoạch", width: 100, defaultHidden: true, sort: (r) => r.plan_code, render: (r) => r.plan_code },
  { key: "quantity", label: "SL", width: 64, align: "right", defaultHidden: true, sort: (r) => Number(r.quantity), render: (r) => formatNumber(r.quantity) },
  {
    key: "status",
    label: "Trạng thái",
    width: 170,
    sort: (r) => r.status,
    text: (r, now) =>
      [
        shipmentStatus(r.status).label,
        r.dispatch_approval === "pending" || r.dispatch_approval === "rejected" ? tripApprovalStatus(r.dispatch_approval).label : "",
        isLate(r, now) ? "Trễ giờ giao" : "",
        r.dispatch_approval === "rejected" && r.dispatch_reject_reason ? `Lý do: ${r.dispatch_reject_reason}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    render: (r, now) => (
      <>
        <div className="flex flex-wrap gap-1">
          <StatusBadge status={r.status} />
          {r.dispatch_approval === "pending" || r.dispatch_approval === "rejected" ? <StatusBadge kind="approval" status={r.dispatch_approval} /> : null}
          {isLate(r, now) ? <Badge variant="destructive">Trễ giờ giao</Badge> : null}
        </div>
        {r.dispatch_approval === "rejected" && r.dispatch_reject_reason ? (
          <div className="mt-0.5 truncate text-xs text-destructive" title={r.dispatch_reject_reason}>
            Lý do: {r.dispatch_reject_reason}
          </div>
        ) : null}
      </>
    ),
  },
  { key: "notes", label: "Ghi chú", width: 200, defaultHidden: true, sort: (r) => r.notes, render: (r) => <div className="truncate" title={r.notes ?? undefined}>{r.notes}</div> },
];

const DEFAULT_PINNED: string[] = [];
const collator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });

const emptyToUndef = (v: SortVal) => (v === null || v === undefined || v === "" ? undefined : v);

/** So sánh để sắp xếp: số theo số, chữ theo tiếng Việt (ô trống do sortUndefined đẩy xuống cuối) */
function compareVals(a: SortVal, b: SortVal) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a ?? ""), String(b ?? ""));
}

/** Bảng chuyến cho màn hình điều phối và chi tiết đơn hàng: kéo đổi cột, sắp xếp, ẩn/hiện, kéo giãn, lưu cấu hình theo người dùng */
export function DispatchTable({
  rows,
  canAssign,
  canCancel,
  canDelete = false,
  showOrder = true,
  emptyText = "Không có chuyến.",
  tableKey = "dispatch_list",
  view = null,
  extraColumns = [],
  extraValues = {},
  canAddField = false,
  toolbar = true,
  canFillDriver,
  exportName,
}: {
  rows: ShipmentListRow[];
  canAssign: boolean;
  canCancel: boolean;
  /** Nút xóa vĩnh viễn trên dòng chuyến đã hủy (danh sách Chuyến hủy) */
  canDelete?: boolean;
  /** Giữ để tương thích: luôn hiện ngày nhận */
  showDate?: boolean;
  showOrder?: boolean;
  emptyText?: string;
  /** Khóa lưu cấu hình bảng theo người dùng */
  tableKey?: string;
  view?: TableViewConfig | null;
  /** Trường bổ sung của chuyến/đơn hàng thành cột */
  extraColumns?: DispatchExtraColumn[];
  extraValues?: DispatchExtraValues;
  canAddField?: boolean;
  /** Hiện thanh công cụ (Cột, Lưu cấu hình) */
  toolbar?: boolean;
  /** Điền nhanh CCCD / GPLX còn thiếu trong hộp Thông tin tài xế (mặc định theo quyền phân công) */
  canFillDriver?: boolean;
  /** Có thì hiện nút Xuất Excel: tên tệp và tiêu đề trong tệp */
  exportName?: { filename: string; title: string };
}) {
  const fillDriver = canFillDriver ?? canAssign;
  const [savePending, startSave] = useTransition();
  const [exportPending, startExport] = useTransition();
  const showActions = canAssign || canCancel || rows.some((r) => r.can_approve_dispatch || r.driver_id);
  const kindCol = extraColumns.find((c) => c.serviceKind);
  const dropCol = extraColumns.find((c) => c.dropOff);

  const cols = useMemo<Col[]>(() => {
    const val = (r: ShipmentListRow, key: string) => extraValues[r.id]?.[key];
    const extra = (c: DispatchExtraColumn): Col => ({
      key: c.key,
      label: c.label,
      width: 140,
      align: c.numeric ? "right" : undefined,
      custom: !c.visible,
      defaultHidden: !c.serviceKind && !c.visible,
      sort: (r) => val(r, c.key)?.[1],
      text: (r) => {
        const v = val(r, c.key);
        return c.numeric && typeof v?.[1] === "number" ? v[1] : (v?.[0] ?? null);
      },
      render: (r) => <div className="truncate">{val(r, c.key)?.[0]}</div>,
    });
    const list: Col[] = [];
    for (const c of BASE_COLS) {
      if (c.orderOnly && !showOrder) continue;
      // Đã có trường "Loại hình vận chuyển" thì cột đó đứng đúng chỗ này
      if (c.key === SERVICE_KIND_PLACEHOLDER) list.push(kindCol ? extra(kindCol) : c);
      else if (c.key === "route" && dropCol)
        list.push({ ...c, text: (r) => routeText(r, val(r, dropCol.key)?.[0]), render: (r) => routeCell(r, val(r, dropCol.key)?.[0]) });
      else list.push(c);
    }
    for (const c of extraColumns) if (!c.serviceKind) list.push(extra(c));
    if (showActions) list.push({ key: "actions", label: "Thao tác", width: 230, align: "right", render: () => null });
    return list;
  }, [extraColumns, extraValues, kindCol, dropCol, showOrder, showActions]);

  const [visibility, setVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries((view?.hidden ?? cols.filter((c) => c.defaultHidden).map((c) => c.key)).map((k) => [k, false])),
  );
  const [order, setOrder] = useState<ColumnOrderState>(() => view?.order ?? []);
  const [sizing, setSizing] = useState<ColumnSizingState>(() => view?.widths ?? {});
  const [pinning, setPinning] = useState<ColumnPinningState>(() => ({ left: view?.pinned ?? DEFAULT_PINNED }));
  const [sorting, setSorting] = useState<SortingState>(() => view?.sort ?? []);
  const [rowHeight, setRowHeight] = useState<number | null>(view?.rowHeight ?? null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const resizeRow = useRef<{ y: number; h: number } | null>(null);
  const [now] = useState(() => Date.now());

  const columns = useMemo<ColumnDef<ShipmentListRow>[]>(
    () =>
      cols.map((c) => ({
        id: c.key,
        header: c.label,
        size: c.width,
        minSize: 50,
        meta: { col: c },
        enableSorting: Boolean(c.sort),
        enableHiding: c.key !== "actions",
        // Ô trống trả về undefined để luôn nằm cuối dù sắp tăng hay giảm
        accessorFn: c.sort ? (r: ShipmentListRow) => emptyToUndef(c.sort!(r)) : undefined,
        sortingFn: (a: Row<ShipmentListRow>, b: Row<ShipmentListRow>, id: string) => compareVals(a.getValue<SortVal>(id), b.getValue<SortVal>(id)),
        sortUndefined: "last" as const,
        cell: ({ row }) =>
          c.key === "actions" ? (
            <Actions r={row.original} canAssign={canAssign} canCancel={canCancel} canDelete={canDelete} canFillDriver={fillDriver} />
          ) : c.key === "vehicle_day_order" ? (
            <VehicleOrderCell r={row.original} editable={canAssign} />
          ) : c.key === "driver_pay" ? (
            <DriverPayCell r={row.original} />
          ) : c.key === "delivery_days" ? (
            <DeliveryDaysCell r={row.original} editable={canAssign} />
          ) : (
            c.render(row.original, now)
          ),
      })),
    [cols, canAssign, canCancel, canDelete, fillDriver, now],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (r) => r.id,
    columnResizeMode: "onChange",
    enableMultiSort: true,
    isMultiSortEvent: (e) => (e as MouseEvent).shiftKey,
    maxMultiSortColCount: 3,
    state: { columnVisibility: visibility, columnOrder: order, columnSizing: sizing, columnPinning: pinning, sorting },
    onColumnVisibilityChange: setVisibility,
    onColumnOrderChange: setOrder,
    onColumnSizingChange: setSizing,
    onColumnPinningChange: setPinning,
    onSortingChange: setSorting,
  });
  const ids = () => table.getAllLeafColumns().map((c) => c.id);
  const meta = (c: Column<ShipmentListRow>) => (c.columnDef.meta as { col: Col }).col;

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
  function pinStyle(col: Column<ShipmentListRow>, header = false): CSSProperties {
    const size = { width: col.getSize(), minWidth: col.getSize(), maxWidth: col.getSize() };
    return col.getIsPinned() ? { ...size, position: "sticky", left: col.getStart("left"), zIndex: header ? 30 : 10 } : size;
  }
  function save() {
    startSave(async () => {
      const r = await saveTableView(tableKey, {
        hidden: Object.entries(visibility).filter(([, v]) => !v).map(([k]) => k),
        order: ids(),
        widths: sizing,
        pinned: pinning.left ?? [],
        rowHeight,
        pageSize: 100,
        sort: sorting,
      });
      if (r.ok) toast.success("Đã lưu cấu hình bảng: thứ tự cột, cột hiển thị, độ rộng và sắp xếp.");
      else toast.error(r.error);
    });
  }
  function reset() {
    startSave(async () => {
      const r = await resetTableView(tableKey);
      if (!r.ok) return void toast.error(r.error);
      setVisibility(Object.fromEntries(cols.filter((c) => c.defaultHidden).map((c) => [c.key, false])));
      setOrder([]);
      setSizing({});
      setPinning({ left: DEFAULT_PINNED });
      setSorting([]);
      setRowHeight(null);
      toast.success(r.message);
    });
  }

  /** Xuất đúng những gì đang xem: dòng theo bộ lọc + sắp xếp, cột đang hiện theo thứ tự */
  function exportExcel() {
    if (!exportName) return;
    const leaf = table.getVisibleLeafColumns().filter((c) => c.id !== "actions");
    const data = table.getRowModel().rows.map((row) =>
      leaf.map((c) => {
        const m = meta(c);
        const v = m.text ? m.text(row.original, now) : m.sort ? m.sort(row.original) : null;
        if (v === undefined || v === null || v === "") return null;
        return typeof v === "number" ? v : String(v);
      }),
    );
    if (data.length === 0) return void toast.error("Không có chuyến nào để xuất.");
    startExport(async () => {
      const r = await exportTableView({
        sheet: "Điều phối",
        filename: exportName.filename,
        title: exportName.title,
        columns: leaf.map((c) => {
          const m = meta(c);
          return { label: m.label, width: Math.max(8, Math.min(60, Math.round(c.getSize() / 7))), numeric: m.align === "right" };
        }),
        rows: data,
      });
      if (!r.ok || !r.data) return void toast.error(r.ok ? "Không tạo được tệp" : r.error);
      const bytes = Uint8Array.from(atob(r.data.base64), (ch) => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.data.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Đã xuất ${r.data.count} chuyến, ${leaf.length} cột.`);
    });
  }

  const sortText = sorting
    .map((s) => {
      const c = cols.find((x) => x.key === s.id);
      return c ? `${c.label} ${s.desc ? "giảm dần" : "tăng dần"}` : null;
    })
    .filter(Boolean)
    .join(", ");

  return (
    <>
      {toolbar ? (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1">
            {sortText ? (
              <>
                Đang sắp xếp: <b className="text-foreground">{sortText}</b>{" "}
                <button type="button" className="text-primary hover:underline" onClick={() => setSorting([])}>
                  Bỏ sắp xếp
                </button>
              </>
            ) : (
              "Bấm tiêu đề cột để sắp xếp (giữ Shift để sắp theo nhiều cột). Kéo tiêu đề để đổi chỗ cột, kéo mép phải để đổi độ rộng."
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {canAddField ? <AddFieldButton module="shipments" customRows={[]} label="Thêm cột (trường)" /> : null}
            <ColumnsMenu columns={table.getAllLeafColumns()} label={(c) => meta(c).label} note={(c) => (meta(c).custom ? "bổ sung" : null)} onMove={moveColumn} />
            {exportName ? (
              <Button
                variant="outline"
                size="sm"
                disabled={exportPending || rows.length === 0}
                onClick={exportExcel}
                title="Xuất danh sách đang xem ra Excel: đúng bộ lọc, tab, sắp xếp, các cột đang hiện theo thứ tự hiện tại"
              >
                {exportPending ? <Loader2 className="animate-spin" /> : <Download />} Xuất Excel
              </Button>
            ) : null}
            <Button variant="outline" size="sm" disabled={savePending} onClick={save} title="Lưu thứ tự cột, cột hiển thị, độ rộng, chiều cao dòng và sắp xếp cho tài khoản của bạn">
              <Save /> Lưu cấu hình
            </Button>
            <Button variant="ghost" size="sm" disabled={savePending} title="Khôi phục cấu hình mặc định" onClick={reset}>
              <RotateCcw /> Mặc định
            </Button>
          </div>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="max-h-[calc(100dvh-12rem)] overflow-auto">
          <table className="border-separate border-spacing-0 text-sm" style={{ width: table.getTotalSize(), tableLayout: "fixed" }}>
            <thead className="sticky top-0 z-20 bg-muted text-left text-xs text-muted-foreground">
              <tr>
                {table.getFlatHeaders().map((h) => {
                  const col = h.column;
                  const c = meta(col);
                  const dir = col.getIsSorted();
                  const idx = sorting.length > 1 ? col.getSortIndex() : -1;
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
                      title={c.hint ? `${c.hint}\nKéo để đổi vị trí cột.` : col.getCanSort() ? "Bấm để sắp xếp, kéo để đổi vị trí cột" : "Kéo để đổi vị trí cột"}
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                      className={cn(
                        "relative cursor-grab border-b bg-muted px-2 py-2 font-medium whitespace-nowrap active:cursor-grabbing",
                        c.align === "right" && "text-right",
                        col.getIsPinned() && col.getIsLastColumn("left") && "border-r",
                        dragCol === col.id && "opacity-50",
                      )}
                    >
                      {col.getCanSort() ? (
                        <button
                          type="button"
                          onClick={col.getToggleSortingHandler()}
                          className={cn("inline-flex max-w-full items-center gap-1 hover:text-foreground", dir && "text-foreground", c.align === "right" && "flex-row-reverse")}
                        >
                          <span className="truncate">{c.label}</span>
                          {dir === "asc" ? <ArrowUp className="size-3.5 shrink-0" /> : dir === "desc" ? <ArrowDown className="size-3.5 shrink-0" /> : <ArrowUpDown className="size-3 shrink-0 opacity-40" />}
                          {idx >= 0 ? <sup>{idx + 1}</sup> : null}
                        </button>
                      ) : (
                        <span className={cn("block truncate", c.hint && "underline decoration-dotted underline-offset-2")}>{c.label}</span>
                      )}
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
                    const assigned = isAssignedRow(row.original);
                    const c = meta(cell.column);
                    return (
                      <td
                        key={cell.id}
                        style={pinStyle(cell.column)}
                        className={cn(
                          "border-b px-2 py-1.5 align-top",
                          assigned ? ASSIGNED_ROW_CELL : "bg-card group-hover:bg-muted/40",
                          c.align === "right" && "text-right tabular-nums",
                          cell.column.getIsPinned() && cell.column.getIsLastColumn("left") && "border-r",
                          ci === 0 && "relative pl-4",
                        )}
                      >
                        <div className="overflow-hidden" style={rowHeight ? { maxHeight: rowHeight - 10 } : undefined}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
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
    </>
  );
}

function Actions({ r, canAssign, canCancel, canDelete, canFillDriver }: { r: ShipmentListRow; canAssign: boolean; canCancel: boolean; canDelete: boolean; canFillDriver: boolean }) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {r.driver_id && r.status !== "cancelled" ? <DriverInfoButton compact shipmentIds={[r.id]} canFill={canFillDriver} /> : null}
      {r.can_approve_dispatch && r.dispatch_approval_request_id ? <TripApprovalButtons compact requestIds={[r.dispatch_approval_request_id]} label={r.shipment_code} /> : null}
      {canAssign && r.dispatch_approval === "rejected" && r.status === "assigned" ? (
        <ResubmitTripButton compact shipmentId={r.id} shipmentCode={r.shipment_code} reason={r.dispatch_reject_reason} />
      ) : null}
      {canAssign && r.driver_id && ["assigned", "accepted", "in_transit"].includes(r.status) && r.dispatch_approval !== "pending" && r.dispatch_approval !== "rejected" ? (
        <ActForDriverQuick shipmentId={r.id} code={r.shipment_code} status={r.status} />
      ) : null}
      {canAssign && ASSIGNABLE_STATUSES.includes(r.status) ? (
        <AssignDialog
          compact
          shipmentId={r.id}
          shipmentCode={r.shipment_code}
          driverId={r.driver_id}
          driverLabel={r.driver_name ? `${r.driver_name} (${r.driver_code})` : null}
          vehicleId={r.vehicle_id}
          vehicleLabel={r.plate_number}
          pickupAt={r.pickup_at}
        />
      ) : null}
      {canAssign
        ? (["unaccept", "correct"] as const)
            .filter((m) => (m === "unaccept" ? UNACCEPT_STATUSES : CORRECT_CREW_STATUSES).includes(r.status))
            .map((mode) => (
              <CrewChangeDialog
                key={mode}
                compact
                mode={mode}
                shipmentId={r.id}
                shipmentCode={r.shipment_code}
                driverId={r.driver_id}
                driverLabel={r.driver_name ? `${r.driver_name} (${r.driver_code})` : null}
                vehicleId={r.vehicle_id}
                vehicleLabel={r.plate_number}
                pickupAt={r.pickup_at}
              />
            ))
        : null}
      {canAssign && !LOCKED_STATUSES.includes(r.status) ? (
        <Button asChild variant="ghost" size="sm" className="h-7 px-2" title={`Sửa toàn bộ đơn ${r.order_code}, mở tới chuyến ${r.shipment_code}`}>
          <Link href={`/dieu-phoi/don-hang/${r.order_id}/sua#chuyen-${r.shipment_code}`}>
            <Pencil /> Sửa
          </Link>
        </Button>
      ) : null}
      {canCancel && CANCELLABLE_STATUSES.includes(r.status) ? <CancelDialog compact shipmentId={r.id} shipmentCode={r.shipment_code} /> : null}
      {canCancel && r.status === "cancelled" ? <RestoreShipmentButton compact shipmentId={r.id} shipmentCode={r.shipment_code} /> : null}
      {canDelete && r.status === "cancelled" ? <DeleteCancelledButton compact ids={[r.id]} label={`chuyến ${r.shipment_code}`} /> : null}
    </div>
  );
}

/** Thứ tự chuyến của xe trong ngày */
function DayOrder({ n }: { n: number }) {
  return (
    <Badge variant="info" className="ml-1.5 px-1.5 py-0 align-middle" title={`Chuyến thứ ${n} của xe trong ngày`}>
      Chuyến {n}
    </Badge>
  );
}
