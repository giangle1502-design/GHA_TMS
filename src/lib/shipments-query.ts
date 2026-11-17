import "server-only";
import { addDaysYMD, monthRangeYMD, startOfDayVN, todayVN } from "@/lib/format";
import { isUuid } from "@/lib/entities/record";
import { sanitizeSearch } from "@/lib/entities/server";
import { SHIPMENT_STATUS } from "@/lib/status";
import { applyConditions, parseConditions, encodeCondition, type AdvField } from "@/lib/advanced-filter";
import { loadCustomFields, resolveRefLabels, visibleCustomRows } from "@/lib/entities/server";
import { advancedFields, moduleCustomFields } from "@/lib/entities/record";
import { shipmentCustomAdvFields } from "@/lib/shipments";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SHIPMENT_ADV_FIELDS, SHIPMENT_DATETIME_FIELDS } from "@/lib/shipments";

/** pl = lọc nhà xe 3PL: id nhà xe, "3pl" (mọi chuyến 3PL), "noi-bo" (chuyến xe nội bộ), "" (tất cả) */
export type ShipmentFilters = { tu: string; den: string; tt: string; kh: string; q: string; pl: string; adv: string[]; extraAdv?: AdvField[] };

/** Giá trị hợp lệ của bộ lọc nhà xe 3PL */
export function parseCarrierFilter(v: string | undefined): string {
  return v && (v === "3pl" || v === "noi-bo" || isUuid(v)) ? v : "";
}

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Chuẩn hóa bộ lọc từ URL; mặc định cả tháng hiện tại (giờ Việt Nam) */
export function parseShipmentFilters(raw: SP, extraAdv: AdvField[] = []): ShipmentFilters {
  const sp = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "a").map(([k, v]) => [k, one(v)])) as Record<string, string | undefined>;
  const month = monthRangeYMD(todayVN());
  let tu = sp.tu && YMD.test(sp.tu) ? sp.tu : month.tu;
  let den = sp.den && YMD.test(sp.den) ? sp.den : month.den;
  if (den < tu) [tu, den] = [den, tu];
  return {
    tu,
    den,
    tt: sp.tt === "tre" || sp.tt === "cho-duyet" || sp.tt === "tat-ca" || SHIPMENT_STATUS.some((s) => s.value === sp.tt) ? sp.tt! : "",
    kh: sp.kh && isUuid(sp.kh) ? sp.kh : "",
    pl: parseCarrierFilter(sp.pl),
    q: sanitizeSearch(sp.q ?? ""),
    adv: parseConditions(raw.a, [...SHIPMENT_ADV_FIELDS, ...extraAdv]).map(encodeCondition),
    extraAdv,
  };
}

/** Áp bộ lọc lên truy vấn view shipment_list */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyShipmentFilters(query: any, f: ShipmentFilters, opts: { status?: boolean } = {}) {
  let q = query.gte("pickup_at", startOfDayVN(f.tu)).lt("pickup_at", startOfDayVN(addDaysYMD(f.den, 1)));
  if (f.kh) q = q.eq("customer_id", f.kh);
  // Nhà xe 3PL (cột carrier_supplier_id của view, SQL 9018; người không xem được 3PL luôn thấy trống)
  if (f.pl === "3pl") q = q.not("carrier_supplier_id", "is", null);
  else if (f.pl === "noi-bo") q = q.is("carrier_supplier_id", null);
  else if (f.pl) q = q.eq("carrier_supplier_id", f.pl);
  if (f.q) {
    q = q.or(["shipment_code", "order_code", "customer_name", "plate_number", "driver_name", "pickup_name", "delivery_name", "plan_code", "empty_return_name", "offroute_return_name"].map((c) => `${c}.ilike.*${f.q}*`).join(","));
  }
  if (f.adv.length) {
    const all = [...SHIPMENT_ADV_FIELDS, ...(f.extraAdv ?? [])];
    q = applyConditions(q, parseConditions(f.adv, all), all, {
      column: (k) => (k.startsWith("cf_") ? `custom_fields->>${k.slice(3)}` : k),
      dateTime: (k) => SHIPMENT_DATETIME_FIELDS.has(k),
      dayStart: startOfDayVN,
      nextDayStart: (d) => startOfDayVN(addDaysYMD(d, 1)),
    });
  }
  if (opts.status !== false && f.tt && f.tt !== "tat-ca") {
    if (f.tt === "tre") q = q.in("status", ["assigned", "accepted", "in_transit"]).lt("expected_delivery_at", new Date().toISOString());
    else if (f.tt === "cho-duyet") q = q.in("dispatch_approval", ["pending", "rejected"]);
    else q = q.eq("status", f.tt);
  }
  return q;
}

export type CarrierOption = { id: string; name: string; count: number };

/**
 * Nhà xe 3PL có chuyến trong khoảng ngày đang xem (để chọn ở bộ lọc 3PL), kèm số chuyến.
 * CSDL chưa chạy SQL 9018 (chưa có cột carrier_*) thì trả về null để ẩn ô lọc.
 */
export async function carrierOptions(supabase: SupabaseClient, f: Pick<ShipmentFilters, "tu" | "den">): Promise<CarrierOption[] | null> {
  const { data, error } = await supabase
    .from("shipment_list")
    .select("carrier_supplier_id, carrier_name")
    .gte("pickup_at", startOfDayVN(f.tu))
    .lt("pickup_at", startOfDayVN(addDaysYMD(f.den, 1)))
    .neq("status", "cancelled")
    .not("carrier_supplier_id", "is", null)
    .limit(5000);
  if (error) return null;
  const m = new Map<string, CarrierOption>();
  for (const r of (data ?? []) as { carrier_supplier_id: string; carrier_name: string | null }[]) {
    const o = m.get(r.carrier_supplier_id) ?? { id: r.carrier_supplier_id, name: r.carrier_name ?? "(không tên)", count: 0 };
    o.count++;
    m.set(o.id, o);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

/** Tên nhà xe đang lọc (khi nhà xe không có chuyến trong khoảng ngày nên không có trong danh sách chọn) */
export async function carrierName(supabase: SupabaseClient, id: string): Promise<string> {
  if (!isUuid(id)) return "";
  const { data } = await supabase.from("suppliers").select("name").eq("id", id).maybeSingle();
  return (data?.name as string | undefined) ?? "";
}

/** Trường bổ sung của chuyến mà người dùng được xem: định nghĩa cột + trường tìm kiếm nâng cao */
export async function shipmentCustomFields(supabase: SupabaseClient, perms: Set<string>) {
  const defs = moduleCustomFields("shipments", visibleCustomRows(await loadCustomFields(supabase, "shipments"), perms), perms);
  return { defs, adv: shipmentCustomAdvFields(advancedFields(defs)) };
}

/** Nhãn của khách hàng, địa điểm, xe… đang dùng trong điều kiện tìm kiếm nâng cao */
export async function advRefLabels(supabase: SupabaseClient, adv: string[], all: AdvField[]) {
  const conds = parseConditions(adv, all).filter((c) => all.find((x) => x.key === c.field)?.kind === "reference");
  if (!conds.length) return {};
  const fields = conds.map((c) => {
    const af = all.find((x) => x.key === c.field)!;
    return { key: c.field, label: af.label, type: "reference" as const, ref: af.ref };
  });
  const labels = await resolveRefLabels(supabase, fields, conds.map((c) => ({ [c.field]: c.value })));
  return Object.assign({}, ...Object.values(labels)) as Record<string, string>;
}
