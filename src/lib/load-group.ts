// Hai (nhiều) đơn ghép chung một xe: mỗi đơn vẫn là một chuyến, các chuyến cùng xe, cùng lượt có chung
// shipments.load_group_id (SQL 9032, 9035). Điều phối, Quản lý chuyến, bảng kê gộp các chuyến này thành 1 dòng.
// Dùng chung cho máy chủ và trình duyệt nên KHÔNG đặt "use client" / "server-only" ở đây.
import type { ShipmentListRow } from "@/lib/shipments";
import type { StatementColumn, StatementRow } from "@/lib/freight-statement";

/** Dòng trên bảng: dòng gộp có group_rows = các chuyến trong nhóm (chuyến đầu là chuyến đại diện) */
export type GroupedShipmentRow = ShipmentListRow & { group_rows?: ShipmentListRow[] };

/** Cột số tiền / số lượng được cộng lại ở dòng gộp */
const SUM_KEYS = [
  "quantity",
  "freight_amount",
  "surcharge_amount",
  "fuel_support_amount",
  "total_revenue",
  "extra_fee_amount",
  "pass_through_amount",
  "amount_due",
  "transport_fee",
  "pass_through_fee",
  "declaration_fee",
  "loading_fee",
  "other_fee",
  "trip_cost",
  "vehicle_cost",
  "profit",
  "driver_pay",
] as const;

/** Cột chữ: nối các giá trị khác nhau của nhóm */
const JOIN_KEYS: { key: keyof ShipmentListRow; sep: string }[] = [
  { key: "shipment_code", sep: " + " },
  { key: "order_code", sep: " + " },
  { key: "customer_code", sep: ", " },
  { key: "customer_name", sep: ", " },
  { key: "pickup_name", sep: " + " },
  { key: "delivery_name", sep: " + " },
  { key: "empty_return_name", sep: " + " },
  { key: "offroute_return_name", sep: " + " },
  { key: "container_no", sep: ", " },
  { key: "notes", sep: "; " },
];

const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Các giá trị khác nhau (bỏ trống) của một cột, theo thứ tự chuyến */
export function distinctValues<T>(list: T[], get: (r: T) => unknown): string[] {
  const out: string[] = [];
  for (const r of list) {
    const v = get(r);
    if (v === null || v === undefined || v === "") continue;
    const s = String(v);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Gộp các chuyến của một nhóm xe thành 1 dòng (chuyến đầu làm đại diện: id, xe, tài xế, trạng thái) */
export function mergeShipmentGroup(members: ShipmentListRow[]): GroupedShipmentRow {
  const first = members[0];
  if (members.length < 2) return first;
  const out: GroupedShipmentRow = { ...first, group_rows: members };
  const rec = out as unknown as Record<string, unknown>;
  for (const k of SUM_KEYS) {
    const vals = members.map((m) => n((m as unknown as Record<string, unknown>)[k]));
    rec[k] = vals.every((v) => v === null) ? (first as unknown as Record<string, unknown>)[k] : vals.reduce<number>((a, v) => a + (v ?? 0), 0);
  }
  for (const { key, sep } of JOIN_KEYS) {
    const vals = distinctValues(members, (m) => m[key]);
    rec[key] = vals.length ? vals.join(sep) : first[key];
  }
  // Đơn giá: tính theo chuyến thì cộng (SL 1 chuyến); cùng đơn giá thì giữ; khác nhau thì để trống
  const units = distinctValues(members, (m) => m.pricing_unit);
  const prices = distinctValues(members, (m) => Number(m.unit_price) || 0);
  if (units.length === 1 && units[0] === "trip") {
    rec.unit_price = members.reduce((a, m) => a + (Number(m.unit_price) || 0), 0);
    rec.quantity = Math.max(...members.map((m) => Number(m.quantity) || 0));
  } else if (prices.length !== 1 || units.length !== 1) {
    rec.unit_price = 0;
  }
  const rates = distinctValues(members, (m) => m.fuel_support_rate);
  if (rates.length > 1) rec.fuel_support_rate = null;
  if (out.route_label !== undefined) {
    const routes = distinctValues(members, (m) => m.route_label);
    rec.route_label = routes.length ? routes.join(" + ") : first.route_label;
  }
  return out;
}

/**
 * Gộp các chuyến chung nhóm xe (load_group_id) thành 1 dòng, giữ thứ tự: dòng gộp đứng ở vị trí chuyến đầu tiên của nhóm.
 * Chuyến không có nhóm, hoặc nhóm chỉ còn 1 chuyến trong danh sách, giữ nguyên.
 */
export function mergeLoadGroups<T extends ShipmentListRow>(rows: T[]): GroupedShipmentRow[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.load_group_id || r.status === "cancelled") continue;
    const g = groups.get(r.load_group_id);
    if (g) g.push(r);
    else groups.set(r.load_group_id, [r]);
  }
  if (![...groups.values()].some((g) => g.length > 1)) return rows;
  const out: GroupedShipmentRow[] = [];
  const done = new Set<string>();
  for (const r of rows) {
    const g = r.load_group_id && r.status !== "cancelled" ? groups.get(r.load_group_id) : undefined;
    if (!g || g.length < 2) {
      out.push(r);
      continue;
    }
    if (done.has(r.load_group_id!)) continue;
    done.add(r.load_group_id!);
    const members = [...g].sort((a, b) => a.shipment_code.localeCompare(b.shipment_code, "vi", { numeric: true }));
    out.push(mergeShipmentGroup(members));
  }
  return out;
}

/**
 * Dòng gộp tính cước theo mã chuyến (ĐVT chuyến, SQL 9036): chuyến đầu giữ đơn giá, các chuyến ghép thêm bằng 0
 * → hiện và sửa một đơn giá (của chuyến đầu). Nhóm tính theo tấn/km, hoặc chưa chuẩn hóa (còn 2 đơn giá) thì hiện từng chuyến.
 */
export function tripPriced(r: GroupedShipmentRow): boolean {
  const list = rowMembers(r);
  return list.every((m) => m.pricing_unit === "trip") && list.slice(1).every((m) => !Number(m.unit_price) && !Number(m.surcharge_amount) && !Number(m.fuel_support_amount));
}

/** Chuyến đầu (đại diện) của dòng */
export function groupHead(r: GroupedShipmentRow): ShipmentListRow {
  return rowMembers(r)[0];
}

/** Các chuyến của một dòng (dòng gộp: mọi chuyến trong nhóm; dòng thường: chính nó) */
export function rowMembers(r: GroupedShipmentRow): ShipmentListRow[] {
  return r.group_rows?.length ? r.group_rows : [r];
}

/** Ngày nhận hàng theo giờ Việt Nam (YYYY-MM-DD) */
function dayVN(iso: string) {
  return new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Chuyến ghép chung xe được với dòng r: cùng số xe, cùng ngày nhận, chưa hủy, chưa cùng nhóm.
 * Dùng để hiện nút "Ghép chung xe" trên bảng.
 */
export function loadGroupCandidates(r: GroupedShipmentRow, all: GroupedShipmentRow[]): ShipmentListRow[] {
  if (!r.vehicle_id || r.status === "cancelled") return [];
  const mine = new Set(rowMembers(r).map((m) => m.id));
  const day = dayVN(r.pickup_at);
  const out: ShipmentListRow[] = [];
  for (const x of all) {
    for (const m of rowMembers(x)) {
      if (mine.has(m.id) || m.status === "cancelled" || m.vehicle_id !== r.vehicle_id || dayVN(m.pickup_at) !== day) continue;
      if (r.load_group_id && m.load_group_id === r.load_group_id) continue;
      out.push(m);
    }
  }
  return out;
}

/**
 * Hai (nhiều) đơn ghép chung một xe (cùng shipments.load_group_id): bảng kê hiện 1 dòng.
 * Tiền cộng lại; SL cộng lại (tính theo chuyến thì vẫn 1 chuyến, đơn giá cộng lại); chữ khác nhau thì nối; STT đánh lại.
 */
export function mergeStatementGroups(
  rows: StatementRow[],
  source: { id: string; load_group_id?: string | null; pricing_unit: string }[],
  catalog: StatementColumn[],
): StatementRow[] {
  const groupOf = new Map(source.map((r) => [r.id, r.load_group_id ?? null]));
  const unitOf = new Map(source.map((r) => [r.id, r.pricing_unit]));
  const groups = new Map<string, StatementRow[]>();
  for (const r of rows) {
    const g = groupOf.get(r.id);
    if (!g) continue;
    const list = groups.get(g);
    if (list) list.push(r);
    else groups.set(g, [r]);
  }
  if (![...groups.values()].some((l) => l.length > 1)) return rows;
  const kindOf = new Map(catalog.map((c) => [c.key, c.kind]));
  const out: StatementRow[] = [];
  const done = new Set<string>();
  for (const r of rows) {
    const g = groupOf.get(r.id);
    const list = g ? groups.get(g) : undefined;
    if (!list || list.length < 2) {
      out.push(r);
      continue;
    }
    if (done.has(g!)) continue;
    done.add(g!);
    const keys = new Set(list.flatMap((x) => Object.keys(x.cells)));
    const cells: StatementRow["cells"] = {};
    const perTrip = list.every((x) => unitOf.get(x.id) === "trip");
    for (const k of keys) {
      const vals = list.map((x) => x.cells[k] ?? null);
      const kind = kindOf.get(k) ?? (k.startsWith("fee_") ? "money" : "text");
      const nums = vals.filter((v): v is number => typeof v === "number");
      const distinct = [...new Set(vals.filter((v) => v !== null && v !== "").map(String))];
      if (k === "quantity") cells[k] = nums.length ? (perTrip ? Math.max(...nums) : nums.reduce((a, v) => a + v, 0)) : null;
      else if (k === "unit_price") cells[k] = perTrip ? nums.reduce((a, v) => a + v, 0) : distinct.length === 1 ? vals.find((v) => v !== null) ?? null : null;
      else if (kind === "money" || (kind === "number" && nums.length === vals.filter((v) => v !== null && v !== "").length && nums.length > 0))
        cells[k] = nums.length ? nums.reduce((a, v) => a + v, 0) : null;
      else if (kind === "percent" || kind === "price") cells[k] = distinct.length === 1 ? vals.find((v) => v !== null) ?? null : null;
      else if (kind === "index") cells[k] = vals[0];
      else cells[k] = distinct.length ? distinct.join(k === "shipment_code" || k === "order_code" ? " + " : k === "notes" || k === "invoice_info" ? "; " : ", ") : null;
    }
    out.push({ id: list[0].id, cells });
  }
  out.forEach((r, i) => {
    if ("stt" in r.cells) r.cells.stt = i + 1;
  });
  return out;
}
