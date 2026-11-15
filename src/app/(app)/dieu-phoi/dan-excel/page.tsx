import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { loadPasteCatalog } from "./actions";
import { PasteOrders } from "./paste-orders";

export const metadata: Metadata = { title: "Dán từ Excel" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tu?: string }> }) {
  await requirePagePermission("dispatch.create");
  const { tu } = await searchParams;
  const back = tu === "chuyen-xe" ? { href: "/chuyen-xe", label: "Quản lý chuyến xe" } : { href: "/dieu-phoi", label: "Điều phối" };
  const catalog = await loadPasteCatalog();
  return (
    <>
      <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> {back.label}
      </Link>
      <PageHeader
        title="Dán từ Excel"
        description="Chọn các dòng trong bảng theo dõi hàng, bấm Ctrl+C rồi dán vào ô bên dưới. Mỗi dòng (một cont) thành một chuyến chờ phân công; các cont cùng tờ khai, cùng điểm giao, cùng ngày gộp thành một đơn."
      />
      {catalog.ok && catalog.data ? (
        <PasteOrders catalog={catalog.data} />
      ) : (
        <Alert variant="destructive">
          <AlertDescription>{catalog.ok ? "Không tải được danh mục." : catalog.error}</AlertDescription>
        </Alert>
      )}
    </>
  );
}
