"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { formatDate } from "@/lib/format";

/** Chọn Từ ngày - Đến ngày cho các bảng báo cáo (tham số URL tu, den; mặc định tháng hiện tại do trang tính sẵn) */
export function ReportDateRange({ tu, den, thisMonth, lastMonth }: { tu: string; den: string; thisMonth: { tu: string; den: string }; lastMonth: { tu: string; den: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [from, setFrom] = useState(tu);
  const [to, setTo] = useState(den);
  const [pending, start] = useTransition();

  const go = (a: string, b: string) => {
    if (!a || !b) return;
    const [x, y] = a <= b ? [a, b] : [b, a];
    setFrom(x);
    setTo(y);
    const q = new URLSearchParams(sp.toString());
    q.set("tu", x);
    q.set("den", y);
    q.delete("page");
    start(() => router.push(`${pathname}?${q.toString()}`, { scroll: false }));
  };
  const isThis = tu === thisMonth.tu && den === thisMonth.den;
  const isLast = tu === lastMonth.tu && den === lastMonth.den;

  return (
    <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
      <CalendarRange className="mb-2 size-4 text-muted-foreground" />
      <div className="space-y-1">
        <Label htmlFor="bc-tu">Từ ngày</Label>
        <Input id="bc-tu" type="date" className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bc-den">Đến ngày</Label>
        <Input id="bc-den" type="date" className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <Button className="h-9" onClick={() => go(from, to)} disabled={pending || (from === tu && to === den)}>
        {pending ? <Loader2 className="animate-spin" /> : null} Xem
      </Button>
      <Button variant={isThis ? "secondary" : "outline"} className="h-9" onClick={() => go(thisMonth.tu, thisMonth.den)} disabled={pending}>
        Tháng này
      </Button>
      <Button variant={isLast ? "secondary" : "outline"} className="h-9" onClick={() => go(lastMonth.tu, lastMonth.den)} disabled={pending}>
        Tháng trước
      </Button>
      <span className="pb-2 text-xs text-muted-foreground">
        Đang xem {formatDate(tu)} – {formatDate(den)}. Bảng tính theo tháng (Tổng hợp theo tháng, Theo xe…) lấy các tháng nằm trong khoảng này.
      </span>
    </div>
  );
}
