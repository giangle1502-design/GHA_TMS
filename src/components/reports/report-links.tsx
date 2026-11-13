import Link from "next/link";
import { BarChart3 } from "lucide-react";

const LINKS: { href?: string; tab?: string; label: string }[] = [
  { href: "/bao-cao/nhom-phi", label: "Chi phí theo nhóm" },
  { href: "/so-chuyen", label: "Số chuyến xe, tài xế" },
  { tab: "report_freight", label: "Cước vận chuyển" },
  { tab: "report_pass_through", label: "Phí chi hộ" },
  { tab: "report_loading", label: "Bốc xếp" },
  { tab: "report_fee_type", label: "Doanh thu theo loại phí" },
];

/** Lối vào nhanh các báo cáo cước phí từ màn hình Điều phối, Quản lý chuyến xe (một dòng chữ nhỏ) */
export function ReportLinks() {
  return (
    <nav aria-label="Báo cáo cước phí" className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <BarChart3 className="size-3.5" /> Báo cáo:
      </span>
      {LINKS.map((l) => (
        <Link key={l.label} href={l.href ?? `/bao-cao?tab=${l.tab}`} className={l.href ? "font-medium text-primary hover:underline" : "text-primary hover:underline"}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
