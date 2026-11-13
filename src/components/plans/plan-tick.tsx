"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createOrdersFromPlan } from "@/lib/plans/actions";
import { formatDate, formatNumber, todayVN } from "@/lib/format";
import type { RowActionProps } from "@/components/finance/row-actions";

/** Ô tích ở cột đầu của bảng kế hoạch: tích = tạo đơn trong Điều phối (mỗi cont một đơn) */
export function PlanTick({ row, onDone }: RowActionProps) {
  const ordered = row.status === "ordered";
  const qty = Number(row.container_qty ?? 1);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("");
  const [pending, start] = useTransition();

  if (ordered) {
    const codes = String(row.order_codes ?? "");
    return (
      <Link
        href={`/dieu-phoi?${new URLSearchParams({ ...(row.order_pickup_date ? { tu: String(row.order_pickup_date), den: String(row.order_pickup_date) } : {}), q: String(row.code ?? "") })}`}
        className="flex items-center justify-center"
        title={`Đã tạo ${row.order_count ?? qty} đơn: ${codes}. Bấm để mở Điều phối.`}
      >
        <input type="checkbox" checked readOnly aria-label={`Kế hoạch ${row.code} đã tạo đơn`} className="size-5 cursor-pointer accent-emerald-600" />
      </Link>
    );
  }

  function openDialog() {
    setDay(typeof row.delivery_date === "string" && row.delivery_date ? row.delivery_date.slice(0, 10) : todayVN());
    setOpen(true);
  }

  function submit() {
    start(async () => {
      const r = await createOrdersFromPlan({ planId: String(row.id), pickupDate: day });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Đã tạo ${r.data?.count ?? qty} đơn trong Điều phối: ${(r.data?.orderCodes ?? []).join(", ")}`);
      setOpen(false);
      onDone();
    });
  }

  return (
    <>
      <div className="flex items-center justify-center">
        <input
          type="checkbox"
          checked={open}
          onChange={openDialog}
          aria-label={`Tạo đơn từ kế hoạch ${row.code}`}
          title={`Tích để tạo ${formatNumber(qty)} đơn trong Điều phối`}
          className="size-5 cursor-pointer accent-primary"
        />
      </div>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo đơn từ kế hoạch {String(row.code ?? "")}</DialogTitle>
            <DialogDescription>
              Tạo <b>{formatNumber(qty)} đơn</b> trong Điều phối (mỗi cont một đơn) · {String(row.route_name ?? "")}
              {row.delivery_date ? ` · giao ngày ${formatDate(String(row.delivery_date))}` : ""}. Sau đó phân công xe, tài xế ở Điều phối.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`plan-day-${row.id}`}>Ngày nhận hàng của các chuyến *</Label>
            <Input id={`plan-day-${row.id}`} type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            <p className="text-xs text-muted-foreground">Mặc định là ngày giao của kế hoạch (không có thì hôm nay). Giá lấy theo bảng giá của khách, tuyến và loại cont.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Đóng
            </Button>
            <Button onClick={submit} disabled={pending || !day}>
              {pending ? <Loader2 className="animate-spin" /> : null} Tạo {formatNumber(qty)} đơn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
