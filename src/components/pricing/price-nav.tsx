import Link from "next/link";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/bang-gia/xe-tai", key: "xe-tai", label: "Bảng giá xe tải" },
  { href: "/bang-gia/xe-cont", key: "xe-cont", label: "Bảng giá xe cont" },
  { href: "/bang-gia", key: "tuyen", label: "Bảng giá theo tuyến, hỗ trợ dầu" },
] as const;

/** Thanh chuyển giữa các loại bảng giá */
export function PriceNav({ active }: { active: (typeof LINKS)[number]["key"] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {LINKS.map((l) => (
        <Link
          key={l.key}
          href={l.href}
          className={cn(
            "rounded-full border px-4 py-1.5 text-sm whitespace-nowrap",
            active === l.key ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
