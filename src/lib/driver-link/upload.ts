"use client";
import { createClient } from "@supabase/supabase-js";

export type UploadKind = "photo" | "delivery_note" | "receipt" | "invoice";

/** Thu nhỏ ảnh chụp từ điện thoại (cạnh dài tối đa 1600px, JPEG) để gửi nhanh khi sóng yếu. */
export async function compressImage(file: File, maxSide = 1600, quality = 0.8): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/heic") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/**
 * Tải ảnh lên thư mục tx/<vé>/ bằng khóa công khai (vai trò ẩn danh).
 * Storage chỉ nhận tệp khi vé còn hạn (kiểm tra trong CSDL), nên không cần khóa bí mật.
 */
export async function uploadWithTicket(ticket: string, items: { file: File; kind: UploadKind }[], onProgress?: (done: number) => void) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let done = 0;
  for (const it of items) {
    const blob = await compressImage(it.file);
    const isPdf = blob.type === "application/pdf";
    const ext = isPdf ? "pdf" : blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : blob.type === "image/heic" ? "heic" : "jpg";
    const path = `tx/${ticket}/${it.kind}-${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("documents").upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
    if (error) throw new Error("Gửi ảnh không thành công, kiểm tra sóng điện thoại rồi thử lại.");
    done += 1;
    onProgress?.(done);
  }
}
