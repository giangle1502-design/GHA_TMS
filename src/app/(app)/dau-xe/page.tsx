import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadTableView } from "@/lib/entities/server";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import { todayVN } from "@/lib/format";
import type { FuelMonth } from "@/lib/vehicle-fuel";
import { FuelReport } from "./fuel-report";

export const metadata: Metadata = { title: "Dầu theo xe" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("fuel.view");
  const sp = await searchParams;
  const month = typeof sp.thang === "string" && /^\d{4}-\d{2}$/.test(sp.thang) ? sp.thang : todayVN().slice(0, 7);
  const supabase = await createClient();
  const [res, view] = await Promise.all([
    supabase.rpc("fuel_month", { p_month: `${month}-01` }),
    loadTableView(supabase, "vehicle_fuel", me.id),
  ]);
  if (res.error) throw res.error;
  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Dầu theo xe"
        description="Dầu từng xe công ty (xe cont, xe tải trong Phương tiện) theo tháng: trên là tổng, dưới là chi tiết từng xe. Bấm vào ô để nhập số; Giám đốc cân đối thực tế với định mức rồi chốt."
      />
      <FuelReport key={month} month={month} data={res.data as FuelMonth} view={view} />
    </>
  );
}
