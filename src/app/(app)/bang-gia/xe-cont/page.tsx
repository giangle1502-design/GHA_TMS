import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { PriceNav } from "@/components/pricing/price-nav";
import { todayVN } from "@/lib/format";
import { monthRange } from "@/lib/freight-statement";
import { ContainerPrices, type ContainerPriceRow } from "./container-prices";

export const metadata: Metadata = { title: "Bảng giá xe cont" };

export default async function Page() {
  const me = await requirePagePermission("price_lists.view");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("container_price_lists")
    .select(
      "id, customer_id, pickup_location_id, delivery_location_id, empty_return_location_id, container_size, unit_price, fuel_support_rate, carrier_unit_price, source, trip_count, price_min, price_max, last_trip_date, last_shipment_code, effective_from, status, notes, updated_at, customer:customers(code, name), pickup:locations!container_price_lists_pickup_location_id_fkey(name), delivery:locations!container_price_lists_delivery_location_id_fkey(name), empty:locations!container_price_lists_empty_return_location_id_fkey(name)",
    )
    .limit(5000);
  const missing = error && /container_price_lists/.test(error.message ?? "");
  if (error && !missing) throw error;
  type Raw = Omit<ContainerPriceRow, "customer_code" | "customer_name" | "pickup_name" | "delivery_name" | "empty_return_name"> & {
    customer: { code: string | null; name: string } | null;
    pickup: { name: string } | null;
    delivery: { name: string } | null;
    empty: { name: string } | null;
  };
  const rows: ContainerPriceRow[] = ((data ?? []) as unknown as Raw[])
    .map(({ customer, pickup, delivery, empty, ...r }) => ({
      ...r,
      unit_price: Number(r.unit_price),
      fuel_support_rate: r.fuel_support_rate === null ? null : Number(r.fuel_support_rate),
      carrier_unit_price: r.carrier_unit_price === null ? null : Number(r.carrier_unit_price),
      price_min: r.price_min === null ? null : Number(r.price_min),
      price_max: r.price_max === null ? null : Number(r.price_max),
      customer_code: customer?.code ?? null,
      customer_name: customer?.name ?? "",
      pickup_name: pickup?.name ?? "",
      delivery_name: delivery?.name ?? "",
      empty_return_name: empty?.name ?? null,
    }))
    .sort((a, b) =>
      [a.customer_name, a.pickup_name, a.delivery_name, a.empty_return_name ?? "", a.container_size ?? ""]
        .join("|")
        .localeCompare([b.customer_name, b.pickup_name, b.delivery_name, b.empty_return_name ?? "", b.container_size ?? ""].join("|"), "vi"),
    );
  const month = monthRange(todayVN());
  return (
    <>
      <PageHeader
        title="Bảng giá xe cont"
        description="Đơn giá CHƯA hỗ trợ dầu theo Khách hàng + Điểm nhận + Điểm giao + Điểm hạ rỗng + cỡ cont. Bấm Lấy giá từ chuyến đã chạy để tạo hoặc cập nhật bảng giá từ cước GHA đã nhập trên các chuyến cont. Cước = Đơn giá × (1 + % hỗ trợ dầu)."
      />
      <PriceNav active="xe-cont" />
      {missing ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Cơ sở dữ liệu chưa có bảng giá xe cont. Chạy file nâng cấp SQL 9022_bang_gia_xe_tai_cont.sql trong Supabase SQL Editor rồi tải lại trang.
        </p>
      ) : (
        <ContainerPrices
          rows={rows}
          defaultRange={month}
          canWrite={me.permissions.has("price_lists.create") && me.permissions.has("price_lists.update")}
          canUpdate={me.permissions.has("price_lists.update")}
          canDelete={me.permissions.has("price_lists.delete")}
          show3pl={me.permissions.has("carriers.view")}
        />
      )}
    </>
  );
}
