"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ClipboardPaste, ImageUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { invoiceToFormValues, parseInvoiceText, type ParsedInvoice } from "@/lib/invoice-parse";

/**
 * Dán (Ctrl+V) hoặc chọn ảnh hóa đơn: đọc chữ ngay trên máy, điền ngày, số HĐ, người bán, số lít, đơn giá, tiền, thuế suất.
 * Ảnh KHÔNG được lưu. Người dùng kiểm tra lại rồi bấm Lưu.
 */
export function InvoiceImageFill({ onFill, getNotes, disabled }: { onFill: (values: Record<string, unknown>) => void; getNotes: () => string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [result, setResult] = useState<ParsedInvoice | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  async function run(file: Blob) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setPct(0);
    try {
      const { ocrInvoiceText } = await import("@/lib/ocr-invoice");
      const text = await ocrInvoiceText(file, (p) => setPct(Math.round(p * 100)));
      const p = parseInvoiceText(text);
      setResult(p);
      if (!p.found.length) {
        toast.error("Không đọc được thông tin hóa đơn. Hãy dán ảnh rõ hơn (chụp nguyên hóa đơn, không bị mờ).");
        return;
      }
      onFill(invoiceToFormValues(p, getNotes()));
      toast.success(`Đã điền: ${p.found.join(", ")}. Kiểm tra lại trước khi lưu.`);
    } catch (e) {
      console.error(e);
      toast.error("Không đọc được ảnh. Lần đầu cần mạng để tải bộ đọc chữ (vài MB).");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Dán ảnh ở bất kỳ đâu trong biểu mẫu
  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      void run(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  return (
    <div
      className="rounded-md border border-dashed bg-muted/30 p-2.5 text-sm"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
        if (f) void run(f);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardPaste className="size-4 text-muted-foreground" />
        <span className="flex-1">
          <b>Dán ảnh hóa đơn (Ctrl+V)</b> hoặc kéo thả ảnh vào đây để tự điền ngày, số HĐ, người bán, số lít, đơn giá, tiền, thuế. Ảnh không được lưu.
        </span>
        <Button type="button" variant="outline" size="sm" disabled={busy || disabled} onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 className="animate-spin" /> : <ImageUp />} {busy ? `Đang đọc… ${pct}%` : "Chọn ảnh"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void run(f);
          }}
        />
      </div>
      {result && result.found.length ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Đọc được: {result.found.join(", ")}
          {result.total !== null ? ` · Tổng thanh toán trên HĐ ${formatNumber(result.total)} đ` : ""}
          {result.vat_label ? ` · Thuế suất ${result.vat_label}` : ""}. Chưa chọn Loại phí, Xe thì chọn thêm.
        </p>
      ) : null}
    </div>
  );
}
