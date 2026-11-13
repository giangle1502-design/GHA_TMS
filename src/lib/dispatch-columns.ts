import type { SupabaseClient } from "@supabase/supabase-js";
import { formatValue, moduleCustomFields } from "@/lib/entities/record";
import { loadCustomFields, resolveRefLabels, visibleCustomRows } from "@/lib/entities/server";
import { computeFormula } from "@/lib/formula";
import { formulaVars } from "@/lib/entities/definitions";
import type { FieldDef } from "@/lib/entities/types";
import { DROP_OFF_RE, type ShipmentListRow } from "@/lib/shipments";

/** Cột bổ sung (trường người dùng tự thêm) của bảng Điều phối */
export type DispatchExtraColumn = {
  key: string;
  label: string;
  numeric: boolean;
  /** Trường "Loại hình vận chuyển": hiện sẵn, thay cho cột giữ chỗ */
  serviceKind?: boolean;
  /** Trường "Điểm hạ hàng": hiện thêm một dòng "Hạ hàng: ..." trong ô Tuyến đường */
  dropOff?: boolean;
  source: "shipment" | "order";
  /** Hiện sẵn (mặc định cột bổ sung bị ẩn) */
  visible?: boolean;
};
/** Giá trị theo chuyến: [chữ hiển thị, giá trị để sắp xếp] */
export type DispatchExtraValues = Record<string, Record<string, [string, string | number | null]>>;

/** Nhận ra trường "Loại hình vận chuyển" theo tên trường (cùng quy tắc với form tạo đơn) */
export const SERVICE_KIND_RE = /lo[aạ]i\s*h[iì]nh/i;
const NUMERIC = ["number", "currency", "percent", "formula"];

/**
 * Trường bổ sung của chuyến và của đơn hàng thành cột cho bảng Điều phối,
 * tính sẵn chữ hiển thị ở máy chủ (công thức, lựa chọn, tham chiếu danh mục).
 */
export async function dispatchExtraColumns(supabase: SupabaseClient, perms: Set<string>, rows: ShipmentListRow[]) {
  const [sRows, oRows] = await Promise.all([loadCustomFields(supabase, "shipments"), loadCustomFields(supabase, "transport_orders")]);
  const sDefs = moduleCustomFields("shipments", visibleCustomRows(sRows, perms), perms).filter((d) => d.type !== "file");
  const oDefs = moduleCustomFields("transport_orders", visibleCustomRows(oRows, perms), perms).filter((d) => d.type !== "file");
  const [sRef, oRef] = await Promise.all([
    resolveRefLabels(supabase, sDefs, rows.map((r) => r.custom_fields ?? {})),
    resolveRefLabels(supabase, oDefs, rows.map((r) => r.order_custom_fields ?? {})),
  ]);
  // Chỉ một cột được coi là "Loại hình vận chuyển": ưu tiên trường của chuyến
  const kind = sDefs.find((d) => SERVICE_KIND_RE.test(d.label)) ?? oDefs.find((d) => SERVICE_KIND_RE.test(d.label));
  const dropOff = sDefs.find((d) => DROP_OFF_RE.test(d.label.normalize("NFC"))) ?? oDefs.find((d) => DROP_OFF_RE.test(d.label.normalize("NFC")));
  const columns: DispatchExtraColumn[] = [];
  const values: DispatchExtraValues = Object.fromEntries(rows.map((r) => [r.id, {}]));
  const add = (defs: FieldDef[], source: "shipment" | "order", refs: Record<string, Record<string, string>>) => {
    for (const d of defs) {
      const key = `${source === "shipment" ? "cf" : "ocf"}_${d.key}`;
      columns.push({ key, label: source === "order" && !d.label.toLowerCase().includes("đơn") ? `${d.label} (đơn)` : d.label, numeric: NUMERIC.includes(d.type), serviceKind: d === kind, dropOff: d === dropOff, source });
      for (const r of rows) {
        const custom = (source === "shipment" ? r.custom_fields : r.order_custom_fields) ?? {};
        const raw =
          d.type === "formula" ? computeFormula(d.formula, formulaVars(source === "shipment" ? "shipments" : "transport_orders", r as unknown as Record<string, unknown>, custom)) : custom[d.key];
        const text = formatValue(d, raw, d.type === "reference" && typeof raw === "string" ? refs[d.key]?.[raw] : null);
        const sortVal = NUMERIC.includes(d.type) && typeof raw === "number" ? raw : text || null;
        values[r.id][key] = [text, sortVal];
      }
    }
  };
  add(sDefs, "shipment", sRef);
  add(oDefs, "order", oRef);
  return { columns, values };
}
