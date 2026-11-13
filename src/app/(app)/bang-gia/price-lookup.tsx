"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, SearchCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { formatDate, formatNumber, formatVND, todayVN } from "@/lib/format";
import { lookupPrice, type PriceCandidate } from "./actions";

const UNIT: Record<string, string> = { trip: "chuyến", km: "km", ton: "tấn" };

export function PriceLookup() {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ customerId: "", pickupId: "", deliveryId: "", vehicleTypeId: "", onDate: todayVN() });
  const [result, setResult] = useState<{ candidates: PriceCandidate[]; ambiguous: boolean } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof v) => (val: string) => setV((s) => ({ ...s, [k]: val }));

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <SearchCheck /> Tra cứu giá áp dụng
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Tra cứu bảng giá áp dụng</DialogTitle>
            <DialogDescription>Nhập thông tin chuyến để xem bảng giá hệ thống sẽ chọn. Không có bảng giá phù hợp thì hệ thống không tự đoán giá.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Khách hàng</Label>
              <ReferenceSelect refKey="customers" value={v.customerId} onChange={set("customerId")} allowQuickCreate={false} />
            </div>
            <div className="space-y-1.5">
              <Label>Loại xe</Label>
              <ReferenceSelect refKey="vehicle_types" value={v.vehicleTypeId} onChange={set("vehicleTypeId")} allowQuickCreate={false} />
            </div>
            <div className="space-y-1.5">
              <Label>Điểm nhận</Label>
              <ReferenceSelect refKey="locations" value={v.pickupId} onChange={set("pickupId")} allowQuickCreate={false} />
            </div>
            <div className="space-y-1.5">
              <Label>Điểm giao</Label>
              <ReferenceSelect refKey="locations" value={v.deliveryId} onChange={set("deliveryId")} allowQuickCreate={false} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lookup-date">Ngày vận chuyển</Label>
              <Input id="lookup-date" type="date" value={v.onDate} onChange={(e) => set("onDate")(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await lookupPrice(v);
                    if (r.ok && r.data) setResult(r.data);
                    else if (!r.ok) toast.error(r.error);
                  })
                }
              >
                {pending ? <Loader2 className="animate-spin" /> : null} Tra cứu
              </Button>
            </div>
          </div>
          {result ? (
            result.candidates.length === 0 ? (
              <Alert variant="destructive">
                <AlertDescription>Không có bảng giá phù hợp. Khi tạo chuyến, điều phối phải nhập giá thủ công hoặc thêm bảng giá.</AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-2">
                {result.ambiguous ? (
                  <Alert>
                    <AlertDescription>Có hai bảng giá cùng mức cụ thể và cùng độ ưu tiên: người tạo chuyến sẽ phải chọn một bảng giá.</AlertDescription>
                  </Alert>
                ) : null}
                <ul className="divide-y rounded-md border text-sm">
                  {result.candidates.map((c, i) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>
                        <b>{c.code}</b> {i === 0 && !result.ambiguous ? <span className="ml-1 rounded bg-emerald-100 px-1.5 text-xs text-emerald-800">Được áp dụng</span> : null}
                        <span className="block text-xs text-muted-foreground">
                          Mức cụ thể {c.specificity} · ưu tiên {c.priority} · hiệu lực {formatDate(c.effective_from)}
                          {c.effective_to ? ` – ${formatDate(c.effective_to)}` : ""}
                        </span>
                      </span>
                      <span className="text-right">
                        {formatVND(c.unit_price)}/{c.pricing_unit === "other" ? c.pricing_unit_label : UNIT[c.pricing_unit]}
                        <span className="block text-xs text-muted-foreground">
                          {c.fuel_support_rate !== null ? `Hỗ trợ dầu ${formatNumber(c.fuel_support_rate)}%` : "Hỗ trợ dầu theo quy tắc"}
                          {c.surcharge_amount ? ` · phụ phí ${formatVND(c.surcharge_amount)}` : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
