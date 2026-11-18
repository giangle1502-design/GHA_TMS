import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PriceNav } from "@/components/pricing/price-nav";
import { todayVN } from "@/lib/format";
import type { TruckRateCard } from "@/lib/truck-rate";
import { TruckRates } from "./truck-rates";

export const metadata: Metadata = { title: "Bảng giá xe tải" };

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const me = await requirePagePermission("price_lists.view");
  const { id } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("truck_rate_cards")
    .select("*, customer:customers(name)")
    .order("status")
    .order("effective_from", { ascending: false })
    .order("code");
  const missing = error && /truck_rate_cards/.test(error.message ?? "");
  if (error && !missing) throw error;
  const cards = ((data ?? []) as (TruckRateCard & { customer?: { name: string } | null })[]).map(({ customer, ...c }) => ({
    ...c,
    customer_name: customer?.name ?? null,
  }));
  return (
    <>
      <PageHeader
        title="Bảng giá xe tải"
        description="Cước theo khoảng km × trọng tải, phí bốc xếp theo trọng tải và hệ số hỗ trợ dầu theo giá dầu. Đơn giá chưa dầu = Giá trong bảng ÷ (1 + % dầu đã gồm); Cước = Đơn giá × (1 + % hỗ trợ dầu). Giá nội bộ: tài khoản khách hàng không xem được."
      />
      <PriceNav active="xe-tai" />
      {missing ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Cơ sở dữ liệu chưa có bảng giá xe tải. Chạy file nâng cấp SQL 9022_bang_gia_xe_tai_cont.sql trong Supabase SQL Editor rồi tải lại trang.
        </p>
      ) : (
        <TruckRates
          cards={cards}
          initialId={id ?? null}
          today={todayVN()}
          canCreate={me.permissions.has("price_lists.create")}
          canUpdate={me.permissions.has("price_lists.update")}
          canDelete={me.permissions.has("price_lists.delete")}
        />
      )}
    </>
  );
}
