import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { anonClient, driverLinkToken } from "@/lib/driver-link/server";
import { isUuid } from "@/lib/entities/record";
import { noteBaseName, type DeliveryNoteData } from "@/lib/delivery-note";
import { DeliveryNoteSheet } from "@/components/delivery-note/delivery-note-sheet";
import { DeliveryNoteToolbar } from "@/components/delivery-note/delivery-note-toolbar";

export const metadata: Metadata = { title: "Phiếu giao hàng" };
export const dynamic = "force-dynamic";

// Tài xế chỉ mở được phiếu của chuyến thuộc xe đang đăng nhập (kiểm tra trong driver_link_delivery_note)
export default async function DriverDeliveryNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const token = await driverLinkToken();
  if (!token) redirect("/tx");
  const { data, error } = await anonClient().rpc("driver_link_delivery_note", { p_token: token, p_shipment_id: id });
  if (error) throw error;
  if (!data) notFound();
  const d = data as DeliveryNoteData;
  return (
    <div className="-mx-4 print:m-0">
      <div className="px-4">
        <DeliveryNoteToolbar backHref="/tx" name={noteBaseName(d.delivery_name, d.shipment_code)} />
      </div>
      <DeliveryNoteSheet d={d} />
    </div>
  );
}
