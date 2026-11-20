"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { PackageOpen, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/input";
import { ReportGrid, type ReportColumn } from "@/components/grid/report-grid";
import { QuickFreightDialog } from "@/components/dispatch/quick-freight-dialog";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { downloadXlsx } from "@/lib/xlsx-client";
import { SHIPMENT_STATUS } from "@/lib/status";
import type { TableViewConfig } from "@/lib/entities/types";

export type MissingFeeRow = {
  id: string;
  shipment_code: string;
  order_code: string | null;
  status: string;
  pickup_date: string;
  report_date: string;
  customer_code: string | null;
  customer_name: string | null;
  plate_number: string | null;
  driver_name: string | null;
  carrier_name: string | null;
  route_label: string | null;
  container_no: string | null;
  tons: number;
  loading_revenue: number;
  missing_loading: boolean;
  missing_pass_through: boolean;
};

type Kind = "" | "loading" | "pass_through";
type Open = { id: string; code: string; tab: "customer" | "carrier" };

const statusLabel = (v: string) => SHIPMENT_STATUS.find((o) => o.value === v)?.label ?? v;
const missingText = (r: MissingFeeRow) => [r.missing_loading ? "Bốc xếp" : "", r.missing_pass_through ? "Chi hộ" : ""].filter(Boolean).join(", ");

export function MissingFees({ rows, view, canEdit, canLoading }: { rows: MissingFeeRow[]; view: TableViewConfig | null; canEdit: boolean; canLoading: boolean }) {
  const [kind, setKind] = useState<Kind>("");
  const [open, setOpen] = useState<Open | null>(null);
  const shown = rows.filter((r) => (kind === "loading" ? r.missing_loading : kind === "pass_through" ? r.missing_pass_through : true));
  const nLoading = rows.filter((r) => r.missing_loading).length;
  const nPass = rows.filter((r) => r.missing_pass_through).length;

  const columns = useMemo<ReportColumn<MissingFeeRow>[]>(
    () => [
      { key: "pickup_date", label: "Ngày nhận hàng", width: 110, kind: "date", value: (r) => r.pickup_date, render: (r) => formatDate(r.pickup_date) },
      {
        key: "shipment_code",
        label: "Mã chuyến",
        width: 130,
        value: (r) => r.shipment_code,
        render: (r) => (
          <Link href={`/chuyen-xe/${r.id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {r.shipment_code}
          </Link>
        ),
      },
      {
        key: "missing",
        label: "Còn thiếu",
        width: 150,
        value: (r) => missingText(r),
        render: (r) => (
          <div className="flex flex-wrap gap-1">
            {r.missing_loading ? <Badge variant="warning">Bốc xếp</Badge> : null}
            {r.missing_pass_through ? <Badge variant="warning">Chi hộ</Badge> : null}
          </div>
        ),
      },
      {
        key: "action",
        label: "Nhập phí",
        width: 230,
        value: () => "",
        render: (r) =>
          canEdit ? (
            <div className="flex flex-wrap gap-1">
              {r.missing_loading && canLoading ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-amber-400 px-2 text-amber-800 dark:text-amber-300"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen({ id: r.id, code: r.shipment_code, tab: "carrier" });
                  }}
                >
                  <PackageOpen /> Nhập bốc xếp
                </Button>
              ) : null}
              {r.missing_pass_through ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 border-amber-400 px-2 text-amber-800 dark:text-amber-300"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen({ id: r.id, code: r.shipment_code, tab: "customer" });
                  }}
                >
                  <Receipt /> Nhập chi hộ
                </Button>
              ) : null}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Không có quyền nhập</span>
          ),
      },
      { key: "customer", label: "Khách hàng", width: 110, value: (r) => r.customer_code ?? r.customer_name },
      { key: "route_label", label: "Tuyến đường", width: 360, value: (r) => r.route_label },
      { key: "plate_number", label: "Số xe", width: 110, value: (r) => r.plate_number },
      { key: "driver_name", label: "Tài xế", width: 150, value: (r) => r.driver_name },
      { key: "carrier_name", label: "Nhà xe 3PL", width: 160, value: (r) => r.carrier_name },
      { key: "container_no", label: "Số cont", width: 120, value: (r) => r.container_no },
      { key: "tons", label: "Tấn", width: 80, align: "right", kind: "number", value: (r) => Number(r.tons), render: (r) => formatNumber(Math.round(Number(r.tons) * 1000) / 1000) },
      { key: "loading_revenue", label: "Thu bốc xếp", width: 120, align: "right", kind: "number", value: (r) => Number(r.loading_revenue), render: (r) => formatVND(r.loading_revenue) },
      { key: "status", label: "Trạng thái", width: 140, value: (r) => statusLabel(r.status) },
      { key: "order_code", label: "Đơn hàng", width: 130, value: (r) => r.order_code },
      { key: "report_date", label: "Ngày hoàn thành", width: 110, kind: "date", value: (r) => r.report_date, render: (r) => formatDate(r.report_date) },
    ],
    [canEdit, canLoading],
  );

  // Bấm dòng: mở khung nhập phần còn thiếu đầu tiên
  const openRow = (r: MissingFeeRow) => {
    if (!canEdit) return;
    if (r.missing_loading && canLoading) setOpen({ id: r.id, code: r.shipment_code, tab: "carrier" });
    else if (r.missing_pass_through) setOpen({ id: r.id, code: r.shipment_code, tab: "customer" });
  };

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Chuyến còn thiếu phí" value={rows.length} active={kind === ""} onClick={() => setKind("")} />
        <Kpi label="Thiếu phí bốc xếp" value={nLoading} active={kind === "loading"} onClick={() => setKind("loading")} />
        <Kpi label="Thiếu phí chi hộ" value={nPass} active={kind === "pass_through"} onClick={() => setKind("pass_through")} />
      </div>
      <ReportGrid
        tableKey="missing_fees"
        rows={shown}
        columns={columns}
        view={view}
        getRowId={(r) => r.id}
        defaultPinned={["shipment_code"]}
        emptyText="Không còn chuyến nào thiếu phí bốc xếp hoặc chi hộ."
        onRowClick={openRow}
        rowTitle="Bấm để nhập phí còn thiếu"
        toolbar={
          <NativeSelect className="h-8 w-44" value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Loại phí còn thiếu">
            <option value="">Tất cả phí còn thiếu</option>
            <option value="loading">Chỉ thiếu bốc xếp</option>
            <option value="pass_through">Chỉ thiếu chi hộ</option>
          </NativeSelect>
        }
        onExport={(cols, list) =>
          downloadXlsx({
            filename: "Phi_chua_nhap.xlsx",
            sheet: "PhiChuaNhap",
            title: "PHÍ BỐC XẾP, CHI HỘ CHƯA NHẬP",
            subtitle: `${list.length} chuyến`,
            columns: cols.filter((c) => c.key !== "action").map((c) => ({ label: c.label, width: Math.max(10, Math.round(c.width / 8)), numeric: c.kind === "number" })),
            rows: list.map((r) =>
              cols
                .filter((c) => c.key !== "action")
                .map((c) => {
                  const v = c.value(r);
                  if (c.kind === "date" && typeof v === "string") return formatDate(v);
                  return v ?? "";
                }),
            ),
          })
        }
      />
      {open ? <QuickFreightDialog shipmentId={open.id} code={open.code} initialTab={open.tab} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function Kpi({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <Card className={active ? "border-l-4 border-l-amber-500" : "cursor-pointer hover:bg-muted/40"} onClick={onClick}>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-lg font-semibold tabular-nums ${value ? "text-amber-700 dark:text-amber-300" : "text-emerald-700"}`}>{formatNumber(value)}</div>
      </CardContent>
    </Card>
  );
}
