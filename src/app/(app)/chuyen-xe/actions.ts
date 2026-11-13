"use server";
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { formatDate, todayVN } from "@/lib/format";
import { isUuid, splitCustom, validateRecord } from "@/lib/entities/record";
import { LOCKED_STATUSES, PRICING_UNITS, documentStatus, settlementStatus, shipmentStatus } from "@/lib/status";
import { formatValue } from "@/lib/entities/record";
import { computeFormula } from "@/lib/formula";
import { formulaVars } from "@/lib/entities/definitions";
import { applyShipmentFilters, parseShipmentFilters, shipmentCustomFields } from "@/lib/shipments-query";
import type { ShipmentListRow } from "@/lib/shipments";

/** Các trường được sửa nhanh trên bảng; mọi thay đổi được ghi nhật ký hệ thống (trigger audit) */
const EDITABLE = {
  quantity: z.number().positive("Số lượng phải lớn hơn 0").max(1_000_000),
  unit_price: z.number().min(0, "Đơn giá không được âm").max(100_000_000_000),
  surcharge_amount: z.number().min(0, "Phụ phí không được âm").max(100_000_000_000),
  fuel_support_rate: z.number().min(0).max(100, "Tỷ lệ hỗ trợ dầu từ 0 đến 100").nullable(),
  notes: z.string().trim().max(1000).nullable(),
} as const;
export type EditableField = keyof typeof EDITABLE;

export async function updateShipmentField(
  id: string,
  field: EditableField,
  value: number | string | null,
  version: number,
): Promise<ActionResult<ShipmentListRow>> {
  return runAction(async () => {
    await requirePermission("shipments.update", "dispatch.update");
    if (!isUuid(id) || !(field in EDITABLE) || !Number.isInteger(version)) throw new ActionError("Dữ liệu không hợp lệ.");
    const parsed = EDITABLE[field].safeParse(field === "notes" ? (value === "" ? null : value) : value);
    if (!parsed.success) throw new ActionError(parsed.error.issues[0]?.message ?? "Giá trị không hợp lệ.");
    const supabase = await createClient();
    const { data: cur, error: curErr } = await supabase.from("shipments").select("status, fuel_support_base").eq("id", id).maybeSingle();
    if (curErr) throw curErr;
    if (!cur) throw new ActionError("Không tìm thấy chuyến.");
    if (field !== "notes" && LOCKED_STATUSES.includes(cur.status)) throw new ActionError("Chuyến đã hủy, không sửa được giá.");
    const patch: Record<string, unknown> = { [field]: parsed.data };
    // Nhập tỷ lệ hỗ trợ dầu cho chuyến chưa có cơ sở tính: mặc định tính trên doanh thu cước
    if (field === "fuel_support_rate") {
      if (parsed.data === null) Object.assign(patch, { fuel_support_base: null, fuel_support_amount: 0 });
      else if (!cur.fuel_support_base) patch.fuel_support_base = "freight_revenue";
    }
    const { data, error } = await supabase.from("shipments").update(patch).eq("id", id).eq("version", version).select("id");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Chuyến vừa được người khác sửa. Vui lòng tải lại trang rồi thử lại.");
    const { data: row, error: rowErr } = await supabase.from("shipment_list").select("*").eq("id", id).single();
    if (rowErr) throw rowErr;
    revalidatePath(`/chuyen-xe/${id}`);
    return row as ShipmentListRow;
  }, "Đã lưu.");
}

export type FileResult = { filename: string; base64: string; count: number; truncated: boolean };

const EXPORT_LIMIT = 5000;

/** Xuất bảng tổng hợp chuyến theo bộ lọc đang chọn */
export async function exportShipments(sp: Record<string, string | string[] | undefined>): Promise<ActionResult<FileResult>> {
  return runAction(async () => {
    const me = await requirePermission("shipments.export");
    const supabase = await createClient();
    const custom = await shipmentCustomFields(supabase, me.permissions);
    const f = parseShipmentFilters(sp, custom.adv);
    const { data, error } = await applyShipmentFilters(supabase.from("shipment_list").select("*"), f)
      .neq("status", "cancelled")
      .order("pickup_at")
      .order("shipment_code")
      .limit(EXPORT_LIMIT + 1);
    if (error) throw error;
    const all = (data ?? []) as ShipmentListRow[];
    const rows = all.slice(0, EXPORT_LIMIT);

    const wb = new ExcelJS.Workbook();
    wb.creator = "KHÁNH HÀ TMS";
    const ws = wb.addWorksheet("Chuyến xe");
    const money = "#,##0";
    ws.columns = [
      { header: "Ngày nhận", key: "pickup_at", width: 12 },
      { header: "Mã chuyến", key: "shipment_code", width: 18 },
      { header: "Mã đơn hàng", key: "order_code", width: 18 },
      { header: "Khách hàng", key: "customer_name", width: 28 },
      { header: "Điểm nhận", key: "pickup_name", width: 26 },
      { header: "Điểm giao", key: "delivery_name", width: 26 },
      { header: "Tuyến đường", key: "route_label", width: 40 },
      { header: "Điểm hạ rỗng", key: "empty_return_name", width: 24 },
      { header: "Điểm hạ rỗng trái tuyến", key: "offroute_return_name", width: 24 },
      { header: "Thứ tự chuyến", key: "trip_order", width: 10 },
      { header: "Mã kế hoạch", key: "plan_code", width: 12 },
      { header: "Ngày giao dự kiến", key: "expected_delivery_at", width: 14 },
      { header: "Loại xe", key: "vehicle_type_name", width: 18 },
      { header: "Biển số", key: "plate_number", width: 12 },
      { header: "Tài xế", key: "driver_name", width: 22 },
      { header: "Số lượng", key: "quantity", width: 10 },
      { header: "Đơn vị tính", key: "pricing_unit", width: 11 },
      { header: "Đơn giá", key: "unit_price", width: 14, style: { numFmt: money } },
      { header: "Cước vận chuyển", key: "freight_amount", width: 15, style: { numFmt: money } },
      { header: "Phụ phí", key: "surcharge_amount", width: 13, style: { numFmt: money } },
      { header: "Tỷ lệ hỗ trợ dầu (%)", key: "fuel_support_rate", width: 12 },
      { header: "Hỗ trợ dầu", key: "fuel_support_amount", width: 14, style: { numFmt: money } },
      { header: "Phí vận chuyển", key: "transport_fee", width: 15, style: { numFmt: money } },
      { header: "Phí chi hộ", key: "pass_through_fee", width: 13, style: { numFmt: money } },
      { header: "Phí tờ khai", key: "declaration_fee", width: 13, style: { numFmt: money } },
      { header: "Phí bốc xếp", key: "loading_fee", width: 13, style: { numFmt: money } },
      { header: "Doanh thu", key: "total_revenue", width: 15, style: { numFmt: money } },
      { header: "Khách phải trả", key: "amount_due", width: 15, style: { numFmt: money } },
      { header: "Trạng thái", key: "status", width: 22 },
      { header: "Chứng từ", key: "document_status", width: 16 },
      { header: "Quyết toán", key: "settlement_status", width: 18 },
      { header: "Ghi chú", key: "notes", width: 30 },
      ...custom.defs.map((d) => ({ header: d.label, key: `cf_${d.key}`, width: 18 })),
    ];
    for (const r of rows) {
      ws.addRow({
        ...r,
        ...Object.fromEntries(custom.defs.map((d) => [`cf_${d.key}`, formatValue(d, d.type === "formula" ? computeFormula(d.formula, formulaVars("shipments", r as unknown as Record<string, unknown>, r.custom_fields)) : r.custom_fields?.[d.key])])),
        pickup_at: formatDate(r.pickup_at),
        expected_delivery_at: r.expected_delivery_at ? formatDate(r.expected_delivery_at) : "",
        quantity: Number(r.quantity),
        pricing_unit: PRICING_UNITS[r.pricing_unit] ?? r.pricing_unit,
        unit_price: Number(r.unit_price),
        freight_amount: Number(r.freight_amount),
        surcharge_amount: Number(r.surcharge_amount),
        fuel_support_rate: r.fuel_support_rate === null ? null : Number(r.fuel_support_rate),
        fuel_support_amount: Number(r.fuel_support_amount),
        total_revenue: Number(r.total_revenue),
        transport_fee: Number(r.transport_fee ?? 0),
        pass_through_fee: Number(r.pass_through_fee ?? 0),
        declaration_fee: Number(r.declaration_fee ?? 0),
        loading_fee: Number(r.loading_fee ?? 0),
        amount_due: Number(r.amount_due),
        status: shipmentStatus(r.status).label,
        document_status: documentStatus(r.document_status).label,
        settlement_status: settlementStatus(r.settlement_status).label,
      });
    }
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    ws.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
    const buf = await wb.xlsx.writeBuffer();
    return {
      filename: `chuyen-xe_${f.tu}_${f.den}_xuat-${todayVN()}.xlsx`,
      base64: Buffer.from(buf as ArrayBuffer).toString("base64"),
      count: rows.length,
      truncated: all.length > EXPORT_LIMIT,
    };
  });
}

/** Sửa các trường bổ sung của chuyến (giữ nguyên trường người dùng không được xem/sửa) */
export async function updateShipmentCustom(id: string, values: Record<string, unknown>, version: number): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requirePermission("shipments.update", "dispatch.update");
    if (!isUuid(id) || !Number.isInteger(version)) throw new ActionError("Dữ liệu không hợp lệ.");
    const supabase = await createClient();
    const editable = (await shipmentCustomFields(supabase, me.permissions)).defs.filter((d) => !d.readOnly && d.type !== "formula");
    if (!editable.length) throw new ActionError("Chuyến chưa có trường bổ sung nào bạn được sửa.");
    const { data: parsed, errors } = validateRecord(editable, values ?? {});
    const first = Object.values(errors)[0];
    if (first) throw new ActionError(first);
    const { data: cur, error: curErr } = await supabase.from("shipments").select("custom_fields").eq("id", id).maybeSingle();
    if (curErr) throw curErr;
    if (!cur) throw new ActionError("Không tìm thấy chuyến.");
    const merged = { ...((cur.custom_fields as Record<string, unknown>) ?? {}), ...splitCustom(editable, parsed).custom };
    const { data, error } = await supabase.from("shipments").update({ custom_fields: merged }).eq("id", id).eq("version", version).select("id");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Chuyến vừa được người khác sửa. Vui lòng tải lại trang rồi thử lại.");
    revalidatePath(`/chuyen-xe/${id}`);
  }, "Đã lưu trường bổ sung.");
}

const optNumber = (msg: string, max = 100_000_000_000) => z.number().min(0, msg).max(max).nullable();
const coreSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int(),
    pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Chọn ngày nhận hàng"),
    expectedDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    pickupLocationId: z.uuid("Chọn điểm nhận"),
    deliveryLocationId: z.uuid("Chọn điểm giao"),
    vehicleTypeId: z.uuid().nullable(),
    quantity: z.number().positive("Số lượng phải lớn hơn 0").max(1_000_000),
    unitPrice: z.number().min(0, "Đơn giá không được âm").max(100_000_000_000),
    pricingUnit: z.enum(["trip", "km", "ton", "other"]),
    surchargeAmount: z.number().min(0, "Phụ phí không được âm").max(100_000_000_000),
    fuelSupportRate: optNumber("Tỷ lệ hỗ trợ dầu từ 0 đến 100", 100),
    notes: z.string().trim().max(1000).nullable(),
  })
  .refine((v) => v.pickupLocationId !== v.deliveryLocationId, { message: "Điểm nhận và điểm giao phải khác nhau" })
  .refine((v) => !v.expectedDeliveryDate || v.expectedDeliveryDate >= v.pickupDate, { message: "Ngày giao dự kiến không được trước ngày nhận hàng" });

/** Sửa thông tin chuyến tạo sai (ngày, điểm nhận/giao, loại xe, số lượng, giá, ghi chú) khi chuyến chưa đóng/hủy */
export async function updateShipmentCore(input: z.input<typeof coreSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("shipments.update", "dispatch.update");
    const p = coreSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ.");
    const d = p.data;
    const supabase = await createClient();
    const { data: cur, error: curErr } = await supabase.from("shipments").select("status, fuel_support_base").eq("id", d.id).maybeSingle();
    if (curErr) throw curErr;
    if (!cur) throw new ActionError("Không tìm thấy chuyến.");
    if (LOCKED_STATUSES.includes(cur.status)) throw new ActionError("Chuyến đã hủy, không sửa được.");
    const patch: Record<string, unknown> = {
      pickup_at: `${d.pickupDate}T00:00:00+07:00`,
      expected_delivery_at: d.expectedDeliveryDate ? `${d.expectedDeliveryDate}T23:59:59+07:00` : null,
      pickup_location_id: d.pickupLocationId,
      delivery_location_id: d.deliveryLocationId,
      vehicle_type_id: d.vehicleTypeId,
      quantity: d.quantity,
      unit_price: d.unitPrice,
      pricing_unit: d.pricingUnit,
      surcharge_amount: d.surchargeAmount,
      fuel_support_rate: d.fuelSupportRate,
      notes: d.notes || null,
    };
    if (d.fuelSupportRate === null) Object.assign(patch, { fuel_support_base: null, fuel_support_amount: 0 });
    else if (!cur.fuel_support_base) patch.fuel_support_base = "freight_revenue";
    const { data, error } = await supabase.from("shipments").update(patch).eq("id", d.id).eq("version", d.version).select("id");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Chuyến vừa được người khác sửa. Vui lòng tải lại trang rồi thử lại.");
    revalidatePath(`/chuyen-xe/${d.id}`);
    revalidatePath("/dieu-phoi", "layout");
  }, "Đã lưu thay đổi của chuyến.");
}
