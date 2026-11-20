"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Combine, Loader2, Split } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { clearLoadGroup, setLoadGroup } from "@/app/(app)/dieu-phoi/load-group-actions";
import { formatVND } from "@/lib/format";
import { rowMembers, type GroupedShipmentRow } from "@/lib/load-group";
import type { ShipmentListRow } from "@/lib/shipments";

/** Mã chuyến của dòng gộp: từng mã một link, kèm nhãn "Ghép N đơn" */
export function GroupCodes({ r, field }: { r: GroupedShipmentRow; field: "shipment" | "order" }) {
  const list = rowMembers(r);
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {list.map((m, i) => (
        <span key={m.id} className="whitespace-nowrap">
          {i > 0 ? <span className="text-muted-foreground">+ </span> : null}
          {field === "shipment" ? (
            <Link href={`/chuyen-xe/${m.id}`} className="font-medium text-primary hover:underline">
              {m.shipment_code}
            </Link>
          ) : (
            <Link href={`/dieu-phoi/don-hang/${m.order_id}`} className="hover:text-primary hover:underline">
              {m.order_code}
            </Link>
          )}
        </span>
      ))}
      {field === "shipment" ? (
        <span className="rounded bg-sky-100 px-1 text-[11px] font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-200" title="Các đơn đi chung một xe, cùng lượt: hiện 1 dòng, cước cộng lại">
          Ghép {list.length} đơn
        </span>
      ) : null}
    </div>
  );
}

/** Ô của dòng gộp cần sửa riêng từng chuyến (đơn giá, số cont, thao tác…): mỗi chuyến một dòng nhỏ có mã chuyến */
export function PerTrip({ r, children }: { r: GroupedShipmentRow; children: (m: ShipmentListRow) => React.ReactNode }) {
  const list = rowMembers(r);
  if (list.length < 2) return <>{children(r)}</>;
  return (
    <div className="space-y-0.5">
      {list.map((m) => (
        <div key={m.id} className="flex items-center gap-1">
          <span className="shrink-0 text-[10px] text-muted-foreground" title={`Chuyến ${m.shipment_code} (đơn ${m.order_code})`}>
            {m.shipment_code.replace(/^.*?-0*/, "#")}
          </span>
          <div className="min-w-0 flex-1">{children(m)}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Nút ghép chung xe / tách: hiện khi xe của chuyến còn chuyến khác cùng ngày (chưa ghép), hoặc dòng đang là dòng gộp.
 * Ghép: các chuyến của nhiều đơn đi chung một xe, cùng lượt hiện 1 dòng ở Điều phối, Quản lý chuyến, bảng kê.
 */
export function LoadGroupButton({ r, candidates, editable }: { r: GroupedShipmentRow; candidates: ShipmentListRow[]; editable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const grouped = Boolean(r.group_rows?.length);
  if (!editable || (!grouped && !candidates.length)) return null;

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-0.5">
      {grouped && r.load_group_id ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-6"
          disabled={pending}
          title="Tách: các chuyến hiện lại riêng từng dòng"
          aria-label={`Tách ghép xe ${r.shipment_code}`}
          onClick={() => run(() => clearLoadGroup({ groupId: r.load_group_id! }))}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Split className="size-3.5" />}
        </Button>
      ) : null}
      {candidates.length ? (
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (o) setPicked(candidates.length === 1 ? [candidates[0].id] : []);
          }}
        >
          <PopoverTrigger asChild>
            <Button type="button" size="icon" variant="ghost" className="size-6 text-sky-700 dark:text-sky-300" title="Ghép chung xe với chuyến khác cùng xe, cùng ngày (hiện 1 dòng)" aria-label={`Ghép chung xe ${r.shipment_code}`}>
              <Combine className="size-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80">
            <p className="mb-2 text-xs text-muted-foreground">
              Xe <b>{r.plate_number}</b> còn các chuyến dưới đây cùng ngày. Chọn chuyến <b>đi chung lượt</b> (ghép hàng 2 đơn lên một xe) để hiện 1 dòng ở
              Điều phối, Quản lý chuyến và bảng kê; cước các chuyến được cộng lại. Chuyến chạy lượt sau thì không chọn.
            </p>
            <div className="max-h-60 space-y-1 overflow-auto">
              {candidates.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={picked.includes(c.id)}
                    onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
                  />
                  <span className="min-w-0">
                    <b>{c.shipment_code}</b> · {c.order_code}
                    <span className="block truncate text-xs text-muted-foreground">
                      {[c.pickup_name, c.delivery_name].filter(Boolean).join(" → ")} · {formatVND(c.transport_fee ?? c.total_revenue)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
                Đóng
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={pending || !picked.length}
                onClick={() => run(() => setLoadGroup({ shipmentIds: [...rowMembers(r).map((m) => m.id), ...picked] }))}
              >
                {pending ? <Loader2 className="animate-spin" /> : <Combine />} Ghép chung xe
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </span>
  );
}
