"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Ban, BadgeCheck, BarChart3, Building2, Bus, Fuel, CalendarOff, CalendarRange, ClipboardList, Columns3, FileInput, Handshake, IdCard, LayoutDashboard, ListChecks, ListTree,
  ListOrdered, MessageCircle, PieChart, Receipt, ReceiptText, HandCoins, CalendarCheck2, Route, ScrollText, Settings, Tags, Truck, Users, Wallet, Workflow, type LucideIcon,
} from "lucide-react";
import type { NavGroup } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  Ban, BadgeCheck, BarChart3, Building2, Bus, Fuel, CalendarOff, CalendarRange, ClipboardList, Columns3, FileInput, Handshake, IdCard, LayoutDashboard, ListChecks, ListTree,
  ListOrdered, MessageCircle, PieChart, Receipt, ReceiptText, HandCoins, CalendarCheck2, Route, ScrollText, Settings, Tags, Truck, Users, Wallet, Workflow,
};

export function SidebarNav({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  // Mục khớp dài nhất được tô (ví dụ /chuyen-xe/bang-ke không tô cả /chuyen-xe)
  const match = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const best = groups.flatMap((g) => g.items.map((i) => i.href)).filter(match).sort((a, b) => b.length - a.length)[0];
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6" aria-label="Menu chính">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">{g.label}</div>
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const Icon = ICONS[item.icon] ?? LayoutDashboard;
              const active = item.href === best;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-primary text-white font-medium shadow-sm shadow-black/20"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.phase ? (
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px]", active ? "bg-white/20 text-white" : "bg-white/10 text-sidebar-muted")} title={`Hoàn thiện ở Giai đoạn ${item.phase}`}>
                        GĐ{item.phase}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
