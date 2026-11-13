import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ActionError } from "@/lib/auth/action";
import { ENTITIES } from "./definitions";
import { isUuid, rowLabel } from "./record";

export type RefCheck = {
  /** Khóa danh mục được tham chiếu (VD "customers") */
  ref: string;
  /** Giá trị mới chọn */
  id: string | null | undefined;
  /** Giá trị đang lưu: trùng giá trị mới thì bỏ qua (dữ liệu cũ vẫn giữ được) */
  previous?: string | null;
  /** Tên ô, để báo lỗi */
  label: string;
};

/**
 * Chặn chọn MỚI bản ghi đã ngừng hoạt động (VD khách hàng ngừng hoạt động) khi lưu.
 * Ô chọn đã ẩn các bản ghi này; kiểm tra ở đây chặn cả đường nhập khác (Excel, gọi thẳng).
 */
export async function assertActiveRefs(supabase: SupabaseClient, checks: RefCheck[]) {
  const byRef = new Map<string, RefCheck[]>();
  for (const c of checks) {
    if (!c.id || !isUuid(c.id) || c.id === (c.previous ?? null)) continue;
    const ent = ENTITIES[c.ref];
    if (!ent?.activeFilter) continue;
    byRef.set(c.ref, [...(byRef.get(c.ref) ?? []), c]);
  }
  for (const [ref, list] of byRef) {
    const ent = ENTITIES[ref];
    const af = ent.activeFilter!;
    const pk = ent.pk ?? "id";
    const cols = [...new Set([pk, af.col, ...ent.labelCols])].join(",");
    const { data, error } = await supabase
      .from(ent.table)
      .select(cols)
      .in(pk, [...new Set(list.map((c) => c.id!))]);
    if (error) throw error;
    const rows = new Map(((data ?? []) as unknown as Record<string, unknown>[]).map((r) => [String(r[pk]), r]));
    for (const c of list) {
      const row = rows.get(c.id!);
      if (row && row[af.col] !== af.value) {
        throw new ActionError(
          `${c.label} “${rowLabel(ent, row)}” đã ngừng hoạt động nên không chọn được. Nếu cần dùng lại, vào Danh mục chuyển ${ent.singular} sang Đang hoạt động.`,
        );
      }
    }
  }
}
