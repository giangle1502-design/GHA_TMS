"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { ReportGrid, type ReportColumn } from "@/components/grid/report-grid";
import { formatNumber } from "@/lib/format";
import type { TableViewConfig } from "@/lib/entities/types";
import { cn } from "@/lib/utils";

type Base = {
  id: string;
  total: number;
  delivered: number;
  open: number;
  today: number;
  work_days: number;
  vs_avg: number;
  /** Xe: các tài xế đã chạy xe; tài xế: các xe đã chạy, kèm số chuyến */
  others: string;
  /** Số chuyến theo ngày YYYY-MM-DD */
  days: Record<string, number>;
};
export type VehicleCountRow = Base & {
  plate_number: string;
  code: string;
  vehicle_type: string | null;
  ownership_type: string;
  status: string;
  company: boolean;
  assigned_driver: string | null;
};
export type DriverCountRow = Base & { full_name: string; code: string; phone: string | null; status: string };

const OWNERSHIP: Record<string, string> = { owned: "Xe công ty", leased: "Thuê dài hạn", lease_purchase: "Thuê mua", outsourced: "Thuê ngoài 3PL" };
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

type Tab = "xe" | "tai-xe" | "ngay";

export function TripCountReport({
  range,
  today,
  stats,
  vehicles,
  drivers,
  days,
  views,
}: {
  range: { from: string; to: string; isMonth: boolean; label: string };
  today: string;
  stats: { trips: number; noVehicle: number; noDriver: number; vehicleAvg: number; driverAvg: number; companyVehicles: number; activeDrivers: number };
  vehicles: VehicleCountRow[];
  drivers: DriverCountRow[];
  days: string[];
  views: { vehicles: TableViewConfig | null; drivers: TableViewConfig | null; days: TableViewConfig | null };
}) {
  const [tab, setTab] = useState<Tab>("xe");
  const [dayOf, setDayOf] = useState<"xe" | "tai-xe">("xe");
  const hasToday = today >= range.from && today <= range.to;
  const shownVehicles = vehicles;
  const idleVehicles = vehicles.filter((v) => v.company && v.total === 0).length;
  const idleDrivers = drivers.filter((d) => d.status === "active" && d.total === 0).length;

  const countCols = <T extends Base>(avg: number, who: string): ReportColumn<T>[] => [
    {
      key: "total",
      label: "Tổng số chuyến",
      width: 105,
      align: "right",
      kind: "number",
      value: (r) => r.total,
      render: (r) => <b className="tabular-nums">{r.total}</b>,
    },
    { key: "delivered", label: "Đã giao xong", width: 95, align: "right", kind: "number", value: (r) => r.delivered },
    { key: "open", label: "Chưa giao xong", width: 105, align: "right", kind: "number", value: (r) => r.open },
    ...(hasToday ? [{ key: "today", label: "Hôm nay", width: 80, align: "right" as const, kind: "number" as const, value: (r: T) => r.today }] : []),
    { key: "work_days", label: "Số ngày có chuyến", width: 120, align: "right", kind: "number", value: (r) => r.work_days },
    {
      key: "vs_avg",
      label: `So với TB (${formatNumber(avg)})`,
      width: 130,
      align: "right",
      kind: "number",
      value: (r) => r.vs_avg,
      render: (r) => (
        <Badge variant={r.vs_avg < 0 ? "success" : r.vs_avg > 1 ? "warning" : "muted"} title={r.vs_avg < 0 ? `Ít chuyến hơn trung bình ${who}, nên ưu tiên giao thêm` : r.vs_avg > 1 ? `Nhiều chuyến hơn trung bình ${who}` : "Gần bằng trung bình"}>
          {r.vs_avg > 0 ? "+" : ""}
          {formatNumber(r.vs_avg)}
        </Badge>
      ),
    },
  ];

  const vehicleCols = useMemo<ReportColumn<VehicleCountRow>[]>(
    () => [
      {
        key: "plate_number",
        label: "Biển số",
        width: 110,
        value: (r) => r.plate_number,
        render: (r) => (
          <Link href={`/phuong-tien/${r.id}`} className="font-medium text-primary hover:underline">
            {r.plate_number}
          </Link>
        ),
      },
      { key: "code", label: "Mã xe", width: 90, value: (r) => r.code },
      { key: "vehicle_type", label: "Loại xe", width: 120, value: (r) => r.vehicle_type },
      {
        key: "ownership_type",
        label: "Sở hữu",
        width: 115,
        kind: "select",
        options: Object.entries(OWNERSHIP).map(([value, label]) => ({ value, label })),
        value: (r) => r.ownership_type,
        render: (r) => OWNERSHIP[r.ownership_type] ?? r.ownership_type,
      },
      { key: "assigned_driver", label: "Tài xế phụ trách", width: 150, value: (r) => r.assigned_driver },
      ...countCols<VehicleCountRow>(stats.vehicleAvg, "mỗi xe"),
      { key: "others", label: "Tài xế đã chạy xe (số chuyến)", width: 260, value: (r) => r.others },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stats.vehicleAvg, hasToday],
  );
  const driverCols = useMemo<ReportColumn<DriverCountRow>[]>(
    () => [
      {
        key: "full_name",
        label: "Tài xế",
        width: 170,
        value: (r) => r.full_name,
        render: (r) => (
          <Link href={`/tai-xe/${r.id}`} className="font-medium text-primary hover:underline">
            {r.full_name}
          </Link>
        ),
      },
      { key: "code", label: "Mã tài xế", width: 90, value: (r) => r.code },
      { key: "phone", label: "SĐT", width: 110, value: (r) => r.phone },
      ...countCols<DriverCountRow>(stats.driverAvg, "mỗi tài xế"),
      { key: "others", label: "Xe đã chạy (số chuyến)", width: 240, value: (r) => r.others },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stats.driverAvg, hasToday],
  );

  type DayRow = { id: string; name: string; sub: string; total: number; days: Record<string, number> };
  const dayRows = useMemo<DayRow[]>(
    () =>
      dayOf === "xe"
        ? shownVehicles.map((v) => ({ id: v.id, name: v.plate_number, sub: v.assigned_driver ?? "", total: v.total, days: v.days }))
        : drivers.map((d) => ({ id: d.id, name: d.full_name, sub: d.code, total: d.total, days: d.days })),
    [dayOf, shownVehicles, drivers],
  );
  const dayCols = useMemo<ReportColumn<DayRow>[]>(
    () => [
      { key: "name", label: dayOf === "xe" ? "Biển số" : "Tài xế", width: 150, value: (r) => r.name, render: (r) => <b>{r.name}</b> },
      { key: "sub", label: dayOf === "xe" ? "Tài xế phụ trách" : "Mã tài xế", width: 140, value: (r) => r.sub },
      { key: "total", label: "Tổng", width: 64, align: "right", kind: "number", value: (r) => r.total, render: (r) => <b>{r.total}</b> },
      ...days.map<ReportColumn<DayRow>>((d) => ({
        key: `d${d.replaceAll("-", "")}`,
        label: `${ddmm(d)} ${WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]}`,
        width: 58,
        align: "right",
        kind: "number",
        value: (r) => r.days[d] ?? 0,
        render: (r) => (r.days[d] ? <span className={cn("tabular-nums", d === today && "font-bold text-primary")}>{r.days[d]}</span> : <span className="text-muted-foreground/50">·</span>),
      })),
    ],
    [days, dayOf, today],
  );

  return (
    <>
      <RangeBar range={range} today={today} />

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 [&>*]:min-w-0">
        <Stat label="Tổng chuyến" value={formatNumber(stats.trips)} note={stats.noVehicle || stats.noDriver ? `${stats.noVehicle} chuyến chưa có xe, ${stats.noDriver} chưa có tài xế` : "Đã gán đủ xe, tài xế"} />
        <Stat label="Trung bình mỗi xe công ty" value={`${formatNumber(stats.vehicleAvg)} chuyến`} note={`${stats.companyVehicles} xe đang hoạt động`} />
        <Stat label="Trung bình mỗi tài xế" value={`${formatNumber(stats.driverAvg)} chuyến`} note={`${stats.activeDrivers} tài xế đang làm`} />
        <Stat label="Xe công ty chưa chạy chuyến nào" value={String(idleVehicles)} tone={idleVehicles ? "warn" : undefined} note="Nên ưu tiên giao chuyến" />
        <Stat label="Tài xế chưa chạy chuyến nào" value={String(idleDrivers)} tone={idleDrivers ? "warn" : undefined} note="Tài xế đang làm, chưa có chuyến" />
      </div>

      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Xem theo">
        {(
          [
            ["xe", "Theo xe"],
            ["tai-xe", "Theo tài xế"],
            ["ngay", "Từng ngày trong kỳ"],
          ] as [Tab, string][]
        ).map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={tab === v}
            onClick={() => setTab(v)}
            className={cn("rounded-lg border px-3 py-2 text-sm font-medium", tab === v ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
          >
            {l}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden py-0">
        <CardContent className="p-0">
          {tab === "xe" ? (
            <ReportGrid
              tableKey="trip_count_vehicles"
              rows={shownVehicles}
              columns={vehicleCols}
              view={views.vehicles}
              getRowId={(r) => r.id}
              defaultPinned={["plate_number"]}
              searchPlaceholder="Tìm biển số, loại xe, tài xế…"
              emptyText="Chưa có xe nào."
            />
          ) : tab === "tai-xe" ? (
            <ReportGrid
              tableKey="trip_count_drivers"
              rows={drivers}
              columns={driverCols}
              view={views.drivers}
              getRowId={(r) => r.id}
              defaultPinned={["full_name"]}
              searchPlaceholder="Tìm tài xế, mã, SĐT, biển số đã chạy…"
              emptyText="Chưa có tài xế nào."
            />
          ) : (
            <ReportGrid
              key={dayOf}
              tableKey="trip_count_days"
              rows={dayRows}
              columns={dayCols}
              view={views.days}
              getRowId={(r) => r.id}
              defaultPinned={["name"]}
              searchPlaceholder={dayOf === "xe" ? "Tìm biển số, tài xế…" : "Tìm tài xế…"}
              emptyText="Không có dữ liệu."
              toolbar={
                <>
                  <NativeSelect aria-label="Từng ngày theo" value={dayOf} onChange={(e) => setDayOf(e.target.value as typeof dayOf)} className="h-8 w-auto text-sm">
                    <option value="xe">Mỗi dòng một xe</option>
                    <option value="tai-xe">Mỗi dòng một tài xế</option>
                  </NativeSelect>
                  {days.length >= 62 ? <span className="text-xs text-muted-foreground">Chỉ hiện 62 ngày đầu của kỳ.</span> : null}
                </>
              }
            />
          )}
        </CardContent>
      </Card>
      <p className="mt-2 text-xs text-muted-foreground">
        Cột &quot;So với TB&quot;: số âm (xanh) là ít chuyến hơn trung bình, nên ưu tiên giao thêm; số dương lớn (vàng) là đã chạy nhiều. Chỉ tính xe nội bộ, không tính xe thuê ngoài 3PL. Trung bình xe chỉ tính xe nội bộ đang hoạt động, trung bình tài xế chỉ tính tài xế đang làm.
      </p>
    </>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "warn" }) {
  return (
    <Card className={cn("h-full py-3", tone === "warn" && "border-warning/50 bg-warning/5")}>
      <CardContent className="px-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{note}</div>
      </CardContent>
    </Card>
  );
}

/** Chọn tháng (có nút tháng trước / sau) hoặc khoảng ngày tùy chọn */
function RangeBar({ range, today }: { range: { from: string; to: string; isMonth: boolean; label: string }; today: string }) {
  const router = useRouter();
  const path = usePathname();
  const [mode, setMode] = useState<"thang" | "ngay">(range.isMonth ? "thang" : "ngay");
  const [month, setMonth] = useState(range.from.slice(0, 7));
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const goMonth = (ym: string) => router.push(`${path}?thang=${ym}`);
  function apply(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "thang") goMonth(month);
    else router.push(`${path}?tu=${from}&den=${to}`);
  }
  return (
    <form onSubmit={apply} className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border bg-card p-2.5">
      <div className="space-y-1">
        <Label htmlFor="kieu">Xem theo</Label>
        <NativeSelect id="kieu" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="h-8 w-auto text-sm">
          <option value="thang">Tháng</option>
          <option value="ngay">Từ ngày – đến ngày</option>
        </NativeSelect>
      </div>
      {mode === "thang" ? (
        <div className="space-y-1">
          <Label htmlFor="thang">Tháng (ví dụ 11/2026)</Label>
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Tháng trước" onClick={() => goMonth(shiftMonth(range.from.slice(0, 7), -1))}>
              <ChevronLeft />
            </Button>
            <Input id="thang" type="month" className="h-8 w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
            <Button type="button" variant="outline" size="icon" className="size-8" aria-label="Tháng sau" onClick={() => goMonth(shiftMonth(range.from.slice(0, 7), 1))}>
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <Label htmlFor="tu">Từ ngày</Label>
            <Input id="tu" type="date" className="h-8 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="den">Đến ngày</Label>
            <Input id="den" type="date" className="h-8 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </>
      )}
      <Button type="submit" size="sm">
        <Search /> Xem
      </Button>
      {range.from.slice(0, 7) !== today.slice(0, 7) || !range.isMonth ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => goMonth(today.slice(0, 7))}>
          Tháng này
        </Button>
      ) : null}
      <span className="text-xs text-muted-foreground">Đang xem: {range.label}</span>
    </form>
  );
}
