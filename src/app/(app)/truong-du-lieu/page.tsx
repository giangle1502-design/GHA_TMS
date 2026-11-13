import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";
import { CUSTOM_FIELD_MODULES, ENTITIES, FORMULA_SYSTEM_FIELDS, FORM_SYSTEM_FIELDS } from "@/lib/entities/definitions";
import { loadCustomFields, loadFormConfig } from "@/lib/entities/server";
import { applyLayout, systemFieldEditable } from "@/lib/entities/record";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { FieldManager } from "./field-manager";
import type { LayoutItem } from "./form-layout-card";
import { SystemFieldsCard, type SystemFieldInfo } from "./system-fields-card";

export const metadata: Metadata = { title: "Quản lý trường dữ liệu" };

const TYPE_LABEL: Record<string, string> = {
  text: "Văn bản", textarea: "Văn bản dài", number: "Số", currency: "Tiền tệ", percent: "Phần trăm", date: "Ngày",
  datetime: "Ngày giờ", select: "Danh sách", multiselect: "Chọn nhiều", boolean: "Có/Không", email: "Email",
  phone: "Điện thoại", url: "Đường dẫn", reference: "Liên kết", gps: "GPS",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ module?: string; them?: string }> }) {
  const me = await requirePagePermission("fields.view", "fields.configure");
  const { module: mp, them } = await searchParams;
  const mod = CUSTOM_FIELD_MODULES.find((m) => m.module === mp) ?? CUSTOM_FIELD_MODULES[0];
  const supabase = await createClient();
  const [custom, { order: layout, system: settings }] = await Promise.all([loadCustomFields(supabase, mod.module, true), loadFormConfig(supabase, mod.module)]);
  const entity = mod.entity ? ENTITIES[mod.entity] : undefined;
  const systemForm = entity ? entity.fields.filter((f) => !f.hideInForm && f.key !== entity.parentKey) : (FORM_SYSTEM_FIELDS[mod.module] ?? []);
  const layoutDefaults: LayoutItem[] = [
    ...systemForm.map((f) => ({ key: f.key, label: settings[f.key]?.label || f.label, system: true })),
    ...custom
      .filter((r) => r.status === "active")
      .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label, "vi"))
      .map((r) => ({ key: r.field_key, label: r.label, system: false })),
  ];
  const systemInfo: SystemFieldInfo[] = entity
    ? entity.fields
        .filter((f) => f.key !== entity.parentKey)
        .map((f) => {
          const can = systemFieldEditable(f);
          return {
            key: f.key, label: f.label, typeLabel: TYPE_LABEL[f.type] ?? f.type, help: f.help ?? "", required: Boolean(f.required),
            list: Boolean(f.list), canRequire: can.required, canHide: can.hidden, hasTable: true,
            options: f.type === "select" || f.type === "multiselect" ? (f.options ?? []).map((o) => ({ value: o.value, label: o.label })) : [],
          };
        })
    : (FORM_SYSTEM_FIELDS[mod.module] ?? []).map((f) => ({
        key: f.key, label: f.label, typeLabel: "—", help: "", required: false, list: false, canRequire: false, canHide: false, hasTable: false, options: [],
      }));
  const numericSystem = entity
    ? entity.fields.filter((f) => ["number", "currency", "percent"].includes(f.type)).map((f) => ({ key: f.key, label: f.label }))
    : (FORMULA_SYSTEM_FIELDS[mod.module] ?? []);

  return (
    <>
      <PageHeader
        title="Quản lý trường dữ liệu"
        description="Thêm trường bổ sung cho từng màn hình mà không cần sửa mã nguồn. Mỗi lần sửa tạo một phiên bản mới; trường đang có dữ liệu không xóa được, chỉ ngừng sử dụng."
      />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b">
        {CUSTOM_FIELD_MODULES.map((m) => (
          <Link
            key={m.module}
            href={`/truong-du-lieu?module=${m.module}`}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-4 py-2 text-sm whitespace-nowrap",
              mod.module === m.module ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {m.label}
          </Link>
        ))}
      </div>
      <div className="space-y-4">
        <FieldManager
          module={mod.module}
          moduleLabel={mod.label}
          rows={custom}
          canConfigure={me.permissions.has("fields.configure")}
          numericSystem={numericSystem}
          systemKeys={(entity?.fields ?? FORM_SYSTEM_FIELDS[mod.module] ?? []).map((f) => f.key)}
          permissions={ALL_PERMISSIONS}
          autoOpen={them === "1"}
          layout={{
            resetKey: `${mod.module}:${layout.join()}:${custom.map((r) => `${r.field_key}${r.status}`).join()}`,
            items: applyLayout(layoutDefaults, layout),
            defaults: layoutDefaults,
            appliesTo:
              mod.module === "transport_orders"
                ? "phần Thông tin đơn hàng trên form Tạo đơn hàng (Điều phối)"
                : mod.module === "shipments"
                  ? "phần Chuyến trên form Tạo đơn hàng (Điều phối)"
                  : `hộp Thêm/Sửa ${mod.label.toLowerCase()}`,
            note: entity?.createAction
              ? "Hộp tạo mới của màn hình này giữ cố định ô hệ thống; trường bổ sung hiện theo thứ tự này."
              : mod.module === "shipments"
                ? "Các mục “(khung Giá)” cùng trường kiểu tiền, %, số, công thức hiện trong khung Giá của chuyến, theo đúng thứ tự trong danh sách này."
                : undefined,
          }}
        />
        <SystemFieldsCard
          key={`${mod.module}:${JSON.stringify(settings)}`}
          module={mod.module}
          moduleLabel={mod.label}
          fields={systemInfo}
          settings={settings}
          canConfigure={me.permissions.has("fields.configure")}
          note={entity ? undefined : "Tên mới hiện trên form Tạo/Sửa đơn hàng ở Điều phối."}
        />
        {entity ? null : (
          <p className="text-sm text-muted-foreground">Trường bổ sung của {mod.label.toLowerCase()} hiện trong màn hình tạo đơn hàng, bảng chuyến xe (cột và tìm kiếm nâng cao) và chi tiết chuyến.</p>
        )}
      </div>
    </>
  );
}
