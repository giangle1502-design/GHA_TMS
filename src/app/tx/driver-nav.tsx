"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Truck, Wallet } from "lucide-react";

/** Thanh dưới cùng của ứng dụng tài xế: Chuyến / Ứng tiền & chi phí */
export function DriverNav() {
  const path = usePathname();
  const items = [
    { href: "/tx", label: "Chuyến", icon: Truck, active: path === "/tx" },
    { href: "/tx/tien", label: "Ứng tiền & chi phí", icon: Wallet, active: path.startsWith("/tx/tien") },
  ];
  return (
    <nav className="fixed right-0 bottom-0 left-0 z-20 mx-auto grid max-w-xl grid-cols-2 border-t bg-card pb-[env(safe-area-inset-bottom)]" aria-label="Ứng dụng tài xế">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={it.active ? "page" : undefined}
          className={`flex h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium ${it.active ? "text-primary" : "text-muted-foreground"}`}
        >
          <it.icon className="size-6" /> {it.label}
        </Link>
      ))}
    </nav>
  );
}
