import type { SupabaseClient } from "@supabase/supabase-js";
import { isGhaYard, noteTimeText, type DeliveryNoteData } from "@/lib/delivery-note";

/**
 * Bản xác nhận đã nhận hàng cho chuyến giao về Bãi xe GHA: mã chuyến -> giờ nhận (theo lúc giao xong, hoặc lúc đến điểm giao).
 * Chuyến không giao về Bãi xe GHA thì không có trong kết quả (in phiếu thường).
 */
export async function loadYardConfirm(supabase: SupabaseClient, notes: { id: string; d: DeliveryNoteData }[]): Promise<Record<string, string>> {
  const yard = notes.filter((n) => isGhaYard(n.d.delivery_name) || isGhaYard(n.d.delivery_company));
  const out: Record<string, string> = {};
  for (let i = 0; i < yard.length; i += 200) {
    const part = yard.slice(i, i + 200);
    const { data, error } = await supabase
      .from("shipments")
      .select("id, completed_at, arrived_delivery_at")
      .in("id", part.map((n) => n.id));
    if (error) throw error;
    const at = new Map(((data ?? []) as { id: string; completed_at: string | null; arrived_delivery_at: string | null }[]).map((r) => [r.id, r.completed_at ?? r.arrived_delivery_at]));
    for (const n of part) out[n.id] = noteTimeText(at.get(n.id));
  }
  return out;
}

/** Điền tên điểm nhận (locations.name) vào từng phiếu, chỉ để đặt tên file PDF "<Điểm nhận> - <Mã chuyến>". Không in lên phiếu. */
export async function loadPickupNames(supabase: SupabaseClient, notes: { id: string; d: DeliveryNoteData }[]): Promise<void> {
  for (let i = 0; i < notes.length; i += 200) {
    const part = notes.slice(i, i + 200);
    const { data, error } = await supabase
      .from("shipments")
      .select("id, pickup:locations!shipments_pickup_location_id_fkey(name)")
      .in("id", part.map((n) => n.id));
    if (error) throw error;
    const rows = (data ?? []) as unknown as { id: string; pickup: { name: string | null } | { name: string | null }[] | null }[];
    const names = new Map(rows.map((r) => [r.id, (Array.isArray(r.pickup) ? r.pickup[0]?.name : r.pickup?.name) ?? null]));
    for (const n of part) n.d.pickup_name = names.get(n.id) ?? null;
  }
}
