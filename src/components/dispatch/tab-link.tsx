import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Variant = NonNullable<Parameters<typeof Badge>[0]["variant"]>;

/** Thẻ lọc theo trạng thái dạng liên kết (giữ bộ lọc trên URL) */
export function TabLink({ href, active, label, count, tone }: { href: string; active: boolean; label: string; count: number; tone?: Variant }) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm",
        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
      <Badge variant={active ? "default" : (tone ?? "muted")} className="px-1.5 py-0">
        {count}
      </Badge>
    </Link>
  );
}
