import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { RouteGapTable, type RouteGap } from "./route-gap-table";

export const metadata: Metadata = { title: "Tuyến chưa có giá lương chuyến" };

/** Gom tuyến (Điểm nhận ↔ Điểm giao) từ các chuyến xe nội bộ để điều phối / kế toán điền giá lương chuyến, không phải tự nhập tuyến */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("dispatch.view", "settlements.view", "settlements.update");
  const sp = await searchParams;
  const days = [30, 90, 180, 365, 730].includes(Number(sp.ngay)) ? Number(sp.ngay) : 365;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("route_pay_gaps", { p_days: days });
  if (error) throw error;
  const canFill = me.permissions.has("dispatch.update") || me.permissions.has("settlements.update");
  const canRates = me.permissions.has("settlements.view") || me.permissions.has("settlements.update");
  return (
    <>
      <PageHeader
        title="Tuyến chưa có giá lương chuyến"
        description="App gom các tuyến Điểm nhận ↔ Điểm giao từ chuyến xe nội bộ (gộp hai chiều), kèm số chuyến và ngày chạy gần nhất. Điền Lương mỗi chuyến cho tuyến chưa có giá rồi bấm Lưu: các chuyến của tuyến đó (cả chuyến cũ chưa lập bảng lương) tự tính theo giá này. Để trống = tiếp tục lấy giá vùng hoặc giá mặc định."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/dieu-phoi">
                <ArrowLeft /> Điều phối
              </Link>
            </Button>
            {canRates ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/luong-tai-xe?tab=trip_pay_rates">Đơn giá lương chuyến</Link>
              </Button>
            ) : null}
          </div>
        }
      />
      <RouteGapTable key={days} rows={(data ?? []) as RouteGap[]} days={days} canFill={canFill} />
    </>
  );
}
