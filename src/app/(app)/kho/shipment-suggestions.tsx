"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/format";
import { StockVoucherDialog, type StockKind, type StockVoucherPrefill } from "@/components/inventory/stock-voucher-dialog";
import type { BinOption } from "./stock-report";
import { ReportGrid, type ReportColumn } from "@/components/grid/report-grid";
import type { TableViewConfig } from "@/lib/entities/types";

export type SuggestionRow = {
  shipment_id: string;
  shipment_code: string;
  status: string;
  trip_date: string;
  kind: StockKind;
  from_bin_id: string | null;
  to_bin_id: string | null;
  pickup_name: string | null;
  delivery_name: string | null;
  plate_number: string | null;
  container_no: string | null;
  order_code: string | null;
  order_voucher_no: string | null;
  order_ref_no: string | null;
  customer_name: string | null;
  is_completed: boolean;
  customer_id: string | null;
  /** Đơn / chuyến chọn Nhập / Xuất kho GHA nhưng chưa chọn vị trí GHA1 / GHA2 */
  needs_bin?: boolean | null;
  items: { product_id: string | null; item_code: string | null; item_name: string | null; quantity: number | null; unit: string | null }[];
};

const KIND: Record<string, { label: string; variant: "success" | "warning" | "info" }> = {
  receipt: { label: "Nhập kho", variant: "success" },
  issue: { label: "Xuất kho", variant: "warning" },
  transfer: { label: "Chuyển vị trí", variant: "info" },
};
const STATUS: Record<string, string> = {
  draft: "Chờ phân công",
  assigned: "Đã phân công",
  accepted: "Tài xế đã nhận",
  in_transit: "Đang chạy",
  driver_completed: "Tài xế đã xong",
  closed: "Đã đóng",
};

/** Chuyến có điểm nhận / điểm giao là kho GHA mà chưa lập phiếu kho: bấm Lập phiếu để điền sẵn mã hàng, số lượng, vị trí */
export function ShipmentSuggestions(props: { tu: string; den: string; rows: SuggestionRow[]; bins: BinOption[]; linked: boolean; canCreate: boolean; view: TableViewConfig | null }) {
  const router = useRouter();
  const [tu, setTu] = useState(props.tu);
  const [den, setDen] = useState(props.den);
  const [open, setOpen] = useState<StockVoucherPrefill | null>(null);
  const [openKey, setOpenKey] = useState("");
  const firstBin = props.bins[0]?.id ?? null;

  function prefillFor(r: SuggestionRow): StockVoucherPrefill {
    const bin = r.kind === "receipt" ? (r.to_bin_id ?? firstBin) : (r.from_bin_id ?? firstBin);
    return {
      kind: r.kind,
      entry_date: r.trip_date,
      bin_id: bin,
      to_bin_id: r.kind === "transfer" ? r.to_bin_id : null,
      ref_no: [r.shipment_code, r.order_voucher_no].filter(Boolean).join(" · ").slice(0, 100),
      partner: [r.plate_number, r.container_no].filter(Boolean).join(" · "),
      shipment_id: r.shipment_id,
      owner_customer_id: r.customer_id,
      source: `chuyến ${r.shipment_code} · ${r.pickup_name ?? ""} → ${r.delivery_name ?? ""}`,
      lines: r.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity ? Number(i.quantity) : null, label: [i.item_code, i.item_name].filter(Boolean).join(" · ") })),
    };
  }

  const columns: ReportColumn<SuggestionRow>[] = [
    { key: "trip_date", label: "Ngày", width: 100, kind: "date", value: (r) => r.trip_date, render: (r) => formatDate(r.trip_date) },
    {
      key: "shipment_code",
      label: "Chuyến",
      width: 140,
      value: (r) => r.shipment_code,
      render: (r) => (
        <span>
          <Link href={`/chuyen-xe/${r.shipment_id}`} className="font-medium text-primary hover:underline">
            {r.shipment_code}
          </Link>{" "}
          <span className="text-xs text-muted-foreground">{STATUS[r.status] ?? r.status}</span>
        </span>
      ),
    },
    {
      key: "kind",
      label: "Gợi ý",
      width: 150,
      value: (r) => `${KIND[r.kind]?.label ?? r.kind}${r.needs_bin ? " · chưa chọn vị trí" : ""}`,
      render: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          <Badge variant={KIND[r.kind]?.variant ?? "info"}>{KIND[r.kind]?.label ?? r.kind}</Badge>
          {r.needs_bin ? (
            <Link href={`/chuyen-xe/${r.shipment_id}#lam-thay`} className="text-xs text-amber-700 underline">
              Chưa chọn vị trí
            </Link>
          ) : !r.is_completed ? (
            <span className="text-xs text-muted-foreground">tự lập khi xong</span>
          ) : null}
        </span>
      ),
    },
    { key: "route", label: "Điểm nhận → Điểm giao", width: 260, value: (r) => `${r.pickup_name ?? ""} → ${r.delivery_name ?? ""}` },
    { key: "vehicle", label: "Xe / cont", width: 160, value: (r) => [r.plate_number, r.container_no].filter(Boolean).join(" · ") },
    { key: "order_code", label: "Đơn hàng", width: 120, value: (r) => r.order_code },
    { key: "customer_name", label: "Khách hàng", width: 180, value: (r) => r.customer_name },
    {
      key: "items",
      label: "Hàng hóa",
      width: 240,
      value: (r) => r.items.map((i) => `${i.item_code ?? i.item_name}: ${formatNumber(i.quantity)} ${i.unit ?? ""}`).join("; "),
      render: (r) =>
        r.items.length ? (
          r.items.map((i, k) => (
            <span key={k} className={i.product_id ? "" : "text-destructive"}>
              {k ? "; " : ""}
              {i.item_code ?? i.item_name}: {formatNumber(i.quantity)} {i.unit}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">Chưa có mã hàng</span>
        ),
    },
    ...(props.canCreate
      ? [
          {
            key: "action",
            label: "Lập phiếu",
            width: 110,
            value: () => "",
            render: (r: SuggestionRow) => (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => {
                  setOpenKey(r.shipment_id);
                  setOpen(prefillFor(r));
                }}
              >
                <ClipboardPlus /> Lập phiếu
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      {!props.linked ? (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Chưa gắn kho với địa điểm nào: chỉ chuyến của đơn đã chọn ô <b>Kho GHA</b> hiện ở đây. Muốn nhận cả chuyến theo địa điểm, vào tab{" "}
          <Link href="/kho?tab=warehouses" className="underline">Kho</Link> (hoặc <Link href="/kho?tab=warehouse_bins" className="underline">Vị trí kho</Link>),
          chọn ô <b>Địa điểm trong danh mục</b> là điểm nhận / điểm giao của kho GHA.
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <div className="space-y-1">
          <Label htmlFor="g-tu">Từ ngày</Label>
          <Input id="g-tu" type="date" className="h-9 w-40" value={tu} onChange={(e) => setTu(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="g-den">Đến ngày</Label>
          <Input id="g-den" type="date" className="h-9 w-40" value={den} onChange={(e) => setDen(e.target.value)} />
        </div>
        <Button variant="outline" className="h-9" onClick={() => router.push(`/kho?tab=chuyen&tu=${tu}&den=${den}`)} disabled={tu === props.tu && den === props.den}>
          Xem
        </Button>
        <p className="text-sm text-muted-foreground">Chuyến đã lập phiếu tự ẩn khỏi danh sách này.</p>
      </div>
      <div className="rounded-lg border bg-card">
        <ReportGrid
          tableKey="stock_suggestions"
          rows={props.rows}
          columns={columns}
          view={props.view}
          getRowId={(r) => r.shipment_id}
          defaultPinned={["trip_date", "shipment_code"]}
          searchPlaceholder="Tìm chuyến, xe, cont, mã hàng…"
          emptyText="Không có chuyến qua kho GHA nào chưa lập phiếu trong kỳ này."
        />
      </div>
      {open ? (
        <StockVoucherDialog key={openKey} open onOpenChange={(o) => !o && setOpen(null)} onDone={() => router.refresh()} prefill={open} />
      ) : null}
    </>
  );
}
