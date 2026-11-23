import type { createClient } from "@/lib/supabase/server";
import { addDaysYMD, startOfDayVN, todayVN } from "@/lib/format";
import { statementRouteLabel } from "@/lib/freight-statement";
import { bagCount } from "@/lib/bags";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Một dòng báo cáo: một mã hàng trên một chuyến (chuyến chưa có mã hàng vẫn hiện 1 dòng để không sót chuyến) */
export type GoodsRow = {
  id: string;
  shipment_id: string;
  trip_date: string;
  delivery_date: string | null;
  shipment_code: string;
  order_id: string;
  order_code: string | null;
  ref_no: string | null;
  customer_code: string | null;
  customer_name: string | null;
  route_label: string;
  pickup_name: string | null;
  delivery_name: string | null;
  empty_return_name: string | null;
  plate_number: string | null;
  driver_name: string | null;
  container_no: string | null;
  status: string;
  line_no: number | null;
  item_code: string | null;
  item_name: string | null;
  quantity: number | null;
  unit: string | null;
  weight_kg: number | null;
  bags: number | null;
  /** Các mã chuyến đi chung xe (2 đơn ghép 1 xe); mỗi chuyến vẫn giữ mã chuyến riêng */
  load_group_codes: string | null;
  no_items: boolean;
};

type ShipRow = {
  id: string;
  shipment_code: string;
  order_id: string;
  order_code: string | null;
  customer_code: string | null;
  customer_name: string | null;
  pickup_at: string | null;
  expected_delivery_at: string | null;
  pickup_name: string | null;
  delivery_name: string | null;
  empty_return_name: string | null;
  plate_number: string | null;
  driver_name: string | null;
  status: string;
  load_group_id: string | null;
};

type ItemRow = {
  shipment_id: string;
  line_no: number;
  item_code: string | null;
  item_name: string | null;
  quantity: number | null;
  unit: string | null;
  weight_kg: number | null;
  bag_count: number | null;
  product: { unit: string | null; kg_per_unit: number | null; kg_per_bag: number | null } | null;
};

export const GOODS_REPORT_MAX_TRIPS = 5000;
/** Khóa tab trên trang Báo cáo (/bao-cao?tab=hang_hoa) */
export const GOODS_REPORT_TAB = "hang_hoa";

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const isUnit = (u: string | null | undefined, re: RegExp) => re.test((u ?? "").trim());

/** Ngày giờ (timestamptz) → YYYY-MM-DD theo giờ Việt Nam */
const ymdVN = (v: string | null) => (v ? todayVN(new Date(v)) : null);

/** Số KG của dòng hàng: KG đã quy đổi theo mã hàng; ĐVT KG thì lấy số lượng */
function itemKg(i: ItemRow): number | null {
  const w = num(i.weight_kg);
  if (w !== null) return w;
  return isUnit(i.unit, /^kg$/i) ? num(i.quantity) : null;
}

/** Số bao giống phiếu giao hàng (SQL 9039): tự tính theo mã hàng > nhập tay */
function itemBags(i: ItemRow): number | null {
  return bagCount(num(i.quantity), i.unit, i.product, i.bag_count);
}

/**
 * Chi tiết hàng hóa vận chuyển theo ngày nhận hàng (Từ ngày - Đến ngày): mỗi mã hàng trên chuyến một dòng.
 * Đọc qua view shipment_list (theo quyền người xem: tài khoản khách chỉ thấy chuyến của mình, không có cột 3PL).
 */
export async function loadGoodsReport(supabase: Supabase, tu: string, den: string): Promise<{ rows: GoodsRow[]; trips: number; truncated: boolean }> {
  const from = startOfDayVN(tu);
  const to = startOfDayVN(addDaysYMD(den, 1));
  const ships: ShipRow[] = [];
  for (let page = 0; page * 1000 < GOODS_REPORT_MAX_TRIPS + 1; page++) {
    const { data, error } = await supabase
      .from("shipment_list")
      .select(
        "id, shipment_code, order_id, order_code, customer_code, customer_name, pickup_at, expected_delivery_at, pickup_name, delivery_name, empty_return_name, plate_number, driver_name, status, load_group_id",
      )
      .gte("pickup_at", from)
      .lt("pickup_at", to)
      .neq("status", "cancelled")
      .order("pickup_at")
      .order("shipment_code")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    ships.push(...((data ?? []) as ShipRow[]));
    if ((data ?? []).length < 1000) break;
  }
  const truncated = ships.length > GOODS_REPORT_MAX_TRIPS;
  const list = ships.slice(0, GOODS_REPORT_MAX_TRIPS);
  const ids = list.map((s) => s.id);
  const orderIds = [...new Set(list.map((s) => s.order_id))];

  const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, k) => a.slice(k * n, k * n + n));

  // Hàng hóa, số cont, số đơn khách: đọc theo lô
  const items = new Map<string, ItemRow[]>();
  const conts = new Map<string, string | null>();
  const refs = new Map<string, string | null>();
  await Promise.all([
    ...chunk(ids, 100).map(async (c) => {
      for (let page = 0; ; page++) {
        const { data, error } = await supabase
          .from("shipment_items")
          .select("shipment_id, line_no, item_code, item_name, quantity, unit, weight_kg, bag_count, product:products(unit, kg_per_unit, kg_per_bag)")
          .in("shipment_id", c)
          .order("shipment_id")
          .order("line_no")
          .range(page * 1000, page * 1000 + 999);
        if (error) throw error;
        for (const it of (data ?? []) as unknown as ItemRow[]) {
          const a = items.get(it.shipment_id) ?? [];
          a.push(it);
          items.set(it.shipment_id, a);
        }
        if ((data ?? []).length < 1000) break;
      }
    }),
    ...chunk(ids, 150).map(async (c) => {
      const { data, error } = await supabase.from("shipments").select("id, container_no").in("id", c);
      if (error) throw error;
      for (const s of (data ?? []) as { id: string; container_no: string | null }[]) conts.set(s.id, s.container_no);
    }),
    ...chunk(orderIds, 150).map(async (c) => {
      const { data, error } = await supabase.from("transport_orders").select("id, ref_no").in("id", c);
      if (error) throw error;
      for (const o of (data ?? []) as { id: string; ref_no: string | null }[]) refs.set(o.id, o.ref_no);
    }),
  ]);

  // Chuyến ghép chung xe: liệt kê các mã chuyến cùng nhóm
  const groups = new Map<string, string[]>();
  for (const s of list) {
    if (!s.load_group_id) continue;
    const g = groups.get(s.load_group_id) ?? [];
    g.push(s.shipment_code);
    groups.set(s.load_group_id, g);
  }

  const rows: GoodsRow[] = [];
  for (const s of list) {
    const base = {
      shipment_id: s.id,
      trip_date: ymdVN(s.pickup_at) ?? "",
      delivery_date: ymdVN(s.expected_delivery_at),
      shipment_code: s.shipment_code,
      order_id: s.order_id,
      order_code: s.order_code,
      ref_no: refs.get(s.order_id) ?? null,
      customer_code: s.customer_code,
      customer_name: s.customer_name,
      route_label: statementRouteLabel({ pickup_name: s.pickup_name, delivery_name: s.delivery_name, empty_return_name: s.empty_return_name }),
      pickup_name: s.pickup_name,
      delivery_name: s.delivery_name,
      empty_return_name: s.empty_return_name,
      plate_number: s.plate_number,
      driver_name: s.driver_name,
      container_no: conts.get(s.id) ?? null,
      status: s.status,
      load_group_codes: s.load_group_id && (groups.get(s.load_group_id)?.length ?? 0) > 1 ? groups.get(s.load_group_id)!.join(", ") : null,
    };
    const its = items.get(s.id) ?? [];
    if (!its.length) {
      rows.push({ ...base, id: `${s.id}-0`, line_no: null, item_code: null, item_name: null, quantity: null, unit: null, weight_kg: null, bags: null, no_items: true });
      continue;
    }
    for (const i of its) {
      const kg = itemKg(i);
      rows.push({
        ...base,
        id: `${s.id}-${i.line_no}`,
        line_no: i.line_no,
        item_code: i.item_code,
        item_name: i.item_name,
        quantity: num(i.quantity),
        unit: i.unit,
        weight_kg: kg,
        bags: itemBags(i),
        no_items: false,
      });
    }
  }
  return { rows, trips: list.length, truncated };
}
