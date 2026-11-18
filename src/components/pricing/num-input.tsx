"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { toNum } from "@/lib/truck-rate";

/** Ô nhập số: hiện "1,250,000" khi không sửa; gõ tự do khi đang sửa, lưu khi rời ô */
export function NumInput({
  value,
  onChange,
  className,
  allowEmpty = true,
  ...rest
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
  allowEmpty?: boolean;
} & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      {...rest}
      inputMode="decimal"
      className={cn(
        "h-8 w-full min-w-0 rounded border border-input bg-card px-1.5 text-right text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
      value={text ?? (value === null ? "" : formatNumber(value))}
      onFocus={(e) => {
        setText(value === null ? "" : String(value));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = toNum(text ?? "");
        if (n !== null || allowEmpty) onChange(n);
        setText(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        rest.onKeyDown?.(e);
      }}
    />
  );
}
