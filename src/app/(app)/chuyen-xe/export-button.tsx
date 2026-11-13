"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportShipments } from "./actions";

export function ExportShipmentsButton({ params }: { params: Record<string, string | string[]> }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await exportShipments(params);
          if (!r.ok || !r.data) return void toast.error(r.ok ? "Không tạo được tệp" : r.error);
          const bytes = Uint8Array.from(atob(r.data.base64), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
          const a = document.createElement("a");
          a.href = url;
          a.download = r.data.filename;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          toast.success(r.data.truncated ? `Đã xuất ${r.data.count} dòng đầu tiên (giới hạn mỗi lần xuất).` : `Đã xuất ${r.data.count} chuyến.`);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Download />} Xuất Excel
    </Button>
  );
}
