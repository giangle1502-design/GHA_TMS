import type { createClient } from "@/lib/supabase/server";
import type { ShipmentListRow } from "@/lib/shipments";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type PayRow = { id: string; amount: number | null; source: string; override: number | null; note: string | null; can_override: boolean };

/** Nguồn giá lương chuyến hiển thị cho người dùng */
export const PAY_SOURCE_LABEL: Record<string, string> = {
  route: "Theo tuyến",
  place: "Theo địa điểm",
  zone: "Theo vùng",
  default: "Giá mặc định",
  driver_legacy: "Hồ sơ tài xế (cũ)",
  monthly_only: "Lương tháng, không tính chuyến",
  manual: "Sửa tay",
  missing: "Chưa có giá",
};

/** Gắn lương chuyến tài xế (theo đơn giá hoặc sửa tay) vào các dòng chuyến đang xem. Lỗi (CSDL chưa nâng cấp) thì bỏ qua. */
export async function attachDriverPay<T extends ShipmentListRow>(supabase: Supabase, rows: T[]): Promise<T[]> {
  const ids = rows.filter((r) => r.driver_id && r.status !== "cancelled").map((r) => r.id).slice(0, 2000);
  if (!ids.length) return rows;
  const { data, error } = await supabase.rpc("shipment_driver_pay", { p_ids: ids });
  if (error || !data) return rows;
  const m = new Map((data as PayRow[]).map((p) => [p.id, p]));
  return rows.map((r) => {
    const p = m.get(r.id);
    return p
      ? { ...r, driver_pay: p.amount, driver_pay_source: p.source, driver_pay_override: p.override, driver_pay_note: p.note, can_override_pay: p.can_override }
      : r;
  });
}
