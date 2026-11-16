"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ClipboardPaste, ImageUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { invoiceDirection, invoiceDirectionHint, invoiceToFormValues, invoiceToTaxInvoiceValues, parseInvoiceText, type ParsedInvoice } from "@/lib/invoice-parse";

/**
 * Dán (Ctrl+V) hoặc chọn ảnh hóa đơn: đọc chữ ngay trên máy, điền ngày, số HĐ, người bán, số lít, đơn giá, tiền, thuế suất.
 * Ảnh KHÔNG được lưu. Người dùng kiểm tra lại rồi bấm Lưu.
 */
export function InvoiceImageFill({
  mode = "invoice",
  autoDirection = false,
  onParsed,
  onFill,
  getNotes,
  disabled,
}: {
  /** invoice = chi phí ngoài chuyến; sale_invoice / purchase_invoice = sổ hóa đơn bán ra / mua vào */
  mode?: "invoice" | "sale_invoice" | "purchase_invoice";
  /** Sổ hóa đơn: tự chọn Mua vào / Bán ra theo vị trí MST của GHA trên hóa đơn (điền thêm trường direction) */
  autoDirection?: boolean;
  /** Gọi sau khi điền (sổ hóa đơn): tìm khách hàng / nhà cung cấp, gợi ý hạng mục */
  onParsed?: (p: ParsedInvoice, dir: "sale" | "purchase") => void | Promise<void>;
  onFill: (values: Record<string, unknown>) => void;
  getNotes: () => string;
  disabled?: boolean;
}) {
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
      if (mode === "invoice") onFill(invoiceToFormValues(p, getNotes()));
      else {
        const cur = mode === "sale_invoice" ? "sale" : "purchase";
        const detected = invoiceDirection(p);
        if (autoDirection) {
          const dir = detected ?? cur;
          onFill({ direction: dir, ...invoiceToTaxInvoiceValues(p, dir, getNotes()) });
          void onParsed?.(p, dir);
          if (dir !== cur) toast.info(dir === "sale" ? "GHA là người bán trên hóa đơn này: đã chọn Bán ra." : "GHA là người mua trên hóa đơn này: đã chọn Mua vào.");
        } else {
          onFill(invoiceToTaxInvoiceValues(p, cur, getNotes()));
          const hint = invoiceDirectionHint(p, cur);
          if (hint) toast.warning(hint);
        }
      }
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
          <b>Dán ảnh hóa đơn (Ctrl+V)</b> hoặc kéo thả ảnh vào đây để tự điền {mode === "invoice" ? "ngày, số HĐ, người bán, số lít, đơn giá, tiền, thuế" : mode === "sale_invoice" ? "ngày, ký hiệu, số HĐ, khách hàng, MST, tiền, thuế" : "ngày, số hóa đơn, thành tiền, VAT"}. Ảnh không được lưu.
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
          {result.vat_label ? ` · Thuế suất ${result.vat_label}` : ""}{mode === "invoice" ? ". Chưa chọn Loại phí, Xe thì chọn thêm." : mode === "sale_invoice" ? ". Chọn thêm Loại hóa đơn." : ". Chọn thêm Hạng mục."}
        </p>
      ) : null}
    </div>
  );
}
