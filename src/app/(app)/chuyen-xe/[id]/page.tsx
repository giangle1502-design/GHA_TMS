import { withErrorDetail } from "@/components/layout/page-error-detail";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { missingColumn } from "@/lib/supabase/missing-column";
import { isUuid, layoutOf, moduleCustomFields } from "@/lib/entities/record";
import { formatDate, formatDateTime, formatNumber, formatVND } from "@/lib/format";
import { ASSIGNABLE_STATUSES, CANCELLABLE_STATUSES, PRICING_UNITS, documentStatus, settlementStatus, shipmentStatus } from "@/lib/status";
import { isLate, type ShipmentListRow } from "@/lib/shipments";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/dispatch/status-badge";
import { AssignDialog } from "@/components/dispatch/assign-dialog";
import { CrewChangeDialog } from "@/components/dispatch/crew-change-dialog";
import { CORRECT_CREW_STATUSES, UNACCEPT_STATUSES } from "@/lib/crew-change";
import { CancelDialog, RestoreShipmentButton } from "@/components/dispatch/cancel-dialog";
import { ResubmitTripButton, TripApprovalButtons } from "@/components/dispatch/trip-approval";
import { shipmentCustomFields } from "@/lib/shipments-query";
import { CustomFieldsCard } from "./custom-fields-card";
import { formulaVars } from "@/lib/entities/definitions";
import { TripCostsCard, type TripCost } from "./trip-costs-card";
import { ActForDriver } from "./act-for-driver";
import { EditShipmentDialog } from "./edit-shipment-dialog";
import { ItemsCard, type ShipmentItem } from "./items-card";
import { FeesDialog, type ShipmentFee } from "./fees-dialog";
import { ProfitCard, type ShipmentProfit } from "./profit-card";
import { CarrierCard, type CarrierPayable } from "./carrier-card";
import type { CarrierCost } from "@/components/finance/carrier-dialogs";
import { DocumentsButton } from "@/components/finance/documents-button";
import { DriverInfoButton } from "@/components/dispatch/driver-info-button";
import { ShipmentEditLock } from "@/components/dispatch/shipment-edit-lock";
import { loadCustomFields, visibleCustomRows } from "@/lib/entities/server";

export const metadata: Metadata = { title: "Chi tiết chuyến" };

type Extra = {
  receivable_id: string | null;
  dispatch_approved_by: string | null;
  dispatch_approved_at: string | null;
  dispatch_approved_on_behalf: boolean;
  photo_skip_reason: string | null;
  pod_photo_required: boolean;
  vehicle: { ownership_type: string; supplier_id: string | null; supplier: { name: string } | null } | null;
  carrier_supplier_id: string | null;
  carrier: { name: string } | null;
  pricing_snapshot: Record<string, unknown>;
  cancel_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  created_by: string | null;
  arrived_pickup_at: string | null;
  departed_pickup_at: string | null;
  arrived_delivery_at: string | null;
  completed_at: string | null;
  actual_km: number | null;
  delivery_result: string | null;
  completion_note: string | null;
  expense_declaration: "none" | "has" | null;
  expense_declared_at: string | null;
};
type History = { id: number; status_field: string; from_status: string | null; to_status: string; changed_by: string | null; changed_at: string; note: string | null };
type Assignment = {
  id: string;
  response: string;
  assigned_at: string;
  responded_at: string | null;
  assigned_by: string | null;
  driver: { full_name: string; code: string } | null;
  vehicle: { plate_number: string } | null;
};
type Expense = TripCost;
const RESULT_LABEL: Record<string, string> = { full: "Giao đủ", partial: "Giao thiếu", failed: "Không giao được" };
type Change = { occurred_at: string; actor_name: string | null; field: string; old_value: string | null; new_value: string | null };

const FIELD_LABELS: Record<string, string> = {
  unit_price: "Đơn giá",
  quantity: "Số lượng",
  surcharge_amount: "Phụ phí",
  fuel_support_rate: "Tỷ lệ hỗ trợ dầu (%)",
  fuel_support_amount: "Tiền hỗ trợ dầu",
  price_list_id: "Bảng giá",
  pricing_unit: "Đơn vị tính",
  vehicle_id: "Xe",
  driver_id: "Tài xế",
  pickup_at: "Ngày nhận hàng",
  expected_delivery_at: "Ngày giao dự kiến",
  notes: "Ghi chú",
};
const MONEY_FIELDS = new Set(["unit_price", "surcharge_amount", "fuel_support_amount"]);
const ASSIGN_RESPONSE: Record<string, { label: string; variant: "warning" | "info" | "muted" }> = {
  pending: { label: "Chờ tài xế nhận", variant: "warning" },
  accepted: { label: "Tài xế đã nhận", variant: "info" },
  superseded: { label: "Đã thay thế / gỡ", variant: "muted" },
};
const FUEL_SOURCE: Record<string, string> = {
  manual: "nhập tay khi tạo chuyến",
  price_list: "theo bảng giá",
  "rule:customer_route": "quy tắc theo khách hàng và tuyến",
  "rule:route": "quy tắc theo tuyến",
  "rule:customer": "quy tắc theo khách hàng",
  "rule:vehicle_type": "quy tắc theo loại xe",
  "rule:default": "quy tắc mặc định",
  none: "không có quy tắc",
};
const FUEL_BASE: Record<string, string> = {
  freight_revenue: "doanh thu cước",
  unit_price: "đơn giá",
  total_revenue: "doanh thu cước + phụ phí",
  fuel_norm: "định mức nhiên liệu",
  formula: "công thức",
};
const STATUS_FIELD: Record<string, { name: string; label: (v: string) => string }> = {
  status: { name: "Vận hành", label: (v) => shipmentStatus(v).label },
  document_status: { name: "Chứng từ", label: (v) => documentStatus(v).label },
  settlement_status: { name: "Quyết toán", label: (v) => settlementStatus(v).label },
};

function fmtChange(field: string, v: string | null): string {
  if (v === null || v === "") return "(trống)";
  if (MONEY_FIELDS.has(field)) return formatVND(v);
  if (field === "pickup_at" || field === "expected_delivery_at") return formatDate(v);
  if (field === "vehicle_id" || field === "driver_id" || field === "price_list_id") return "(đã đổi)";
  if (field === "pricing_unit") return PRICING_UNITS[v] ?? v;
  return /^-?\d+(\.\d+)?$/.test(v) ? formatNumber(v) : v;
}

const EXTRA_COLS =
  "receivable_id, pricing_snapshot, cancel_reason, cancelled_at, created_at, created_by, arrived_pickup_at, departed_pickup_at, arrived_delivery_at, completed_at, actual_km, delivery_result, completion_note, expense_declaration, expense_declared_at, photo_skip_reason, pod_photo_required, dispatch_approved_by, dispatch_approved_at, dispatch_approved_on_behalf, carrier_supplier_id, carrier:suppliers(name), vehicle:vehicles(ownership_type, supplier_id, supplier:suppliers(name))";

export default async function Page(props: { params: Promise<{ id: string }> }) {
  return withErrorDetail(() => PageInner(props));
}

async function PageInner({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePagePermission("shipments.view", "dispatch.view");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const canExpenses = me.permissions.has("expenses.view");
  const canSeeCarrier = ["dispatch.view", "receivables.view", "reports.view", "expenses.view"].some((k) => me.permissions.has(k as never));
  const canSeePayable = me.permissions.has("receivables.view");
  const [custom, rowRes, extraRes, histRes, asgRes, changeRes, expRes, docRes, itemRes, itemFieldRows, feeRes, profitRes] = await Promise.all([
    shipmentCustomFields(supabase, me.permissions),
    supabase.from("shipment_list").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("shipments")
      .select(EXTRA_COLS)
      .eq("id", id)
      .maybeSingle(),
    supabase.from("shipment_status_history").select("id, status_field, from_status, to_status, changed_by, changed_at, note").eq("shipment_id", id).order("changed_at").order("id"),
    supabase
      .from("shipment_assignments")
      .select("id, response, assigned_at, responded_at, assigned_by, driver:drivers(full_name, code), vehicle:vehicles(plate_number)")
      .eq("shipment_id", id)
      .order("assigned_at", { ascending: false }),
    supabase.rpc("shipment_change_history", { p_shipment_id: id }),
    canExpenses
      ? supabase.from("expense_list").select("id, code, category_name, group_name, group_sort, amount, status, paid_by, incurred_at, file_count, note, ref_no, approval_request_id, payroll_id").eq("shipment_id", id).order("incurred_at").order("code")
      : Promise.resolve({ data: [], error: null }),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("entity_type", "shipment").eq("entity_id", id).is("archived_at", null),
    supabase.from("shipment_items").select("line_no, item_code, item_name, quantity, unit, note, custom_fields").eq("shipment_id", id).order("line_no"),
    loadCustomFields(supabase, "shipment_items"),
    supabase.from("shipment_fees").select("line_no, fee_type_id, fee_kind, amount, note, declaration_type_id, ref_no, quantity, unit_price, declaration:declaration_types(name), fee_type:fee_types(name, sort_order, fee_group:fee_groups(id, name, report_role, sort_order))").eq("shipment_id", id).order("line_no"),
    canExpenses ? supabase.from("shipment_profit").select("*").eq("shipment_id", id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const [carrierRes, payableRes, feeDocRes, sheetRes, lockRes] = await Promise.all([
    canSeeCarrier
      ? supabase.from("shipment_carrier_costs").select("line_no, cost_kind, fee_type_id, description, quantity, unit_price, amount, ref_no, note, fee_type:fee_types(name)").eq("shipment_id", id).order("line_no")
      : Promise.resolve({ data: [], error: null }),
    canSeePayable
      ? supabase.from("payables").select("id, code, amount, paid_amount, status, due_date, invoice_no").eq("shipment_id", id).eq("kind", "carrier").neq("status", "cancelled").maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // Tệp hóa đơn PDF / ảnh của phí chi hộ (lỗi thì chỉ không hiện số tệp)
    supabase.from("documents").select("fee_type_id").eq("entity_type", "shipment_fee").eq("entity_id", id).is("archived_at", null),
    // Ảnh phiếu chi phí tài xế gửi (văn phòng nhập chi phí theo phiếu)
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("entity_type", "shipment").eq("entity_id", id).eq("doc_type", "receipt").is("archived_at", null),
    // Số lần lưu chuyến (khóa sửa 0061; CSDL chưa nâng cấp thì không khóa)
    supabase.rpc("shipment_edit_status", { p_shipment_id: id }),
  ]);
  const editRev = lockRes.error ? null : Number((lockRes.data as { rev?: number } | null)?.rev ?? 0);
  const sheetCount = sheetRes.count ?? 0;
  const feeDocs = new Map<string, number>();
  for (const d of (feeDocRes.data ?? []) as { fee_type_id: string | null }[]) if (d.fee_type_id) feeDocs.set(d.fee_type_id, (feeDocs.get(d.fee_type_id) ?? 0) + 1);
  if (carrierRes.error) throw carrierRes.error;
  const carrierCosts = (carrierRes.data ?? []) as unknown as CarrierCost[];
  // Hạng mục "Thuê xe ngoài (3-PL)": chuyến 3PL tự chọn sẵn ở Chi phí đầu ra (từ 0058 mã đổi sang CP…, mã cũ ở legacy_code)
  const outsourceRow = canSeeCarrier
    ? ((await supabase.from("expense_categories").select("id, name").or("code.eq.OUTSOURCE,legacy_code.eq.OUTSOURCE").eq("is_active", true).limit(1).maybeSingle()).data ??
      (await supabase.from("expense_categories").select("id, name").eq("is_active", true).or("name.ilike.%3-PL%,name.ilike.%3PL%,name.ilike.%thuê xe ngoài%").order("sort_order").limit(1).maybeSingle()).data)
    : null;
  const outsourceCat = outsourceRow ? { id: String(outsourceRow.id), label: String(outsourceRow.name) } : null;
  const carrierPayable = (payableRes.data ?? null) as CarrierPayable | null;
  // CSDL chưa nâng cấp 0054 (chưa có cột pod_photo_required): đọc lại không có cột này, coi như bắt buộc chụp
  let extra = extraRes;
  if (extra.error && missingColumn(extra.error, "pod_photo_required")) {
    const retry = await supabase
      .from("shipments")
      .select(EXTRA_COLS.replace("pod_photo_required, ", ""))
      .eq("id", id)
      .maybeSingle();
    extra = { ...retry, data: retry.data ? { ...(retry.data as object), pod_photo_required: true } : null } as typeof extraRes;
  }
  for (const r of [rowRes, extra, histRes, asgRes, changeRes]) if (r.error) throw r.error;
  const s = rowRes.data as ShipmentListRow | null;
  const x = extra.data as Extra | null;
  if (!s || !x) notFound();
  const history = (histRes.data ?? []) as History[];
  const assignments = (asgRes.data ?? []) as unknown as Assignment[];
  const changes = (changeRes.data ?? []) as Change[];
  if (expRes.error) throw expRes.error;
  const expenses = (expRes.data ?? []) as Expense[];
  // Khoản chờ duyệt mà người đang xem duyệt được: hiện nút Duyệt / Từ chối ngay tại dòng chi phí
  const pendingIds = expenses.filter((e) => e.status === "pending" && e.approval_request_id).map((e) => e.approval_request_id!);
  const approvable = new Map<string, Record<string, unknown>>();
  if (pendingIds.length) {
    const { data } = await supabase.from("approval_list").select("id, code, amount, can_approve, entity_type, entity_id").in("id", pendingIds);
    for (const r of data ?? []) if (r.can_approve) approvable.set(r.id as string, { ...r, file_count: 0 });
  }
  const docCount = docRes.count ?? 0;
  if (feeRes.error) throw feeRes.error;
  const fees = (feeRes.data ?? []) as unknown as ShipmentFee[];
  // Phí theo nhóm: nhóm Cước vận chuyển cộng vào Tổng cước, các nhóm khác hiện riêng kèm cộng nhóm
  const feeGroups = (() => {
    const freight: ShipmentFee[] = [];
    const map = new Map<string, { name: string; sort: number; lines: ShipmentFee[] }>();
    for (const f of fees) {
      const g = f.fee_type?.fee_group;
      if (g?.report_role === "freight") {
        freight.push(f);
        continue;
      }
      const name = g?.name ?? "Phí khác";
      if (!map.has(name)) map.set(name, { name, sort: g?.sort_order ?? 9999, lines: [] });
      map.get(name)!.lines.push(f);
    }
    return { freight, others: [...map.values()].sort((a, b) => a.sort - b.sort) };
  })();
  const canEditFees =
    (me.permissions.has("dispatch.update") || me.permissions.has("shipments.update")) && s.status !== "cancelled" && !x.receivable_id;
  const approvedCost = expenses.filter((e) => e.status === "approved").reduce((a, e) => a + Number(e.amount), 0);
  const pendingCost = expenses.filter((e) => e.status === "pending").reduce((a, e) => a + Number(e.amount), 0);
  const profit = (profitRes.data ?? null) as ShipmentProfit | null;
  // Chi phí chuyến đã duyệt cộng theo hạng mục
  const costLines = [...expenses.filter((e) => e.status === "approved").reduce((m, e) => m.set(e.category_name, (m.get(e.category_name) ?? 0) + Number(e.amount)), new Map<string, number>())]
    .map(([name, amount]) => ({ name, amount }));

  const actorIds = [...new Set([x.created_by, ...history.map((h) => h.changed_by), ...assignments.map((a) => a.assigned_by), x.dispatch_approved_by].filter((v): v is string => Boolean(v)))];
  const { data: nameRows } = actorIds.length ? await supabase.rpc("user_display_names", { p_ids: actorIds }) : { data: [] };
  const names = new Map(((nameRows ?? []) as { id: string; display_name: string }[]).map((n) => [n.id, n.display_name]));
  const who = (uid: string | null) => (uid ? (names.get(uid) ?? "Người dùng") : "Hệ thống");

  const snap = x.pricing_snapshot ?? {};
  const canAssign = me.permissions.has("dispatch.update") && ASSIGNABLE_STATUSES.includes(s.status);
  const canCancel = (me.permissions.has("dispatch.delete") || me.permissions.has("shipments.delete")) && CANCELLABLE_STATUSES.includes(s.status);
  const unit = PRICING_UNITS[s.pricing_unit] ?? s.pricing_unit;
  const approvalBlocked = s.status === "assigned" && (s.dispatch_approval === "pending" || s.dispatch_approval === "rejected");
  const canActForDriver =
    me.permissions.has("dispatch.update") && Boolean(s.driver_id) && ["assigned", "accepted", "in_transit"].includes(s.status) && !approvalBlocked;
  // Chuyến chạy nhà xe 3PL: xe thuê ngoài, xe có nhà xe, hoặc chuyến đã ghi nhà xe 3PL
  const is3pl = x.vehicle?.ownership_type === "outsourced" || Boolean(x.vehicle?.supplier_id) || Boolean(x.carrier_supplier_id);

  return (
    <>
      {editRev !== null && s.status !== "cancelled" ? <ShipmentEditLock shipmentId={s.id} rev={editRev} /> : null}
      <Link href="/chuyen-xe" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" /> Quản lý chuyến xe
      </Link>
      <PageHeader
        title={`Chuyến ${s.shipment_code}`}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={s.status} />
            <StatusBadge kind="document" status={s.document_status} />
            <StatusBadge kind="settlement" status={s.settlement_status} />
            {s.dispatch_approval && s.dispatch_approval !== "not_required" ? <StatusBadge kind="approval" status={s.dispatch_approval} /> : null}
            {isLate(s) ? <Badge variant="destructive">Trễ giờ giao</Badge> : null}
          </span>
        }
        actions={
          <>
            {s.driver_id && s.status !== "cancelled" ? (
              <DriverInfoButton
                variant="outline"
                shipmentIds={[s.id]}
                canFill={me.permissions.has("dispatch.update") || (me.permissions.has("drivers.view_sensitive") && me.permissions.has("drivers.update"))}
              />
            ) : null}
            {(me.permissions.has("dispatch.update") || me.permissions.has("shipments.update")) && s.status !== "cancelled" ? <EditShipmentDialog s={s} /> : null}
            {canAssign ? (
              <AssignDialog
                shipmentId={s.id}
                shipmentCode={s.shipment_code}
                driverId={s.driver_id}
                driverLabel={s.driver_name ? `${s.driver_name} (${s.driver_code})` : null}
                vehicleId={s.vehicle_id}
                vehicleLabel={s.plate_number}
                pickupAt={s.pickup_at}
              />
            ) : null}
            {me.permissions.has("dispatch.update")
              ? (["unaccept", "correct"] as const)
                  .filter((m) => (m === "unaccept" ? UNACCEPT_STATUSES : CORRECT_CREW_STATUSES).includes(s.status))
                  .map((m) => (
                    <CrewChangeDialog
                      key={m}
                      mode={m}
                      shipmentId={s.id}
                      shipmentCode={s.shipment_code}
                      driverId={s.driver_id}
                      driverLabel={s.driver_name ? `${s.driver_name} (${s.driver_code})` : null}
                      vehicleId={s.vehicle_id}
                      vehicleLabel={s.plate_number}
                      pickupAt={s.pickup_at}
                    />
                  ))
              : null}
            {canCancel ? <CancelDialog shipmentId={s.id} shipmentCode={s.shipment_code} /> : null}
            {s.status === "cancelled" && (me.permissions.has("dispatch.delete") || me.permissions.has("shipments.delete")) ? (
              <RestoreShipmentButton shipmentId={s.id} shipmentCode={s.shipment_code} />
            ) : null}
          </>
        }
      />

      {s.status === "cancelled" ? (
        <p className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          Đã hủy lúc {formatDateTime(x.cancelled_at)}. Lý do: <b>{x.cancel_reason}</b>
        </p>
      ) : null}

      {approvalBlocked ? (
        <div
          className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm ${s.dispatch_approval === "rejected" ? "border-destructive/30 bg-destructive/5" : "border-warning/40 bg-warning/10"}`}
        >
          <span>
            {s.dispatch_approval === "rejected" ? (
              <>
                Giám đốc <b>từ chối</b> chuyến này{s.dispatch_reject_reason ? <>: <b>{s.dispatch_reject_reason}</b></> : null}. Sửa chuyến rồi bấm Gửi duyệt lại; đổi tài xế thì tự gửi duyệt.
              </>
            ) : (
              <>
                Chuyến đang <b>chờ Giám đốc duyệt</b>. Tài xế chưa thấy chuyến trên điện thoại, điều phối chưa nhận đơn thay được.
              </>
            )}
          </span>
          <span className="flex gap-1">
            {s.can_approve_dispatch && s.dispatch_approval_request_id ? <TripApprovalButtons requestIds={[s.dispatch_approval_request_id]} label={s.shipment_code} /> : null}
            {s.dispatch_approval === "rejected" && me.permissions.has("dispatch.update") ? (
              <ResubmitTripButton shipmentId={s.id} shipmentCode={s.shipment_code} reason={s.dispatch_reject_reason} />
            ) : null}
          </span>
        </div>
      ) : s.dispatch_approval === "approved" && x.dispatch_approved_at ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {x.dispatch_approved_on_behalf
            ? `${who(x.dispatch_approved_by)} đã duyệt hộ Giám đốc (ủy quyền) lúc ${formatDateTime(x.dispatch_approved_at)}.`
            : `Giám đốc ${who(x.dispatch_approved_by)} đã duyệt lúc ${formatDateTime(x.dispatch_approved_at)}.`}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Thông tin chuyến</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <Item label="Đơn hàng">
                <Link href={`/dieu-phoi/don-hang/${s.order_id}`} className="text-primary hover:underline">
                  {s.order_code}
                </Link>{" "}
                <span className="text-muted-foreground">(chuyến thứ {s.sequence_in_order})</span>
              </Item>
              <Item label="Khách hàng">{s.customer_name}</Item>
              <Item label="Tuyến">
                <span className="flex flex-wrap items-center gap-1">
                  {s.pickup_name} <ArrowRight className="size-3.5 text-muted-foreground" /> {s.delivery_name}
                </span>
                {snap.route_name ? (
                  <span className="text-xs text-muted-foreground">
                    Tuyến {String(snap.route_name)}
                    {snap.route_distance_km ? `, ${formatNumber(snap.route_distance_km as number)} km` : ""}
                  </span>
                ) : null}
              </Item>
              <Item label="Loại xe">{s.vehicle_type_name ?? "–"}</Item>
              {s.empty_return_name || s.offroute_return_name ? (
                <Item label="Hạ rỗng">
                  {s.empty_return_name ?? "–"}
                  {s.offroute_return_name ? <span className="block font-medium text-amber-700 dark:text-amber-400">Trái tuyến: {s.offroute_return_name}</span> : null}
                </Item>
              ) : null}
              {s.trip_order || s.plan_code ? (
                <Item label="Thứ tự chuyến / kế hoạch">
                  {s.trip_order ? `Thứ tự ${s.trip_order}` : "–"}
                  {s.plan_code ? <span className="text-muted-foreground"> · kế hoạch {s.plan_code}</span> : null}
                </Item>
              ) : null}
              <Item label="SĐT điểm nhận / giao">
                {s.pickup_phone ? <a href={`tel:${s.pickup_phone.replace(/[^0-9+]/g, "")}`} className="text-primary hover:underline">{s.pickup_phone}</a> : "–"}
                {" / "}
                {s.delivery_phone ? <a href={`tel:${s.delivery_phone.replace(/[^0-9+]/g, "")}`} className="text-primary hover:underline">{s.delivery_phone}</a> : "–"}
              </Item>
              <Item label="Ngày nhận hàng">{formatDate(s.pickup_at)}</Item>
              <Item label="Ngày giao dự kiến">{s.expected_delivery_at ? formatDate(s.expected_delivery_at) : "–"}</Item>
              <Item label="Xe">{s.plate_number ?? "Chưa chọn"}</Item>
              <Item label="Tài xế">{s.driver_name ? `${s.driver_name} (${s.driver_code})` : "Chưa phân công"}</Item>
              {s.notes ? (
                <div className="sm:col-span-2">
                  <Item label="Ghi chú">{s.notes}</Item>
                </div>
              ) : null}
              <Item label="Người tạo">
                {who(x.created_by)} <span className="text-muted-foreground">· {formatDateTime(x.created_at)}</span>
              </Item>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Doanh thu chuyến</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Line label={`Cước (${formatNumber(s.quantity)} ${unit} × ${formatVND(s.unit_price)})`} value={formatVND(s.freight_amount)} />
            <Line label="Phụ phí" value={formatVND(s.surcharge_amount)} />
            <Line label={s.fuel_support_rate !== null ? `Hỗ trợ dầu ${formatNumber(s.fuel_support_rate)}%` : "Hỗ trợ dầu"} value={formatVND(s.fuel_support_amount)} />
            {feeGroups.freight.map((f) => (
              <Line key={f.line_no} label={`${f.fee_type?.name ?? "Phí"}${f.note ? ` (${f.note})` : ""}`} value={formatVND(f.amount)} />
            ))}
            <div className="border-t pt-2">
              <Line label="Tổng cước" value={<b>{formatVND(Number(s.freight_amount) + Number(s.surcharge_amount) + Number(s.fuel_support_amount) + feeGroups.freight.reduce((a, f) => a + Number(f.amount), 0))}</b>} />
            </div>
            {feeGroups.others.map((g) => (
              <div key={g.name} className="space-y-1.5 border-t pt-2">
                <div className="text-xs font-semibold text-muted-foreground">{g.name}</div>
                {g.lines.map((f) => (
                  <Line
                    key={f.line_no}
                    label={`${f.fee_type?.name ?? "Phí"}${f.declaration?.name ? ` · tờ khai ${f.declaration.name}` : ""}${f.quantity != null && f.unit_price != null ? ` · ${formatNumber(f.quantity)} × ${formatNumber(f.unit_price)}` : ""}${f.ref_no ? ` · số ${f.ref_no}` : ""}${f.fee_kind === "pass_through" ? " (chi hộ)" : ""}${f.note ? ` (${f.note})` : ""}`}
                    value={
                      f.fee_kind === "pass_through" || f.fee_type?.fee_group?.report_role === "pass_through" ? (
                        <span className="inline-flex items-center gap-1">
                          <DocumentsButton
                            entityType="shipment_fee"
                            entityId={s.id}
                            feeTypeId={f.fee_type_id}
                            count={feeDocs.get(f.fee_type_id) ?? 0}
                            title={`Hóa đơn ${f.fee_type?.name ?? "phí chi hộ"} · chuyến ${s.shipment_code}`}
                            label={feeDocs.get(f.fee_type_id) ? `PDF (${feeDocs.get(f.fee_type_id)})` : "Đính kèm"}
                            canUpload={me.permissions.has("documents.create") && s.status !== "cancelled"}
                          />
                          {formatVND(f.amount)}
                        </span>
                      ) : (
                        formatVND(f.amount)
                      )
                    }
                  />
                ))}
                <Line label={`Cộng ${g.name.toLowerCase()}`} value={<b>{formatVND(g.lines.reduce((a, f) => a + Number(f.amount), 0))}</b>} />
              </div>
            ))}
            <div className="border-t pt-2">
              <Line label="Tổng doanh thu" value={<b className="text-primary">{formatVND(s.total_revenue)}</b>} />
            </div>
            {Number(s.pass_through_amount) > 0 ? <Line label="Khách phải trả (gồm chi hộ)" value={<b>{formatVND(s.amount_due)}</b>} /> : null}
            {canEditFees ? <FeesDialog shipmentId={s.id} code={s.shipment_code} fees={fees} feeDocs={Object.fromEntries(feeDocs)} /> : null}
            <div className="space-y-1 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              <p>
                Giá:{" "}
                {snap.price_source === "price_list"
                  ? `bảng giá ${String(snap.price_list_code)} (mức cụ thể ${String(snap.price_specificity)}, ưu tiên ${String(snap.price_priority)})`
                  : snap.price_source === "manual"
                    ? "nhập tay (không có bảng giá phù hợp)"
                    : snap.price_source === "excel"
                      ? "theo file Excel đã nhập"
                      : snap.price_source === "pending"
                      ? Number(s.unit_price)
                        ? "nhập sau khi tạo chuyến"
                        : "chưa có giá. Nhập đơn giá và phụ phí ở bảng Quản lý chuyến xe (bấm vào ô Đơn giá để sửa)"
                      : "dữ liệu nhập trước Giai đoạn 4"}
              </p>
              {snap.fuel_source ? (
                <p>
                  Hỗ trợ dầu: {FUEL_SOURCE[String(snap.fuel_source)] ?? String(snap.fuel_source)}
                  {s.fuel_support_base ? `, tính trên ${FUEL_BASE[s.fuel_support_base] ?? s.fuel_support_base}` : ""}
                </p>
              ) : null}
              {snap.quoted_at ? <p>Chụp giá lúc {formatDateTime(String(snap.quoted_at))}; bảng giá đổi sau này không làm đổi chuyến.</p> : null}
            </div>
            {canExpenses ? (
              <div className="space-y-2 border-t pt-2">
                <Line label="Chi phí đã duyệt" value={formatVND(approvedCost)} />
                {pendingCost ? <Line label="Chi phí chờ duyệt (chưa tính)" value={formatVND(pendingCost)} /> : null}
                <Line
                  label="Lời/lỗ (xem chi tiết bên dưới)"
                  value={
                    <a href="#loi-lo" className="font-semibold hover:underline">
                      {formatVND(profit ? Number(profit.profit) : Number(s.total_revenue) - approvedCost)}
                    </a>
                  }
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {canExpenses ? (
          <ProfitCard
            profit={profit}
            revenue={Number(s.total_revenue)}
            costLines={costLines}
            plate={s.plate_number}
            vehicleId={s.vehicle_id}
            outsourced={is3pl}
            addExpense={
              me.permissions.has("expenses.create") && s.status !== "cancelled" ? (
                <a href="#chi-phi-dau-ra" className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card px-3 text-sm font-medium hover:bg-muted">
                  + Nhập chi phí đầu ra
                </a>
              ) : null
            }
          />
        ) : null}

        {canSeeCarrier && (is3pl || carrierCosts.length) ? (
          <CarrierCard
            shipmentId={s.id}
            code={s.shipment_code}
            outsourced={is3pl}
            supplierId={x.carrier_supplier_id ?? x.vehicle?.supplier_id ?? null}
            supplierName={x.carrier?.name ?? x.vehicle?.supplier?.name ?? null}
            costs={carrierCosts}
            payable={carrierPayable}
            canSeePayable={canSeePayable}
            customerPassThrough={fees
              .filter((f) => f.fee_kind === "pass_through")
              .map((f) => ({ fee_type_id: f.fee_type_id, name: f.fee_type?.name ?? "Chi hộ", amount: Number(f.amount), ref_no: f.ref_no, note: f.note }))}
            canEdit={
              (me.permissions.has("dispatch.update") || me.permissions.has("shipments.update") || me.permissions.has("receivables.create")) && s.status !== "cancelled"
            }
          />
        ) : null}

        <CustomFieldsCard
          shipmentId={s.id}
          version={s.version}
          fields={custom.defs}
          values={s.custom_fields ?? {}}
          context={formulaVars("shipments", s as unknown as Record<string, unknown>, {})}
          canEdit={me.permissions.has("shipments.update") || me.permissions.has("dispatch.update")}
          canAddField={me.permissions.has("fields.configure")}
        />

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Lịch sử trạng thái</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-3 border-l pl-4 text-sm">
              {history.map((h) => {
                const f = STATUS_FIELD[h.status_field] ?? STATUS_FIELD.status;
                return (
                  <li key={h.id}>
                    <span className="absolute -left-1.5 mt-1.5 size-3 rounded-full border-2 border-card bg-primary" />
                    <div>
                      <span className="text-muted-foreground">{f.name}: </span>
                      {h.from_status ? (
                        <>
                          {f.label(h.from_status)} <ArrowRight className="inline size-3.5 text-muted-foreground" />{" "}
                        </>
                      ) : null}
                      <b>{f.label(h.to_status)}</b>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(h.changed_at)} · {who(h.changed_by)}
                      {h.note ? ` · ${h.note}` : ""}
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lịch sử phân công</CardTitle>
          </CardHeader>
          <CardContent>
            {assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa phân công lần nào.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {assignments.map((a) => {
                  const r = ASSIGN_RESPONSE[a.response] ?? { label: a.response, variant: "muted" as const };
                  return (
                    <li key={a.id}>
                      <div className="flex flex-wrap items-center gap-2">
                        <b>{a.driver ? `${a.driver.full_name} (${a.driver.code})` : "Tài xế"}</b>
                        {a.vehicle ? <span className="text-muted-foreground">· {a.vehicle.plate_number}</span> : null}
                        <Badge variant={r.variant}>{r.label}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Phân công {formatDateTime(a.assigned_at)} bởi {who(a.assigned_by)}
                        {a.responded_at ? ` · cập nhật ${formatDateTime(a.responded_at)}` : ""}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Lịch sử thay đổi giá, khối lượng, xe, tài xế</CardTitle>
          </CardHeader>
          <CardContent>
            {changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có thay đổi nào sau khi tạo chuyến.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Thời gian</th>
                      <th className="py-1.5 pr-3 font-medium">Người sửa</th>
                      <th className="py-1.5 pr-3 font-medium">Trường</th>
                      <th className="py-1.5 pr-3 font-medium">Giá trị cũ</th>
                      <th className="py-1.5 font-medium">Giá trị mới</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((c, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-1.5 pr-3 whitespace-nowrap">{formatDateTime(c.occurred_at)}</td>
                        <td className="py-1.5 pr-3">{c.actor_name ?? "Hệ thống"}</td>
                        <td className="py-1.5 pr-3">{FIELD_LABELS[c.field] ?? c.field}</td>
                        <td className="py-1.5 pr-3 text-muted-foreground">{fmtChange(c.field, c.old_value)}</td>
                        <td className="py-1.5">{fmtChange(c.field, c.new_value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card id="lam-thay" className="scroll-mt-20">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Giao hàng và chứng từ</CardTitle>
            <DocumentsButton
              entityType="shipment"
              entityId={s.id}
              count={docCount}
              title={`Chứng từ chuyến ${s.shipment_code}`}
              canUpload={me.permissions.has("documents.create")}
              variant="outline"
            />
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {canActForDriver ? (
              <ActForDriver
                shipmentId={s.id}
                code={s.shipment_code}
                status={s.status}
                driverName={s.driver_name ?? ""}
                outsourced={is3pl}
                canUpload={me.permissions.has("documents.create")}
              />
            ) : me.permissions.has("dispatch.update") && approvalBlocked && s.driver_id ? (
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                Nút <b>Nhận đơn thay tài xế</b>, <b>Bắt đầu chạy</b>, <b>Hoàn thành</b> hiện sau khi Giám đốc duyệt chuyến
                {s.dispatch_approval === "rejected" ? " (chuyến đang bị từ chối, sửa rồi Gửi duyệt lại)" : " (chuyến đang Chờ GĐ duyệt)"}.
              </p>
            ) : null}
            {x.photo_skip_reason ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
                Hoàn thành khi chưa có ảnh, chứng từ. Lý do: <b>{x.photo_skip_reason}</b>. Bấm nút Chứng từ ở trên để tải bổ sung.
              </p>
            ) : null}
            {x.completed_at ? (
              <>
                <Line label="Hoàn thành lúc" value={formatDateTime(x.completed_at)} />
                {x.delivery_result ? <Line label="Kết quả" value={RESULT_LABEL[x.delivery_result] ?? x.delivery_result} /> : null}
                {x.completion_note ? <p className="rounded-md bg-muted/50 p-2">Ghi chú tài xế: {x.completion_note}</p> : null}
                {x.expense_declaration ? (
                  <Line
                    label="Chi phí tài xế"
                    value={
                      x.expense_declaration === "none"
                        ? "Tài xế xác nhận không phát sinh chi phí"
                        : sheetCount
                          ? `Tài xế báo có chi phí, gửi ${sheetCount} ảnh phiếu chi phí`
                          : "Tài xế khai có chi phí (xem mục Chi phí)"
                    }
                  />
                ) : null}
                {x.expense_declaration === "has" && sheetCount > 0 && !expenses.some((e) => e.paid_by === "driver" && e.status !== "cancelled") ? (
                  <p data-sheet-todo className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
                    Chờ nhập chi phí: mở <b>Chứng từ</b> ở trên (ảnh loại Biên lai / phiếu chi phí), rồi nhập từng khoản ở mục <b>Chi phí chuyến</b> bên dưới, nguồn chi &quot;Chi bởi tài xế&quot;.
                  </p>
                ) : null}
              </>
            ) : x.departed_pickup_at ? (
              <Line label="Bắt đầu chạy lúc" value={formatDateTime(x.departed_pickup_at)} />
            ) : (
              <p className="text-muted-foreground">Tài xế chưa bắt đầu chạy.</p>
            )}
            <Line label="Khách yêu cầu chụp chứng từ" value={x.pod_photo_required ? "Có (tài xế bắt buộc chụp)" : "Không"} />
            <Line label="Ảnh, chứng từ đã nộp" value={`${docCount} tệp`} />
          </CardContent>
        </Card>

        <ItemsCard
          shipmentId={s.id}
          items={(itemRes.data ?? []) as ShipmentItem[]}
          fields={moduleCustomFields("shipment_items", visibleCustomRows(itemFieldRows, me.permissions), me.permissions)}
          layout={layoutOf("shipment_items", itemFieldRows)}
          fieldRows={itemFieldRows}
          canEdit={(me.permissions.has("dispatch.update") || me.permissions.has("dispatch.create")) && !["closed", "cancelled"].includes(s.status)}
          canAddField={me.permissions.has("fields.configure")}
        />

        {canExpenses ? (
          <TripCostsCard
            shipmentId={s.id}
            shipmentCode={s.shipment_code}
            costs={expenses}
            approvable={Object.fromEntries(approvable)}
            canCreate={me.permissions.has("expenses.create") && s.status !== "cancelled"}
            canCancel={me.permissions.has("expenses.update") || me.permissions.has("expenses.delete")}
            canCancelOwnPending={me.permissions.has("expenses.create")}
            carrier={
              canSeeCarrier && (is3pl || carrierCosts.length)
                ? {
                    supplierId: x.carrier_supplier_id ?? x.vehicle?.supplier_id ?? null,
                    lines: carrierCosts,
                    outsource: outsourceCat,
                    supplierName: x.carrier?.name ?? x.vehicle?.supplier?.name ?? null,
                    freight: carrierCosts.filter((c) => c.cost_kind === "freight").reduce((a, c) => a + Number(c.amount), 0),
                    other: carrierCosts.filter((c) => c.cost_kind === "other").reduce((a, c) => a + Number(c.amount), 0),
                    passThrough: carrierCosts.filter((c) => c.cost_kind === "pass_through").reduce((a, c) => a + Number(c.amount), 0),
                    canEdit:
                      (me.permissions.has("dispatch.update") || me.permissions.has("shipments.update") || me.permissions.has("receivables.create")) && s.status !== "cancelled",
                  }
                : null
            }
          />
        ) : null}
      </div>
    </>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
