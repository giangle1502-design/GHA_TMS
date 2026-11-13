import { withErrorDetail } from "@/components/layout/page-error-detail";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Pencil, Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/entities/record";
import { formatDate, formatDateTime, formatVND } from "@/lib/format";
import type { ShipmentListRow } from "@/lib/shipments";
import { PageHeader } from "@/components/layout/page-header";
import { CancelOrderDialog } from "./cancel-order-dialog";
import { loadCustomFields, loadTableView, visibleCustomRows } from "@/lib/entities/server";
import { formatValue, moduleCustomFields } from "@/lib/entities/record";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DispatchTable } from "@/components/dispatch/dispatch-table";
import { dispatchExtraColumns } from "@/lib/dispatch-columns";

export const metadata: Metadata = { title: "Đơn hàng" };

const ORDER_STATUS: Record<string, { label: string; variant: "info" | "success" | "destructive" }> = {
  open: { label: "Đang mở", variant: "info" },
  completed: { label: "Đã hoàn thành", variant: "success" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

type Order = {
  id: string;
  order_code: string;
  order_date: string;
  status: string;
  notes: string | null;
  created_at: string;
  customer: { id: string; name: string; code: string } | null;
  payer: { id: string; name: string; code: string } | null;
  dispatcher_id: string | null;
  custom_fields: Record<string, unknown> | null;
  company: { id: string; name: string } | null;
};

export default async function Page(props: { params: Promise<{ id: string }> }) {
  return withErrorDetail(() => PageInner(props));
}

async function PageInner({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePagePermission("dispatch.view", "shipments.view");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [orderRes, shipRes, orderFieldRows] = await Promise.all([
    supabase
      .from("transport_orders")
      .select(
        "id, order_code, order_date, status, notes, created_at, customer:customers!transport_orders_customer_id_fkey(id, name, code), payer:customers!transport_orders_payer_customer_id_fkey(id, name, code), dispatcher_id, custom_fields, company:company_entities(id, name)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("shipment_list").select("*").eq("order_id", id).order("sequence_in_order"),
    loadCustomFields(supabase, "transport_orders"),
  ]);
  if (orderRes.error) throw orderRes.error;
  if (shipRes.error) throw shipRes.error;
  const order = orderRes.data as unknown as Order | null;
  if (!order) notFound();
  const rows = (shipRes.data ?? []) as ShipmentListRow[];
  const { data: names } = order.dispatcher_id ? await supabase.rpc("user_display_names", { p_ids: [order.dispatcher_id] }) : { data: null };
  const creator = (names as { display_name: string }[] | null)?.[0]?.display_name;
  const [extras, view] = await Promise.all([dispatchExtraColumns(supabase, me.permissions, rows), loadTableView(supabase, "order_shipments", me.id)]);
  const live = rows.filter((r) => r.status !== "cancelled");
  const revenue = live.reduce((s, r) => s + Number(r.total_revenue), 0);
  const st = ORDER_STATUS[order.status] ?? {
    label: order.status,
    variant: "info" as const,
  };
  const canAdd = order.status === "open" && me.permissions.has("dispatch.create");
  const orderFields = moduleCustomFields("transport_orders", visibleCustomRows(orderFieldRows, me.permissions), me.permissions);
  const canEditOrder = order.status !== "cancelled" && me.permissions.has("dispatch.update");

  return (
    <>
      <Link href="/dieu-phoi" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Điều phối
      </Link>
      <PageHeader
        title={`Đơn hàng ${order.order_code}`}
        description={<Badge variant={st.variant}>{st.label}</Badge>}
        actions={
          <>
            {canEditOrder ? (
              <Button asChild variant="outline">
                <Link href={`/dieu-phoi/don-hang/${order.id}/sua`}>
                  <Pencil /> Sửa toàn bộ đơn
                </Link>
              </Button>
            ) : null}
            {order.status !== "cancelled" &&
            (me.permissions.has("dispatch.delete") || me.permissions.has("shipments.delete")) &&
            !rows.some((r) => ["driver_completed", "closed"].includes(r.status)) ? (
              <CancelOrderDialog orderId={order.id} orderCode={order.order_code} tripCount={live.length} />
            ) : null}
            {canAdd ? (
              <Button asChild>
                <Link href={`/dieu-phoi/tao-don?don=${order.id}`}>
                  <Plus /> Thêm chuyến
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <Card className="mb-4">
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Item label="Khách hàng">{order.customer ? `${order.customer.name} (${order.customer.code})` : "–"}</Item>
            <Item label="Khách thanh toán">{order.payer ? `${order.payer.name} (${order.payer.code})` : "–"}</Item>
            <Item label="Ngày đơn hàng">{formatDate(order.order_date)}</Item>
            {order.company ? <Item label="Đơn vị nội bộ">{order.company.name}</Item> : null}
            <Item label="Người tạo">
              {creator ?? "–"}
              <span className="block text-xs text-muted-foreground">{formatDateTime(order.created_at)}</span>
            </Item>
            <Item label="Số chuyến">
              {live.length}
              {rows.length > live.length ? <span className="text-muted-foreground"> (+{rows.length - live.length} đã hủy)</span> : null}
            </Item>
            <Item label="Doanh thu dự kiến (không tính chuyến hủy)">
              <span className="font-semibold">{formatVND(revenue)}</span>
            </Item>
            {orderFields
              .filter((f) => order.custom_fields?.[f.key] !== undefined && order.custom_fields?.[f.key] !== null && order.custom_fields?.[f.key] !== "")
              .map((f) => (
                <Item key={f.key} label={f.label}>
                  {formatValue(f, order.custom_fields?.[f.key])}
                </Item>
              ))}
            {order.notes ? (
              <div className="sm:col-span-2">
                <Item label="Ghi chú">{order.notes}</Item>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="text-base">Các chuyến trong đơn</CardTitle>
        </CardHeader>
        <CardContent className="mt-4 border-t p-0">
          <DispatchTable
            tableKey="order_shipments"
            view={view}
            extraColumns={extras.columns}
            extraValues={extras.values}
            rows={rows}
            showDate
            showOrder={false}
            canAssign={me.permissions.has("dispatch.update")}
            canCancel={me.permissions.has("dispatch.delete") || me.permissions.has("shipments.delete")}
          />
        </CardContent>
      </Card>
    </>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
