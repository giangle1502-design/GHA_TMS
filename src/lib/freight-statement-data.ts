import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysYMD, formatDate, startOfDayVN } from "@/lib/format";
import { PRICING_UNITS } from "@/lib/status";
import { dispatchExtraColumns } from "@/lib/dispatch-columns";
import type { ShipmentListRow } from "@/lib/shipments";
import {
  BASE_STATEMENT_COLUMNS,
  STATEMENT_STATUS_OPTIONS,
  type StatementColumn,
  type StatementCustomer,
  type StatementRow,
  type StatementStatusFilter,
} from "@/lib/freight-statement";

/** Số chuyến tối đa của một bảng kê */
export const STATEMENT_MAX_ROWS = 2000;

export type StatementParams = { kh: string; tu: string; den: string; tt: StatementStatusFilter };

export type StatementData = {
  customer: StatementCustomer | null;
  catalog: StatementColumn[];
  rows: StatementRow[];
  truncated: boolean;
  /** Số chuyến trong kỳ không có trong bảng kê vì chưa giao (khi lọc "đã giao") */
  notDelivered: number;
};

type FeeTypeRow = { id: string; name: string; sort_order: number; fee_group: { name: string; sort_order: number } | null };

/**
 * Dữ liệu bảng kê cước của một khách hàng trong khoảng ngày (theo ngày nhận hàng):
 * danh sách cột chọn được (cột có sẵn + trường bổ sung + từng loại phí) và giá trị từng chuyến.
 */
export async function loadStatement(supabase: SupabaseClient, perms: Set<string>, p: StatementParams): Promise<StatementData> {
  const feeTypesRes = await supabase
    .from("fee_types")
    .select("id, name, sort_order, fee_group:fee_groups(name, sort_order)")
    .eq("is_active", true)
    .order("sort_order")
    .order("name");
  if (feeTypesRes.error) throw feeTypesRes.error;
  const feeTypes = ((feeTypesRes.data ?? []) as unknown as FeeTypeRow[]).sort(
    (a, b) => (a.fee_group?.sort_order ?? 999) - (b.fee_group?.sort_order ?? 999) || a.sort_order - b.sort_order || a.name.localeCompare(b.name, "vi"),
  );

  if (!p.kh) {
    const { columns } = await dispatchExtraColumns(supabase, perms, []);
    return { customer: null, catalog: buildCatalog(columns, feeTypes), rows: [], truncated: false, notDelivered: 0 };
  }

  const statuses = STATEMENT_STATUS_OPTIONS.find((o) => o.value === p.tt)?.statuses ?? STATEMENT_STATUS_OPTIONS[0].statuses;
  const from = startOfDayVN(p.tu);
  const to = startOfDayVN(addDaysYMD(p.den, 1));
  const [custRes, notDeliveredRes] = await Promise.all([
    supabase.from("customers").select("id, code, name, tax_code, billing_address").eq("id", p.kh).maybeSingle(),
    p.tt === "giao"
      ? supabase
          .from("shipment_list")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", p.kh)
          .gte("pickup_at", from)
          .lt("pickup_at", to)
          .in("status", ["draft", "assigned", "accepted", "in_transit"])
      : Promise.resolve({ count: 0, error: null }),
  ]);
  if (custRes.error) throw custRes.error;

  const list: ShipmentListRow[] = [];
  for (let page = 0; page < 3; page++) {
    const { data, error } = await supabase
      .from("shipment_list")
      .select("*")
      .eq("customer_id", p.kh)
      .gte("pickup_at", from)
      .lt("pickup_at", to)
      .in("status", [...statuses])
      .order("pickup_at")
      .order("shipment_code")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    list.push(...((data ?? []) as ShipmentListRow[]));
    if ((data ?? []).length < 1000) break;
  }
  const truncated = list.length > STATEMENT_MAX_ROWS;
  const rowsIn = list.slice(0, STATEMENT_MAX_ROWS);

  // Số tiền từng loại phí của từng chuyến (đọc theo lô 200 mã)
  const fees = new Map<string, Record<string, number>>();
  for (let i = 0; i < rowsIn.length; i += 200) {
    const { data, error } = await supabase
      .from("shipment_fees")
      .select("shipment_id, fee_type_id, amount")
      .in("shipment_id", rowsIn.slice(i, i + 200).map((r) => r.id));
    if (error) throw error;
    for (const f of (data ?? []) as { shipment_id: string; fee_type_id: string | null; amount: number }[]) {
      if (!f.fee_type_id) continue;
      const m = fees.get(f.shipment_id) ?? {};
      m[`fee_${f.fee_type_id}`] = (m[`fee_${f.fee_type_id}`] ?? 0) + Number(f.amount);
      fees.set(f.shipment_id, m);
    }
  }

  const extra = await dispatchExtraColumns(supabase, perms, rowsIn);
  const catalog = buildCatalog(extra.columns, feeTypes);
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const rows: StatementRow[] = rowsIn.map((r, i) => {
    const cells: StatementRow["cells"] = {
      stt: i + 1,
      pickup_at: formatDate(r.pickup_at),
      expected_delivery_at: formatDate(r.expected_delivery_at),
      shipment_code: r.shipment_code,
      order_code: r.order_code,
      route_label: r.route_label ?? [r.pickup_name, r.delivery_name].filter(Boolean).join(" → "),
      pickup_name: r.pickup_name,
      delivery_name: r.delivery_name,
      empty_return_name: r.empty_return_name ?? null,
      offroute_return_name: r.offroute_return_name ?? null,
      vehicle_type_name: r.vehicle_type_name,
      plate_number: r.plate_number,
      driver_name: r.driver_name,
      quantity: num(r.quantity),
      pricing_unit: PRICING_UNITS[r.pricing_unit] ?? r.pricing_unit,
      unit_price: num(r.unit_price),
      freight_amount: num(r.freight_amount),
      fuel_support_rate: num(r.fuel_support_rate),
      fuel_support_amount: num(r.fuel_support_amount),
      surcharge_amount: num(r.surcharge_amount),
      transport_fee: num(r.transport_fee ?? Number(r.freight_amount) + Number(r.surcharge_amount) + Number(r.fuel_support_amount)),
      pass_through_fee: num(r.pass_through_fee ?? 0),
      declaration_fee: num(r.declaration_fee ?? 0),
      loading_fee: num(r.loading_fee ?? 0),
      other_fee: num(r.other_fee ?? 0),
      total_revenue: num(r.total_revenue),
      amount_due: num(r.amount_due),
      notes: r.notes,
      ...(fees.get(r.id) ?? {}),
    };
    for (const c of extra.columns) {
      const [text, sortVal] = extra.values[r.id]?.[c.key] ?? ["", null];
      cells[c.key] = c.numeric && typeof sortVal === "number" ? sortVal : text || null;
    }
    return { id: r.id, cells };
  });

  return {
    customer: (custRes.data as StatementCustomer | null) ?? null,
    catalog,
    rows,
    truncated,
    notDelivered: notDeliveredRes.count ?? 0,
  };
}

function buildCatalog(extra: { key: string; label: string; numeric: boolean; source: "shipment" | "order" }[], feeTypes: FeeTypeRow[]): StatementColumn[] {
  return [
    ...BASE_STATEMENT_COLUMNS,
    ...extra.map((c) => ({
      key: c.key,
      label: c.label,
      kind: c.numeric ? ("number" as const) : ("text" as const),
      group: c.source === "shipment" ? "Trường bổ sung của chuyến" : "Trường bổ sung của đơn hàng",
      width: c.numeric ? 12 : 16,
    })),
    ...feeTypes.map((f) => ({
      key: `fee_${f.id}`,
      label: f.name,
      kind: "money" as const,
      group: `Từng loại phí${f.fee_group ? ` – ${f.fee_group.name}` : ""}`,
      width: 13,
    })),
  ];
}
