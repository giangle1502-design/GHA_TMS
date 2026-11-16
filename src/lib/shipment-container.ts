import type { createClient } from "@/lib/supabase/server";
import type { ShipmentListRow } from "@/lib/shipments";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Gắn Số cont (shipments.container_no) vào các dòng chuyến đang xem, để hiện và sửa nhanh trên bảng
 * Điều phối / Quản lý chuyến. View shipment_list chưa có cột này nên đọc thẳng bảng shipments (theo lô).
 * Lỗi thì bỏ qua, bảng vẫn hiện bình thường (ô Số cont để trống).
 */
export async function attachContainerNo<T extends ShipmentListRow>(supabase: Supabase, rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const ids = [...new Set(rows.map((r) => r.id))];
  const m = new Map<string, string | null>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  const results = await Promise.all(chunks.map((c) => supabase.from("shipments").select("id, container_no").in("id", c)));
  for (const { data, error } of results) {
    if (error) return rows;
    for (const s of data ?? []) m.set(s.id as string, (s.container_no as string | null) ?? null);
  }
  return rows.map((r) => (m.has(r.id) ? { ...r, container_no: m.get(r.id) ?? null } : r));
}

/** Chuẩn hóa số cont người dùng gõ: bỏ khoảng trắng, dấu gạch, chấm; viết hoa */
export function normalizeContainerNo(v: string) {
  return v.toUpperCase().replace(/[\s\-._/]/g, "");
}
