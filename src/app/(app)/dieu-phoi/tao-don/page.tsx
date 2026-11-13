import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid, layoutOf, moduleCustomFields } from "@/lib/entities/record";
import { loadCustomFields, visibleCustomRows } from "@/lib/entities/server";
import { PageHeader } from "@/components/layout/page-header";
import { parseDriverAppSettings } from "@/lib/driver-link/settings";
import { OrderForm } from "./order-form";

export const metadata: Metadata = { title: "Tạo đơn hàng" };

export default async function Page({ searchParams }: { searchParams: Promise<{ don?: string }> }) {
  const me = await requirePagePermission("dispatch.create");
  const { don } = await searchParams;
  const sb = await createClient();
  // Mặc định ô "Khách yêu cầu chụp chứng từ" (Cấu hình → Ứng dụng tài xế); CSDL chưa nâng cấp thì bật
  const podPhotoDefault = parseDriverAppSettings((await sb.rpc("driver_app_settings")).data).delivery_photo_required;
  const [orderRows, shipRows, itemRows] = await Promise.all([loadCustomFields(sb, "transport_orders"), loadCustomFields(sb, "shipments"), loadCustomFields(sb, "shipment_items")]);
  const orderFields = moduleCustomFields("transport_orders", visibleCustomRows(orderRows, me.permissions), me.permissions);
  const shipmentFields = moduleCustomFields("shipments", visibleCustomRows(shipRows, me.permissions), me.permissions);
  const canAddField = me.permissions.has("fields.configure");
  let order: { id: string; code: string; customerId: string; customerName: string } | undefined;
  if (don) {
    if (!isUuid(don)) notFound();
    const supabase = await createClient();
    const { data } = await supabase
      .from("transport_orders")
      .select("id, order_code, status, customer_id, customers!transport_orders_customer_id_fkey(name)")
      .eq("id", don)
      .maybeSingle();
    if (!data) notFound();
    const c = data.customers as unknown as { name: string } | null;
    order = { id: data.id, code: data.order_code, customerId: data.customer_id, customerName: c?.name ?? "" };
  }
  return (
    <>
      <Link href={order ? `/dieu-phoi/don-hang/${order.id}` : "/dieu-phoi"} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> {order ? `Đơn hàng ${order.code}` : "Điều phối"}
      </Link>
      <PageHeader
        actions={
          <Button asChild variant="outline">
            <Link href={order ? `/dieu-phoi/don-hang/${order.id}` : "/dieu-phoi"}>
              <X /> Đóng
            </Link>
          </Button>
        }
        title={order ? `Thêm chuyến vào đơn ${order.code}` : "Tạo đơn hàng"}
        description={
          order
            ? `Khách hàng: ${order.customerName}. Giá và hỗ trợ dầu được tính lại theo bảng giá tại ngày nhận hàng.`
            : "Một đơn hàng gồm một hoặc nhiều chuyến. Mã đơn và mã chuyến tự sinh khi lưu; giá lấy theo bảng giá và được chụp lại trên từng chuyến."
        }
      />
      <OrderForm
        podPhotoDefault={podPhotoDefault}
        closeHref={order ? `/dieu-phoi/don-hang/${order.id}` : "/dieu-phoi"}
        order={order}
        canCreatePriceList={me.permissions.has("price_lists.create")}
        orderFields={orderFields}
        shipmentFields={shipmentFields}
        orderLayout={layoutOf("transport_orders", orderRows)}
        shipmentLayout={layoutOf("shipments", shipRows)}
        canAddField={canAddField}
        orderFieldRows={orderRows}
        shipmentFieldRows={shipRows}
        itemFields={moduleCustomFields("shipment_items", visibleCustomRows(itemRows, me.permissions), me.permissions)}
        itemLayout={layoutOf("shipment_items", itemRows)}
        itemFieldRows={itemRows}
      />
    </>
  );
}
