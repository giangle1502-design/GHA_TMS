"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Images, Loader2, Paperclip, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { listDocuments, type DocumentItem } from "@/lib/finance/actions";
import { uploadStaffDocuments, type DocEntity, type StaffFile } from "./upload";

export const DOC_TYPE_LABEL: Record<string, string> = {
  photo: "Ảnh hàng",
  delivery_note: "Phiếu ký nhận",
  receipt: "Biên lai",
  invoice: "Hóa đơn",
  other: "Khác",
};

/** Nút xem chứng từ / ảnh của một bản ghi (ảnh xem qua đường dẫn tạm, không công khai) */
export function DocumentsButton({
  entityType,
  entityId,
  count,
  title,
  canUpload = false,
  variant = "ghost",
  feeTypeId,
  label,
}: {
  entityType: DocEntity;
  entityId: string;
  /** Tệp hóa đơn của một loại phí chi hộ (entityType = shipment_fee, entityId = id chuyến) */
  feeTypeId?: string;
  /** Chữ trên nút (mặc định "Ảnh (n)" / "Chứng từ") */
  label?: string;
  count: number;
  title: string;
  canUpload?: boolean;
  variant?: "ghost" | "outline";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<DocumentItem[] | null>(null);
  const [loading, startLoad] = useTransition();
  const [uploading, startUpload] = useTransition();
  const [docType, setDocType] = useState<StaffFile["docType"]>(entityType === "shipment" ? "delivery_note" : entityType === "shipment_fee" ? "invoice" : "receipt");
  const input = useRef<HTMLInputElement>(null);

  function load() {
    startLoad(async () => {
      const r = await listDocuments(entityType, entityId, feeTypeId);
      if (r.ok) setDocs(r.data ?? []);
      else toast.error(r.error);
    });
  }

  if (!count && !canUpload) return null;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={variant}
        className="h-7 px-2"
        title="Xem ảnh, chứng từ"
        onClick={() => {
          setOpen(true);
          load();
        }}
      >
        {entityType === "shipment_fee" ? <Paperclip className="size-3.5" /> : <Images className="size-3.5" />} {label ?? (count ? `Ảnh (${count})` : "Chứng từ")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Ảnh và chứng từ chỉ xem được khi đăng nhập; đường dẫn tự hết hạn sau 10 phút.</DialogDescription>
          </DialogHeader>
          {loading && !docs ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Đang tải…
            </p>
          ) : docs && docs.length ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {docs.map((d) => (
                <li key={d.id} className="overflow-hidden rounded-lg border">
                  <a href={d.url ?? "#"} target="_blank" rel="noopener noreferrer" className="block">
                    {d.mime_type.startsWith("image/") && d.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.url} alt={d.file_name} className="aspect-square w-full bg-muted object-cover" />
                    ) : (
                      <div className="flex aspect-square items-center justify-center bg-muted">
                        <FileText className="size-8 text-muted-foreground" />
                      </div>
                    )}
                  </a>
                  <div className="p-1.5 text-xs">
                    <div className="font-medium">{DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type}</div>
                    <div className="truncate" title={d.file_name}>
                      {d.file_name}
                    </div>
                    <div className="text-muted-foreground">{formatDateTime(d.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Chưa có chứng từ.</p>
          )}
          {canUpload ? (
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <NativeSelect aria-label="Loại chứng từ" className="h-9 w-auto" value={docType} onChange={(e) => setDocType(e.target.value as StaffFile["docType"])}>
                {Object.entries(DOC_TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
              <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => input.current?.click()}>
                {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Tải ảnh / PDF lên
              </Button>
              <input
                ref={input}
                type="file"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                aria-label="Chọn tệp chứng từ"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []).slice(0, 10);
                  e.target.value = "";
                  if (!files.length) return;
                  if (files.some((f) => f.size > 10 * 1024 * 1024)) return toast.error("Mỗi tệp tối đa 10 MB");
                  startUpload(async () => {
                    const r = await uploadStaffDocuments(entityType, entityId, files.map((file) => ({ file, docType })), feeTypeId);
                    if (!r.ok) return void toast.error(r.error);
                    toast.success("Đã tải chứng từ lên");
                    load();
                    router.refresh();
                  });
                }}
              />
              <span className="text-xs text-muted-foreground">Ảnh JPG/PNG hoặc PDF, tối đa 10 MB mỗi tệp.</span>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
