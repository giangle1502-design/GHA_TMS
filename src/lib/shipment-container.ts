import type { createClient } from "@/lib/supabase/server";
import type { ShipmentListRow } from "@/lib/shipments";
import { attachDriverPay } from "@/lib/driver-pay";

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

/**
 * Gắn cùng lúc lương chuyến tài xế và Số cont (hai truy vấn chạy song song thay vì nối tiếp).
 * Cả hai hàm giữ nguyên thứ tự và số dòng nên ghép theo vị trí.
 */
export async function attachPayAndContainer<T extends ShipmentListRow>(supabase: Supabase, rows: T[]): Promise<T[]> {
  if (!rows.length) return rows;
  const [paid, withCont] = await Promise.all([attachDriverPay(supabase, rows), attachContainerNo(supabase, rows)]);
  return paid.map((r, i) => {
    const c = withCont[i];
    return c && c.id === r.id && "container_no" in c ? { ...r, container_no: c.container_no } : r;
  });
}
