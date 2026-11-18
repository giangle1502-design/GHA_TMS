"use server";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { isUuid } from "@/lib/entities/record";
import type { TruckRateCard } from "@/lib/truck-rate";

export type ContPriceOption = {
  id: string;
  pickup_location_id: string;
  pickup_name: string;
  delivery_location_id: string;
  delivery_name: string;
  empty_return_location_id: string | null;
  empty_return_name: string | null;
  container_size: string | null;
  unit_price: number;
  fuel_support_rate: number | null;
  trip_count: number;
  last_trip_date: string | null;
  /** 3 = đúng tuyến + hạ rỗng + cỡ cont, 2 = đúng tuyến + hạ rỗng, 1 = đúng tuyến, 0 = khác tuyến */
  match: number;
};

export type RoutePriceOption = {
  id: string;
  code: string;
  unit_price: number;
  pricing_unit: string;
  fuel_support_rate: number | null;
  surcharge_amount: number;
  effective_from: string;
  effective_to: string | null;
};

export type PriceOptions = {
  shipment: {
    id: string;
    code: string;
    version: number;
    customer_id: string;
    customer_name: string | null;
    pickup_name: string | null;
    delivery_name: string | null;
    empty_return_name: string | null;
    trip_date: string;
    unit_price: number;
    fuel_support_rate: number | null;
    container_no: string | null;
    container_size: string | null;
    is_container: boolean;
    tons: number | null;
    distance_km: number | null;
    status: string;
  };
  cont: ContPriceOption[];
  truckCards: TruckRateCard[];
  routePrices: RoutePriceOption[];
  /** CSDL chưa chạy SQL 9022 */
  missingTables: boolean;
};

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Bảng giá phù hợp với một chuyến: giá xe cont của khách hàng, bảng giá xe tải, bảng giá theo tuyến */
export async function getShipmentPriceOptions(shipmentId: string): Promise<ActionResult<PriceOptions>> {
  return runAction(async () => {
    await requirePermission("shipments.update", "dispatch.update");
    await requirePermission("price_lists.view");
    if (!isUuid(shipmentId)) throw new ActionError("Dữ liệu không hợp lệ.");
    const supabase = await createClient();
    const { data: s, error } = await supabase
      .from("shipments")
      .select(
        "id, shipment_code, version, status, pickup_at, unit_price, fuel_support_rate, container_no, pickup_location_id, delivery_location_id, empty_return_location_id, vehicle_type_id, " +
          "order:transport_orders(customer_id, customer:customers!transport_orders_customer_id_fkey(name)), vehicle:vehicles!shipments_vehicle_id_fkey(vehicle_kind), trailer:vehicles!shipments_trailer_id_fkey(trailer_size), " +
          "pickup:locations!shipments_pickup_location_id_fkey(name), delivery:locations!shipments_delivery_location_id_fkey(name), empty:locations!shipments_empty_return_location_id_fkey(name), " +
          "items:shipment_items(weight_kg, quantity, unit)",
      )
      .eq("id", shipmentId)
      .maybeSingle();
    if (error) throw error;
    if (!s) throw new ActionError("Không tìm thấy chuyến.");
    const r = s as unknown as {
      id: string;
      shipment_code: string;
      version: number;
      status: string;
      pickup_at: string;
      unit_price: number;
      fuel_support_rate: number | null;
      container_no: string | null;
      pickup_location_id: string;
      delivery_location_id: string;
      empty_return_location_id: string | null;
      vehicle_type_id: string | null;
      order: { customer_id: string; customer: { name: string } | null } | null;
      vehicle: { vehicle_kind: string } | null;
      trailer: { trailer_size: string | null } | null;
      pickup: { name: string } | null;
      delivery: { name: string } | null;
      empty: { name: string } | null;
      items: { weight_kg: number | null; quantity: number | null; unit: string | null }[] | null;
    };
    const customerId = r.order?.customer_id ?? "";
    const tripDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(r.pickup_at));
    const kg = (r.items ?? []).reduce(
      (a, x) => a + (x.weight_kg !== null ? Number(x.weight_kg) : /^\s*kg\s*$/i.test(x.unit ?? "") ? Number(x.quantity) || 0 : 0),
      0,
    );
    const size = r.trailer?.trailer_size && ["20", "40", "45"].includes(r.trailer.trailer_size) ? r.trailer.trailer_size : null;
    const isContainer = Boolean(r.container_no?.trim()) || r.vehicle?.vehicle_kind === "tractor";

    const [routeRes, contRes, cardRes, plRes] = await Promise.all([
      supabase.from("routes").select("distance_km").eq("pickup_location_id", r.pickup_location_id).eq("delivery_location_id", r.delivery_location_id).maybeSingle(),
      customerId
        ? supabase
            .from("container_price_lists")
            .select(
              "id, pickup_location_id, delivery_location_id, empty_return_location_id, container_size, unit_price, fuel_support_rate, trip_count, last_trip_date, " +
                "pickup:locations!container_price_lists_pickup_location_id_fkey(name), delivery:locations!container_price_lists_delivery_location_id_fkey(name), empty:locations!container_price_lists_empty_return_location_id_fkey(name)",
            )
            .eq("customer_id", customerId)
            .eq("status", "active")
            .limit(1000)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("truck_rate_cards")
        .select("*, customer:customers(name)")
        .eq("status", "active")
        .lte("effective_from", tripDate)
        .or(`effective_to.is.null,effective_to.gte.${tripDate}`)
        .order("effective_from", { ascending: false }),
      supabase.rpc("find_price_lists", {
        p_customer_id: customerId || null,
        p_pickup_location_id: r.pickup_location_id,
        p_delivery_location_id: r.delivery_location_id,
        p_vehicle_type_id: r.vehicle_type_id,
        p_on_date: tripDate,
      }),
    ]);
    const missingTables = Boolean(
      (contRes.error && /container_price_lists/.test(contRes.error.message ?? "")) || (cardRes.error && /truck_rate_cards/.test(cardRes.error.message ?? "")),
    );
    if (contRes.error && !missingTables) throw contRes.error;
    if (cardRes.error && !missingTables) throw cardRes.error;

    type ContRaw = Omit<ContPriceOption, "pickup_name" | "delivery_name" | "empty_return_name" | "match"> & {
      pickup: { name: string } | null;
      delivery: { name: string } | null;
      empty: { name: string } | null;
    };
    const cont: ContPriceOption[] = ((contRes.data ?? []) as unknown as ContRaw[])
      .map(({ pickup, delivery, empty, ...c }) => {
        const route = c.pickup_location_id === r.pickup_location_id && c.delivery_location_id === r.delivery_location_id;
        const emptyOk = (c.empty_return_location_id ?? null) === (r.empty_return_location_id ?? null);
        const sizeOk = !size || !c.container_size || c.container_size === size;
        return {
          ...c,
          unit_price: Number(c.unit_price),
          fuel_support_rate: n(c.fuel_support_rate),
          pickup_name: pickup?.name ?? "",
          delivery_name: delivery?.name ?? "",
          empty_return_name: empty?.name ?? null,
          match: route ? (emptyOk ? (sizeOk ? 3 : 2) : 1) : 0,
        };
      })
      .sort((a, b) => b.match - a.match || (a.pickup_name + a.delivery_name).localeCompare(b.pickup_name + b.delivery_name, "vi"));

    const truckCards = ((cardRes.data ?? []) as (TruckRateCard & { customer?: { name: string } | null })[])
      .filter((c) => !c.customer_id || c.customer_id === customerId)
      // Bảng riêng của khách hàng lên trước bảng nội bộ dùng chung
      .sort((a, b) => Number(Boolean(b.customer_id)) - Number(Boolean(a.customer_id)))
      .map(({ customer, ...c }) => ({ ...c, default_fuel_pct: Number(c.default_fuel_pct), customer_name: customer?.name ?? null }));

    const routePrices = ((plRes.error ? [] : plRes.data) ?? []) as RoutePriceOption[];

    return {
      shipment: {
        id: r.id,
        code: r.shipment_code,
        version: r.version,
        customer_id: customerId,
        customer_name: r.order?.customer?.name ?? null,
        pickup_name: r.pickup?.name ?? null,
        delivery_name: r.delivery?.name ?? null,
        empty_return_name: r.empty?.name ?? null,
        trip_date: tripDate,
        unit_price: Number(r.unit_price),
        fuel_support_rate: n(r.fuel_support_rate),
        container_no: r.container_no,
        container_size: size,
        is_container: isContainer,
        tons: kg > 0 ? Math.round(kg) / 1000 : null,
        distance_km: n(routeRes.data?.distance_km),
        status: r.status,
      },
      cont,
      truckCards,
      routePrices: routePrices.map((p) => ({ ...p, unit_price: Number(p.unit_price), fuel_support_rate: n(p.fuel_support_rate), surcharge_amount: Number(p.surcharge_amount) })),
      missingTables,
    };
  });
}
