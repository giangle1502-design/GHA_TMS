"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import type { NavGroup } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Ô tìm nhanh chức năng trên thanh đầu trang: gõ tên màn hình (có hoặc không dấu) rồi Enter để mở */
export function NavSearch({ groups }: { groups: NavGroup[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const items = useMemo(() => groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))), [groups]);
  const results = useMemo(() => {
    const t = fold(q.trim());
    return t ? items.filter((i) => fold(`${i.label} ${i.group}`).includes(t)).slice(0, 8) : [];
  }, [items, q]);

  function go(href: string) {
    setQ("");
    setOpen(false);
    router.push(href);
  }

  return (
    <div
      ref={box}
      className="relative hidden w-full max-w-md md:block"
      onBlur={(e) => {
        if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIdx((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && results[idx]) {
            e.preventDefault();
            go(results[idx].href);
          } else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Tìm chức năng… (ví dụ: phương tiện, bảng giá)"
        aria-label="Tìm chức năng"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="nav-search-list"
        className="h-9 w-full rounded-full border bg-background pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30"
      />
      {open && q.trim() ? (
        <ul id="nav-search-list" role="listbox" className="absolute top-11 right-0 left-0 z-50 overflow-hidden rounded-lg border bg-popover py-1 shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">Không tìm thấy chức năng phù hợp</li>
          ) : (
            results.map((r, i) => (
              <li key={r.href} role="option" aria-selected={i === idx}>
                <button
                  type="button"
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => go(r.href)}
                  className={cn("flex w-full items-center justify-between px-3 py-2 text-left text-sm", i === idx && "bg-accent")}
                >
                  <span>{r.label}</span>
                  <span className="text-xs text-muted-foreground">{r.group}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
