import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import { EntityListSection } from "@/components/entities/entity-list-section";
import { monthRangeYMD, todayVN } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StockReport, type StockRow, type BinOption } from "./stock-report";
import { ShipmentSuggestions, type SuggestionRow } from "./shipment-suggestions";

export const metadata: Metadata = { title: "Kho GHA nhập xuất tồn" };

type SP = Record<string, string | string[] | undefined>;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID = /^[0-9a-f-]{36}$/i;

const TABS = [
  { key: "bao-cao", label: "Báo cáo xuất nhập tồn" },
  { key: "chuyen", label: "Chuyến qua kho chờ lập phiếu" },
  { key: "stock_entries", label: "Phiếu nhập, xuất, tồn đầu kỳ" },
  { key: "warehouse_bins", label: "Vị trí kho" },
  { key: "warehouses", label: "Kho" },
  { key: "warehouse_bin_suppliers", label: "3PL xem tồn kho" },
];

/** Kho GHA (nội bộ): tồn đầu kỳ, phiếu nhập, xuất, chuyển vị trí GHA1 ↔ GHA2, báo cáo xuất nhập tồn để đối chiếu hàng (LE 18/11/2026) */
export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePagePermission("inventory.view");
  const sp = await searchParams;
  const canCreate0 = me.permissions.has("inventory.create");
  // Người chỉ có quyền xem (VD tài khoản nhà xe 3PL) chỉ thấy báo cáo tồn
  const tabs = canCreate0 ? TABS : TABS.filter((t) => t.key === "bao-cao");
  const tab = tabs.find((t) => t.key === one(sp.tab))?.key ?? "bao-cao";
  const month = monthRangeYMD(todayVN());
  let tu = YMD.test(one(sp.tu)) ? one(sp.tu) : month.tu;
  let den = YMD.test(one(sp.den)) ? one(sp.den) : month.den;
  if (den < tu) [tu, den] = [den, tu];
  const canCreate = me.permissions.has("inventory.create");

  let body: React.ReactNode = null;
  if (tab === "bao-cao" || tab === "chuyen") {
    const supabase = await createClient();
    const binsRes = await supabase.from("warehouse_bins").select("id, code, name, warehouse_id, location_id, warehouses(name)").eq("is_active", true).order("sort_order").limit(500);
    if (binsRes.error) throw binsRes.error;
    const bins: BinOption[] = ((binsRes.data ?? []) as unknown as { id: string; code: string; name: string; warehouse_id: string; location_id: string | null; warehouses: { name: string } | null }[]).map(
      (b) => ({ id: b.id, code: b.code, name: b.name, warehouse_id: b.warehouse_id, warehouse_name: b.warehouses?.name ?? "", has_location: Boolean(b.location_id) }),
    );
    if (tab === "bao-cao") {
      const bin = UUID.test(one(sp.vt)) ? one(sp.vt) : "";
      const byBin = one(sp.gop) !== "1";
      const { data, error } = await supabase.rpc("stock_balance_report", { p_from: tu, p_to: den, p_bin_id: bin || null, p_by_bin: byBin });
      if (error) throw error;
      body = <StockReport tu={tu} den={den} bin={bin} byBin={byBin} bins={bins} rows={(data ?? []) as StockRow[]} canCreate={canCreate} />;
    } else {
      const [sugRes, whRes] = await Promise.all([
        supabase
          .from("stock_shipment_suggestions")
          .select("*")
          .gte("trip_date", tu)
          .lte("trip_date", den)
          .order("trip_date", { ascending: false })
          .limit(1000),
        supabase.from("warehouses").select("id, location_id").eq("is_active", true),
      ]);
      if (sugRes.error) throw sugRes.error;
      const linked = bins.some((b) => b.has_location) || (whRes.data ?? []).some((w) => (w as { location_id: string | null }).location_id);
      body = <ShipmentSuggestions tu={tu} den={den} rows={(sugRes.data ?? []) as SuggestionRow[]} bins={bins} linked={linked} canCreate={canCreate} />;
    }
  } else {
    body = <EntityListSection entityKey={tab} searchParams={sp} revalidate="/kho" />;
  }

  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Kho GHA nhập xuất tồn"
        description={
          canCreate0
            ? "Theo dõi hàng trong Kho GHA theo vị trí GHA1, GHA2 và theo công ty chủ hàng: nhập tồn đầu kỳ một lần, sau đó chuyến giao tới / lấy hàng ở kho GHA tự lập phiếu nhập / xuất khi chuyến hoàn thành. Báo cáo xuất nhập tồn theo kỳ để đối chiếu. Tài khoản khách hàng không thấy phần này."
            : "Tồn kho của vị trí được cấp quyền xem."
        }
      />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/kho?tab=${t.key}`}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-4 py-2 text-sm whitespace-nowrap",
              tab === t.key ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {body}
    </>
  );
}
