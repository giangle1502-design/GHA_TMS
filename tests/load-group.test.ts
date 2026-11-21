import { describe, expect, it } from "vitest";
import { loadGroupCandidates, mergeLoadGroups, mergeStatementGroups } from "@/lib/load-group";
import type { ShipmentListRow } from "@/lib/shipments";
import { BASE_STATEMENT_COLUMNS, type StatementRow } from "@/lib/freight-statement";

const base = {
  sequence_in_order: 1,
  customer_id: "c1",
  customer_name: "VAP",
  customer_code: "VAP",
  pickup_at: "2026-11-20T01:00:00Z",
  expected_delivery_at: null,
  pickup_location_id: "p",
  pickup_name: "KHO NGOẠI QUAN TBS",
  delivery_location_id: "d",
  delivery_name: "Bãi xe GHA",
  vehicle_type_id: null,
  vehicle_type_name: null,
  vehicle_id: "v1",
  plate_number: "61H02648",
  driver_id: "dr",
  driver_name: "A",
  driver_code: "A",
  price_list_id: null,
  pricing_unit: "trip",
  quantity: 1,
  surcharge_amount: 0,
  fuel_support_rate: null,
  fuel_support_base: null,
  fuel_support_amount: 0,
  extra_fee_amount: 0,
  pass_through_amount: 0,
  status: "driver_completed",
  document_status: "pending",
  settlement_status: "open",
  notes: null,
  version: 1,
} as const;

function trip(id: string, code: string, order: string, price: number, group: string | null): ShipmentListRow {
  return {
    ...base,
    id,
    shipment_code: code,
    order_id: `o-${order}`,
    order_code: order,
    unit_price: price,
    freight_amount: price,
    total_revenue: price,
    amount_due: price,
    transport_fee: price,
    load_group_id: group,
  };
}

describe("gộp đơn ghép chung xe", () => {
  const a = trip("1", "SHD-000201", "SHP-1", 2_200_000, "g");
  const b = trip("2", "SHD-000202", "SHP-2", 2_500_000, "g");
  const c = trip("3", "SHD-000203", "SHP-3", 1_000_000, null);

  it("Điều phối / Quản lý chuyến: 2 chuyến cùng nhóm thành 1 dòng, cước cộng lại", () => {
    const out = mergeLoadGroups([a, c, b]);
    expect(out).toHaveLength(2);
    expect(out[0].shipment_code).toBe("SHD-000201 + SHD-000202");
    expect(out[0].order_code).toBe("SHP-1 + SHP-2");
    expect(out[0].transport_fee).toBe(4_700_000);
    expect(out[0].amount_due).toBe(4_700_000);
    expect(out[0].quantity).toBe(1);
    expect(out[0].unit_price).toBe(4_700_000);
    expect(out[0].pickup_name).toBe("KHO NGOẠI QUAN TBS");
    expect(out[0].group_rows?.map((m) => m.id)).toEqual(["1", "2"]);
    expect(out[1].id).toBe("3");
  });

  it("không có nhóm thì giữ nguyên", () => {
    const rows = [a, c].map((r) => ({ ...r, load_group_id: null }));
    expect(mergeLoadGroups(rows)).toBe(rows);
  });

  it("gợi ý ghép: cùng xe, cùng ngày, chưa cùng nhóm", () => {
    const rows = mergeLoadGroups([a, b, c]);
    expect(loadGroupCandidates(rows[0], rows).map((m) => m.id)).toEqual(["3"]);
    const other = { ...c, id: "4", vehicle_id: "v2" };
    expect(loadGroupCandidates(rows[0], [...rows, other]).map((m) => m.id)).toEqual(["3"]);
  });

  it("bảng kê: 1 dòng, tiền cộng, STT đánh lại", () => {
    const row = (r: ShipmentListRow, stt: number): StatementRow => ({
      id: r.id,
      cells: { stt, pickup_at: "20/11/2026", route_label: "KHO NGOẠI QUAN TBS → Bãi xe GHA", plate_number: "61H02648", quantity: 1, unit_price: r.unit_price, transport_fee: r.transport_fee ?? 0, amount_due: r.amount_due, shipment_code: r.shipment_code },
    });
    const out = mergeStatementGroups([row(a, 1), row(b, 2), row(c, 3)], [a, b, c], BASE_STATEMENT_COLUMNS);
    expect(out).toHaveLength(2);
    expect(out[0].cells).toMatchObject({ stt: 1, route_label: "KHO NGOẠI QUAN TBS → Bãi xe GHA", plate_number: "61H02648", quantity: 1, unit_price: 4_700_000, transport_fee: 4_700_000, amount_due: 4_700_000, shipment_code: "SHD-000201 + SHD-000202" });
    expect(out[1].cells.stt).toBe(2);
  });
});
