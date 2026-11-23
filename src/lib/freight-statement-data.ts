import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysYMD, formatDate, startOfDayVN } from "@/lib/format";
import { PRICING_UNITS } from "@/lib/status";
import { dispatchExtraColumns } from "@/lib/dispatch-columns";
import type { ShipmentListRow } from "@/lib/shipments";
import { mergeStatementGroups } from "@/lib/load-group";
import {
  BASE_STATEMENT_COLUMNS,
  CARRIER_BASE_COLUMNS,
  STATEMENT_ALL_CUSTOMERS,
  STATEMENT_STATUS_OPTIONS,
  invoiceText,
  statementRouteLabel,
  type StatementColumn,
  type StatementCustomer,
  type StatementRow,
  type StatementStatusFilter,
} from "@/lib/freight-statement";

/** Số chuyến tối đa của một bảng kê */
export const STATEMENT_MAX_ROWS = 2000;

/** kh: id khách hàng, hoặc "all" = mọi khách hàng được gán (chỉ tài khoản khách) */
export type StatementParams = { kh: string; tu: string; den: string; tt: StatementStatusFilter };

/**
 * Tài khoản khách chỉ xem bảng kê (quyền statements.view, không có quyền xem chuyến):
 * đọc qua các view statement_* (CSDL tự lọc theo khách hàng được gán ở trang Người dùng).
 */
export function isStatementPortal(perms: Set<string>): boolean {
  return perms.has("statements.view") && !perms.has("shipments.view");
}

/** Khách hàng được lập bảng kê: nhân viên GHA thấy mọi khách đang dùng, tài khoản khách chỉ thấy khách được gán */
export async function loadStatementCustomers(supabase: SupabaseClient, perms: Set<string>): Promise<StatementCustomer[]> {
  const portal = isStatementPortal(perms);
  let q = supabase.from(portal ? "statement_customers" : "customers").select("id, code, name, tax_code, billing_address").order("name").limit(3000);
  if (!portal) q = q.eq("status", "active");
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as StatementCustomer[];
}

/** Đầu bảng kê khi chọn "Tất cả": gộp tên và MST các công ty */
function combinedCustomer(list: StatementCustomer[]): StatementCustomer {
  return {
    id: STATEMENT_ALL_CUSTOMERS,
    code: list.map((c) => c.code).join("-"),
    name: list.map((c) => c.name).join(" / "),
    tax_code: list.map((c) => `${c.code}: ${c.tax_code ?? ""}`).join("; "),
    billing_address: null,
  };
}

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

  const portal = isStatementPortal(perms);
  const statuses = STATEMENT_STATUS_OPTIONS.find((o) => o.value === p.tt)?.statuses ?? STATEMENT_STATUS_OPTIONS[0].statuses;
  const from = startOfDayVN(p.tu);
  const to = startOfDayVN(addDaysYMD(p.den, 1));
  const listView = portal ? "statement_shipment_list" : "shipment_list";

  // Khách hàng của bảng kê. "Tất cả" chỉ dành cho tài khoản khách: mọi khách hàng được gán.
  let customer: StatementCustomer | null = null;
  let customerIds: string[];
  if (p.kh === STATEMENT_ALL_CUSTOMERS) {
    const list = portal ? await loadStatementCustomers(supabase, perms) : [];
    customer = list.length ? (list.length === 1 ? list[0] : combinedCustomer(list)) : null;
    customerIds = list.map((c) => c.id);
  } else {
    const custRes = await supabase
      .from(portal ? "statement_customers" : "customers")
      .select("id, code, name, tax_code, billing_address")
      .eq("id", p.kh)
      .maybeSingle();
    if (custRes.error) throw custRes.error;
    customer = (custRes.data as StatementCustomer | null) ?? null;
    customerIds = customer ? [customer.id] : [];
  }
  if (!customer) {
    const { columns } = await dispatchExtraColumns(supabase, perms, []);
    return { customer: null, catalog: buildCatalog(columns, feeTypes), rows: [], truncated: false, notDelivered: 0 };
  }

  const notDeliveredRes =
    p.tt === "giao"
      ? await supabase
          .from(listView)
          .select("id", { count: "exact", head: true })
          .in("customer_id", customerIds)
          .gte("pickup_at", from)
          .lt("pickup_at", to)
          .in("status", ["draft", "assigned", "accepted", "in_transit"])
      : { count: 0, error: null };

  const list: (ShipmentListRow & { pickup_billing_address?: string | null; delivery_billing_address?: string | null })[] = [];
  for (let page = 0; page < 3; page++) {
    const { data, error } = await supabase
      .from(listView)
      .select("*")
      .in("customer_id", customerIds)
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
      .from(portal ? "statement_shipment_fees" : "shipment_fees")
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

  // Thông tin xuất hóa đơn của điểm nhận / điểm giao (ô "Địa chỉ xuất hóa đơn" của địa điểm)
  // (tài khoản khách: view bảng kê có sẵn hai cột này, không đọc danh mục địa điểm)
  const billing = new Map<string, string | null>();
  if (portal) {
    for (const r of rowsIn) {
      if (r.pickup_location_id) billing.set(r.pickup_location_id, r.pickup_billing_address ?? null);
      if (r.delivery_location_id) billing.set(r.delivery_location_id, r.delivery_billing_address ?? null);
    }
  }
  const locIds = portal ? [] : [...new Set(rowsIn.flatMap((r) => [r.pickup_location_id, r.delivery_location_id]).filter((x): x is string => Boolean(x)))];
  for (let i = 0; i < locIds.length; i += 200) {
    const { data, error } = await supabase.from("locations").select("id, billing_address").in("id", locIds.slice(i, i + 200));
    if (error) throw error;
    for (const l of (data ?? []) as { id: string; billing_address: string | null }[]) billing.set(l.id, l.billing_address);
  }

  const [extra, trip] = await Promise.all([dispatchExtraColumns(supabase, perms, rowsIn), loadTripExtras(supabase, rowsIn, portal)]);
  const catalog = buildCatalog(extra.columns, feeTypes);
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const rows: StatementRow[] = rowsIn.map((r, i) => {
    const cells: StatementRow["cells"] = {
      stt: i + 1,
      pickup_at: formatDate(r.pickup_at),
      expected_delivery_at: formatDate(r.expected_delivery_at),
      shipment_code: r.shipment_code,
      order_code: r.order_code,
      customer_code: r.customer_code ?? null,
      route_label: statementRouteLabel(r),
      invoice_info:
        invoiceText(r.pickup_location_id ? billing.get(r.pickup_location_id) : null, r.delivery_location_id ? billing.get(r.delivery_location_id) : null) || null,
      pickup_name: r.pickup_name,
      delivery_name: r.delivery_name,
      empty_return_name: r.empty_return_name ?? null,
      offroute_return_name: r.offroute_return_name ?? null,
      vehicle_type_name: r.vehicle_type_name,
      plate_number: r.plate_number,
      driver_name: r.driver_name,
      trip_count: 1,
      ...tripCells(r, trip),
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
      ...(fees.get(r.id) ?? {}),
    };
    for (const c of extra.columns) {
      const [text, sortVal] = extra.values[r.id]?.[c.key] ?? ["", null];
      cells[c.key] = c.numeric && typeof sortVal === "number" ? sortVal : text || null;
    }
    return { id: r.id, cells };
  });

  return {
    customer,
    catalog,
    rows: mergeStatementGroups(rows, rowsIn, catalog),
    truncated,
    notDelivered: notDeliveredRes.count ?? 0,
  };
}

function buildCatalog(
  extra: { key: string; label: string; numeric: boolean; source: "shipment" | "order" }[],
  feeTypes: FeeTypeRow[],
  base: StatementColumn[] = BASE_STATEMENT_COLUMNS,
): StatementColumn[] {
  return [
    ...base,
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


// ---------------------------------------------------------------------------
// Bảng kê 3PL: chi phí GHA phải trả một nhà xe thuê ngoài trong kỳ
// ---------------------------------------------------------------------------

/** nx: id nhà xe 3PL; kh: lọc thêm theo khách hàng (trống = mọi khách hàng) */
export type CarrierStatementParams = { nx: string; kh: string; tu: string; den: string; tt: StatementStatusFilter };

/** Nhà xe 3PL có chuyến (theo báo cáo Chuyến 3PL), kèm mọi nhà cung cấp đang có xe thuê ngoài */
export async function loadCarrierSuppliers(supabase: SupabaseClient): Promise<StatementCustomer[]> {
  const [tripRes, vehRes] = await Promise.all([
    supabase.from("report_carrier_trips").select("supplier_id").not("supplier_id", "is", null).limit(20000),
    supabase.from("vehicles").select("supplier_id").not("supplier_id", "is", null).limit(5000),
  ]);
  if (tripRes.error) throw tripRes.error;
  if (vehRes.error) throw vehRes.error;
  const ids = [...new Set([...(tripRes.data ?? []), ...(vehRes.data ?? [])].map((r) => (r as { supplier_id: string }).supplier_id))];
  const out: StatementCustomer[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("suppliers").select("id, code, name, tax_code, address").in("id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const r of (data ?? []) as { id: string; code: string; name: string; tax_code: string | null; address: string | null }[])
      out.push({ id: r.id, code: r.code, name: r.name, tax_code: r.tax_code, billing_address: r.address });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

type CarrierCostLine = {
  shipment_id: string;
  cost_kind: "freight" | "pass_through" | "other";
  fee_type_id: string | null;
  quantity: number | null;
  unit_price: number | null;
  fuel_pct: number | null;
  amount: number;
  supplier_id: string | null;
  note: string | null;
};

const PAY_LABEL: Record<string, string> = {
  no_cost: "Chưa nhập chi phí",
  no_payable: "Chưa lập công nợ",
  unpaid: "Chưa trả",
  partial: "Trả một phần",
  paid: "Đã trả đủ",
};

/**
 * Dữ liệu bảng kê 3PL của một nhà xe trong khoảng ngày (theo ngày nhận hàng, giống bảng kê khách hàng):
 * chuyến do nhà xe chạy (nhà xe của chuyến, hoặc xe thuê ngoài thuộc nhà xe khi chuyến chưa ghi nhà xe)
 * và các khoản trả nhà xe đó (cước gồm % dầu, chi hộ, bốc xếp, chi phí khác) – không có cước thu khách.
 */
export async function loadCarrierStatement(supabase: SupabaseClient, perms: Set<string>, p: CarrierStatementParams): Promise<StatementData> {
  const feeTypesRes = await supabase
    .from("fee_types")
    .select("id, name, sort_order, is_loading, fee_group:fee_groups(name, sort_order)")
    .eq("is_active", true)
    .order("sort_order")
    .order("name");
  if (feeTypesRes.error) throw feeTypesRes.error;
  const feeTypes = ((feeTypesRes.data ?? []) as unknown as (FeeTypeRow & { is_loading: boolean | null })[]).sort(
    (a, b) => (a.fee_group?.sort_order ?? 999) - (b.fee_group?.sort_order ?? 999) || a.sort_order - b.sort_order || a.name.localeCompare(b.name, "vi"),
  );
  const loadingType = new Set(feeTypes.filter((f) => f.is_loading).map((f) => f.id));

  const empty = async (): Promise<StatementData> => {
    const { columns } = await dispatchExtraColumns(supabase, perms, []);
    return { customer: null, catalog: buildCatalog(columns, feeTypes, CARRIER_BASE_COLUMNS), rows: [], truncated: false, notDelivered: 0 };
  };
  if (!p.nx) return empty();
  const supRes = await supabase.from("suppliers").select("id, code, name, tax_code, address").eq("id", p.nx).maybeSingle();
  if (supRes.error) throw supRes.error;
  const sup = supRes.data as { id: string; code: string; name: string; tax_code: string | null; address: string | null } | null;
  if (!sup) return empty();
  const supplier: StatementCustomer = { id: sup.id, code: sup.code, name: sup.name, tax_code: sup.tax_code, billing_address: sup.address };

  // Xe thuê ngoài của nhà xe: chuyến chưa ghi nhà xe mà chạy xe này cũng là của nhà xe (như báo cáo Chuyến 3PL)
  const vehRes = await supabase.from("vehicles").select("id").eq("supplier_id", sup.id).limit(2000);
  if (vehRes.error) throw vehRes.error;
  const vIds = ((vehRes.data ?? []) as { id: string }[]).map((v) => v.id);
  const ofCarrier = vIds.length ? `carrier_supplier_id.eq.${sup.id},and(carrier_supplier_id.is.null,vehicle_id.in.(${vIds.join(",")}))` : `carrier_supplier_id.eq.${sup.id}`;

  const statuses = STATEMENT_STATUS_OPTIONS.find((o) => o.value === p.tt)?.statuses ?? STATEMENT_STATUS_OPTIONS[0].statuses;
  const from = startOfDayVN(p.tu);
  const to = startOfDayVN(addDaysYMD(p.den, 1));
  const base = () => {
    let q = supabase.from("shipment_list").select("*").or(ofCarrier).gte("pickup_at", from).lt("pickup_at", to);
    if (p.kh) q = q.eq("customer_id", p.kh);
    return q;
  };

  const notDeliveredRes =
    p.tt === "giao"
      ? await (() => {
          let q = supabase.from("shipment_list").select("id", { count: "exact", head: true }).or(ofCarrier).gte("pickup_at", from).lt("pickup_at", to);
          if (p.kh) q = q.eq("customer_id", p.kh);
          return q.in("status", ["draft", "assigned", "accepted", "in_transit"]);
        })()
      : { count: 0, error: null };

  const list: ShipmentListRow[] = [];
  for (let page = 0; page < 3; page++) {
    const { data, error } = await base()
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
  const ids = rowsIn.map((r) => r.id);

  // Khoản trả nhà xe của từng chuyến (bỏ khoản trả đơn vị bốc xếp khác) + tình trạng thanh toán
  const lines = new Map<string, CarrierCostLine[]>();
  const pay = new Map<string, { paid_amount: number; remaining_amount: number; pay_status: string; invoice_no: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [cRes, pRes] = await Promise.all([
      supabase.from("shipment_carrier_costs").select("shipment_id, cost_kind, fee_type_id, quantity, unit_price, fuel_pct, amount, supplier_id, note").in("shipment_id", chunk),
      supabase.from("report_carrier_trips").select("id, paid_amount, remaining_amount, pay_status, invoice_no").in("id", chunk),
    ]);
    if (cRes.error) throw cRes.error;
    if (pRes.error) throw pRes.error;
    for (const l of (cRes.data ?? []) as CarrierCostLine[]) {
      if (l.supplier_id && l.supplier_id !== sup.id) continue;
      lines.set(l.shipment_id, [...(lines.get(l.shipment_id) ?? []), l]);
    }
    for (const r of (pRes.data ?? []) as { id: string; paid_amount: number; remaining_amount: number; pay_status: string; invoice_no: string | null }[]) pay.set(r.id, r);
  }

  const [extra, trip, billing] = await Promise.all([dispatchExtraColumns(supabase, perms, rowsIn), loadTripExtras(supabase, rowsIn, false), loadBilling(supabase, rowsIn)]);
  const catalog = buildCatalog(extra.columns, feeTypes, CARRIER_BASE_COLUMNS);
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const sum = (ls: CarrierCostLine[]) => ls.reduce((a, l) => a + Number(l.amount), 0);
  const single = (vals: (number | null)[]) => {
    const d = [...new Set(vals.filter((v): v is number => v !== null && v !== undefined).map(Number))];
    return d.length === 1 ? d[0] : null;
  };
  const rows: StatementRow[] = rowsIn.map((r, i) => {
    const ls = lines.get(r.id) ?? [];
    const fr = ls.filter((l) => l.cost_kind === "freight");
    const isLoading = (l: CarrierCostLine) => l.cost_kind === "other" && Boolean(l.fee_type_id && loadingType.has(l.fee_type_id));
    const frBase = fr.reduce(
      (a, l) => a + (l.quantity != null && l.unit_price != null ? Number(l.quantity) * Number(l.unit_price) : Number(l.amount) / (1 + Number(l.fuel_pct ?? 0) / 100)),
      0,
    );
    const frTotal = sum(fr);
    const qty = fr.filter((l) => l.quantity != null);
    const pm = pay.get(r.id);
    const byFee: Record<string, number> = {};
    for (const l of ls) if (l.fee_type_id) byFee[`fee_${l.fee_type_id}`] = (byFee[`fee_${l.fee_type_id}`] ?? 0) + Number(l.amount);
    const cells: StatementRow["cells"] = {
      stt: i + 1,
      pickup_at: formatDate(r.pickup_at),
      expected_delivery_at: formatDate(r.expected_delivery_at),
      shipment_code: r.shipment_code,
      order_code: r.order_code,
      customer_code: r.customer_code ?? null,
      route_label: statementRouteLabel(r),
      invoice_info:
        invoiceText(r.pickup_location_id ? billing.get(r.pickup_location_id) : null, r.delivery_location_id ? billing.get(r.delivery_location_id) : null) || null,
      pickup_name: r.pickup_name,
      delivery_name: r.delivery_name,
      empty_return_name: r.empty_return_name ?? null,
      offroute_return_name: r.offroute_return_name ?? null,
      vehicle_type_name: r.vehicle_type_name,
      plate_number: r.plate_number,
      driver_name: r.driver_name,
      trip_count: 1,
      ...tripCells(r, trip),
      quantity: num(r.quantity),
      pricing_unit: PRICING_UNITS[r.pricing_unit] ?? r.pricing_unit,
      c_quantity: qty.length ? qty.reduce((a, l) => a + Number(l.quantity), 0) : null,
      c_unit_price: single(fr.map((l) => (l.unit_price == null ? null : Number(l.unit_price)))),
      c_freight_base: fr.length ? Math.round(frBase) : null,
      c_fuel_pct: single(fr.map((l) => (l.fuel_pct == null ? null : Number(l.fuel_pct)))),
      c_fuel_amount: fr.length ? frTotal - Math.round(frBase) : null,
      c_freight: frTotal,
      c_pass_through: sum(ls.filter((l) => l.cost_kind === "pass_through")),
      c_loading: sum(ls.filter(isLoading)),
      c_other: sum(ls.filter((l) => l.cost_kind === "other" && !isLoading(l))),
      c_total: sum(ls),
      c_paid: pm ? Number(pm.paid_amount) : null,
      c_remaining: pm ? Number(pm.remaining_amount) : null,
      c_pay_status: pm ? (PAY_LABEL[pm.pay_status] ?? pm.pay_status) : ls.length ? null : PAY_LABEL.no_cost,
      c_invoice_no: pm?.invoice_no ?? null,
      c_note: [...new Set(ls.map((l) => l.note?.trim()).filter(Boolean))].join("; ") || null,
      ...byFee,
    };
    for (const c of extra.columns) {
      const [text, sortVal] = extra.values[r.id]?.[c.key] ?? ["", null];
      cells[c.key] = c.numeric && typeof sortVal === "number" ? sortVal : text || null;
    }
    return { id: r.id, cells };
  });

  return {
    customer: supplier,
    catalog,
    rows: mergeStatementGroups(rows, rowsIn, catalog),
    truncated,
    notDelivered: notDeliveredRes.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Dùng chung hai bảng kê: hàng hóa (số lượng vận chuyển), ghi chú đơn nội bộ, thông tin xuất hóa đơn
// ---------------------------------------------------------------------------

type TripExtra = { tons: number | null; detail: string | null; orderNote: string | null; cont: string | null };

const fmtQty = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);

/**
 * Ghi chú đơn hàng do GHA nhập khi tạo đơn. Đơn dán từ Excel (sheet COST CONT) có ghi chú tự sinh
 * "Dán từ Excel · Tờ khai ..." nên bỏ phần đó; ghi chú của khách trong file Excel nằm ở ghi chú chuyến, không lấy.
 */
export function internalOrderNote(note: string | null | undefined): string | null {
  const parts = String(note ?? "")
    .split(" · ")
    .map((x) => x.trim())
    .filter(Boolean);
  const fromExcel = parts.includes("Dán từ Excel");
  const keep = parts.filter((x) => x !== "Dán từ Excel" && !(fromExcel && /^Tờ khai /.test(x)));
  return keep.join(" · ") || null;
}

/** Khối lượng một dòng hàng (kg): cân nặng quy đổi, hoặc số lượng khi ĐVT là kg / tấn */
function itemKg(i: { quantity: number | null; unit: string | null; weight_kg: number | null }): number | null {
  if (i.weight_kg !== null && i.weight_kg !== undefined) return Number(i.weight_kg);
  const u = (i.unit ?? "").trim().toLowerCase();
  if (i.quantity === null || i.quantity === undefined) return null;
  if (/^kg$/.test(u)) return Number(i.quantity);
  if (/^(tấn|tan|t|ton|tons)$/.test(u)) return Number(i.quantity) * 1000;
  return null;
}

/** Mã hàng của từng chuyến (tổng tấn + chi tiết "37MK10: 5 tấn, 190K2M: 5 tấn") và ghi chú đơn nội bộ */
async function loadTripExtras(supabase: SupabaseClient, rows: ShipmentListRow[], portal: boolean): Promise<Map<string, TripExtra>> {
  const out = new Map<string, TripExtra>(rows.map((r) => [r.id, { tons: null, detail: null, orderNote: null, cont: null }]));
  // Tài khoản khách không đọc được hàng hóa / đơn hàng gốc
  if (portal || !rows.length) return out;
  const ids = rows.map((r) => r.id);
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter(Boolean))];
  type Item = { shipment_id: string; item_code: string | null; item_name: string | null; quantity: number | null; unit: string | null; weight_kg: number | null };
  const items = new Map<string, Item[]>();
  const notes = new Map<string, string | null>();
  const conts = new Map<string, string | null>();
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const c = ids.slice(i, i + 150);
    jobs.push(
      (async () => {
        for (let page = 0; ; page++) {
          const { data, error } = await supabase
            .from("shipment_items")
            .select("shipment_id, item_code, item_name, quantity, unit, weight_kg")
            .in("shipment_id", c)
            .order("shipment_id")
            .order("line_no")
            .range(page * 1000, page * 1000 + 999);
          if (error) throw error;
          for (const it of (data ?? []) as Item[]) items.set(it.shipment_id, [...(items.get(it.shipment_id) ?? []), it]);
          if ((data ?? []).length < 1000) break;
        }
        const { data, error } = await supabase.from("shipments").select("id, container_no").in("id", c);
        if (error) throw error;
        for (const x of (data ?? []) as { id: string; container_no: string | null }[]) conts.set(x.id, x.container_no?.trim() || null);
      })(),
    );
  }
  for (let i = 0; i < orderIds.length; i += 150) {
    const c = orderIds.slice(i, i + 150);
    jobs.push(
      (async () => {
        const { data, error } = await supabase.from("transport_orders").select("id, notes").in("id", c);
        if (error) throw error;
        for (const o of (data ?? []) as { id: string; notes: string | null }[]) notes.set(o.id, internalOrderNote(o.notes));
      })(),
    );
  }
  await Promise.all(jobs);
  for (const r of rows) {
    const its = items.get(r.id) ?? [];
    const kgs = its.map(itemKg);
    const known = kgs.filter((k): k is number => k !== null);
    const detail = its
      .map((it, k) => {
        const name = it.item_code?.trim() || it.item_name?.trim() || "";
        const kg = kgs[k];
        const qty = kg !== null ? `${fmtQty(Math.round(kg) / 1000)} tấn` : it.quantity !== null ? `${fmtQty(Number(it.quantity))}${it.unit ? ` ${it.unit}` : ""}` : "";
        return [name, qty].filter(Boolean).join(": ");
      })
      .filter(Boolean)
      .join(", ");
    out.set(r.id, {
      tons: known.length ? Math.round(known.reduce((a, k) => a + k, 0)) / 1000 : null,
      detail: detail || null,
      orderNote: r.order_id ? (notes.get(r.order_id) ?? null) : null,
      cont: conts.get(r.id) ?? null,
    });
  }
  return out;
}

function tripCells(r: ShipmentListRow, trip: Map<string, TripExtra>): StatementRow["cells"] {
  const t = trip.get(r.id);
  return {
    container_no: t?.cont ?? null,
    goods_tons: t?.tons ?? null,
    goods_detail: t?.detail ?? null,
    // Ghi chú = ghi chú đơn hàng GHA nhập khi tạo đơn; ghi chú chuyến (khách trong file Excel / cho tài xế) để cột riêng
    notes: t?.orderNote ?? null,
    trip_notes: r.notes ?? null,
  };
}

/** Ô "Địa chỉ xuất hóa đơn" của điểm nhận / điểm giao */
async function loadBilling(supabase: SupabaseClient, rows: ShipmentListRow[]): Promise<Map<string, string | null>> {
  const billing = new Map<string, string | null>();
  const locIds = [...new Set(rows.flatMap((r) => [r.pickup_location_id, r.delivery_location_id]).filter((x): x is string => Boolean(x)))];
  for (let i = 0; i < locIds.length; i += 200) {
    const { data, error } = await supabase.from("locations").select("id, billing_address").in("id", locIds.slice(i, i + 200));
    if (error) throw error;
    for (const l of (data ?? []) as { id: string; billing_address: string | null }[]) billing.set(l.id, l.billing_address);
  }
  return billing;
}
