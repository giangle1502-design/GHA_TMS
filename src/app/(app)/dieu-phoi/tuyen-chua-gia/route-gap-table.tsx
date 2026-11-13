"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Loader2, Save, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveRoutePayRates } from "@/app/(app)/dieu-phoi/actions";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type RouteGap = {
  location_a_id: string;
  location_a_name: string;
  location_b_id: string;
  location_b_name: string;
  trips: number;
  recent_trips: number;
  last_date: string;
  amount: number | null;
  source: string;
  has_route_rate: boolean;
};

const SOURCE: Record<string, { label: string; cls: string }> = {
  route: { label: "Giá tuyến", cls: "text-emerald-700 dark:text-emerald-400" },
  place: { label: "Giá địa điểm", cls: "text-emerald-700 dark:text-emerald-400" },
  zone: { label: "Giá vùng", cls: "text-teal-700 dark:text-teal-400" },
  default: { label: "Giá mặc định", cls: "text-amber-700 dark:text-amber-400" },
  missing: { label: "Chưa có giá", cls: "text-destructive font-medium" },
};
const PERIODS = [30, 90, 180, 365, 730];
const key = (r: RouteGap) => `${r.location_a_id}|${r.location_b_id}`;

export function RouteGapTable({ rows, days, canFill }: { rows: RouteGap[]; days: number; canFill: boolean }) {
  const [q, setQ] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter((r) => (!onlyMissing || !r.has_route_rate) && (!t || `${r.location_a_name} ${r.location_b_name}`.toLowerCase().includes(t)));
  }, [rows, q, onlyMissing]);
  const filled = Object.entries(vals).filter(([, v]) => v.trim() !== "");
  const missingCount = rows.filter((r) => !r.has_route_rate).length;

  const save = () =>
    start(async () => {
      const byKey = new Map(rows.map((r) => [key(r), r]));
      const payload = filled
        .map(([k, v]) => ({ r: byKey.get(k), amount: Number(v.replace(/[^0-9]/g, "")) }))
        .filter((x) => x.r && Number.isFinite(x.amount))
        .map((x) => ({ a: x.r!.location_a_id, b: x.r!.location_b_id, amount: x.amount }));
      const res = await saveRoutePayRates({ rows: payload });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${res.message} (${res.data ?? 0} tuyến)`);
      setVals({});
      router.refresh();
    });

  const exportCsv = () => {
    const head = ["Tên gọi", "Điểm 1", "Điểm 2", "Lương mỗi chuyến", "Số chuyến", "Ngày chạy gần nhất", "Giá đang áp", "Giá lấy từ"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = shown.map((r) =>
      [`${r.location_a_name} ↔ ${r.location_b_name}`, r.location_a_name, r.location_b_name, "", r.trips, formatDate(r.last_date), r.amount ?? "", SOURCE[r.source]?.label ?? r.source]
        .map(esc)
        .join(","),
    );
    const blob = new Blob(["﻿" + [head.map(esc).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tuyen-chua-gia-luong-${days}-ngay.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm điểm nhận, điểm giao" className="w-64 pl-8" aria-label="Tìm tuyến" />
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" className="size-4" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          Chỉ tuyến chưa có giá riêng ({missingCount})
        </label>
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <span className="text-muted-foreground">Chuyến trong</span>
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/dieu-phoi/tuyen-chua-gia?ngay=${p}`}
              className={cn("rounded-md border px-2 py-1", p === days ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted")}
            >
              {p} ngày
            </Link>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!shown.length}>
            <Download /> Tải Excel
          </Button>
          {canFill ? (
            <Button size="sm" onClick={save} disabled={pending || !filled.length}>
              {pending ? <Loader2 className="animate-spin" /> : <Save />} Lưu giá {filled.length ? `(${filled.length} tuyến)` : ""}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-auto rounded-lg border" style={{ maxHeight: "70vh" }}>
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b text-left">
              <th className="px-3 py-2">Tuyến (hai chiều)</th>
              <th className="px-3 py-2 text-right">Số chuyến</th>
              <th className="px-3 py-2 text-right" title="Số chuyến trong 30 ngày gần đây">30 ngày</th>
              <th className="px-3 py-2">Chạy gần nhất</th>
              <th className="px-3 py-2 text-right">Giá đang áp</th>
              <th className="w-44 px-3 py-2 text-right">Lương mỗi chuyến</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const k = key(r);
              const src = SOURCE[r.source] ?? { label: r.source, cls: "" };
              return (
                <tr key={k} className="border-b hover:bg-muted/40">
                  <td className="px-3 py-1.5">
                    {r.location_a_name} <span className="text-muted-foreground">↔</span> {r.location_b_name}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(r.trips)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.recent_trips ? formatNumber(r.recent_trips) : ""}</td>
                  <td className="px-3 py-1.5">{formatDate(r.last_date)}</td>
                  <td className="px-3 py-1.5 text-right">
                    {r.amount != null ? <span className="tabular-nums">{formatNumber(r.amount)}</span> : null}
                    <div className={cn("text-xs", src.cls)}>{src.label}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {r.has_route_rate ? (
                      <span className="text-xs text-muted-foreground">Đã có giá tuyến</span>
                    ) : canFill ? (
                      <Input
                        inputMode="numeric"
                        value={vals[k] ?? ""}
                        onChange={(e) => {
                          const d = e.target.value.replace(/[^0-9]/g, "");
                          setVals((v) => ({ ...v, [k]: d ? formatNumber(Number(d)) : "" }));
                        }}
                        placeholder="Ví dụ: 900,000"
                        className="h-8 text-right tabular-nums"
                        aria-label={`Lương mỗi chuyến ${r.location_a_name} ↔ ${r.location_b_name}`}
                      />
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!shown.length ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">
                  {onlyMissing ? "Mọi tuyến đã có giá riêng." : "Không có tuyến nào."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
