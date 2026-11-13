"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { openByPlate } from "./actions";

/** Biển số chuẩn: chữ hoa, chỉ chữ và số. */
const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function PlateForm() {
  const router = useRouter();
  const [plate, setPlate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="mt-6 rounded-2xl border bg-card p-6 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await openByPlate(plate);
          if (!r.ok) setError(r.error);
          else router.refresh();
        });
      }}
    >
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Truck className="size-7" />
      </div>
      <h1 className="text-center text-xl font-semibold">Nhập số xe để xem chuyến</h1>
      <p className="mt-1 text-center text-sm text-muted-foreground">Viết liền, không dấu chấm, gạch. Ví dụ 61K31295</p>
      <label htmlFor="plate" className="sr-only">
        Số xe
      </label>
      <input
        id="plate"
        value={plate}
        onChange={(e) => setPlate(clean(e.target.value))}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={12}
        placeholder="61K31295"
        aria-label="Số xe"
        className="mt-5 h-16 w-full rounded-xl border-2 bg-background text-center font-mono text-3xl font-semibold tracking-widest uppercase outline-none focus:border-primary"
      />
      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || plate.length < 5}
        className="mt-4 h-14 w-full rounded-xl bg-primary text-lg font-semibold text-primary-foreground disabled:opacity-50"
      >
        {pending ? "Đang mở…" : "Xem chuyến"}
      </button>
    </form>
  );
}
