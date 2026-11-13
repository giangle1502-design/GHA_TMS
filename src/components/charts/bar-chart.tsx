"use client";
import { useState } from "react";
import { fmt, niceTicks } from "./scale";

type Datum = { label: string; title: string; value: number };

/** Biểu đồ cột một chuỗi; rê chuột vào cột để xem giá trị */
export function BarChart({ data, unit, height = 220 }: { data: Datum[]; unit: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const pad = { t: 12, r: 8, b: 26, l: 32 };
  const ticks = niceTicks(Math.max(...data.map((d) => d.value), 0));
  const top = ticks[ticks.length - 1];
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const slot = iw / data.length;
  const bw = Math.min(28, slot * 0.6);
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const every = Math.max(1, Math.ceil(data.length / 16));
  const h = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={`Biểu đồ cột: ${unit}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
              {fmt(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * slot + (slot - bw) / 2;
          const bh = Math.max(0, y(0) - y(d.value));
          const r = Math.min(4, bh);
          return (
            <g key={d.label + i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * slot} y={pad.t} width={slot} height={ih} fill="transparent" />
              {bh > 0 ? (
                <path
                  d={`M${x},${y(0)} V${y(d.value) + r} Q${x},${y(d.value)} ${x + r},${y(d.value)} H${x + bw - r} Q${x + bw},${y(d.value)} ${x + bw},${y(d.value) + r} V${y(0)} Z`}
                  fill="var(--tone-blue)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              ) : null}
              {i % every === (data.length - 1) % every ? (
                <text x={pad.l + i * slot + slot / 2} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {d.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {h ? (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${((pad.l + hover! * slot + slot / 2) / W) * 100}%` }}
        >
          <div className="text-muted-foreground">{h.title}</div>
          <div className="font-semibold tabular-nums">
            {fmt(h.value)} {unit}
          </div>
        </div>
      ) : null}
    </div>
  );
}
