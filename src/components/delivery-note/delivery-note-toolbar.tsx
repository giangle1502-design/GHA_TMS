"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronLeft, Download, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Nút In / Tải PDF cho phiếu giao hàng. PDF dựng ở trình duyệt (ảnh A4) để chạy được cả trên điện thoại tài xế. */
export function DeliveryNoteToolbar({ backHref, fileName }: { backHref: string; fileName: string }) {
  const [busy, setBusy] = useState(false);

  async function downloadPdf() {
    const el = document.querySelector<HTMLElement>(".dn-sheet");
    if (!el) return;
    setBusy(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
      // Dựng bản sao ở khổ A4 (794px ≈ 210mm) ngoài màn hình, để điện thoại màn hẹp vẫn ra đúng bố cục A4
      const holder = document.createElement("div");
      holder.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;background:#fff;";
      const copy = el.cloneNode(true) as HTMLElement;
      copy.classList.add("dn-a4");
      holder.appendChild(copy);
      document.body.appendChild(holder);
      let canvas: HTMLCanvasElement;
      try {
        canvas = await html2canvas(copy, { scale: 2, backgroundColor: "#ffffff", windowWidth: 1000 });
      } finally {
        holder.remove();
      }
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const margin = 12;
      const w = 210 - margin * 2;
      const h = (canvas.height * w) / canvas.width;
      const maxH = 297 - margin * 2;
      const scale = h > maxH ? maxH / h : 1;
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", margin + (w - w * scale) / 2, margin, w * scale, h * scale);
      pdf.save(fileName);
    } catch (e) {
      console.error(e);
      toast.error("Không tạo được PDF. Hãy dùng nút In phiếu và chọn “Lưu dưới dạng PDF”.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center gap-2 print:hidden">
      <Button asChild variant="outline" size="lg">
        <Link href={backHref}>
          <ChevronLeft /> Quay lại
        </Link>
      </Button>
      <div className="flex-1" />
      <Button size="lg" variant="outline" onClick={() => window.print()}>
        <Printer /> In phiếu
      </Button>
      <Button size="lg" onClick={downloadPdf} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Download />} Tải PDF
      </Button>
    </div>
  );
}
