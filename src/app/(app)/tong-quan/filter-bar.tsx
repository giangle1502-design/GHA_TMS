"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Filter, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { DASH_PRESETS, dashFilterQuery, type DashFilter, type DashPreset } from "@/lib/dashboard-filter";
import { cn } from "@/lib/utils";

const REFS = [
  { key: "kh", refKey: "customers", label: "Khách hàng", hint: "Gõ tên hoặc mã khách hàng" },
  { key: "tx", refKey: "drivers", label: "Tài xế", hint: "Gõ tên hoặc mã tài xế" },
  { key: "xe", refKey: "vehicles", label: "Xe", hint: "Gõ biển số, VD: 61K31295" },
  { key: "tuyen", refKey: "routes", label: "Tuyến", hint: "Gõ tên hoặc mã tuyến" },
] as const;

/** Thanh lọc trang Tổng quan; mọi lựa chọn ghi vào địa chỉ trang để gửi link hoặc tải lại vẫn giữ */
export function DashboardFilterBar({ filter }: { filter: DashFilter }) {
  const [v, setV] = useState(filter);
  const [pending, start] = useTransition();
  const router = useRouter();
  const go = (next: DashFilter) => {
    setV(next);
    const q = dashFilterQuery(next);
    start(() => router.push(q ? `/tong-quan?${q}` : "/tong-quan"));
  };
  const hasEntity = !!(v.kh || v.tx || v.xe || v.tuyen);
  const changed = hasEntity || v.ky !== "thang";

  return (
    <div className="mb-4 space-y-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Filter className="size-3.5" />} Thời gian (ngày nhận hàng):
        </span>
        {DASH_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => go({ ...v, ky: p.value as DashPreset })}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              v.ky === p.value ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/40 hover:bg-accent",
            )}
          >
            {p.label}
          </button>
        ))}
        <span className={cn("ml-1 flex flex-wrap items-center gap-1.5", v.ky === "tuy-chon" && "rounded-full ring-2 ring-primary/40")}>
          <Input
            type="date"
            aria-label="Từ ngày"
            title="Từ ngày"
            className="h-8 w-[9.5rem] text-xs"
            value={v.tu}
            onChange={(e) => e.target.value && go({ ...v, ky: "tuy-chon", tu: e.target.value })}
          />
          <span className="text-xs text-muted-foreground">đến</span>
          <Input
            type="date"
            aria-label="Đến ngày"
            title="Đến ngày"
            className="h-8 w-[9.5rem] text-xs"
            value={v.den}
            onChange={(e) => e.target.value && go({ ...v, ky: "tuy-chon", den: e.target.value })}
          />
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-end">
        {REFS.map((r) => (
          <div key={r.key} className="min-w-0 space-y-1">
            <Label htmlFor={`dash-${r.key}`} className="text-xs text-muted-foreground">
              {r.label} <span className="font-normal">· {r.hint}</span>
            </Label>
            <ReferenceSelect
              id={`dash-${r.key}`}
              refKey={r.refKey}
              value={v[r.key]}
              allowQuickCreate={false}
              onChange={(id) => go({ ...v, [r.key]: id })}
            />
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={!changed || pending}
          onClick={() => go({ ky: "thang", tu: "", den: "", kh: "", tx: "", xe: "", tuyen: "" })}
        >
          <X /> Bỏ lọc
        </Button>
      </div>
    </div>
  );
}
