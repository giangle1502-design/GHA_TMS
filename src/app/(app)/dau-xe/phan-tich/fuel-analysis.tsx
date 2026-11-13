"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ReportGrid, type ReportColumn } from "@/components/grid/report-grid";
import { downloadXlsx } from "@/lib/xlsx-client";
import { NUMBER_LOCALE } from "@/lib/format";
import { monthLabel } from "@/lib/vehicle-fuel";
import { allocateTrips, routeStats, usedLiters, vehicleStats, type FuelMonthRow, type FuelTrip, type RouteStat, type VehicleStat } from "@/lib/fuel-analysis";
import type { TableViewConfig } from "@/lib/entities/types";
import { cn } from "@/lib/utils";

const nf = new Intl.NumberFormat(NUMBER_LOCALE, { maximumFractionDigits: 2 });
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "" : nf.format(v));
const pct = (v: number | null) => (v === null ? "" : `${v > 0 ? "+" : ""}${nf.format(v)}%`);
const tone = (v: number | null, warn = 5) =>
  v === null ? "" : v > warn ? "font-semibold text-red-600 dark:text-red-400" : v < -warn ? "text-emerald-700 dark:text-emerald-400" : "";

type Tab = "vehicles" | "routes" | "months";
type Row = Record<string, string | number | null> & { id: string };

/** Thanh ngang so sánh (giá trị / lớn nhất), vạch đen = định mức */
function Bar({ value, max, mark, danger }: { value: number | null; max: number; mark?: number | null; danger?: boolean }) {
  if (value === null || !max) return null;
  return (
    <div className="relative h-2.5 w-full min-w-16 rounded bg-muted">
      <div className={cn("h-full rounded", danger ? "bg-red-500" : "bg-primary")} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      {mark ? <div className="absolute -top-0.5 h-3.5 w-0.5 bg-foreground" style={{ left: `${Math.min(100, (mark / max) * 100)}%` }} title={`Định mức ${fmt(mark)}`} /> : null}
    </div>
  );
}

export function FuelAnalysis({
  from,
  to,
  months,
  rows,
  trips,
  tripsError,
  canExport,
  views,
}: {
  from: string;
  to: string;
  months: string[];
  rows: FuelMonthRow[];
  trips: FuelTrip[];
  tripsError: string | null;
  canExport: boolean;
  views: Record<Tab, TableViewConfig | null>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("vehicles");
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const [printing, setPrinting] = useState<{ title: string; cols: ReportColumn<Row>[]; rows: Row[] } | null>(null);

  const tripCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of trips) m.set(x.vehicleId, (m.get(x.vehicleId) ?? 0) + 1);
    return m;
  }, [trips]);
  const vehicles = useMemo(() => vehicleStats(rows, tripCount), [rows, tripCount]);
  const routes = useMemo(() => routeStats(allocateTrips(rows, trips)), [rows, trips]);
  const noKmRoutes = routes.filter((r) => r.routeKm === null).length;

  const totKm = vehicles.reduce((a, v) => a + v.km, 0);
  const totL = vehicles.reduce((a, v) => a + v.liters, 0);
  const totNorm = vehicles.reduce((a, v) => a + v.norm, 0);
  const totCost = vehicles.reduce((a, v) => a + v.cost, 0);
  const worst = vehicles.find((v) => v.overPct !== null && v.overPct > 0) ?? null;
  const topRoute = routes[0] ?? null;
  const missing = new Set(rows.filter((r) => r.kmRun === null || r.kmRun <= 0 || usedLiters(r) === null).map((r) => r.id)).size;

  useEffect(() => {
    if (!printing) return;
    const tm = setTimeout(() => {
      window.print();
      setPrinting(null);
    }, 50);
    return () => clearTimeout(tm);
  }, [printing]);

  // ---- So sánh xe
  const maxPer100 = Math.max(0, ...vehicles.map((v) => Math.max(v.per100 ?? 0, v.norm100 ?? 0)));
  const vRows: Row[] = vehicles.map((v, i) => ({ ...(v as unknown as Row), rank: i + 1 }));
  const n = (key: keyof VehicleStat | "rank", label: string, width = 110, render?: (r: Row) => React.ReactNode): ReportColumn<Row> => ({
    key,
    label,
    width,
    align: "right",
    kind: "number",
    value: (r) => r[key] as number | null,
    render: render ?? ((r) => <span className="tabular-nums">{fmt(r[key] as number | null)}</span>),
  });
  const vCols: ReportColumn<Row>[] = [
    n("rank", "Hạng", 60),
    { key: "plate", label: "Số xe", width: 100, value: (r) => r.plate as string, render: (r) => <span className="font-semibold">{r.plate}</span> },
    { key: "type", label: "Loại xe", width: 110, kind: "select", options: [...new Set(vehicles.map((v) => v.type))].map((x) => ({ value: x, label: x })), value: (r) => r.type as string },
    { key: "driver", label: "Tài xế phụ trách", width: 140, value: (r) => r.driver as string },
    n("months", "Số tháng", 80),
    n("trips", "Số chuyến", 85),
    n("km", "KM chạy", 100),
    n("kmPerTrip", "KM / chuyến", 100),
    n("liters", "Lít dầu", 100),
    n("per100", "Lít / 100 km", 190, (r) => (
      <div className="flex items-center gap-2">
        <Bar value={r.per100 as number} max={maxPer100} mark={r.norm100 as number | null} danger={(r.overPct as number | null) !== null && (r.overPct as number) > 5} />
        <span className="w-12 shrink-0 text-right font-semibold tabular-nums">{fmt(r.per100 as number)}</span>
      </div>
    )),
    n("norm100", "Định mức lít / 100 km", 130),
    n("overPct", "Vượt định mức", 115, (r) => <span className={cn("tabular-nums", tone(r.overPct as number | null))}>{pct(r.overPct as number | null)}</span>),
    n("vsTypePct", "So với TB cùng loại", 130, (r) => <span className={cn("tabular-nums", tone(r.vsTypePct as number | null))}>{pct(r.vsTypePct as number | null)}</span>),
    n("cost", "Tiền dầu", 120),
    n("costPerKm", "Tiền dầu / km", 110),
  ];

  // ---- Theo tuyến (ước tính)
  const maxRoute = Math.max(0, ...routes.map((r) => r.liters));
  const rRows: Row[] = routes.map((r, i) => ({ ...(r as unknown as Row), id: r.key, rank: i + 1 }));
  const rn = (key: keyof RouteStat | "rank", label: string, width = 110, render?: (r: Row) => React.ReactNode) => n(key as keyof VehicleStat, label, width, render);
  const rCols: ReportColumn<Row>[] = [
    rn("rank", "Hạng", 60),
    { key: "name", label: "Tuyến đường", width: 240, value: (r) => r.name as string, render: (r) => <span className="font-medium" title={r.name as string}>{r.name}</span> },
    rn("routeKm", "KM tuyến", 90, (r) =>
      r.routeKm === null ? <span className="text-xs text-amber-700 dark:text-amber-400">chưa có km</span> : <span className="tabular-nums">{fmt(r.routeKm as number)}</span>,
    ),
    rn("trips", "Số chuyến", 85),
    rn("vehicles", "Số xe chạy", 85),
    rn("liters", "Lít dầu (ước tính)", 220, (r) => (
      <div className="flex items-center gap-2">
        <Bar value={r.liters as number} max={maxRoute} />
        <span className="w-20 shrink-0 text-right font-semibold whitespace-nowrap tabular-nums">{fmt(r.liters as number)}</span>
      </div>
    )),
    rn("sharePct", "Tỷ lệ % dầu", 95, (r) => <span className="tabular-nums">{fmt(r.sharePct as number)}%</span>),
    rn("litersPerTrip", "Lít / chuyến", 100),
    rn("per100", "Lít / 100 km", 100),
    rn("cost", "Tiền dầu (ước tính)", 140),
    rn("costPerTrip", "Tiền dầu / chuyến", 130),
  ];

  // ---- Theo tháng: lít/100 km của từng xe qua các tháng
  const mRows: Row[] = useMemo(() => {
    const ids = [...new Set(rows.map((r) => r.id))];
    return ids
      .map((id) => {
        const list = rows.filter((r) => r.id === id);
        const o: Row = { id, plate: list[0].plate, type: list[0].type };
        for (const m of months) {
          const r = list.find((x) => x.month === m);
          const l = r ? usedLiters(r) : null;
          o[m] = r && l !== null && r.kmRun ? Math.round((l / r.kmRun) * 10000) / 100 : null;
        }
        return o;
      })
      .filter((o) => months.some((m) => o[m] !== null));
  }, [rows, months]);
  const mCols: ReportColumn<Row>[] = [
    { key: "plate", label: "Số xe", width: 100, value: (r) => r.plate as string, render: (r) => <span className="font-semibold">{r.plate}</span> },
    { key: "type", label: "Loại xe", width: 110, value: (r) => r.type as string },
    ...months.map((m, i) => ({
      key: m,
      label: `Lít/100km ${monthLabel(m)}`,
      width: 120,
      align: "right" as const,
      kind: "number" as const,
      value: (r: Row) => r[m] as number | null,
      render: (r: Row) => {
        const prev = i > 0 ? (r[months[i - 1]] as number | null) : null;
        const cur = r[m] as number | null;
        const up = prev !== null && cur !== null ? cur - prev : null;
        return (
          <span className="tabular-nums">
            {fmt(cur)}
            {up ? <span className={cn("ml-1 text-xs", up > 0 ? "text-red-600" : "text-emerald-700")}>{up > 0 ? "▲" : "▼"}</span> : null}
          </span>
        );
      },
    })),
  ];

  const T = {
    vehicles: { key: "fuel_analysis_vehicles", rows: vRows, cols: vCols, title: "SO SÁNH DẦU GIỮA CÁC XE", empty: "Chưa có xe nào đủ số KM và số lít trong kỳ này." },
    routes: { key: "fuel_analysis_routes", rows: rRows, cols: rCols, title: "DẦU THEO TUYẾN ĐƯỜNG (ƯỚC TÍNH)", empty: tripsError ?? "Chưa có chuyến của xe có số liệu dầu trong kỳ này." },
    months: { key: "fuel_analysis_months", rows: mRows, cols: mCols, title: "LÍT DẦU / 100 KM THEO THÁNG", empty: "Chưa có số liệu." },
  }[tab];
  const period = from === to ? `tháng ${monthLabel(from)}` : `từ tháng ${monthLabel(from)} đến tháng ${monthLabel(to)}`;

  async function exportExcel(cols: ReportColumn<Row>[], list: Row[]) {
    await downloadXlsx({
      filename: `Phan tich dau ${tab} ${from}_${to}`,
      sheet: T.title.slice(0, 31),
      title: T.title,
      subtitle: period,
      columns: cols.map((c) => ({ label: c.label, width: c.width, numeric: c.kind === "number" })),
      rows: list.map((r) => cols.map((c) => c.value(r) ?? null)),
    });
  }

  return (
    <>
      <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } html, body { background: #fff !important; } .fa-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      .fa-print table { border-collapse: collapse; width: 100%; }
      .fa-print th, .fa-print td { border: 1px solid #000; padding: 2px 4px; vertical-align: middle; }
      .fa-print thead th { background: #000; color: #fff; font-weight: 700; text-align: center; border-color: #000 #fff; }`}</style>
      <div className="print:hidden">
        <form
          className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border bg-card p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/dau-xe/phan-tich?tu=${f}&den=${t}`);
          }}
        >
          <Button variant="outline" size="sm" asChild>
            <Link href="/dau-xe">
              <ArrowLeft /> Dầu theo xe
            </Link>
          </Button>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">Từ tháng</span>
            <input type="month" value={f} onChange={(e) => setF(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground" />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span className="block">Đến tháng</span>
            <input type="month" value={t} onChange={(e) => setT(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm text-foreground" />
          </label>
          <Button type="submit" size="sm" disabled={!f || !t}>
            Xem
          </Button>
          <span className="text-sm text-muted-foreground">Kỳ: {period} (tối đa 24 tháng)</span>
        </form>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Tổng KM chạy" value={fmt(totKm)} note={`${vehicles.length} xe có đủ số liệu`} />
          <Kpi label="Tổng lít dầu" value={fmt(totL)} note="số chốt, chưa chốt thì thực tế" />
          <Kpi label="Lít / 100 km chung" value={totKm ? fmt(Math.round((totL / totKm) * 10000) / 100) : ""} note={totNorm && totKm ? `định mức ${fmt(Math.round((totNorm / totKm) * 10000) / 100)}` : undefined} />
          <Kpi label="Tiền dầu" value={fmt(totCost)} note={totKm && totCost ? `${fmt(Math.round(totCost / totKm))} đ/km` : "đồng"} />
          <Kpi label="Xe vượt định mức nhiều nhất" value={worst ? worst.plate : "—"} note={worst ? `${pct(worst.overPct)} (${fmt(worst.per100)} lít/100km)` : "chưa có xe vượt"} danger={!!worst} />
          <Kpi label="Tuyến tốn dầu nhất" value={topRoute ? topRoute.name : "—"} note={topRoute ? `${fmt(topRoute.liters)} lít, ${fmt(topRoute.sharePct)}% (ước tính)` : undefined} />
        </div>

        <Card className="mt-4 gap-0 py-0">
          <div className="flex flex-wrap items-center gap-1 border-b px-3 pt-2">
            {(
              [
                ["vehicles", "So sánh xe"],
                ["routes", "Theo tuyến (ước tính)"],
                ["months", "Theo tháng"],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-1.5 text-sm",
                  tab === k ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <ReportGrid
            key={tab}
            tableKey={T.key}
            rows={T.rows}
            columns={T.cols}
            view={views[tab]}
            getRowId={(r) => r.id}
            defaultPinned={tab === "months" ? ["plate"] : [T.cols[0].key, T.cols[1].key]}
            emptyText={T.empty}
            onExport={canExport ? exportExcel : undefined}
            onPrint={(cols, list) => setPrinting({ title: T.title, cols, rows: list })}
          />
        </Card>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {tab === "vehicles" ? (
            <p>
              Lít/100 km = lít dầu ÷ KM chạy × 100. Vạch đen trên thanh là định mức (tỷ trọng của xe). Vượt định mức đỏ khi tốn hơn 5%. &quot;So với TB cùng loại&quot; so
              với lít/100 km chung của các xe cùng loại (cont với cont, tải với tải). Chỉ tính tháng có đủ KM đầu, KM cuối và số lít
              {missing ? `; ${missing} xe có tháng thiếu số liệu nên bị bỏ qua tháng đó` : ""}.
            </p>
          ) : tab === "routes" ? (
            <p>
              Ước tính: dầu của mỗi xe trong tháng được chia cho các chuyến xe đó chạy trong tháng theo km của tuyến (Danh mục Tuyến đường). Tuyến tốn dầu nhất = tổng
              lít nhiều nhất. Vì chia theo km nên Lít/100 km của tuyến phản ánh xe nào chạy tuyến đó, không đo được đường đèo, kẹt xe…
              {noKmRoutes ? ` ${noKmRoutes} tuyến chưa có km: nhập km ở Khách hàng và địa điểm → Tuyến đường để số chính xác hơn.` : ""}
            </p>
          ) : (
            <p>Lít dầu / 100 km của từng xe qua từng tháng. ▲ đỏ: tốn hơn tháng trước, ▼ xanh: ít hơn.</p>
          )}
        </div>
      </div>

      {printing ? (
        <div className="fa-print hidden text-[10px] text-black print:block" style={{ fontFamily: '"Times New Roman", Times, serif' }}>
          <div className="text-center text-[15px] font-bold">{printing.title}</div>
          <div className="mb-2 text-center italic">{period}</div>
          <table>
            <thead>
              <tr>
                {printing.cols.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {printing.rows.map((r) => (
                <tr key={r.id}>
                  {printing.cols.map((c) => {
                    const v = c.value(r);
                    const isPct = c.key === "overPct" || c.key === "vsTypePct";
                    return (
                      <td key={c.key} style={{ textAlign: c.kind === "number" ? "right" : "left" }}>
                        {typeof v === "number" ? (isPct ? pct(v) : fmt(v)) : (v ?? "")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function Kpi({ label, value, note, danger }: { label: string; value: string; note?: string; danger?: boolean }) {
  return (
    <Card className={cn("gap-1 py-3", danger && "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40")}>
      <CardContent className="px-3">
        <div className="truncate text-xs text-muted-foreground" title={label}>
          {label}
        </div>
        <div className={cn("truncate text-base font-bold tabular-nums sm:text-lg", danger && "text-red-700 dark:text-red-300")} title={value}>
          {value || "0"}
        </div>
        {note ? (
          <div className="truncate text-[11px] text-muted-foreground" title={note}>
            {note}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
