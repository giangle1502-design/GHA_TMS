import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { todayVN } from "@/lib/format";
import { COMPANY_DEFAULT, monthRange } from "@/lib/freight-statement";
import { CompactDensity } from "@/components/layout/compact-density";
import { LoadingReport, type LoadingLine, type LoadingTrip } from "./loading-report";

export const metadata: Metadata = { title: "Bốc xếp 3PL" };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Tổng hợp bốc xếp theo đơn vị 3PL và bảng kê bốc xếp (giữ nghiệp vụ như app QLVT cũ) */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("reports.view", "receivables.view");
  if (!me.permissions.has("carriers.view")) redirect("/khong-co-quyen");
  const sp = await searchParams;
  const month = monthRange(todayVN());
  let tu = YMD.test(one(sp.tu)) ? one(sp.tu) : month.tu;
  let den = YMD.test(one(sp.den)) ? one(sp.den) : month.den;
  if (den < tu) [tu, den] = [den, tu];

  const supabase = await createClient();
  const [linesRes, tripsRes, priceRes] = await Promise.all([
    supabase
      .from("report_loading_3pl")
      .select(
        "id, shipment_id, shipment_code, report_date, customer_code, customer_name, plate_number, pickup_name, delivery_name, tons, supplier_id, vendor_name, is_trip_carrier, fee_name, quantity, unit_price, amount, ref_no, note, payable_id, payable_code, pay_status, paid, last_paid_at",
      )
      .gte("report_date", tu)
      .lte("report_date", den)
      .order("report_date")
      .limit(20000),
    supabase
      .from("report_loading_trips")
      .select("id, shipment_code, report_date, customer_code, customer_name, plate_number, pickup_name, delivery_name, tons, loading_revenue, loading_cost, loading_unpaid, loading_lines, vendors")
      .gte("report_date", tu)
      .lte("report_date", den)
      .order("report_date")
      .limit(20000),
    supabase.from("system_settings").select("value").eq("key", "loading.unit_price_per_ton").maybeSingle(),
  ]);
  if (linesRes.error) throw linesRes.error;
  if (tripsRes.error) throw tripsRes.error;

  return (
    <>
      <CompactDensity />
      <LoadingReport
        tu={tu}
        den={den}
        lines={(linesRes.data ?? []) as LoadingLine[]}
        trips={(tripsRes.data ?? []) as LoadingTrip[]}
        company={COMPANY_DEFAULT}
        defaultPrice={Number((priceRes.data as { value?: unknown } | null)?.value ?? 40000) || 40000}
        canPay={me.permissions.has("receivables.pay")}
      />
    </>
  );
}
