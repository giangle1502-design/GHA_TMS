import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { todayVN } from "@/lib/format";
import { AttendanceGrid, type AttendanceMonth } from "./attendance-grid";

export const metadata: Metadata = { title: "Chấm công tài xế" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePagePermission("dispatch.view", "settlements.view", "settlements.update");
  const sp = await searchParams;
  const raw = typeof sp.thang === "string" && /^\d{4}-\d{2}$/.test(sp.thang) ? sp.thang : todayVN().slice(0, 7);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("attendance_month", { p_month: `${raw}-01` });
  if (error) throw error;
  return (
    <>
      <PageHeader
        title="Chấm công tài xế"
        description="Ngày nhận hàng của chuyến điều phối đã chỉ định cho tài xế (xe nội bộ) được tự chấm công; chuyến nhiều ngày cộng theo cột Số ngày giao ở Điều phối. Chuyến hủy hoặc đổi tài xế thì tự bỏ. Ô vàng là ngày đã qua mà không có chuyến, không có đơn nghỉ: điều phối chọn ô rồi xác nhận. Ngày nghỉ tuần, ngày lễ đặt ở Lương tài xế → Hướng dẫn, thiết lập chung."
      />
      <AttendanceGrid key={raw} month={raw} data={data as AttendanceMonth} today={todayVN()} />
    </>
  );
}
