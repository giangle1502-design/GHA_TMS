import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/entities/record";
import { noteFileName, safeBackHref, type DeliveryNoteData } from "@/lib/delivery-note";
import { DeliveryNoteSheet } from "@/components/delivery-note/delivery-note-sheet";
import { DeliveryNoteToolbar } from "@/components/delivery-note/delivery-note-toolbar";
import { DeliveryNoteBatch } from "@/components/delivery-note/delivery-note-batch";
import { loadYardConfirm } from "@/lib/delivery-note-confirm";

export const metadata: Metadata = { title: "Phiếu giao hàng" };

// Trang in riêng (không có menu) để bản in/PDF chỉ có phiếu
export default async function DeliveryNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  await requirePagePermission("shipments.view", "dispatch.view");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delivery_note", { p_shipment_id: id });
  if (error) throw error;
  if (!data) notFound();
  const d = data as DeliveryNoteData;
  // ?mau=xac-nhan: hàng giao về Bãi xe GHA, in kèm dấu ĐÃ NHẬN HÀNG
  if (sp.mau === "xac-nhan") {
    const notes = [{ id, d }];
    return <DeliveryNoteBatch notes={notes} backHref={safeBackHref(sp.ve, `/chuyen-xe/${id}`)} confirm={await loadYardConfirm(supabase, notes)} />;
  }
  return (
    <div className="min-h-screen bg-muted/50 p-4 print:bg-white print:p-0">
      <DeliveryNoteToolbar backHref={safeBackHref(sp.ve, `/chuyen-xe/${id}`)} fileName={noteFileName(d.shipment_code)} />
      <DeliveryNoteSheet d={d} />
    </div>
  );
}
