"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { AdvancedFilter } from "@/components/advanced-filter";
import { addDaysYMD } from "@/lib/format";
import { encodeCondition, parseConditions, type AdvField } from "@/lib/advanced-filter";

export type DispatchFilters = { tu: string; den: string; kh: string; xe: string; tx: string; q: string; adv: string[]; xem: string };

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/** Bộ lọc màn hình Điều phối: khoảng ngày nhận hàng, khách hàng, xe, tài xế, từ khóa, tìm kiếm nâng cao */
export function DispatchFilterBar({
  filters,
  today,
  advFields,
  advLabels,
  keepRange = false,
}: {
  filters: DispatchFilters;
  today: string;
  advFields: AdvField[];
  advLabels: Record<string, string>;
  /** Luôn ghi khoảng ngày lên URL (trang có khoảng ngày mặc định khác "hôm nay") */
  keepRange?: boolean;
}) {
  const [v, setV] = useState(filters);
  const [pending, start] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  function go(next: DispatchFilters) {
    let { tu, den } = next;
    if (!tu) tu = today;
    if (!den) den = tu;
    if (den < tu) [tu, den] = [den, tu];
    const q = new URLSearchParams();
    if (keepRange || tu !== today || den !== today) {
      q.set("tu", tu);
      q.set("den", den);
    }
    for (const k of ["kh", "xe", "tx", "q", "xem"] as const) if (next[k]) q.set(k, next[k].trim());
    for (const a of next.adv) q.append("a", a);
    setV({ ...next, tu, den });
    start(() => router.push(q.size ? `${pathname}?${q.toString()}` : pathname, { scroll: false }));
  }
  const setRange = (tu: string, den: string) => go({ ...v, tu, den });
  const span = days(v.tu, v.den) + 1;
  const monthStart = `${today.slice(0, 8)}01`;
  const monthEnd = addDaysYMD(`${addDaysYMD(monthStart, 32).slice(0, 8)}01`, -1);
  const preset = (label: string, tu: string, den: string) => (
    <Button type="button" size="sm" variant={filters.tu === tu && filters.den === den ? "secondary" : "ghost"} className="h-7 px-2" onClick={() => setRange(tu, den)}>
      {label}
    </Button>
  );
  const hasFilter = Boolean(filters.kh || filters.xe || filters.tx || filters.q || filters.adv.length);

  return (
    <form
      className="mb-4 space-y-2 rounded-lg border bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        go(v);
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[auto_minmax(9rem,10rem)_minmax(9rem,10rem)_auto_repeat(3,minmax(10rem,1fr))] lg:items-end">
        <Button type="button" variant="outline" size="icon" aria-label="Lùi một khoảng" title={`Lùi ${span} ngày`} className="hidden lg:inline-flex" onClick={() => setRange(addDaysYMD(v.tu, -span), addDaysYMD(v.den, -span))}>
          <ChevronLeft />
        </Button>
        <div className="space-y-1">
          <Label htmlFor="dp-tu" className="text-xs text-muted-foreground">
            Nhận hàng từ ngày
          </Label>
          <Input id="dp-tu" type="date" value={v.tu} onChange={(e) => setV({ ...v, tu: e.target.value, den: v.den < e.target.value ? e.target.value : v.den })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dp-den" className="text-xs text-muted-foreground">
            Đến ngày
          </Label>
          <Input id="dp-den" type="date" value={v.den} min={v.tu} onChange={(e) => setV({ ...v, den: e.target.value })} />
        </div>
        <Button type="button" variant="outline" size="icon" aria-label="Tiến một khoảng" title={`Tiến ${span} ngày`} className="hidden lg:inline-flex" onClick={() => setRange(addDaysYMD(v.tu, span), addDaysYMD(v.den, span))}>
          <ChevronRight />
        </Button>
        <div className="space-y-1">
          <Label htmlFor="dp-kh" className="text-xs text-muted-foreground">
            Công ty / khách hàng
          </Label>
          <ReferenceSelect id="dp-kh" refKey="customers" value={v.kh} allowQuickCreate={false} onChange={(id) => setV({ ...v, kh: id })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dp-xe" className="text-xs text-muted-foreground">
            Số xe
          </Label>
          <ReferenceSelect id="dp-xe" refKey="vehicles" value={v.xe} allowQuickCreate={false} onChange={(id) => setV({ ...v, xe: id })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dp-tx" className="text-xs text-muted-foreground">
            Tài xế
          </Label>
          <ReferenceSelect id="dp-tx" refKey="drivers" value={v.tx} allowQuickCreate={false} onChange={(id) => setV({ ...v, tx: id })} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input value={v.q} onChange={(e) => setV({ ...v, q: e.target.value })} placeholder="Mã chuyến, mã đơn, khách, biển số, tài xế, địa điểm…" aria-label="Từ khóa" className="pl-8" />
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Search />} Lọc
        </Button>
        {hasFilter ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => go({ ...v, kh: "", xe: "", tx: "", q: "", adv: [] })}>
            <X /> Bỏ lọc
          </Button>
        ) : null}
        <AdvancedFilter fields={advFields} value={parseConditions(filters.adv, advFields)} valueLabels={advLabels} onApply={(conds) => go({ ...v, adv: conds.map(encodeCondition) })} />
        <div className="flex flex-wrap items-center gap-0.5 sm:ml-auto">
          <span className="mr-1 text-xs text-muted-foreground">Nhanh:</span>
          {preset("Hôm qua", addDaysYMD(today, -1), addDaysYMD(today, -1))}
          {preset("Hôm nay", today, today)}
          {preset("Ngày mai", addDaysYMD(today, 1), addDaysYMD(today, 1))}
          {preset("7 ngày tới", today, addDaysYMD(today, 6))}
          {preset("Tháng này", monthStart, monthEnd)}
        </div>
      </div>
    </form>
  );
}
