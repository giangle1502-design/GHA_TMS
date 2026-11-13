import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";
import { DriverNav } from "./driver-nav";

export const metadata: Metadata = { title: "Tài xế nhận chuyến" };
export const viewport: Viewport = { themeColor: "#0f2a5c" };

// Ứng dụng tài xế mở bằng link, không cần đăng nhập: tài xế nhập biển số xe để xem và nhận chuyến.
export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col bg-muted/40">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 bg-sidebar px-4 text-white">
        <Link href="/tx" className="flex items-center gap-2 font-semibold">
          <Truck className="size-5" /> KHÁNH HÀ TMS
        </Link>
        <span className="flex-1 text-right text-sm text-sidebar-muted">Tài xế</span>
      </header>
      <main className="flex-1 p-4 pb-24">{children}</main>
      <DriverNav />
    </div>
  );
}
