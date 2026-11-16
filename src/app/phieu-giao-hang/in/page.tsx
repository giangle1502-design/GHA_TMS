import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { parseNoteIds, safeBackHref, type DeliveryNoteData } from "@/lib/delivery-note";
import { DeliveryNoteBatch } from "@/components/delivery-note/delivery-note-batch";

export const metadata: Metadata = { title: "In phiếu giao hàng" };

type SP = Record<string, string | string[] | undefined>;

// In hàng loạt phiếu giao hàng (từ Điều phối / Quản lý chuyến): ?ids=uuid,uuid,...&ve=/dieu-phoi?...
export default async function DeliveryNoteBatchPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePagePermission("shipments.view", "dispatch.view");
  const sp = await searchParams;
  const ids = parseNoteIds(sp.ids);
  const backHref = safeBackHref(sp.ve, "/dieu-phoi");
  const supabase = await createClient();
  const notes: { id: string; d: DeliveryNoteData }[] = [];
  // Đọc theo lô 20 chuyến song song, giữ đúng thứ tự trong danh sách đang xem
  for (let i = 0; i < ids.length; i += 20) {
    const part = ids.slice(i, i + 20);
    const res = await Promise.all(part.map((id) => supabase.rpc("delivery_note", { p_shipment_id: id })));
    res.forEach((r, j) => {
      if (r.error) throw r.error;
      if (r.data) notes.push({ id: part[j], d: r.data as DeliveryNoteData });
    });
  }
  return <DeliveryNoteBatch notes={notes} backHref={backHref} />;
}
