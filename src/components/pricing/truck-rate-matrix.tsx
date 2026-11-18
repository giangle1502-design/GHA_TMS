"use client";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { round0, type TruckRateCard } from "@/lib/truck-rate";

/** base = đơn giá chưa dầu (đúng như bảng), fuel = cước gồm % dầu */
export type MatrixMode = "base" | "fuel";

/** Giá hiển thị trong ô theo chế độ xem */
export function shownPrice(raw: number | null, mode: MatrixMode, fuelPct: number): number | null {
  if (raw === null) return null;
  return mode === "base" ? raw : round0(raw * (1 + fuelPct / 100));
}

/** Bảng cước xe tải (chỉ xem): dòng = khoảng km, cột = trọng tải; bấm ô để chọn giá */
export function TruckRateMatrix({
  card,
  mode,
  fuelPct,
  highlight,
  onPick,
}: {
  card: TruckRateCard;
  mode: MatrixMode;
  fuelPct: number;
  highlight?: { di: number; wi: number } | null;
  onPick?: (di: number, wi: number) => void;
}) {
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            <th className="sticky left-0 z-20 border-r border-b bg-muted px-3 py-2 text-left font-semibold whitespace-nowrap">Khoảng cách</th>
            {card.weight_bands.map((w, j) => (
              <th
                key={j}
                className={cn("border-r border-b px-3 py-2 text-right font-semibold whitespace-nowrap", highlight?.wi === j && "bg-primary/15")}
                title={`${formatNumber(w.from_ton)} - ${formatNumber(w.to_ton)} tấn`}
              >
                {w.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {card.distance_bands.map((d, i) => (
            <tr key={i} className="border-b last:border-0">
              <th
                className={cn("sticky left-0 z-[5] border-r bg-card px-3 py-2 text-left font-medium whitespace-nowrap", highlight?.di === i && "bg-primary/15")}
                title={`${formatNumber(d.from_km)} - ${formatNumber(d.to_km)} km`}
              >
                {d.label}
              </th>
              {card.weight_bands.map((_, j) => {
                const v = shownPrice(card.prices[i]?.[j] ?? null, mode, fuelPct);
                const hit = highlight?.di === i && highlight?.wi === j;
                const cross = !hit && (highlight?.di === i || highlight?.wi === j);
                return (
                  <td key={j} className={cn("border-r p-0 text-right tabular-nums", cross && "bg-primary/5", hit && "bg-primary text-primary-foreground font-semibold")}>
                    {onPick && v !== null ? (
                      <button type="button" className="block w-full px-3 py-2 text-right hover:bg-primary/20" title="Bấm để lấy giá này" onClick={() => onPick(i, j)}>
                        {formatNumber(v)}
                      </button>
                    ) : (
                      <span className="block px-3 py-2">{v === null ? <span className="text-muted-foreground">–</span> : formatNumber(v)}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
