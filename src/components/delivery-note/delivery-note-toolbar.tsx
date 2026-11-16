"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronLeft, Download, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Nút In / Tải PDF cho phiếu giao hàng (một hoặc nhiều phiếu, mỗi phiếu một trang A4). PDF dựng ở trình duyệt (ảnh A4) để chạy được cả trên điện thoại tài xế.
 * name: tên phiếu không đuôi ("SP-ITC - SNOV-0004"). Dùng cho file "Tải PDF" và làm tiêu đề trang, vì trình duyệt lấy tiêu đề trang
 * làm tên file mặc định khi bấm In → "Lưu dưới dạng PDF".
 */
export function DeliveryNoteToolbar({ backHref, name, count = 1 }: { backHref: string; name: string; /** Số phiếu đang hiện (in hàng loạt) */ count?: number }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const prev = document.title;
    document.title = name;
    // Next.js có thể đặt lại tiêu đề sau khi điều hướng: đặt lại ngay trước khi in cho chắc
    const before = () => {
      document.title = name;
    };
    window.addEventListener("beforeprint", before);
    return () => {
      window.removeEventListener("beforeprint", before);
      document.title = prev;
    };
  }, [name]);
  const [progress, setProgress] = useState("");
  const many = count > 1;

  async function downloadPdf() {
    const sheets = Array.from(document.querySelectorAll<HTMLElement>(".dn-sheet"));
    if (!sheets.length) return;
    setBusy(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const margin = 12;
      const w = 210 - margin * 2;
      const maxH = 297 - margin * 2;
      // Mỗi phiếu một trang A4. Dựng bản sao ở khổ A4 (794px ≈ 210mm) ngoài màn hình, để điện thoại màn hẹp vẫn ra đúng bố cục A4
      for (let i = 0; i < sheets.length; i++) {
        const holder = document.createElement("div");
        holder.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;background:#fff;";
        const copy = sheets[i].cloneNode(true) as HTMLElement;
        copy.classList.add("dn-a4");
        holder.appendChild(copy);
        document.body.appendChild(holder);
        let canvas: HTMLCanvasElement;
        try {
          canvas = await html2canvas(copy, { scale: 2, backgroundColor: "#ffffff", windowWidth: 1000 });
        } finally {
          holder.remove();
        }
        const h = (canvas.height * w) / canvas.width;
        const scale = h > maxH ? maxH / h : 1;
        if (i > 0) pdf.addPage("a4", "portrait");
        pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", margin + (w - w * scale) / 2, margin, w * scale, h * scale);
        if (sheets.length > 1) setProgress(`${i + 1}/${sheets.length}`);
      }
      pdf.save(`${name}.pdf`);
    } catch (e) {
      console.error(e);
      toast.error("Không tạo được PDF. Hãy dùng nút In phiếu và chọn “Lưu dưới dạng PDF”.");
    } finally {
      setBusy(false);
      setProgress("");
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
      <Button size="lg" variant="outline" onClick={() => {
          document.title = name;
          window.print();
        }} disabled={count === 0}>
        <Printer /> {many ? `In ${count} phiếu` : "In phiếu"}
      </Button>
      <Button size="lg" onClick={downloadPdf} disabled={busy || count === 0}>
        {busy ? <Loader2 className="animate-spin" /> : <Download />} {busy && progress ? `Đang tạo PDF ${progress}` : many ? `Tải PDF (${count} trang)` : "Tải PDF"}
      </Button>
    </div>
  );
}
