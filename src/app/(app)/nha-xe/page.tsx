import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadTableView } from "@/lib/entities/server";
import { PageHeader } from "@/components/layout/page-header";
import { monthRangeYMD, todayVN } from "@/lib/format";
import { CarrierPortal, type PortalFleet, type PortalShipment, type PortalSupplier } from "./carrier-portal";

export const metadata: Metadata = { title: "Nhà xe 3PL đăng ký xe" };

type SP = Record<string, string | string[] | undefined>;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Cổng nhà xe 3PL (LE 18/11/2026): 3PL thấy chuyến GHA chỉ định cho nhà xe mình, tự nhập số xe, tài xế
 * và chia đơn lớn thành nhiều xe. Không có cước, đơn giá, khách hàng. Điều phối GHA chọn nhà xe để xem / chia hộ.
 */
export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePagePermission("carrier_portal.use", "dispatch.update");
  const sp = await searchParams;
  const month = monthRangeYMD(todayVN());
  let tu = YMD.test(one(sp.tu)) ? one(sp.tu) : month.tu;
  let den = YMD.test(one(sp.den)) ? one(sp.den) : month.den;
  if (den < tu) [tu, den] = [den, tu];
  const all = one(sp.tatca) === "1";
  const supabase = await createClient();
  const supRes = await supabase.rpc("carrier_portal_suppliers");
  if (supRes.error) {
    if (supRes.error.code === "PGRST202" || supRes.error.code === "42883") {
      return (
        <>
          <PageHeader title="Nhà xe 3PL đăng ký xe" />
          <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">Cơ sở dữ liệu chưa nâng cấp Cổng nhà xe 3PL. Nhờ quản trị chạy file SQL 9030 trong Supabase SQL Editor.</p>
        </>
      );
    }
    throw supRes.error;
  }
  const suppliers = (supRes.data ?? []) as PortalSupplier[];
  // Nhân viên điều phối: phải chọn nhà xe; tài khoản 3PL: mặc định mọi nhà xe được gắn
  const staff = me.permissions.has("dispatch.update");
  let sup = UUID.test(one(sp.nx)) && suppliers.some((s) => s.id === one(sp.nx)) ? one(sp.nx) : "";
  if (!sup && suppliers.length === 1) sup = suppliers[0].id;
  const view = await loadTableView(supabase, "carrier_portal", me.id);
  let rows: PortalShipment[] = [];
  let fleet: PortalFleet = { vehicles: [], drivers: [] };
  if (sup || !staff) {
    const [{ data, error }, fleetRes] = await Promise.all([
      supabase.rpc("carrier_portal_shipments", { p_supplier_id: sup || null, p_from: tu, p_to: den, p_open_only: !all }),
      // Xe, tài xế đã nhập lần trước (SQL 9031); chưa nâng cấp thì không gợi ý
      supabase.rpc("carrier_portal_fleet", { p_supplier_id: sup || null }),
    ]);
    if (error) throw error;
    rows = (data ?? []) as PortalShipment[];
    if (!fleetRes.error && fleetRes.data) fleet = fleetRes.data as PortalFleet;
  }
  return (
    <>
      <PageHeader
        title="Nhà xe 3PL đăng ký xe"
        description="Các chuyến GHA giao cho nhà xe. Bấm Đăng ký xe để nhập số xe, tài xế và số lượng từng xe; đơn lớn thì thêm nhiều xe, tổng không vượt số lượng của chuyến. Không nhập tài xế thì ghi Tài xế & 3PL."
      />
      <CarrierPortal tu={tu} den={den} all={all} supplier={sup} suppliers={suppliers} staff={staff} rows={rows} fleet={fleet} view={view} />
    </>
  );
}
