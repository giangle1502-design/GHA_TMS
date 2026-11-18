"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { StockTargetSelect } from "@/components/inventory/stock-target-select";
import { setStockTarget, type StockTargetOptions } from "@/lib/inventory/actions";

/** Kho GHA của riêng chuyến: chọn / đổi vị trí GHA1, GHA2 (kể cả sau khi chuyến đã hoàn thành: phiếu kho tự lập theo) */
export function ShipmentStockTarget({ shipmentId, stock }: { shipmentId: string; stock: StockTargetOptions }) {
  const router = useRouter();
  const [value, setValue] = useState(stock.value);
  const [pending, start] = useTransition();
  const needsBin = /^(receipt|issue):$/.test(stock.value) || stock.needsBin;
  return (
    <div className={`space-y-1.5 rounded-lg border p-3 ${needsBin ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30" : "border-dashed"}`}>
      <Label htmlFor="ship-stock" className="flex items-center gap-1.5">
        <Warehouse className="size-4" /> Kho GHA {stock.inherited && stock.value ? <span className="text-xs font-normal text-muted-foreground">(theo đơn hàng)</span> : null}
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <StockTargetSelect id="ship-stock" className="h-9 w-auto min-w-64" bins={stock.bins} value={value} onChange={setValue} emptyLabel={stock.viaLocation ? "Theo địa điểm gắn với kho" : "Chưa chọn"} />
        <Button
          size="sm"
          variant="outline"
          disabled={pending || value === stock.value}
          onClick={() =>
            start(async () => {
              const r = await setStockTarget({ shipmentId, value });
              if (!r.ok) return void toast.error(r.error);
              toast.success("Đã lưu vị trí kho của chuyến. Chuyến đã hoàn thành thì phiếu kho tự lập / cập nhật theo.");
              router.refresh();
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : null} Lưu
        </Button>
      </div>
      {needsBin ? <p className="text-xs text-amber-800 dark:text-amber-200">Chuyến qua kho GHA nhưng chưa chọn vị trí GHA1 / GHA2: chọn để cộng / trừ tồn kho.</p> : null}
    </div>
  );
}
