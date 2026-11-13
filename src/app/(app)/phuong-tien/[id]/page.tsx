import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChildList, RecordCard } from "@/components/entities/record-card";
import { getEntity, VEHICLE_STATUS } from "@/lib/entities/definitions";
import { entityAccess } from "@/lib/entities/access";
import { isUuid } from "@/lib/entities/record";
import { loadChildren, loadCustomFields, loadRecord, visibleCustomRows } from "@/lib/entities/server";
import { formatDate, formatVND } from "@/lib/format";

export const metadata: Metadata = { title: "Chi tiết phương tiện" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePagePermission("vehicles.view");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const vehicles = getEntity("vehicles");
  const customRows = visibleCustomRows(await loadCustomFields(supabase, "vehicles"), me.permissions);
  const { record, refLabels } = await loadRecord(supabase, vehicles, customRows, id);
  if (!record) notFound();
  const path = `/phuong-tien/${id}`;
  const acc = {
    vehicle: entityAccess(vehicles, me.permissions),
    fin: entityAccess(getEntity("vehicle_financials"), me.permissions),
    loans: entityAccess(getEntity("loan_schedules"), me.permissions),
    maint: entityAccess(getEntity("maintenance_records"), me.permissions),
  };
  const [fin, loans, maint, summary] = await Promise.all([
    acc.fin.view ? loadRecord(supabase, getEntity("vehicle_financials"), [], id) : null,
    acc.loans.view ? loadChildren(supabase, getEntity("loan_schedules"), id) : null,
    acc.maint.view ? loadChildren(supabase, getEntity("maintenance_records"), id) : null,
    acc.fin.view ? supabase.from("vehicle_loan_summary").select("*").eq("vehicle_id", id).maybeSingle() : null,
  ]);
  const s = summary?.data as { outstanding_principal: number | null; next_due_date: string | null; installments: number } | null | undefined;
  const status = VEHICLE_STATUS.find((x) => x.value === record.status);

  return (
    <>
      <Link href="/phuong-tien" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Danh sách phương tiện
      </Link>
      <PageHeader
        title={`${record.plate_number} (${record.code})`}
        description={<Badge variant={record.status === "active" ? "success" : "secondary"}>{status?.label ?? String(record.status)}</Badge>}
      />
      <div className="space-y-4">
        <RecordCard entityKey="vehicles" customRows={customRows} record={record} refLabels={refLabels} canEdit={acc.vehicle.update} title="Thông tin xe" revalidate={path} />
        {acc.fin.view ? (
          <>
            {s && s.installments > 0 ? (
              <Card>
                <CardContent className="grid gap-4 pt-6 text-sm sm:grid-cols-3">
                  <div>
                    <div className="text-xs text-muted-foreground">Dư nợ gốc (theo lịch trả nợ)</div>
                    <div className="text-lg font-semibold">{formatVND(s.outstanding_principal)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Kỳ đến hạn tiếp theo</div>
                    <div className="text-lg font-semibold">{s.next_due_date ? formatDate(s.next_due_date) : "Đã trả hết"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Số kỳ đã nhập</div>
                    <div className="text-lg font-semibold">{s.installments}</div>
                  </div>
                </CardContent>
              </Card>
            ) : null}
            <RecordCard
              entityKey="vehicle_financials"
              record={fin?.record ?? null}
              refLabels={fin?.refLabels}
              parentId={id}
              canEdit={acc.fin.update}
              title="Tài chính: giá mua, khấu hao, khoản vay"
              emptyText="Chưa nhập thông tin tài chính. Dư nợ chỉ được tính khi có lịch trả nợ, hệ thống không tự suy đoán."
              revalidate={path}
            />
            <ChildList entityKey="loan_schedules" parentId={id} rows={loans?.rows ?? []} refLabels={loans?.refLabels} access={acc.loans} title="Lịch trả nợ vay" revalidate={path} />
          </>
        ) : (
          <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Thông tin tài chính của xe chỉ hiện với người có quyền xem dữ liệu nhạy cảm.</p>
        )}
        {acc.maint.view ? (
          <ChildList entityKey="maintenance_records" parentId={id} rows={maint?.rows ?? []} refLabels={maint?.refLabels} access={acc.maint} title="Sửa chữa, bảo dưỡng, thay lốp, thay nhớt" revalidate={path} />
        ) : null}
        <p className="text-xs text-muted-foreground">Tệp đính kèm (giấy đăng ký, đăng kiểm, bảo hiểm) sẽ có ở Giai đoạn 5 cùng chức năng tải ảnh chứng từ.</p>
      </div>
    </>
  );
}
