import { withErrorDetail } from "@/components/layout/page-error-detail";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { missingColumn } from "@/lib/supabase/missing-column";
import { isUuid, layoutOf, moduleCustomFields } from "@/lib/entities/record";
import { loadCustomFields, visibleCustomRows } from "@/lib/entities/server";
import { formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { parseDriverAppSettings } from "@/lib/driver-link/settings";
import { OrderForm, type EditOrderInit, type EditShipmentInit } from "../../../tao-don/order-form";

export const metadata: Metadata = { title: "Sửa đơn hàng" };

const ymd = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("sv-SE", {
        timeZone: "Asia/Ho_Chi_Minh",
      })
    : "";

type ShipRow = {
  id: string;
  shipment_code: string;
  status: string;
  version: number;
  receivable_id: string | null;
  pickup_at: string;
  expected_delivery_at: string | null;
  pickup_location_id: string;
  delivery_location_id: string;
  empty_return_location_id: string | null;
  offroute_return_location_id: string | null;
  trip_order: number | null;
  vehicle_type_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  price_list_id: string | null;
  unit_price: number;
  pricing_unit: string;
  quantity: number;
  surcharge_amount: number;
  fuel_support_rate: number | null;
  fuel_support_base: string | null;
  fuel_support_amount: number;
  pricing_snapshot: { price_list_code?: string | null } | null;
  notes: string | null;
  pod_photo_required: boolean;
  custom_fields: Record<string, unknown> | null;
};

type FeeRow = {
  shipment_id: string;
  fee_type_id: string;
  fee_kind: "revenue" | "pass_through";
  amount: number;
  note: string | null;
  declaration_type_id: string | null;
  ref_no: string | null;
  quantity: number | null;
  unit_price: number | null;
  declaration: { name: string } | null;
  fee_type: { name: string } | null;
};

type ItemRow = {
  shipment_id: string;
  item_code: string | null;
  item_name: string | null;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  custom_fields: Record<string, unknown> | null;
};

/** Sửa toàn bộ đơn hàng bằng đúng biểu mẫu lúc tạo đơn, nạp sẵn mọi thông tin đã nhập */
const SHIP_COLS =
  "id, shipment_code, status, version, receivable_id, pickup_at, expected_delivery_at, pickup_location_id, delivery_location_id, empty_return_location_id, offroute_return_location_id, trip_order, vehicle_type_id, vehicle_id, driver_id, price_list_id, unit_price, pricing_unit, quantity, surcharge_amount, fuel_support_rate, fuel_support_base, fuel_support_amount, pricing_snapshot, notes, pod_photo_required, custom_fields";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  return withErrorDetail(() => PageInner(props));
}

async function PageInner({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePagePermission("dispatch.update");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sb = await createClient();
  // Mặc định ô "Khách yêu cầu chụp chứng từ" (Cấu hình → Ứng dụng tài xế); CSDL chưa nâng cấp thì bật
  const podPhotoDefault = parseDriverAppSettings((await sb.rpc("driver_app_settings")).data).delivery_photo_required;
  const [orderRes, shipRes, orderRows, shipRows, itemRows] = await Promise.all([
    sb
      .from("transport_orders")
      .select(
        "id, order_code, order_date, status, notes, custom_fields, customer:customers!transport_orders_customer_id_fkey(id, name, code), payer:customers!transport_orders_payer_customer_id_fkey(id, name, code), company:company_entities(id, name)",
      )
      .eq("id", id)
      .maybeSingle(),
    sb
      .from("shipments")
      .select(SHIP_COLS)
      .eq("order_id", id)
      .neq("status", "cancelled")
      .order("sequence_in_order"),
    loadCustomFields(sb, "transport_orders"),
    loadCustomFields(sb, "shipments"),
    loadCustomFields(sb, "shipment_items"),
  ]);
  if (orderRes.error) throw orderRes.error;
  // CSDL chưa nâng cấp 0054 (chưa có cột pod_photo_required): đọc lại không có cột này, coi như bắt buộc chụp
  let shipData = shipRes.data as unknown[] | null;
  if (shipRes.error && missingColumn(shipRes.error, "pod_photo_required")) {
    const retry = await sb.from("shipments").select(SHIP_COLS.replace("pod_photo_required, ", "")).eq("order_id", id).neq("status", "cancelled").order("sequence_in_order");
    if (retry.error) throw retry.error;
    shipData = ((retry.data ?? []) as object[]).map((r) => ({ ...r, pod_photo_required: true }));
  } else if (shipRes.error) throw shipRes.error;
  const o = orderRes.data as unknown as {
    id: string;
    order_code: string;
    order_date: string;
    status: string;
    notes: string | null;
    custom_fields: Record<string, unknown> | null;
    customer: { id: string; name: string; code: string } | null;
    payer: { id: string; name: string; code: string } | null;
    company: { id: string; name: string } | null;
  } | null;
  if (!o) notFound();
  const ships = (shipData ?? []) as unknown as ShipRow[];
  const ids = ships.map((s) => s.id);
  const [feeRes, itemRes, feeDocRes] = ids.length
    ? await Promise.all([
        sb
          .from("shipment_fees")
          .select("shipment_id, line_no, fee_type_id, fee_kind, amount, note, declaration_type_id, ref_no, quantity, unit_price, declaration:declaration_types(name), fee_type:fee_types(name)")
          .in("shipment_id", ids)
          .order("line_no"),
        sb.from("shipment_items").select("shipment_id, line_no, item_code, item_name, quantity, unit, note, custom_fields").in("shipment_id", ids).order("line_no"),
        // Tệp hóa đơn chi hộ đã đính kèm (lỗi thì chỉ không hiện số tệp)
        sb.from("documents").select("entity_id, fee_type_id").eq("entity_type", "shipment_fee").in("entity_id", ids).is("archived_at", null),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];
  const feeDocs = new Map<string, Record<string, number>>();
  for (const d of (feeDocRes.data ?? []) as { entity_id: string; fee_type_id: string | null }[]) {
    if (!d.fee_type_id) continue;
    const m = feeDocs.get(d.entity_id) ?? {};
    m[d.fee_type_id] = (m[d.fee_type_id] ?? 0) + 1;
    feeDocs.set(d.entity_id, m);
  }
  if (feeRes.error) throw feeRes.error;
  if (itemRes.error) throw itemRes.error;
  const fees = (feeRes.data ?? []) as unknown as FeeRow[];
  const items = (itemRes.data ?? []) as unknown as ItemRow[];

  const orderFields = moduleCustomFields("transport_orders", visibleCustomRows(orderRows, me.permissions), me.permissions);
  const shipmentFields = moduleCustomFields("shipments", visibleCustomRows(shipRows, me.permissions), me.permissions);
  const canAddField = me.permissions.has("fields.configure");

  const shipments: EditShipmentInit[] = ships.map((s) => ({
    id: s.id,
    code: s.shipment_code,
    version: s.version,
    status: s.status,
    billed: Boolean(s.receivable_id),
    pickupDate: ymd(s.pickup_at),
    expectedDeliveryDate: ymd(s.expected_delivery_at),
    pickupLocationId: s.pickup_location_id,
    deliveryLocationId: s.delivery_location_id,
    emptyReturnLocationId: s.empty_return_location_id ?? "",
    offrouteReturnLocationId: s.offroute_return_location_id ?? "",
    tripOrder: s.trip_order ?? null,
    vehicleTypeId: s.vehicle_type_id ?? "",
    vehicleId: s.vehicle_id ?? "",
    driverId: s.driver_id ?? "",
    quantity: Number(s.quantity),
    priceListId: s.price_list_id ?? "",
    priceListCode: s.pricing_snapshot?.price_list_code ?? null,
    unitPrice: Number(s.unit_price),
    pricingUnit: s.pricing_unit,
    surchargeAmount: Number(s.surcharge_amount),
    fuelSupportRate: s.fuel_support_rate === null ? null : Number(s.fuel_support_rate),
    fuelBase: s.fuel_support_base,
    fuelAmount: Number(s.fuel_support_amount),
    notes: s.notes ?? "",
    podPhotoRequired: s.pod_photo_required ?? true,
    custom: s.custom_fields ?? {},
    items: items
      .filter((it) => it.shipment_id === s.id)
      .map((it) => ({
        item_code: it.item_code ?? "",
        item_name: it.item_name ?? "",
        quantity: it.quantity === null ? "" : String(it.quantity),
        unit: it.unit ?? "",
        note: it.note ?? "",
        custom: it.custom_fields ?? {},
      })),
    feeDocs: feeDocs.get(s.id),
    fees: fees
      .filter((f) => f.shipment_id === s.id)
      .map((f) => ({
        fee_type_id: f.fee_type_id,
        label: f.fee_type?.name ?? "",
        kind: f.fee_kind,
        amount: formatNumber(Number(f.amount)),
        note: f.note ?? "",
        declaration_type_id: f.declaration_type_id ?? "",
        declaration_label: f.declaration?.name ?? "",
                ref_no: f.ref_no ?? "",
                quantity: f.quantity == null ? "" : formatNumber(Number(f.quantity)),
                unit_price: f.unit_price == null ? "" : formatNumber(Number(f.unit_price)),
      })),
  }));

  const edit: EditOrderInit = {
    id: o.id,
    code: o.order_code,
    status: o.status,
    billed: ships.some((s) => s.receivable_id),
    customer: {
      id: o.customer?.id ?? "",
      label: o.customer ? `${o.customer.name} – ${o.customer.code}` : "",
    },
    payer: {
      id: o.payer?.id ?? "",
      label: o.payer ? `${o.payer.name} – ${o.payer.code}` : "",
    },
    company: { id: o.company?.id ?? "", label: o.company?.name ?? "" },
    orderDate: o.order_date,
    notes: o.notes ?? "",
    custom: o.custom_fields ?? {},
    shipments,
  };

  return (
    <>
      <Link href={`/dieu-phoi/don-hang/${o.id}`} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Đơn hàng {o.order_code}
      </Link>
      <PageHeader
        actions={
          <Button asChild variant="outline">
            <Link href={`/dieu-phoi/don-hang/${o.id}`}>
              <X /> Đóng
            </Link>
          </Button>
        }
        title={`Sửa đơn hàng ${o.order_code}`}
        description="Sửa mọi thông tin đã nhập lúc tạo đơn: phần đầu đơn, từng chuyến, giá, phí, hàng hóa, trường bổ sung. Thêm chuyến hoặc hủy chuyến ngay tại đây. Mọi thay đổi được ghi nhật ký."
      />
      {o.status === "cancelled" ? (
        <Alert variant="destructive">
          <AlertDescription>Đơn hàng đã hủy, không sửa được.</AlertDescription>
        </Alert>
      ) : (
        <OrderForm
          podPhotoDefault={podPhotoDefault}
          closeHref={`/dieu-phoi/don-hang/${o.id}`}
          edit={edit}
          canCreate={o.status === "open" && me.permissions.has("dispatch.create")}
          canCancelTrips={me.permissions.has("dispatch.delete") || me.permissions.has("shipments.delete")}
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
      )}
    </>
  );
}
