import Link from "next/link";
import type { ReactNode } from "react";
import { Minus, Equal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber, formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ShipmentProfit = {
  shipment_id: string;
  trip_month: string;
  revenue: number;
  trip_cost: number;
  pending_cost: number;
  vehicle_cost: number;
  vehicle_month_cost: number;
  vehicle_month_trips: number;
  profit_before_vehicle: number;
  profit: number;
  margin_percent: number | null;
  /** Cước + chi phí khác phải trả nhà xe 3PL (không gồm chi hộ 3PL) */
  carrier_cost?: number;
};

/** Khung Lời/lỗ chuyến: doanh thu − chi phí chuyến đã duyệt − chi phí xe chia về */
export function ProfitCard(props: {
  profit: ShipmentProfit | null;
  revenue: number;
  costLines: { name: string; amount: number }[];
  plate: string | null;
  vehicleId: string | null;
  outsourced: boolean;
  addExpense?: ReactNode;
}) {
  const p = props.profit;
  const tripCost = props.costLines.reduce((a, l) => a + l.amount, 0);
  const vehicleCost = Number(p?.vehicle_cost ?? 0);
  const carrierCost = Number(p?.carrier_cost ?? 0);
  const result = p ? Number(p.profit) : props.revenue - tripCost;
  const month = p?.trip_month ? `${p.trip_month.slice(5, 7)}/${p.trip_month.slice(0, 4)}` : null;
  return (
    <Card className="lg:col-span-3" id="loi-lo">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Lời/lỗ chuyến</CardTitle>
        {props.addExpense}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-stretch gap-2">
          <Box label="Doanh thu" value={props.revenue} />
          <Op><Minus className="size-4" /></Op>
          <Box label="Chi phí chuyến" value={tripCost} />
          <Op><Minus className="size-4" /></Op>
          {props.outsourced || carrierCost > 0 ? (
            <>
              <a href="#chi-phi-3pl" className="contents">
                <Box label="Cước, chi phí trả 3PL" value={carrierCost} />
              </a>
              <Op><Minus className="size-4" /></Op>
            </>
          ) : null}
          <Box label="Chi phí xe chia về" value={vehicleCost} />
          <Op><Equal className="size-4" /></Op>
          <div
            className={cn(
              "min-w-36 flex-1 rounded-lg border-2 px-3 py-2",
              result >= 0 ? "border-emerald-500/60 bg-emerald-500/10" : "border-red-500/60 bg-red-500/10",
            )}
          >
            <div className="text-xs text-muted-foreground">{result >= 0 ? "Lời" : "Lỗ"}</div>
            <div className={cn("text-lg font-semibold tabular-nums", result >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
              {formatVND(result)}
            </div>
            {p?.margin_percent != null ? <div className="text-xs text-muted-foreground">Tỷ suất {formatNumber(p.margin_percent)}% doanh thu</div> : null}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <div className="font-medium">Chi phí chuyến (đã duyệt)</div>
            {props.costLines.length === 0 ? (
              <p className="text-muted-foreground">Chưa có chi phí đã duyệt.</p>
            ) : (
              props.costLines.map((l) => <Line key={l.name} label={l.name} value={formatVND(l.amount)} />)
            )}
            {Number(p?.pending_cost ?? 0) > 0 ? (
              <Line label="Chờ duyệt (chưa trừ vào lời lỗ)" value={<span className="text-amber-700 dark:text-amber-400">{formatVND(p!.pending_cost)}</span>} />
            ) : null}
            <p className="pt-1 text-xs text-muted-foreground">
              Nhập ở nút <b>Nhập chi phí</b> (văn phòng) hoặc tài xế khai khi hoàn thành chuyến: bồi dưỡng, bốc xếp, cầu đường, vá lốp dọc đường, ... Khoản chỉ được trừ sau khi duyệt. Cước thuê xe 3PL nhập ở khung Chi phí trả 3PL.
            </p>
          </div>
          <div className="space-y-1">
            <div className="font-medium">Chi phí xe chia về</div>
            {props.outsourced ? (
              <p className="text-muted-foreground">Xe thuê ngoài (3-PL): không có chi phí sửa chữa, bảo hiểm của công ty. Cước trả nhà xe nhập ở khung <a href="#chi-phi-3pl" className="text-primary hover:underline">Chi phí trả 3PL</a> bên dưới.</p>
            ) : !props.vehicleId ? (
              <p className="text-muted-foreground">Chuyến chưa có xe.</p>
            ) : !p ? (
              <p className="text-muted-foreground">Chỉ tính khi chuyến đang chạy hoặc đã hoàn thành.</p>
            ) : (
              <>
                <Line label={`Sửa chữa, bảo dưỡng, kiểm định, bảo hiểm xe ${props.plate ?? ""} tháng ${month}`} value={formatVND(p.vehicle_month_cost)} />
                <Line label={`Số chuyến của xe trong tháng`} value={formatNumber(p.vehicle_month_trips)} />
                <Line label="Phần chia cho chuyến này" value={<b>{formatVND(p.vehicle_cost)}</b>} />
              </>
            )}
            {props.vehicleId && !props.outsourced ? (
              <p className="pt-1 text-xs text-muted-foreground">
                Nhập theo xe ở{" "}
                <Link href={`/phuong-tien/${props.vehicleId}`} className="text-primary hover:underline">
                  Phương tiện → {props.plate ?? "xe"} → Bảo dưỡng, sửa chữa
                </Link>
                . Tổng chi phí xe trong tháng được chia đều cho các chuyến của xe trong tháng đó.
              </p>
            ) : null}
          </div>
        </div>
        {p && vehicleCost > 0 ? (
          <p className="text-xs text-muted-foreground">Lời/lỗ trước khi chia chi phí xe: {formatVND(p.profit_before_vehicle)}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Box({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-32 flex-1 rounded-lg border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{formatVND(value)}</div>
    </div>
  );
}

function Op({ children }: { children: ReactNode }) {
  return <div className="flex items-center text-muted-foreground">{children}</div>;
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="shrink-0 whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}
