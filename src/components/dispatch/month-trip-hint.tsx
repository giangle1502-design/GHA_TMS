"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Loader2 } from "lucide-react";
import { formatDate, formatNumber } from "@/lib/format";
import { monthTripCount, type MonthTripCount } from "@/app/(app)/dieu-phoi/actions";
import { cn } from "@/lib/utils";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Dòng nhỏ dưới ô chọn xe / tài xế: trong tháng của ngày nhận hàng, xe (tài xế) này đã có bao nhiêu chuyến,
 * so với trung bình các xe (tài xế), để điều phối chia chuyến đều khi trong ngày không đủ chuyến cho mọi xe.
 */
export function MonthTripHint({ kind, id, day, excludeShipmentId }: { kind: "vehicle" | "driver"; id: string; day: string; excludeShipmentId?: string }) {
  const key = id && YMD.test(day) ? `${kind}|${id}|${day}` : "";
  const [result, setResult] = useState<{ key: string; data: MonthTripCount | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    monthTripCount({ kind, id, day, excludeShipmentId }).then((r) => {
      if (alive) setResult({ key, data: r.ok ? (r.data ?? null) : null });
    });
    return () => {
      alive = false;
    };
  }, [key, kind, id, day, excludeShipmentId]);

  if (!key) return null;
  if (result?.key !== key) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Đang đếm số chuyến trong tháng…
      </p>
    );
  }
  const d = result.data;
  if (!d) return null;
  const who = kind === "vehicle" ? "Xe này" : "Tài xế này";
  const each = kind === "vehicle" ? "mỗi xe công ty" : "mỗi tài xế";
  const month = `${day.slice(5, 7)}/${day.slice(0, 4)}`;
  const low = d.month < d.avg;
  const high = d.month > d.avg + 1;
  return (
    <div className={cn("rounded-md border px-2 py-1.5 text-xs", high ? "border-warning/40 bg-warning/10" : low ? "border-success/40 bg-success/10" : "bg-muted/40")}>
      <p className="flex flex-wrap items-center gap-x-1">
        <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
        <span>
          {who} đã chạy <b>{d.month} chuyến</b> trong tháng {month}
          {d.month ? ` (đã giao xong ${d.delivered})` : ""}, ngày {formatDate(day)}: <b>{d.day} chuyến</b> khác.
        </span>
      </p>
      <p className="mt-0.5 text-muted-foreground">
        Trung bình {each}: {formatNumber(d.avg)} chuyến/tháng (ít nhất {d.min}, nhiều nhất {d.max}).{" "}
        {high ? <b className="text-[oklch(0.47_0.12_65)]">Nhiều hơn trung bình, cân nhắc giao xe/tài xế khác.</b> : low ? <b className="text-success">Ít chuyến hơn trung bình, nên ưu tiên.</b> : null}{" "}
        <Link href={`/so-chuyen?thang=${day.slice(0, 7)}`} target="_blank" className="text-primary hover:underline">
          Xem bảng số chuyến
        </Link>
      </p>
    </div>
  );
}
