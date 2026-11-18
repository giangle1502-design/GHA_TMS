"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPlus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber, todayVN } from "@/lib/format";
import { downloadXlsx } from "@/lib/xlsx-client";
import { ReportGrid, type ReportColumn } from "@/components/grid/report-grid";
import type { TableViewConfig } from "@/lib/entities/types";
import { StockVoucherDialog, type StockKind, type StockVoucherPrefill } from "@/components/inventory/stock-voucher-dialog";
import type { BinOption } from "./stock-report";

export type ContTrip = {
  shipment_id: string;
  shipment_code: string;
  status: string;
  trip_date: string;
  kind: StockKind;
  bin_code: string | null;
  to_bin_code: string | null;
  needs_bin: boolean;
  pickup_name: string | null;
  delivery_name: string | null;
  plate_number: string | null;
  container_no: string | null;
  order_code: string | null;
  customer_name: string | null;
  customer_id: string | null;
  pickup_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  items: { product_id: string | null; item_code: string | null; item_name: string | null; quantity: number | null; unit: string | null }[];
  voucher_no: string | null;
};
/** Một dòng = một mã hàng trên một cont */
type Row = ContTrip & { id: string; item_code: string; item_name: string; quantity: number | null; unit: string };

const KIND: Record<string, { label: string; variant: "success" | "warning" | "info" }> = {
  receipt: { label: "Về kho (nhập)", variant: "success" },
  issue: { label: "Đi khỏi kho (xuất)", variant: "warning" },
  transfer: { label: "Chuyển vị trí", variant: "info" },
};
const STATUS: Record<string, string> = {
  draft: "Chờ phân công",
  assigned: "Đã phân công",
  accepted: "Tài xế đã nhận",
  in_transit: "Đang chạy",
  driver_completed: "Đã tới / xong",
  closed: "Đã đóng",
};

/** Cont về / đi kho GHA trong ngày (thủ kho): số cont, mã hàng, số lượng, vị trí; gõ số cont để tra nhanh */
export function ContTrips(props: { tu: string; den: string; cont: string; rows: ContTrip[]; bins: BinOption[]; canCreate: boolean; view: TableViewConfig | null }) {
  const router = useRouter();
  const [tu, setTu] = useState(props.tu);
  const [den, setDen] = useState(props.den);
  const [cont, setCont] = useState(props.cont);
  const [open, setOpen] = useState<{ key: string; prefill: StockVoucherPrefill } | null>(null);
  const binId = (code: string | null) => props.bins.find((b) => b.code === code)?.id ?? null;

  const go = (p: { tu?: string; den?: string; cont?: string }) => {
    const sp = new URLSearchParams({ tab: "cont", tu: p.tu ?? props.tu, den: p.den ?? props.den });
    const c = (p.cont ?? props.cont).trim();
    if (c) sp.set("cont", c);
    router.push(`/kho?${sp.toString()}`);
  };

  const rows = useMemo<Row[]>(
    () =>
      props.rows.flatMap((t) =>
        (t.items.length ? t.items : [{ product_id: null, item_code: "", item_name: "Chưa có mã hàng", quantity: null, unit: "" }]).map((i, k) => ({
          ...t,
          id: `${t.shipment_id}-${k}`,
          item_code: i.item_code ?? "",
          item_name: i.item_name ?? "",
          quantity: i.quantity === null ? null : Number(i.quantity),
          unit: i.unit ?? "",
        })),
      ),
    [props.rows],
  );
  const conts = (k: string) => new Set(props.rows.filter((r) => r.kind === k).map((r) => r.container_no || r.shipment_id)).size;

  function prefillFor(r: ContTrip): StockVoucherPrefill {
    const from = r.kind === "receipt" ? null : binId(r.bin_code);
    const to = r.kind === "receipt" ? binId(r.bin_code) : r.kind === "transfer" ? binId(r.to_bin_code) : null;
    return {
      kind: r.kind,
      entry_date: r.trip_date,
      bin_id: (r.kind === "receipt" ? to : from) ?? props.bins[0]?.id ?? null,
      to_bin_id: r.kind === "transfer" ? to : null,
      ref_no: r.shipment_code,
      partner: [r.plate_number, r.container_no].filter(Boolean).join(" · "),
      shipment_id: r.shipment_id,
      owner_customer_id: r.customer_id,
      source: `cont ${r.container_no ?? ""} · ${r.pickup_name ?? ""} → ${r.delivery_name ?? ""}`,
      lines: r.items.map((i) => ({ product_id: i.product_id, quantity: i.quantity ? Number(i.quantity) : null, label: [i.item_code, i.item_name].filter(Boolean).join(" · ") })),
    };
  }

  const columns: ReportColumn<Row>[] = [
    { key: "trip_date", label: "Ngày", width: 95, kind: "date", value: (r) => r.trip_date, render: (r) => formatDate(r.trip_date) },
    {
      key: "kind",
      label: "Về / đi",
      width: 140,
      value: (r) => KIND[r.kind]?.label ?? r.kind,
      render: (r) => <Badge variant={KIND[r.kind]?.variant ?? "info"}>{KIND[r.kind]?.label ?? r.kind}</Badge>,
    },
    {
      key: "bin_code",
      label: "Vị trí",
      width: 90,
      value: (r) => (r.to_bin_code ? `${r.bin_code} → ${r.to_bin_code}` : r.bin_code),
      render: (r) => (r.needs_bin ? <span className="text-amber-700">Chưa chọn</span> : r.to_bin_code ? `${r.bin_code} → ${r.to_bin_code}` : r.bin_code),
    },
    { key: "container_no", label: "Số cont", width: 130, value: (r) => r.container_no, render: (r) => <span className="font-semibold">{r.container_no}</span> },
    { key: "plate_number", label: "Số xe", width: 110, value: (r) => r.plate_number },
    { key: "item_code", label: "Mã hàng", width: 130, value: (r) => r.item_code, render: (r) => <span className="font-medium">{r.item_code}</span> },
    { key: "item_name", label: "Tên hàng", width: 200, value: (r) => r.item_name },
    { key: "quantity", label: "Số lượng", width: 110, align: "right", kind: "number", value: (r) => r.quantity, render: (r) => (r.quantity === null ? "" : formatNumber(r.quantity)) },
    { key: "unit", label: "ĐVT", width: 60, value: (r) => r.unit },
    { key: "customer_name", label: "Chủ hàng", width: 160, value: (r) => r.customer_name },
    { key: "route", label: "Điểm nhận → Điểm giao", width: 240, value: (r) => `${r.pickup_name ?? ""} → ${r.delivery_name ?? ""}` },
    { key: "status", label: "Trạng thái", width: 120, value: (r) => STATUS[r.status] ?? r.status },
    { key: "shipment_code", label: "Chuyến", width: 120, value: (r) => r.shipment_code },
    { key: "order_code", label: "Đơn hàng", width: 110, value: (r) => r.order_code },
    {
      key: "voucher_no",
      label: "Phiếu kho",
      width: 130,
      value: (r) => r.voucher_no ?? "",
      render: (r) =>
        r.voucher_no ? (
          r.voucher_no
        ) : props.canCreate && r.id.endsWith("-0") ? (
          <Button size="sm" variant="outline" className="h-7" onClick={() => setOpen({ key: r.shipment_id, prefill: prefillFor(r) })}>
            <ClipboardPlus /> Lập phiếu
          </Button>
        ) : (
          <span className="text-muted-foreground">Chưa có</span>
        ),
    },
  ];

  const sameUnit = (list: Row[]) => {
    const u = [...new Set(list.map((r) => r.unit))];
    return u.length === 1 ? u[0] : null;
  };
  const isToday = props.tu === props.den && props.den === todayVN();
  const title = props.cont ? `Tra cứu cont "${props.cont}"` : isToday ? "Cont về / đi kho GHA hôm nay" : `Cont về / đi kho GHA từ ${formatDate(props.tu)} đến ${formatDate(props.den)}`;

  return (
    <>
      <form
        className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          go({ cont });
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="ct-cont">Số cont</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-2 size-4 text-muted-foreground" />
            <Input id="ct-cont" className="h-9 w-56 pl-7 uppercase" value={cont} onChange={(e) => setCont(e.target.value)} placeholder="Gõ số cont rồi Enter" autoFocus />
          </div>
        </div>
        <Button type="submit" className="h-9" disabled={!cont.trim() || cont.trim() === props.cont}>
          Tìm cont
        </Button>
        {props.cont ? (
          <Button
            type="button"
            variant="ghost"
            className="h-9"
            onClick={() => {
              setCont("");
              go({ cont: "" });
            }}
          >
            <X /> Bỏ tìm cont
          </Button>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="ct-tu">Từ ngày</Label>
          <Input id="ct-tu" type="date" className="h-9 w-40" value={tu} onChange={(e) => setTu(e.target.value)} disabled={Boolean(props.cont)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ct-den">Đến ngày</Label>
          <Input id="ct-den" type="date" className="h-9 w-40" value={den} onChange={(e) => setDen(e.target.value)} disabled={Boolean(props.cont)} />
        </div>
        <Button type="button" variant="outline" className="h-9" disabled={Boolean(props.cont) || (tu === props.tu && den === props.den)} onClick={() => go({ tu, den })}>
          Xem
        </Button>
        {!isToday || props.cont ? (
          <Button
            type="button"
            variant="ghost"
            className="h-9"
            onClick={() => {
              const t = todayVN();
              setTu(t);
              setDen(t);
              setCont("");
              go({ tu: t, den: t, cont: "" });
            }}
          >
            Hôm nay
          </Button>
        ) : null}
      </form>

      <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="text-sm text-muted-foreground">
          {conts("receipt")} cont về · {conts("issue")} cont đi{conts("transfer") ? ` · ${conts("transfer")} chuyển vị trí` : ""}
        </span>
      </div>
      <div className="rounded-lg border bg-card">
        <ReportGrid
          tableKey="stock_trips"
          rows={rows}
          columns={columns}
          view={props.view}
          getRowId={(r) => r.id}
          defaultPinned={["trip_date", "kind"]}
          searchPlaceholder="Lọc trong bảng: mã hàng, xe, chủ hàng…"
          emptyText={props.cont ? "Không tìm thấy cont này trên chuyến qua kho GHA (trong 1 năm gần nhất)." : "Không có cont về / đi kho GHA trong ngày này."}
          footer={(list) => {
            const u = sameUnit(list);
            return u && list.length > 1 ? { trip_date: "Cộng", quantity: formatNumber(list.reduce((a, r) => a + (r.quantity ?? 0), 0)), unit: u } : null;
          }}
          onExport={(cols, list) =>
            downloadXlsx({
              filename: `Cont-ve-di-kho-GHA-${props.cont || `${props.tu}-${props.den}`}.xlsx`,
              sheet: "Cont về đi",
              title: title.toUpperCase(),
              columns: cols.map((c) => ({ label: c.label, width: Math.max(8, Math.round(c.width / 8)), numeric: c.align === "right" })),
              rows: list.map((r) => cols.map((c) => (c.key === "trip_date" ? formatDate(r.trip_date) : (c.value(r) ?? "")))),
            })
          }
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Mỗi dòng là một mã hàng trên một cont. Cont về: ngày tới kho (chưa tới thì ngày giao dự kiến); cont đi: ngày lấy hàng. Chuyến hoàn thành thì phiếu kho tự lập theo vị trí; cột Phiếu kho cho biết đã có phiếu chưa.
      </p>
      {open ? <StockVoucherDialog key={open.key} open onOpenChange={(o) => !o && setOpen(null)} onDone={() => router.refresh()} prefill={open.prefill} /> : null}
    </>
  );
}
