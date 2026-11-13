import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { EntityListSection, resolveEntityTabs } from "@/components/entities/entity-list-section";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Danh mục hệ thống" };

type SP = Record<string, string | string[] | undefined>;

/**
 * Danh mục phí gộp (người dùng 03/11/2026): tab "Nhóm phí" và "Danh mục phí", mỗi tab chọn Nguồn phí:
 * Thu khách (fee_groups / fee_types), Chi ra (expense_groups / expense_categories) hoặc Tất cả (view gộp, chỉ xem).
 */
const FEE_TABS: Record<string, { customer: string; expense: string }> = {
  fee_catalog_groups: { customer: "fee_groups", expense: "expense_groups" },
  fee_catalog_items: { customer: "fee_types", expense: "expense_categories" },
};
/** Liên kết cũ ?tab=fee_types… vẫn mở đúng chỗ */
const LEGACY: Record<string, [string, "customer" | "expense"]> = {
  fee_groups: ["fee_catalog_groups", "customer"],
  expense_groups: ["fee_catalog_groups", "expense"],
  fee_types: ["fee_catalog_items", "customer"],
  expense_categories: ["fee_catalog_items", "expense"],
};
const SOURCES = [
  { key: "customer", label: "Thu khách", hint: "Tiền thu của khách hàng: cước, phụ thu, chi hộ… Mã TK0001." },
  { key: "expense", label: "Chi ra", hint: "Tiền công ty chi cho chuyến: dầu, cầu đường, bốc xếp… Mã CP0001." },
  { key: "all", label: "Tất cả", hint: "Xem chung hai nguồn. Muốn thêm hoặc sửa thì chọn Thu khách hoặc Chi ra." },
] as const;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePagePermission("catalogs.view");
  const raw = await searchParams;
  const sp: SP = { ...raw };
  const legacy = typeof sp.tab === "string" ? LEGACY[sp.tab] : undefined;
  if (legacy) {
    sp.tab = legacy[0];
    sp.nguon = legacy[1];
  }
  const { active, nav } = await resolveEntityTabs({
    basePath: "/danh-muc",
    searchParams: sp,
    tabs: [
      { key: "vehicle_types" },
      { key: "fee_catalog_groups", label: "Nhóm phí" },
      { key: "fee_catalog_items", label: "Danh mục phí" },
      { key: "declaration_types" },
      { key: "banks" },
      { key: "company_bank_accounts" },
      { key: "payment_methods" },
      { key: "company_entities" },
      { key: "salary_rules" },
      { key: "catalog_items", label: "Danh mục khác" },
      { key: "catalogs", label: "Nhóm danh mục" },
    ],
  });
  const fee = active ? FEE_TABS[active] : undefined;
  const source = SOURCES.find((s) => s.key === sp.nguon)?.key ?? "customer";
  const entityKey = fee ? (source === "all" ? active! : fee[source]) : active;
  return (
    <>
      <PageHeader title="Danh mục hệ thống" description="Các danh mục dùng chung. Mọi thay đổi được ghi vào nhật ký hệ thống." />
      {nav}
      {fee ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Nguồn phí:</span>
          <div className="inline-flex rounded-md border p-0.5">
            {SOURCES.map((s) => (
              <Link
                key={s.key}
                href={`/danh-muc?tab=${active}&nguon=${s.key}`}
                className={cn(
                  "rounded px-3 py-1 text-sm",
                  source === s.key ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </Link>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">{SOURCES.find((s) => s.key === source)?.hint}</span>
        </div>
      ) : null}
      {entityKey ? <EntityListSection key={entityKey} entityKey={entityKey} searchParams={sp} revalidate="/danh-muc" /> : null}
    </>
  );
}
