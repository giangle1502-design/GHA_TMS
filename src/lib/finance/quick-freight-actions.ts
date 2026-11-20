"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { isUuid } from "@/lib/entities/record";
import type { ShipmentFee } from "@/app/(app)/chuyen-xe/[id]/fees-dialog";
import type { CarrierCost } from "@/components/finance/carrier-dialogs";
import type { ShipmentListRow } from "@/lib/shipments";

/**
 * Khung "Nhập cước" (làm theo app Khánh Hà): giá, phí thu khách, chi phí 3PL của một chuyến trong một khung,
 * mở từ bảng Điều phối, Quản lý chuyến xe và chi tiết chuyến. GHA thêm bảng giá đi kèm để lấy giá.
 */
export type QuickFreight = {
  id: string;
  code: string;
  status: string;
  version: number;
  /** Số lần lưu chuyến (khóa sửa 0061); null = CSDL chưa nâng cấp, không khóa */
  rev: number | null;
  customerName: string | null;
  routeLabel: string | null;
  pickupAt: string;
  unitPrice: number;
  pricingUnit: string;
  quantity: number;
  surcharge: number;
  fuelRate: number | null;
  fuelBase: string | null;
  fuelAmount: number;
  /** Đã lập công nợ phải thu: không sửa giá, phí thu khách */
  billed: boolean;
  canEditFees: boolean;
  /** Trọng lượng chuyến (tấn) từ mã hàng × số lượng; null = chưa quy ra kg được */
  tons: number | null;
  /** Số dòng hàng chưa quy ra kg (thiếu kg/đơn vị) */
  itemsNoWeight: number;
  itemCount: number;
  /** Xem được bảng giá (quyền Bảng giá) */
  canSeePrices: boolean;
  fees: ShipmentFee[];
  feeDocs: Record<string, number>;
  /** Chuyến chạy nhà xe 3PL (xe thuê ngoài / xe có nhà xe / chuyến đã ghi nhà xe) hoặc đã có khoản 3PL */
  carrier: null | {
    canEdit: boolean;
    supplierId: string | null;
    supplierName: string | null;
    invoiceNo: string | null;
    dueDate: string | null;
    paidAmount: number;
    costs: CarrierCost[];
    loadingFeeTypes: { id: string; name: string }[];
    loadingUnitPrice: number;
    tripTons: number;
  };
};

const FEE_COLS =
  "line_no, fee_type_id, fee_kind, amount, note, declaration_type_id, ref_no, quantity, unit_price, declaration:declaration_types(name), fee_type:fee_types(name, sort_order, is_loading, fee_group:fee_groups(id, name, report_role, sort_order))";

/** opts.carrier: luôn trả phần chi phí 3PL (mở từ trang Phí chưa nhập để nhập bốc xếp cho cả chuyến xe nội bộ) */
export async function loadQuickFreight(shipmentId: string, opts: { carrier?: boolean } = {}): Promise<ActionResult<QuickFreight>> {
  return runAction(async () => {
    const me = await requirePermission("dispatch.update", "shipments.update", "receivables.create");
    if (!isUuid(shipmentId)) throw new ActionError("Dữ liệu không hợp lệ.");
    const has = (k: string) => me.permissions.has(k as never);
    // Chi phí 3PL: chỉ người xem được nhà xe 3PL (tài khoản khách hàng không có quyền này)
    const canSeeCarrier = has("carriers.view") && ["dispatch.view", "receivables.view", "reports.view", "expenses.view"].some(has);
    const supabase = await createClient();
    const [rowRes, extraRes, feeRes, docRes, carrierRes, payRes, lockRes, itemRes] = await Promise.all([
      supabase
        .from("shipment_list")
        .select("id, shipment_code, status, version, customer_name, route_label, pickup_name, delivery_name, pickup_at, unit_price, pricing_unit, quantity, surcharge_amount, fuel_support_rate, fuel_support_base, fuel_support_amount")
        .eq("id", shipmentId)
        .maybeSingle(),
      supabase
        .from("shipments")
        .select("receivable_id, carrier_supplier_id, carrier:suppliers(name), vehicle:vehicles!shipments_vehicle_id_fkey(ownership_type, supplier_id, supplier:suppliers(name))")
        .eq("id", shipmentId)
        .maybeSingle(),
      supabase.from("shipment_fees").select(FEE_COLS).eq("shipment_id", shipmentId).order("line_no"),
      supabase.from("documents").select("fee_type_id").eq("entity_type", "shipment_fee").eq("entity_id", shipmentId).is("archived_at", null),
      canSeeCarrier
        ? supabase.from("shipment_carrier_costs").select("*, supplier:suppliers(name), fee_type:fee_types(name, is_loading)").eq("shipment_id", shipmentId).order("line_no")
        : Promise.resolve({ data: [], error: null }),
      canSeeCarrier
        ? supabase.from("payables").select("paid_amount, due_date, invoice_no").eq("shipment_id", shipmentId).eq("kind", "carrier").neq("status", "cancelled").maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase.rpc("shipment_edit_status", { p_shipment_id: shipmentId }),
      supabase.from("shipment_items").select("quantity, unit, weight_kg").eq("shipment_id", shipmentId),
    ]);
    for (const r of [rowRes, extraRes, feeRes, carrierRes]) if (r.error) throw r.error;
    const s = rowRes.data as Record<string, unknown> | null;
    const x = extraRes.data as unknown as {
      receivable_id: string | null;
      carrier_supplier_id: string | null;
      carrier: { name: string } | null;
      vehicle: { ownership_type: string | null; supplier_id: string | null; supplier: { name: string } | null } | null;
    } | null;
    if (!s || !x) throw new ActionError("Không tìm thấy chuyến.");
    const status = String(s.status);
    const canUpdate = has("dispatch.update") || has("shipments.update");
    const costs = (carrierRes.data ?? []) as unknown as CarrierCost[];
    const is3pl = x.vehicle?.ownership_type === "outsourced" || Boolean(x.vehicle?.supplier_id) || Boolean(x.carrier_supplier_id);
    const pay = (payRes.error ? null : payRes.data) as { paid_amount: number; due_date: string | null; invoice_no: string | null } | null;
    const feeDocs: Record<string, number> = {};
    for (const d of (docRes.data ?? []) as { fee_type_id: string | null }[]) if (d.fee_type_id) feeDocs[d.fee_type_id] = (feeDocs[d.fee_type_id] ?? 0) + 1;

    // Trọng lượng: kg quy đổi theo mã hàng; dòng ĐVT kg thì lấy luôn số lượng
    const items = (itemRes.data ?? []) as { quantity: number | null; unit: string | null; weight_kg: number | null }[];
    let kg = 0;
    let itemsNoWeight = 0;
    for (const it of items) {
      const w = it.weight_kg !== null ? Number(it.weight_kg) : /^\s*kg\s*$/i.test(it.unit ?? "") && it.quantity !== null ? Number(it.quantity) : null;
      if (w === null) itemsNoWeight++;
      else kg += w;
    }
    const tons = items.length && itemsNoWeight < items.length ? Math.round(kg) / 1000 : null;

    let carrier: QuickFreight["carrier"] = null;
    if (canSeeCarrier && (is3pl || costs.length || opts.carrier)) {
      // Bốc xếp 3PL: loại phí nhóm Bốc xếp, đơn giá mặc định (đ/tấn), trọng lượng chuyến (tấn) như chi tiết chuyến
      const [typesRes, priceRes, weightRes] = await Promise.all([
        supabase.from("fee_types").select("id, name").eq("is_loading", true).eq("is_active", true).order("sort_order"),
        supabase.from("system_settings").select("value").eq("key", "loading.unit_price_per_ton").maybeSingle(),
        supabase.from("shipment_items").select("weight_kg").eq("shipment_id", shipmentId),
      ]);
      carrier = {
        canEdit: (canUpdate || has("receivables.create")) && status !== "cancelled",
        supplierId: x.carrier_supplier_id ?? x.vehicle?.supplier_id ?? null,
        supplierName: x.carrier?.name ?? x.vehicle?.supplier?.name ?? null,
        invoiceNo: pay?.invoice_no ?? null,
        dueDate: pay?.due_date ?? null,
        paidAmount: Number(pay?.paid_amount ?? 0),
        costs,
        loadingFeeTypes: ((typesRes.data ?? []) as { id: string; name: string }[]).map((t) => ({ id: String(t.id), name: String(t.name) })),
        loadingUnitPrice: Number((priceRes.data as { value?: unknown } | null)?.value ?? 40000) || 40000,
        tripTons: Math.round(((weightRes.data ?? []) as { weight_kg: number | null }[]).reduce((a, r) => a + Number(r.weight_kg ?? 0), 0)) / 1000,
      };
    }

    return {
      id: String(s.id),
      code: String(s.shipment_code),
      status,
      version: Number(s.version),
      rev: lockRes.error ? null : Number((lockRes.data as { rev?: number } | null)?.rev ?? 0),
      customerName: (s.customer_name as string | null) ?? null,
      routeLabel: (s.route_label as string | null) ?? (s.pickup_name && s.delivery_name ? `${s.pickup_name} → ${s.delivery_name}` : null),
      pickupAt: String(s.pickup_at),
      unitPrice: Number(s.unit_price ?? 0),
      pricingUnit: String(s.pricing_unit ?? "trip"),
      quantity: Number(s.quantity ?? 1),
      surcharge: Number(s.surcharge_amount ?? 0),
      fuelRate: s.fuel_support_rate === null || s.fuel_support_rate === undefined ? null : Number(s.fuel_support_rate),
      fuelBase: (s.fuel_support_base as string | null) ?? null,
      fuelAmount: Number(s.fuel_support_amount ?? 0),
      billed: Boolean(x.receivable_id),
      canEditFees: canUpdate && status !== "cancelled" && !x.receivable_id,
      tons,
      itemsNoWeight,
      itemCount: items.length,
      canSeePrices: has("price_lists.view"),
      fees: (feeRes.data ?? []) as unknown as ShipmentFee[],
      feeDocs,
      carrier,
    };
  });
}

const priceSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  unitPrice: z.number().min(0, "Đơn giá không được âm").max(100_000_000_000),
  surchargeAmount: z.number().min(0, "Phụ phí không được âm").max(100_000_000_000),
  fuelSupportRate: z.number().min(0, "Tỷ lệ hỗ trợ dầu từ 0 đến 100").max(100, "Tỷ lệ hỗ trợ dầu từ 0 đến 100").nullable(),
});

/** Lưu đơn giá, phụ phí, % hỗ trợ dầu của chuyến; tiền dầu do CSDL tự tính lại (Cước = Đơn giá × (1 + % dầu)) */
export async function saveQuickFreightPrice(input: z.input<typeof priceSchema>): Promise<ActionResult<ShipmentListRow>> {
  return runAction(async () => {
    await requirePermission("shipments.update", "dispatch.update");
    const p = priceSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ.");
    const d = p.data;
    const supabase = await createClient();
    const { data: cur, error: curErr } = await supabase.from("shipments").select("status, fuel_support_base, receivable_id").eq("id", d.id).maybeSingle();
    if (curErr) throw curErr;
    if (!cur) throw new ActionError("Không tìm thấy chuyến.");
    if (cur.status === "cancelled") throw new ActionError("Chuyến đã hủy, không sửa được giá.");
    if (cur.receivable_id) throw new ActionError("Chuyến đã lập công nợ phải thu, không sửa được giá.");
    const patch: Record<string, unknown> = { unit_price: d.unitPrice, surcharge_amount: d.surchargeAmount, fuel_support_rate: d.fuelSupportRate };
    // Nhập % dầu cho chuyến chưa có cơ sở tính: mặc định tính trên doanh thu cước (đơn giá × số lượng)
    if (d.fuelSupportRate === null) Object.assign(patch, { fuel_support_base: null, fuel_support_amount: 0 });
    else if (!cur.fuel_support_base) patch.fuel_support_base = "freight_revenue";
    const { data, error } = await supabase.from("shipments").update(patch).eq("id", d.id).eq("version", d.version).select("id");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Chuyến vừa được người khác sửa. Đóng khung rồi mở lại để lấy bản mới.");
    const { data: row, error: rowErr } = await supabase.from("shipment_list").select("*").eq("id", d.id).single();
    if (rowErr) throw rowErr;
    revalidatePath(`/chuyen-xe/${d.id}`);
    return row as ShipmentListRow;
  }, "Đã lưu giá chuyến.");
}
