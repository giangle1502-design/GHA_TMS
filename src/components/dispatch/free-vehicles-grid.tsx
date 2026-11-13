"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/input";
import { ReportGrid, type ReportColumn } from "@/components/grid/report-grid";
import type { TableViewConfig } from "@/lib/entities/types";
import type { FreeVehicleRow } from "@/lib/free-vehicles";

const OWNERSHIP: Record<string, string> = { owned: "Xe công ty", leased: "Thuê dài hạn", lease_purchase: "Thuê mua" };
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Báo cáo xe công ty còn trống (chưa có chuyến) trong khoảng ngày đang xem */
export function FreeVehiclesGrid({ rows, view, totalDays }: { rows: FreeVehicleRow[]; view: TableViewConfig | null; totalDays: number }) {
  const [mode, setMode] = useState<"free" | "none" | "all">("free");
  const shown = useMemo(
    () =>
      rows
        .filter((r) => (mode === "all" ? true : mode === "none" ? r.trips === 0 && r.busy_days === 0 : r.free_days > 0))
        .sort((a, b) => b.free_days - a.free_days || a.plate_number.localeCompare(b.plate_number)),
    [rows, mode],
  );
  const columns = useMemo<ReportColumn<FreeVehicleRow>[]>(
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
      { key: "code", label: "Mã xe", width: 100, value: (r) => r.code },
      { key: "vehicle_type", label: "Loại xe", width: 130, value: (r) => r.vehicle_type },
      { key: "driver_name", label: "Tài xế phụ trách", width: 160, value: (r) => r.driver_name },
      { key: "driver_phone", label: "SĐT tài xế", width: 115, value: (r) => r.driver_phone },
      {
        key: "ownership_type",
        label: "Sở hữu",
        width: 110,
        kind: "select",
        options: Object.entries(OWNERSHIP).map(([value, label]) => ({ value, label })),
        value: (r) => r.ownership_type,
        render: (r) => OWNERSHIP[r.ownership_type] ?? r.ownership_type,
      },
      { key: "trips", label: "Số chuyến trong kỳ", width: 110, align: "right", kind: "number", value: (r) => r.trips },
      { key: "busy_days", label: "Ngày bận (chưa giao xong)", width: 115, align: "right", kind: "number", value: (r) => r.busy_days },
      {
        key: "free_days",
        label: "Ngày trống",
        width: 100,
        align: "right",
        kind: "number",
        value: (r) => r.free_days,
        render: (r) => <Badge variant={r.free_days === totalDays ? "success" : r.free_days ? "warning" : "muted"}>{r.free_days === totalDays ? `Trống cả ${totalDays} ngày` : r.free_days}</Badge>,
      },
      {
        key: "free_dates",
        label: "Các ngày trống",
        width: 260,
        value: (r) => r.free_dates.map(ddmm).join(", "),
        render: (r) => (r.free_days === totalDays ? <span className="text-muted-foreground">Cả khoảng ngày</span> : r.free_dates.map(ddmm).join(", ")),
      },
    ],
    [totalDays],
  );
  return (
    <ReportGrid
      tableKey="dispatch_free_vehicles"
      rows={shown}
      columns={columns}
      view={view}
      getRowId={(r) => r.id}
      defaultPinned={["plate_number"]}
      searchPlaceholder="Tìm biển số, loại xe, tài xế…"
      emptyText={mode === "all" ? "Chưa có xe công ty nào đang hoạt động." : "Tất cả xe công ty đều đang bận (có chuyến chưa giao xong) trong khoảng ngày này."}
      toolbar={
        totalDays > 1 ? (
          <NativeSelect aria-label="Loại xe trống" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="h-8 w-auto text-sm">
            <option value="free">Xe còn ngày trống</option>
            <option value="none">Xe không có chuyến nào cả khoảng</option>
            <option value="all">Tất cả xe công ty</option>
          </NativeSelect>
        ) : (
          <NativeSelect aria-label="Loại xe trống" value={mode === "none" ? "free" : mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="h-8 w-auto text-sm">
            <option value="free">Xe còn trống</option>
            <option value="all">Tất cả xe công ty</option>
          </NativeSelect>
        )
      }
    />
  );
}
