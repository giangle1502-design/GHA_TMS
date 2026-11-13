import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Ô tìm kiếm dạng form GET: giữ các tham số khác trên URL, Enter để tìm */
export function SearchForm({ action, q, keep = {}, placeholder = "Tìm kiếm…", className }: { action: string; q?: string; keep?: Record<string, string | undefined>; placeholder?: string; className?: string }) {
  return (
    <form action={action} role="search" className={className ?? "flex w-full gap-2 sm:w-80"}>
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
        <Input name="q" defaultValue={q ?? ""} placeholder={placeholder} aria-label="Tìm kiếm" className="pl-8" />
      </div>
      <Button type="submit" variant="outline">
        Tìm
      </Button>
    </form>
  );
}
