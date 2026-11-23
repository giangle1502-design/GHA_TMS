"use client";
import { useState } from "react";
import { toast } from "sonner";
import { CircleDollarSign, Loader2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CarrierCostsDialog } from "@/components/finance/carrier-dialogs";
import { QuickFreightDialog } from "@/components/dispatch/quick-freight-dialog";
import { loadQuickFreight, type QuickFreight } from "@/lib/finance/quick-freight-actions";
import { cn } from "@/lib/utils";

/**
 * Nút trên dòng bảng Xe thuê ngoài 3PL (Chuyến 3PL): nhập chi phí ngay tại bảng, không phải mở Điều phối / Quản lý chuyến / chi tiết chuyến.
 * - "Nhập chi phí" / "Chi phí": mở thẳng khung Chi phí trả 3PL (cước 3PL × (1 + % dầu), bốc xếp 3PL, chi hộ 3PL, chi phí khác, nhà xe, số HĐ, hạn trả).
 * - "Cước": mở khung Nhập cước chung (đơn giá thu khách, % hỗ trợ dầu, phí thu khách, bảng giá, tab Chi phí trả 3PL).
 * Lưu xong bảng tự tải lại (router.refresh trong khung).
 */
export function CarrierRowCost({ row }: { row: Record<string, unknown> }) {
  const id = String(row.id ?? "");
  const code = String(row.shipment_code ?? "");
  const noCost = row.pay_status === "no_cost";
  const costs = useCarrierCostDialog(id, code);
  const [freight, setFreight] = useState<"customer" | "carrier" | null>(null);
  if (!id) return null;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className={cn("h-7 px-2", noCost && "border-amber-400 text-amber-800 hover:bg-amber-50 dark:text-amber-300")}
        disabled={costs.loading}
        onClick={() => void costs.open(() => setFreight("carrier"))}
        title={noCost ? `Chuyến ${code} chưa nhập chi phí 3PL: bấm để nhập ngay` : `Sửa chi phí trả 3PL chuyến ${code}`}
        aria-label={`Chi phí 3PL ${code}`}
      >
        {costs.loading ? <Loader2 className="size-3.5 animate-spin" /> : <Truck className="size-3.5" />} {noCost ? "Nhập chi phí" : "Chi phí"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2"
        onClick={() => setFreight("customer")}
        title={`Cước thu khách, % hỗ trợ dầu, phí thu khách, bảng giá chuyến ${code}`}
        aria-label={`Nhập cước ${code}`}
      >
        <CircleDollarSign className="size-3.5" /> Cước
      </Button>
      {costs.dialog}
      {freight ? <QuickFreightDialog shipmentId={id} code={code} initialTab={freight} onClose={() => setFreight(null)} /> : null}
    </>
  );
}

/**
 * Tải chuyến rồi mở thẳng khung Chi phí trả 3PL (CarrierCostsDialog autoOpen).
 * open(fallback): tài khoản không sửa được (chuyến đã hủy / chỉ xem) thì gọi fallback (vd. mở khung Nhập cước tab 3PL để xem).
 * startLoading: thêm sẵn một dòng bốc xếp nếu chuyến chưa có (trang Bốc xếp 3PL).
 */
export function useCarrierCostDialog(id: string, code: string, opts?: { startLoading?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [carrier, setCarrier] = useState<{ data: QuickFreight; carrier: NonNullable<QuickFreight["carrier"]> } | null>(null);

  async function open(fallback?: () => void) {
    setLoading(true);
    const r = await loadQuickFreight(id, { carrier: true });
    setLoading(false);
    if (!r.ok || !r.data) return void toast.error(r.ok ? "Không tải được chuyến." : r.error);
    const c = r.data.carrier;
    if (!c) return void toast.error("Tài khoản này không xem được chi phí 3PL.");
    if (!c.canEdit) return void (fallback ? fallback() : toast.error(`Chuyến ${code} không sửa được chi phí (đã hủy hoặc không có quyền).`));
    setCarrier({ data: r.data, carrier: c });
  }

  const customerPass = carrier
    ? carrier.data.fees
        .filter((f) => f.fee_kind === "pass_through" && Number(f.amount) > 0)
        .map((f) => ({ fee_type_id: f.fee_type_id, name: f.fee_type?.name ?? "Chi hộ", amount: Number(f.amount), ref_no: f.ref_no ?? null, note: f.note ?? null }))
    : [];

  const dialog = carrier ? (
    <CarrierCostsDialog
      autoOpen
      startLoading={opts?.startLoading}
      onClose={() => setCarrier(null)}
      shipmentId={carrier.data.id}
      code={carrier.data.code}
      supplierId={carrier.carrier.supplierId}
      supplierLabel={carrier.carrier.supplierName}
      invoiceNo={carrier.carrier.invoiceNo}
      dueDate={carrier.carrier.dueDate}
      costs={carrier.carrier.costs}
      customerPassThrough={customerPass}
      paidAmount={carrier.carrier.paidAmount}
      loadingFeeTypes={carrier.carrier.loadingFeeTypes}
      loadingUnitPrice={carrier.carrier.loadingUnitPrice}
      tripTons={carrier.carrier.tripTons}
    />
  ) : null;
  return { loading, open, dialog };
}
