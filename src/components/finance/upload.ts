"use client";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/driver-link/upload";
import { registerDocuments } from "@/lib/finance/actions";

export type StaffFile = { file: File; docType: "photo" | "delivery_note" | "receipt" | "invoice" | "other" };

/** Nhân viên tải chứng từ lên Storage (quyền documents.create kiểm tra trong chính sách Storage) rồi ghi vào bảng chứng từ */
export type DocEntity = "shipment" | "shipment_expense" | "advance_request" | "purchase_request" | "shipment_fee";

/** feeTypeId: bắt buộc với shipment_fee (tệp hóa đơn của một loại phí chi hộ, entityId = id chuyến) */
export async function uploadStaffDocuments(entityType: DocEntity, entityId: string, items: StaffFile[], feeTypeId?: string) {
  const supabase = createClient();
  const files = [];
  for (const it of items) {
    const blob = await compressImage(it.file);
    const mime = blob.type || it.file.type;
    const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/heic" ? "heic" : "jpg";
    const path = `${entityType}/${entityId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("documents").upload(path, blob, { contentType: mime, upsert: false });
    if (error) return { ok: false as const, error: "Tải tệp không thành công: " + it.file.name };
    files.push({ path, name: it.file.name.slice(0, 200), mime: mime as "image/jpeg", size: blob.size, docType: it.docType });
  }
  if (!files.length) return { ok: true as const };
  return registerDocuments({ entityType, entityId, feeTypeId, files });
}
