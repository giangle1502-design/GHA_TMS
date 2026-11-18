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
export function ShipmentSuggestions(props: { tu: string; den: string; rows: SuggestionRow[]; bins: BinOption[]; linked: boolean; canCreate: boolean }) {
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

  return (
    <>
      {!props.linked ? (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Chưa gắn kho với địa điểm nào. Vào tab <Link href="/kho?tab=warehouses" className="underline">Kho</Link> (hoặc{" "}
          <Link href="/kho?tab=warehouse_bins" className="underline">Vị trí kho</Link>), sửa Kho GHA, chọn ô <b>Địa điểm trong danh mục</b> là điểm nhận / điểm giao
          của kho GHA trên chuyến xe. Sau đó chuyến giao tới kho GHA hiện ở đây để lập phiếu nhập, chuyến lấy hàng ở kho GHA để lập phiếu xuất.
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
        <p className="text-sm text-muted-foreground">
          {props.rows.length} chuyến chưa có phiếu. Chuyến qua kho GHA tự lập phiếu khi hoàn thành (tài xế đã xong / đã đóng) và tự ẩn khỏi đây; chưa hoàn thành thì chưa cộng / trừ tồn. Chỉ bấm Lập phiếu khi cần ghi khác (VD hàng chưa có mã).
        </p>
      </div>
      {props.rows.length ? (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[960px] text-sm [&_td]:border-r [&_td:last-child]:border-r-0 [&_th]:border-r [&_th:last-child]:border-r-0">
            <thead className="bg-muted text-left text-xs">
              <tr>
                <th className="px-2 py-2">Ngày</th>
                <th className="px-2 py-2">Chuyến</th>
                <th className="px-2 py-2">Gợi ý</th>
                <th className="px-2 py-2">Điểm nhận → Điểm giao</th>
                <th className="px-2 py-2">Xe / cont</th>
                <th className="px-2 py-2">Khách hàng</th>
                <th className="px-2 py-2">Hàng hóa</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {props.rows.map((r) => (
                <tr key={r.shipment_id} className="border-t align-top">
                  <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(r.trip_date)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <Link href={`/chuyen-xe/${r.shipment_id}`} className="font-medium text-primary hover:underline">
                      {r.shipment_code}
                    </Link>
                    <div className="text-xs text-muted-foreground">{STATUS[r.status] ?? r.status}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge variant={KIND[r.kind]?.variant ?? "info"}>{KIND[r.kind]?.label ?? r.kind}</Badge>
                    {r.needs_bin ? (
                      <Link href={`/chuyen-xe/${r.shipment_id}#lam-thay`} className="mt-1 block text-xs text-amber-700 underline">
                        Chưa chọn vị trí
                      </Link>
                    ) : null}
                    {!r.is_completed && !r.needs_bin ? <div className="mt-1 text-xs text-muted-foreground">Tự lập khi chuyến hoàn thành</div> : null}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.pickup_name} → {r.delivery_name}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{[r.plate_number, r.container_no].filter(Boolean).join(" · ")}</td>
                  <td className="px-2 py-1.5">{r.customer_name}</td>
                  <td className="px-2 py-1.5">
                    {r.items.length
                      ? r.items.map((i, k) => (
                          <div key={k} className={i.product_id ? "" : "text-destructive"}>
                            {i.item_code ?? i.item_name}: {formatNumber(i.quantity)} {i.unit}
                          </div>
                        ))
                      : <span className="text-muted-foreground">Chưa có mã hàng</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    {props.canCreate ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setOpenKey(r.shipment_id);
                          setOpen(prefillFor(r));
                        }}
                      >
                        <ClipboardPlus /> Lập phiếu
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : props.linked ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Không có chuyến qua kho GHA nào chưa lập phiếu trong kỳ này.</div>
      ) : null}
      {open ? (
        <StockVoucherDialog key={openKey} open onOpenChange={(o) => !o && setOpen(null)} onDone={() => router.refresh()} prefill={open} />
      ) : null}
    </>
  );
}
