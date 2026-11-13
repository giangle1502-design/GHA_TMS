"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ReferenceSelect } from "@/components/entities/reference-select";

type Filters = { tu: string; den: string; tt: string; kh: string; q: string; adv: string[] };

export function ShipmentFilterBar({ filters }: { filters: Filters }) {
  const [v, setV] = useState(filters);
  const router = useRouter();
  function apply(next = v) {
    const q = new URLSearchParams();
    for (const k of ["tu", "den", "tt", "kh", "q"] as const) if (next[k]) q.set(k, next[k]);
    for (const a of next.adv) q.append("a", a);
    router.push(`/chuyen-xe?${q.toString()}`);
  }
  return (
    <form
      className="mb-3 grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-[repeat(2,10rem)_minmax(12rem,1fr)_minmax(12rem,1fr)_auto] lg:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="f-tu" className="text-xs text-muted-foreground">
          Nhận hàng từ ngày
        </Label>
        <Input id="f-tu" type="date" value={v.tu} onChange={(e) => setV({ ...v, tu: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="f-den" className="text-xs text-muted-foreground">
          Đến ngày
        </Label>
        <Input id="f-den" type="date" value={v.den} onChange={(e) => setV({ ...v, den: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="f-kh" className="text-xs text-muted-foreground">
          Khách hàng
        </Label>
        <ReferenceSelect id="f-kh" refKey="customers" value={v.kh} allowQuickCreate={false} onChange={(id) => setV({ ...v, kh: id })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="f-q" className="text-xs text-muted-foreground">
          Tìm mã chuyến, mã đơn, biển số, tài xế, địa điểm
        </Label>
        <Input id="f-q" value={v.q} onChange={(e) => setV({ ...v, q: e.target.value })} placeholder="Gõ để tìm…" />
      </div>
      <Button type="submit" className="sm:col-span-2 lg:col-span-1">
        <Search /> Lọc
      </Button>
    </form>
  );
}
