import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { ImportTrips } from "./import-trips";

export const metadata: Metadata = { title: "Nhập chuyến từ Excel" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tu?: string }> }) {
  await requirePagePermission("dispatch.create");
  const { tu } = await searchParams;
  const back = tu === "chuyen-xe" ? { href: "/chuyen-xe", label: "Quản lý chuyến xe" } : { href: "/dieu-phoi", label: "Điều phối" };
  return (
    <>
      <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> {back.label}
      </Link>
      <PageHeader
        title="Nhập đơn hàng, chuyến từ Excel"
        description="Mỗi dòng trong file là một chuyến. Hệ thống kiểm tra từng dòng (khách hàng theo mã, xe theo biển số, tài xế, địa điểm) và chỉ ghi khi bạn bấm Nhập. Chuyến nhập xong hiện ở cả Điều phối và Quản lý chuyến xe."
      />
      <ImportTrips />
    </>
  );
}
