import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { addDaysYMD, formatDate, formatDateTime, todayVN } from "@/lib/format";
import { SHIPMENT_ADV_FIELDS, type ShipmentListRow } from "@/lib/shipments";
import { isUuid } from "@/lib/entities/record";
import { loadTableView } from "@/lib/entities/server";
import { advRefLabels, applyShipmentFilters, parseShipmentFilters, shipmentCustomFields } from "@/lib/shipments-query";
import { dispatchExtraColumns, type DispatchExtraColumn } from "@/lib/dispatch-columns";
import { PageHeader } from "@/components/layout/page-header";
import { CompactDensity } from "@/components/layout/compact-density";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DispatchTable } from "@/components/dispatch/dispatch-table";
import { DispatchFilterBar } from "@/components/dispatch/dispatch-filter-bar";
import { DeleteCancelledButton } from "@/components/dispatch/cancel-dialog";

export const metadata: Metadata = { title: "Chuyến hủy" };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 1000;
/** Khoảng ngày tối đa một lần xem */
const MAX_SPAN = 366;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Danh sách chuyến đã hủy (tách khỏi Điều phối, Quản lý chuyến): tìm lại và khôi phục */
export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePagePermission("dispatch.view", "shipments.view");
  const raw = await searchParams;
  const today = todayVN();
  // Mặc định nhận hàng từ 30 ngày trước đến 30 ngày tới
  const tuRaw = one(raw.tu);
  const denRaw = one(raw.den);
  const tu0 = tuRaw && YMD.test(tuRaw) ? tuRaw : addDaysYMD(today, -30);
  const den0 = denRaw && YMD.test(denRaw) ? denRaw : addDaysYMD(today, 30);
  const supabase = await createClient();
  const custom = await shipmentCustomFields(supabase, me.permissions);
  const f = parseShipmentFilters({ ...raw, tu: tu0, den: den0, tt: "" }, custom.adv);
  if (f.den > addDaysYMD(f.tu, MAX_SPAN - 1)) f.den = addDaysYMD(f.tu, MAX_SPAN - 1);
  const xe = isUuid(one(raw.xe) ?? "") ? one(raw.xe)! : "";
  const tx = isUuid(one(raw.tx) ?? "") ? one(raw.tx)! : "";
  const advFields = [...SHIPMENT_ADV_FIELDS, ...custom.adv];

  let listQ = applyShipmentFilters(supabase.from("shipment_list").select("*"), f).eq("status", "cancelled");
  if (xe) listQ = listQ.eq("vehicle_id", xe);
  if (tx) listQ = listQ.eq("driver_id", tx);
  const [listRes, view, advLabels] = await Promise.all([
    listQ.order("pickup_at", { ascending: false }).order("shipment_code", { ascending: false }).limit(MAX_ROWS),
    loadTableView(supabase, "cancelled_trips", me.id),
    advRefLabels(supabase, f.adv, advFields),
  ]);
  if (listRes.error) throw listRes.error;
  const rows = (listRes.data ?? []) as ShipmentListRow[];

  // Lý do hủy, lúc hủy, người hủy (đọc thẳng bảng chuyến, theo lô)
  type CancelInfo = { id: string; cancel_reason: string | null; cancelled_at: string | null; cancelled_by: string | null };
  const info = new Map<string, CancelInfo>();
  for (let i = 0; i < rows.length; i += 200) {
    const { data } = await supabase
      .from("shipments")
      .select("id, cancel_reason, cancelled_at, cancelled_by")
      .in("id", rows.slice(i, i + 200).map((r) => r.id));
    for (const c of (data ?? []) as CancelInfo[]) info.set(c.id, c);
  }
  const userIds = [...new Set([...info.values()].map((c) => c.cancelled_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (userIds.length) {
    const { data } = await supabase.from("profiles").select("id, full_name, email").in("id", userIds);
    for (const p of (data ?? []) as { id: string; full_name: string | null; email: string | null }[]) names.set(p.id, p.full_name?.trim() || p.email || "");
  }

  const extras = await dispatchExtraColumns(supabase, me.permissions, rows);
  const cancelCols: DispatchExtraColumn[] = [
    { key: "sys_cancel_reason", label: "Lý do hủy", numeric: false, source: "shipment", visible: true },
    { key: "sys_cancelled_at", label: "Lúc hủy", numeric: false, source: "shipment", visible: true },
    { key: "sys_cancelled_by", label: "Người hủy", numeric: false, source: "shipment", visible: true },
  ];
  for (const r of rows) {
    const c = info.get(r.id);
    const who = c?.cancelled_by ? (names.get(c.cancelled_by) ?? "") : "";
    extras.values[r.id] = {
      ...extras.values[r.id],
      sys_cancel_reason: [c?.cancel_reason ?? "", c?.cancel_reason ?? null],
      sys_cancelled_at: [c?.cancelled_at ? formatDateTime(c.cancelled_at) : "", c?.cancelled_at ?? null],
      sys_cancelled_by: [who, who || null],
    };
  }

  const canRestore = me.permissions.has("dispatch.delete") || me.permissions.has("shipments.delete");
  const filtered = Boolean(f.kh || xe || tx || f.q || f.adv.length);
  const rangeText = `nhận hàng từ ${formatDate(f.tu)} đến ${formatDate(f.den)}`;

  return (
    <>
      <CompactDensity />
      <PageHeader
        title="Chuyến hủy"
        description={`Chuyến đã hủy, ${rangeText}. Không hiện ở Điều phối và Quản lý chuyến. Bấm Khôi phục để đưa chuyến về Chưa phân công rồi phân công lại, hoặc Xóa để xóa vĩnh viễn.`}
        actions={
          <>
            {canRestore ? <DeleteCancelledButton ids={rows.map((r) => r.id)} label={`${rows.length} chuyến hủy đang lọc`} /> : null}
            <Button variant="outline" asChild>
              <Link href="/dieu-phoi">
                <ArrowLeft /> Về Điều phối
              </Link>
            </Button>
          </>
        }
      />
      <DispatchFilterBar keepRange filters={{ tu: f.tu, den: f.den, kh: f.kh, xe, tx, q: f.q, adv: f.adv, xem: "" }} today={today} advFields={advFields} advLabels={advLabels} />
      <Card className="overflow-hidden">
        <div className="border-b px-4 py-3 text-sm">
          <b>{rows.length}</b> chuyến đã hủy
          {canRestore ? "" : ". Bạn chỉ xem được, cần quyền hủy chuyến (Điều phối: Xóa) để khôi phục hoặc xóa."}
        </div>
        {rows.length >= MAX_ROWS ? (
          <p className="border-b bg-warning/10 px-4 py-2 text-xs">Chỉ hiển thị {MAX_ROWS} chuyến mới nhất. Thu hẹp khoảng ngày hoặc thêm điều kiện lọc để xem đủ.</p>
        ) : null}
        <DispatchTable
          rows={rows}
          view={view}
          tableKey="cancelled_trips"
          extraColumns={[...cancelCols, ...extras.columns]}
          extraValues={extras.values}
          canAddField={me.permissions.has("fields.configure")}
          canAssign={false}
          canCancel={canRestore}
          canDelete={canRestore}
          canFillDriver={false}
          showDate
          exportName={{ filename: `chuyen-huy-${f.tu}_${f.den}`, title: `CHUYẾN HỦY – ${rangeText}` }}
          emptyText={filtered ? "Không có chuyến hủy phù hợp với bộ lọc." : `Không có chuyến hủy ${rangeText}.`}
        />
      </Card>
    </>
  );
}
