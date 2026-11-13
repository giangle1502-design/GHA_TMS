"use client";
import { useState } from "react";
import { toneVar, type Tone } from "@/lib/tones";
import { fmt, niceTicks } from "./scale";

type Series = { name: string; tone: Tone; values: number[] };

/** Biểu đồ đường nhiều chuỗi cùng một trục; rê chuột để xem giá trị từng kỳ */
export function LineChart({ labels, series, unit, height = 220 }: { labels: string[]; series: Series[]; unit: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const pad = { t: 14, r: 40, b: 26, l: 32 };
  const ticks = niceTicks(Math.max(0, ...series.flatMap((s) => s.values)));
  const top = ticks[ticks.length - 1];
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const last = labels.length - 1;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Biểu đồ đường: ${series.map((s) => s.name).join(", ")}`}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
              {fmt(t)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => (
          <text key={l} x={x(i)} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
            {l}
          </text>
        ))}
        {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="stroke-muted-foreground/50" strokeDasharray="3 3" /> : null}
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              fill="none"
              stroke={toneVar(s.tone)}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.values.map((v, i) =>
              hover === i || i === last ? (
                <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={toneVar(s.tone)} className="stroke-card" strokeWidth={2} />
              ) : null,
            )}
            <text x={x(last) + 8} y={y(s.values[last] ?? 0) + 4} className="fill-foreground text-[11px] font-medium tabular-nums">
              {fmt(s.values[last] ?? 0)}
            </text>
          </g>
        ))}
        {labels.map((l, i) => (
          <rect
            key={l}
            x={x(i) - iw / Math.max(1, labels.length - 1) / 2}
            y={pad.t}
            width={iw / Math.max(1, labels.length - 1)}
            height={ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: toneVar(s.tone) }} />
            {s.name}
          </span>
        ))}
      </div>
      {hover !== null ? (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          <div className="mb-0.5 text-muted-foreground">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: toneVar(s.tone) }} />
              {s.name}: <span className="font-semibold tabular-nums">{fmt(s.values[hover] ?? 0)}</span> {unit}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
