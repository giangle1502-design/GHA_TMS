import { toneVar, type Tone } from "@/lib/tones";
import { fmt } from "./scale";

type Item = { label: string; value: number; tone: Tone };

/** Biểu đồ tròn (vành khuyên) kèm chú giải có số lượng và tỷ lệ */
export function DonutChart({ items, centerLabel }: { items: Item[]; centerLabel: string }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  const R = 70;
  const r = 48;
  const mid = (R + r) / 2;
  const C = 2 * Math.PI * mid;
  const shown = items.filter((i) => i.value > 0);
  const gap = shown.length > 1 ? 2 : 0;
  const offsets = shown.map((_, k) => shown.slice(0, k).reduce((a, x) => a + (x.value / total) * C, 0));
  return (
    <div className="@container">
      <div className="flex flex-col items-center gap-5 @sm:flex-row">
        <svg viewBox="0 0 160 160" className="size-40 shrink-0" role="img" aria-label={`Biểu đồ tròn: ${centerLabel}`}>
          <circle cx={80} cy={80} r={mid} fill="none" className="stroke-muted" strokeWidth={R - r} />
          {shown.map((i, k) => {
            const len = (i.value / total) * C;
            return (
              <circle
                key={i.label}
                cx={80}
                cy={80}
                r={mid}
                fill="none"
                stroke={toneVar(i.tone)}
                strokeWidth={R - r}
                strokeDasharray={`${Math.max(0, len - gap)} ${C}`}
                strokeDashoffset={-offsets[k]}
                transform="rotate(-90 80 80)"
              >
                <title>{`${i.label}: ${fmt(i.value)}`}</title>
              </circle>
            );
          })}
          <text x={80} y={76} textAnchor="middle" className="fill-muted-foreground text-[10px]">
            {centerLabel}
          </text>
          <text x={80} y={96} textAnchor="middle" className="fill-foreground text-[20px] font-bold tabular-nums">
            {fmt(total)}
          </text>
        </svg>
        <ul className="w-full space-y-2 text-sm">
          {items.map((i) => (
            <li key={i.label} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: toneVar(i.tone) }} />
              <span className="flex-1 truncate text-muted-foreground">{i.label}</span>
              <span className="font-medium tabular-nums">{fmt(i.value)}</span>
              <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                {total ? `${((i.value / total) * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%` : "–"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
