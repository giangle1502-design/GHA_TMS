"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import type { UploadKind } from "@/lib/driver-link/upload";

export type PickedFile = { id: string; file: File; kind: UploadKind; url: string };

/** Chụp ảnh / chọn ảnh từ máy, gắn loại cho từng ảnh (ảnh hàng, phiếu ký nhận, hóa đơn…). Tối đa 10 ảnh. */
export function PhotoPicker({
  value,
  onChange,
  kinds,
  label = "Chụp ảnh",
}: {
  value: PickedFile[];
  onChange: (v: PickedFile[]) => void;
  kinds: { value: UploadKind; label: string }[];
  label?: string;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<UploadKind>(kinds[0].value);
  useEffect(() => () => value.forEach((p) => URL.revokeObjectURL(p.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  function add(files: FileList | null) {
    if (!files) return;
    const next = [...value];
    for (const f of Array.from(files)) {
      if (next.length >= 10) break;
      if (!f.type.startsWith("image/") && f.type !== "application/pdf") continue;
      next.push({ id: crypto.randomUUID(), file: f, kind, url: URL.createObjectURL(f) });
    }
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {kinds.length > 1 ? (
        <div className="flex gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Loại ảnh">
          {kinds.map((k) => (
            <button
              key={k.value}
              type="button"
              role="radio"
              aria-checked={kind === k.value}
              onClick={() => setKind(k.value)}
              className={`flex-1 rounded-lg px-2 py-2 text-sm font-medium ${kind === k.value ? "bg-card shadow-xs" : "text-muted-foreground"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => camRef.current?.click()} className="flex h-14 items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground">
          <Camera className="size-5" /> {label}
        </button>
        <button type="button" onClick={() => libRef.current?.click()} className="flex h-14 items-center justify-center gap-2 rounded-xl border bg-card font-medium">
          <ImagePlus className="size-5" /> Chọn ảnh có sẵn
        </button>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Chụp ảnh" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <input ref={libRef} type="file" accept="image/*,application/pdf" multiple className="hidden" aria-label="Chọn ảnh có sẵn" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      {value.length ? (
        <ul className="grid grid-cols-3 gap-2">
          {value.map((p) => (
            <li key={p.id} className="relative overflow-hidden rounded-lg border bg-card">
              {p.file.type === "application/pdf" ? (
                <div className="flex aspect-square items-center justify-center text-xs text-muted-foreground">PDF</div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.url} alt="" className="aspect-square w-full object-cover" />
              )}
              <span className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5 text-center text-[11px] text-white">
                {kinds.find((k) => k.value === p.kind)?.label}
              </span>
              <button
                type="button"
                aria-label="Bỏ ảnh"
                onClick={() => {
                  URL.revokeObjectURL(p.url);
                  onChange(value.filter((x) => x.id !== p.id));
                }}
                className="absolute top-1 right-1 rounded-full bg-black/60 p-1 text-white"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
