import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadTableView } from "@/lib/entities/server";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import { MissingFees, type MissingFeeRow } from "./missing-fees";

export const metadata: Metadata = { title: "Phí chưa nhập" };

/**
 * Phí bốc xếp và chi hộ chưa nhập: chuyến đã tick "Có chi phí bốc xếp" / "Có chi hộ" khi tạo đơn mà chưa nhập phí.
 * Bấm dòng mở khung nhập phí ngay tại trang, không phải quay lại Điều phối hay Quản lý chuyến xe.
 */
export default async function Page() {
  const me = await requirePagePermission("dispatch.view", "shipments.view", "reports.view");
  const supabase = await createClient();
  const [res, view] = await Promise.all([
    supabase.from("report_missing_fees").select("*").order("pickup_date").limit(2000),
    loadTableView(supabase, "missing_fees", me.id),
  ]);
  const has = (k: string) => me.permissions.has(k as never);
  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Phí bốc xếp, chi hộ chưa nhập"
        description="Chuyến đã tick “Có chi phí bốc xếp” hoặc “Có chi hộ” khi tạo đơn mà chưa nhập phí. Bấm Nhập trên dòng (hoặc bấm vào dòng) để nhập ngay; nhập xong chuyến tự rời danh sách."
      />
      {res.error ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          Chưa đọc được danh sách: cần chạy SQL 9034 (9034_chi_ho_bat_buoc_phi_chua_nhap.sql) trên Supabase. ({res.error.message})
        </p>
      ) : (
        <MissingFees
          rows={(res.data ?? []) as MissingFeeRow[]}
          view={view}
          canEdit={has("dispatch.update") || has("shipments.update") || has("receivables.create")}
          canLoading={has("carriers.view")}
        />
      )}
    </>
  );
}
