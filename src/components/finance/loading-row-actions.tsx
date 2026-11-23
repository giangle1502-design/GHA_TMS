"use client";
import { useState } from "react";
import { HandCoins, Loader2, PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuickFreightDialog } from "@/components/dispatch/quick-freight-dialog";
import { useCarrierCostDialog } from "@/components/finance/carrier-row-cost";
import { cn } from "@/lib/utils";

const warn = "border-amber-400 text-amber-800 hover:bg-amber-50 dark:text-amber-300";

/**
 * Nút trên dòng trang Bốc xếp 3PL: nhập thu và chi bốc xếp ngay tại bảng, không phải mở Điều phối / Quản lý chuyến.
 * - "Thu": khung Nhập cước, tab Cước & phí thu khách, cuộn tới nhóm Bốc xếp (SL × đơn giá thu khách).
 * - "Chi": khung Chi phí trả 3PL, sẵn dòng Bốc xếp 3PL (đơn vị bốc xếp, SL tấn × đơn giá); một chuyến thêm được nhiều đơn vị.
 * Lưu xong trang tự tải lại.
 */
export function LoadingRowActions({ id, code, hasRevenue, hasCost }: { id: string; code: string; hasRevenue: boolean; hasCost: boolean }) {
  const costs = useCarrierCostDialog(id, code, { startLoading: true });
  const [tab, setTab] = useState<"customer" | "carrier" | null>(null);
  return (
    <div className="flex flex-nowrap gap-1" onClick={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        variant="outline"
        className={cn("h-7 px-2", !hasRevenue && warn)}
        onClick={() => setTab("customer")}
        title={`Thu bốc xếp của khách, chuyến ${code}`}
        aria-label={`Nhập thu bốc xếp ${code}`}
      >
        <HandCoins className="size-3.5" /> {hasRevenue ? "Thu" : "Nhập thu"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className={cn("h-7 px-2", !hasCost && warn)}
        disabled={costs.loading}
        onClick={() => void costs.open(() => setTab("carrier"))}
        title={`Chi bốc xếp trả đơn vị bốc xếp (nhiều đơn vị được), chuyến ${code}`}
        aria-label={`Nhập chi bốc xếp ${code}`}
      >
        {costs.loading ? <Loader2 className="size-3.5 animate-spin" /> : <PackageOpen className="size-3.5" />} {hasCost ? "Chi" : "Nhập chi"}
      </Button>
      {costs.dialog}
      {tab ? (
        <QuickFreightDialog shipmentId={id} code={code} initialTab={tab} focusFeeRole={tab === "customer" ? "loading" : undefined} onClose={() => setTab(null)} />
      ) : null}
    </div>
  );
}
