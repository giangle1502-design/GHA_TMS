"use client";
import { useState } from "react";
import { CircleDollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuickFreightDialog } from "@/components/dispatch/quick-freight-dialog";
import type { RowActionProps } from "@/components/finance/row-actions";
import { cn } from "@/lib/utils";

/**
 * Nút "Cước" trên dòng báo cáo theo chuyến (Lợi nhuận từng chuyến, Cước vận chuyển): mở khung Nhập cước chung
 * (đơn giá, % hỗ trợ dầu, phí thu khách, chi phí 3PL, bảng giá) ngay tại báo cáo, không cần mở lại chuyến.
 * Chuyến chưa nhập cước: nút màu cam "Nhập cước".
 */
export function FreightRowAction({ row }: RowActionProps) {
  const [open, setOpen] = useState(false);
  const id = String(row.id ?? "");
  const code = String(row.shipment_code ?? "");
  const missing = !(Number(row.freight_amount ?? 0) > 0);
  if (!id) return null;
  return (
    <>
      <Button
        variant={missing ? "outline" : "ghost"}
        size="sm"
        className={cn("h-7 px-2", missing && "border-amber-400 text-amber-800 hover:bg-amber-50 dark:text-amber-300")}
        title={missing ? `Chuyến ${code} chưa nhập cước: bấm để nhập ngay` : `Xem / sửa cước chuyến ${code}`}
        onClick={() => setOpen(true)}
      >
        <CircleDollarSign /> {missing ? "Nhập cước" : "Cước"}
      </Button>
      {open ? <QuickFreightDialog shipmentId={id} code={code} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
