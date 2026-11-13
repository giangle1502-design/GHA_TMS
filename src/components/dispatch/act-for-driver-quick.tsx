"use client";
import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Flag, Loader2, Play, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { actForDriver } from "@/app/(app)/dieu-phoi/actions";

/** Nút làm thay tài xế ngay trên dòng Điều phối: Nhận thay → Bắt đầu chạy → Hoàn thành (mở chi tiết chuyến) */
export function ActForDriverQuick({ shipmentId, code, status }: { shipmentId: string; code: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (step: "accept" | "start") =>
    start(async () => {
      const r = await actForDriver({ shipmentId, step });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      router.refresh();
    });

  if (status === "assigned")
    return (
      <Button variant="ghost" size="sm" className="h-7 px-2" disabled={pending} title={`Nhận đơn thay tài xế chuyến ${code}`} onClick={() => run("accept")}>
        {pending ? <Loader2 className="animate-spin" /> : <UserCheck />} Nhận thay
      </Button>
    );
  if (status === "accepted")
    return (
      <Button variant="ghost" size="sm" className="h-7 px-2" disabled={pending} title={`Bắt đầu chạy thay tài xế chuyến ${code}`} onClick={() => run("start")}>
        {pending ? <Loader2 className="animate-spin" /> : <Play />} Bắt đầu chạy
      </Button>
    );
  if (status === "in_transit")
    return (
      <Button asChild variant="ghost" size="sm" className="h-7 px-2" title={`Hoàn thành chuyến ${code} thay tài xế (nhập kết quả giao, chứng từ)`}>
        <Link href={`/chuyen-xe/${shipmentId}#lam-thay`}>
          <Flag /> Hoàn thành
        </Link>
      </Button>
    );
  return null;
}
