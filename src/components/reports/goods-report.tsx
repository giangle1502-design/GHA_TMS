"use client";
import Link from "next/link";
import { formatDate, formatNumber } from "@/lib/format";
import { downloadXlsx } from "@/lib/xlsx-client";
import { ReportGrid, type ReportColumn } from "@/components/grid/report-grid";
import type { TableViewConfig } from "@/lib/entities/types";
import type { GoodsRow } from "@/lib/goods-report";

const STATUS: Record<string, string> = {
  draft: "Chờ phân công",
  assigned: "Đã phân công",
  accepted: "Tài xế đã nhận",
  in_transit: "Đang chạy",
  driver_completed: "Tài xế đã xong",
  closed: "Đã đóng",
};
const STATUS_OPTIONS = Object.values(STATUS).map((label) => ({ value: label, label }));

const sum = (list: GoodsRow[], f: (r: GoodsRow) => number | null) => list.reduce((a, r) => a + (f(r) ?? 0), 0);
const trips = (list: GoodsRow[]) => new Set(list.map((r) => r.shipment_id)).size;

/** Báo cáo chi tiết hàng hóa vận chuyển: mỗi mã hàng trên chuyến một dòng, để đối chiếu không sót chuyến */
export function GoodsReport({ tu, den, rows, truncated, view }: { tu: string; den: string; rows: GoodsRow[]; truncated: boolean; view: TableViewConfig | null }) {
  const columns: ReportColumn<GoodsRow>[] = [
    { key: "trip_date", label: "Ngày", width: 95, kind: "date", value: (r) => r.trip_date, render: (r) => formatDate(r.trip_date) },
    {
      key: "shipment_code",
      label: "Mã chuyến",
      width: 120,
      value: (r) => r.shipment_code,
      render: (r) => (
        <Link href={`/chuyen-xe/${r.shipment_id}`} className="font-medium whitespace-nowrap hover:text-primary hover:underline">
          {r.shipment_code}
        </Link>
      ),
    },
    {
      key: "order_code",
      label: "Mã đơn hàng",
      width: 120,
      value: (r) => r.order_code,
      render: (r) => (
        <Link href={`/dieu-phoi/don-hang/${r.order_id}`} className="whitespace-nowrap hover:text-primary hover:underline">
          {r.order_code}
        </Link>
      ),
    },
    { key: "ref_no", label: "Số đơn hàng", width: 130, value: (r) => r.ref_no },
    { key: "route_label", label: "Tuyến đường", width: 300, value: (r) => r.route_label },
    { key: "plate_number", label: "Số xe", width: 105, value: (r) => r.plate_number },
    { key: "container_no", label: "Số cont", width: 125, value: (r) => r.container_no },
    {
      key: "item_code",
      label: "Mã hàng",
      width: 120,
      value: (r) => r.item_code,
      render: (r) => (r.no_items ? <span className="text-amber-700">Chưa có mã hàng</span> : <span className="font-medium">{r.item_code}</span>),
    },
    { key: "item_name", label: "Tên hàng", width: 220, value: (r) => r.item_name },
    { key: "weight_kg", label: "Số lượng (KG)", width: 115, align: "right", kind: "number", value: (r) => r.weight_kg, render: (r) => formatNumber(r.weight_kg) },
    { key: "bags", label: "Số bao", width: 85, align: "right", kind: "number", value: (r) => r.bags, render: (r) => formatNumber(r.bags) },
    { key: "status", label: "Trạng thái", width: 120, kind: "select", options: STATUS_OPTIONS, value: (r) => STATUS[r.status] ?? r.status },
    { key: "load_group_codes", label: "Ghép chung xe", width: 150, value: (r) => r.load_group_codes },
    { key: "quantity", label: "Số lượng gốc", width: 100, align: "right", kind: "number", value: (r) => r.quantity, render: (r) => formatNumber(r.quantity) },
    { key: "unit", label: "ĐVT", width: 60, value: (r) => r.unit },
    { key: "customer_code", label: "Mã KH", width: 90, value: (r) => r.customer_code },
    { key: "customer_name", label: "Khách hàng", width: 200, value: (r) => r.customer_name },
    { key: "pickup_name", label: "Điểm nhận", width: 180, value: (r) => r.pickup_name },
    { key: "delivery_name", label: "Điểm giao", width: 180, value: (r) => r.delivery_name },
    { key: "empty_return_name", label: "Điểm trả rỗng", width: 160, value: (r) => r.empty_return_name },
    { key: "driver_name", label: "Tài xế", width: 160, value: (r) => r.driver_name },
    { key: "delivery_date", label: "Ngày giao dự kiến", width: 110, kind: "date", value: (r) => r.delivery_date, render: (r) => formatDate(r.delivery_date) },
  ];

  const title = `CHI TIẾT HÀNG HÓA VẬN CHUYỂN TỪ ${formatDate(tu)} ĐẾN ${formatDate(den)}`;
  const DATE_KEYS = new Set(["trip_date", "delivery_date"]);
  const NUM_KEYS = new Set(["weight_kg", "bags", "quantity"]);

  return (
    <>
      {truncated ? (
        <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Khoảng ngày có quá nhiều chuyến, bảng chỉ hiện 5,000 chuyến đầu. Anh chọn khoảng ngày ngắn hơn để xem đủ.
        </p>
      ) : null}
      <div className="rounded-lg border bg-card">
        <ReportGrid
          tableKey="report_goods_detail"
          rows={rows}
          columns={columns}
          view={view}
          getRowId={(r) => r.id}
          defaultPinned={["trip_date", "shipment_code"]}
          searchPlaceholder="Lọc trong bảng: mã chuyến, số xe, số cont, mã hàng…"
          emptyText="Không có chuyến nào trong khoảng ngày này."
          footer={(list) =>
            list.length
              ? {
                  trip_date: "Cộng",
                  shipment_code: `${formatNumber(trips(list))} chuyến`,
                  item_code: `${formatNumber(list.filter((r) => !r.no_items).length)} dòng hàng`,
                  weight_kg: formatNumber(sum(list, (r) => r.weight_kg)),
                  bags: formatNumber(sum(list, (r) => r.bags)),
                }
              : null
          }
          onExport={(cols, list) =>
            downloadXlsx({
              filename: `Chi-tiet-hang-hoa-van-chuyen-${tu}-${den}.xlsx`,
              sheet: "Hàng hóa vận chuyển",
              title,
              subtitle: `${formatNumber(trips(list))} chuyến, ${formatNumber(list.filter((r) => !r.no_items).length)} dòng hàng`,
              columns: cols.map((c) => ({ label: c.label, width: c.width, numeric: c.align === "right" })),
              rows: list.map((r) =>
                cols.map((c) => {
                  const v = c.value(r);
                  if (DATE_KEYS.has(c.key)) return formatDate(v as string | null);
                  if (c.key === "item_code" && r.no_items) return "Chưa có mã hàng";
                  return NUM_KEYS.has(c.key) ? ((v as number | null) ?? null) : (v ?? "");
                }),
              ),
              footer: cols.map((c, k) =>
                c.key === "weight_kg"
                  ? sum(list, (r) => r.weight_kg)
                  : c.key === "bags"
                    ? sum(list, (r) => r.bags)
                    : c.key === "shipment_code"
                      ? `${formatNumber(trips(list))} chuyến`
                      : k === 0
                        ? "Cộng"
                        : "",
              ),
            })
          }
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Mỗi dòng là một mã hàng trên một chuyến (chuyến chưa nhập mã hàng vẫn hiện một dòng &quot;Chưa có mã hàng&quot;). Ngày là ngày nhận hàng của chuyến, không gồm chuyến đã hủy.
        Hai đơn ghép chung một xe vẫn giữ mã chuyến riêng, cột Ghép chung xe cho biết đi cùng chuyến nào. Số bao tính như phiếu giao hàng (nhập tay, hoặc KG ÷ Số KG/bao của mã hàng).
      </p>
    </>
  );
}
