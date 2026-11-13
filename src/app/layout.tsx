import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "KHÁNH HÀ TMS – Quản lý vận tải", template: "%s · KHÁNH HÀ TMS" },
  description: "Phần mềm quản lý vận tải cho Công ty Vận tải Khánh Hà",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e2a4a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className="h-full">
      <body className="min-h-full">
        {children}
        <Toaster richColors position="top-center" closeButton />
      </body>
    </html>
  );
}
