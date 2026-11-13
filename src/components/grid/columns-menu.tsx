"use client";
import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Columns3, Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Nút "Cột": ẩn/hiện, đổi thứ tự, cố định cột của bảng (dùng chung cho mọi bảng TanStack) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ColumnsMenu<T = any>({
  columns,
  label,
  note,
  onMove,
}: {
  columns: Column<T>[];
  label: (c: Column<T>) => string;
  note?: (c: Column<T>) => string | null;
  onMove: (id: string, delta: number) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 /> Cột
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">
          Ẩn/hiện, sắp xếp và cố định cột. Trên bảng: kéo tiêu đề cột để đổi chỗ, kéo mép phải tiêu đề để đổi độ rộng, kéo mép dưới dòng để đổi chiều cao.
        </div>
        <ul className="max-h-80 overflow-y-auto p-1">
          {columns.map((c, i) => {
            const pinned = c.getIsPinned() === "left";
            const n = note?.(c);
            return (
              <li key={c.id} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={c.getIsVisible()} disabled={!c.getCanHide()} onChange={c.getToggleVisibilityHandler()} />
                  <span className="truncate">{label(c)}</span>
                  {n ? <span className="text-[10px] text-muted-foreground">{n}</span> : null}
                </label>
                <button type="button" className="rounded p-1 hover:bg-background disabled:opacity-30" disabled={i === 0} onClick={() => onMove(c.id, -1)} aria-label={`Đưa cột ${label(c)} lên`}>
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded p-1 hover:bg-background disabled:opacity-30"
                  disabled={i === columns.length - 1}
                  onClick={() => onMove(c.id, 1)}
                  aria-label={`Đưa cột ${label(c)} xuống`}
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  className={cn("rounded p-1 hover:bg-background", pinned && "text-primary")}
                  onClick={() => c.pin(pinned ? false : "left")}
                  aria-label={pinned ? "Bỏ cố định" : "Cố định bên trái"}
                  title={pinned ? "Bỏ cố định" : "Cố định bên trái"}
                >
                  {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
