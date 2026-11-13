import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChildList, RecordCard } from "@/components/entities/record-card";
import { DRIVER_STATUS, getEntity } from "@/lib/entities/definitions";
import { entityAccess } from "@/lib/entities/access";
import { isUuid } from "@/lib/entities/record";
import { loadChildren, loadCustomFields, loadRecord, visibleCustomRows } from "@/lib/entities/server";

export const metadata: Metadata = { title: "Chi tiết tài xế" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePagePermission("drivers.view");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const drivers = getEntity("drivers");
  const customRows = visibleCustomRows(await loadCustomFields(supabase, "drivers"), me.permissions);
  const { record, refLabels } = await loadRecord(supabase, drivers, customRows, id);
  if (!record) notFound();
  const path = `/tai-xe/${id}`;
  const acc = {
    driver: entityAccess(drivers, me.permissions),
    sens: entityAccess(getEntity("driver_sensitive"), me.permissions),
    bank: entityAccess(getEntity("driver_bank_accounts"), me.permissions),
    pay: entityAccess(getEntity("driver_pay_components"), me.permissions),
  };
  const [sens, banks, pays, vehicle, profile] = await Promise.all([
    acc.sens.view ? loadRecord(supabase, getEntity("driver_sensitive"), [], id) : null,
    acc.bank.view ? loadChildren(supabase, getEntity("driver_bank_accounts"), id) : null,
    acc.pay.view ? loadChildren(supabase, getEntity("driver_pay_components"), id) : null,
    supabase.from("driver_vehicle_view").select("vehicle_id, plate_number").eq("driver_id", id).maybeSingle(),
    record.profile_id && me.permissions.has("users.view")
      ? supabase.from("profiles").select("email, status").eq("id", record.profile_id as string).maybeSingle()
      : null,
  ]);
  const status = DRIVER_STATUS.find((x) => x.value === record.status);
  const v = vehicle.data as { vehicle_id: string; plate_number: string } | null;
  const p = profile?.data as { email: string; status: string } | null | undefined;

  return (
    <>
      <Link href="/tai-xe" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Danh sách tài xế
      </Link>
      <PageHeader
        title={`${record.full_name} (${record.code})`}
        description={<Badge variant={record.status === "active" ? "success" : "secondary"}>{status?.label ?? String(record.status)}</Badge>}
      />
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Xe phụ trách</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {v ? (
                <Link href={`/phuong-tien/${v.vehicle_id}`} className="font-medium text-primary hover:underline">
                  {v.plate_number}
                </Link>
              ) : (
                <span className="text-muted-foreground">Chưa gán xe. Gán ở màn hình Phương tiện (trường “Tài xế phụ trách”).</span>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tài khoản đăng nhập ứng dụng tài xế</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {record.profile_id ? (
                <span>
                  Đã liên kết{p ? `: ${p.email}` : ""}{p?.status === "disabled" ? " (đã khóa)" : ""}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Chưa liên kết.{" "}
                  {me.permissions.has("users.create") ? (
                    <Link href="/nguoi-dung" className="text-primary hover:underline">
                      Cấp quyền truy cập với vai trò Tài xế và chọn hồ sơ này
                    </Link>
                  ) : (
                    "Nhờ quản trị viên cấp quyền truy cập với vai trò Tài xế."
                  )}
                </span>
              )}
            </CardContent>
          </Card>
        </div>
        <RecordCard entityKey="drivers" customRows={customRows} record={record} refLabels={refLabels} canEdit={acc.driver.update} title="Hồ sơ tài xế" revalidate={path} />
        {acc.pay.view ? (
          <ChildList
            entityKey="driver_pay_components"
            parentId={id}
            rows={pays?.rows ?? []}
            refLabels={pays?.refLabels}
            access={acc.pay}
            title="Mức lương theo khoản (lương cơ bản, phụ cấp, thưởng)"
            revalidate={path}
          />
        ) : null}
        {acc.sens.view ? (
          <>
            <RecordCard
              entityKey="driver_sensitive"
              record={sens?.record ?? null}
              parentId={id}
              canEdit={acc.sens.update}
              title="Giấy tờ tùy thân (dữ liệu nhạy cảm)"
              emptyText="Chưa nhập số CCCD."
              revalidate={path}
            />
            <ChildList entityKey="driver_bank_accounts" parentId={id} rows={banks?.rows ?? []} refLabels={banks?.refLabels} access={acc.bank} title="Tài khoản ngân hàng" revalidate={path} />
          </>
        ) : (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">CCCD và tài khoản ngân hàng chỉ hiện với người có quyền xem dữ liệu nhạy cảm.</p>
        )}
      </div>
    </>
  );
}
