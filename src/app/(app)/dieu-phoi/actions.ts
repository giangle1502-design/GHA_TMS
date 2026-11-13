"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { addDaysYMD, startOfDayVN } from "@/lib/format";
import { lastDayOfMonth, loadTrips, tripDay } from "@/lib/trip-counts";
import { ActionError, requirePermission, runAction, toUserMessage, type ActionResult } from "@/lib/auth/action";
import { loadCustomFields, visibleCustomRows } from "@/lib/entities/server";
import { assertActiveRefs } from "@/lib/entities/active-check";
import { moduleCustomFields, parseNumberVN, splitCustom, validateRecord } from "@/lib/entities/record";
import type { FieldDef } from "@/lib/entities/types";

/** Kiểm tra và chuẩn hóa giá trị trường bổ sung (cùng quy tắc với biểu mẫu danh mục) */
function customValues(fields: FieldDef[], raw: Record<string, unknown> | undefined, prefix: string): Record<string, unknown> {
  const editable = fields.filter((f) => !f.readOnly && f.type !== "formula");
  if (!editable.length) return {};
  const { data, errors } = validateRecord(editable, raw ?? {});
  const first = Object.values(errors)[0];
  if (first) throw new ActionError(prefix + first);
  return splitCustom(editable, data).custom;
}

const uuid = z.uuid("Giá trị không hợp lệ");
const optUuid = uuid.optional().or(z.literal("").transform(() => undefined));
const optNum = (label: string, opts: { min?: number; max?: number; positive?: boolean } = {}) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return undefined;
      const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
      if (!Number.isFinite(n)) {
        ctx.addIssue({ code: "custom", message: `${label} không hợp lệ` });
        return z.NEVER;
      }
      if ((opts.positive && n <= 0) || (opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) {
        ctx.addIssue({
          code: "custom",
          message: `${label} nằm ngoài giới hạn cho phép`,
        });
        return z.NEVER;
      }
      return n;
    });

export type QuoteResult = {
  route: { id: string; name: string; distance_km: number | null } | null;
  candidates: {
    id: string;
    code: string;
    unit_price: number;
    pricing_unit: string;
    pricing_unit_label: string | null;
    fuel_support_rate: number | null;
    surcharge_amount: number;
    specificity: number;
    priority: number;
  }[];
  fuel_rule: {
    id: string;
    scope_type: string;
    rate_percent: number | null;
    calculation_base: string;
  } | null;
};

const quoteSchema = z.object({
  customerId: optUuid,
  pickupId: uuid,
  deliveryId: uuid,
  vehicleTypeId: optUuid,
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày không hợp lệ"),
});

/** Báo giá cho một chuyến: bảng giá ứng viên, tuyến, quy tắc hỗ trợ dầu */
export async function quoteShipment(input: z.input<typeof quoteSchema>): Promise<ActionResult<QuoteResult>> {
  return runAction(async () => {
    await requirePermission("dispatch.create", "dispatch.update");
    const p = quoteSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("quote_shipment", {
      p_customer_id: p.data.customerId ?? null,
      p_pickup: p.data.pickupId,
      p_delivery: p.data.deliveryId,
      p_vehicle_type: p.data.vehicleTypeId ?? null,
      p_on: p.data.onDate,
    });
    if (error) throw error;
    return data as QuoteResult;
  });
}

const dayOrder = z.number().int().min(1, "Thứ tự chuyến của xe phải từ 1").max(99, "Thứ tự chuyến của xe tối đa 99");
const otherOrders = z
  .array(z.object({ shipmentId: uuid, order: dayOrder }))
  .max(50)
  .optional();

/** Ghi thứ tự chuyến của xe trong ngày (null = bỏ thứ tự) */
async function setDayOrders(supabase: Awaited<ReturnType<typeof createClient>>, list: { shipmentId: string; order: number | null }[]) {
  for (const x of list) {
    const { error } = await supabase.rpc("set_vehicle_day_order", {
      p_shipment_id: x.shipmentId,
      p_order: x.order,
    });
    if (error) throw error;
  }
}

const dateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Thời gian không hợp lệ");

const itemSchema = z.object({
  item_code: z.string().max(100, "Mã hàng tối đa 100 ký tự").optional(),
  item_name: z.string().max(300, "Tên hàng tối đa 300 ký tự").optional(),
  quantity: z.union([z.number(), z.string()]).optional(),
  unit: z.string().max(30, "Đơn vị tính tối đa 30 ký tự").optional(),
  note: z.string().max(500, "Ghi chú hàng hóa tối đa 500 ký tự").optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});
const itemsSchema = z.array(itemSchema).max(500, "Mỗi chuyến tối đa 500 dòng hàng hóa");

/** Chuẩn hóa dòng hàng hóa: số lượng theo kiểu Việt Nam, kiểm tra cột bổ sung */
function itemRows(items: z.infer<typeof itemsSchema>, fields: FieldDef[], prefix: string) {
  return items.map((it, j) => {
    const q = it.quantity === undefined || it.quantity === "" ? null : parseNumberVN(it.quantity);
    if (q !== null && (Number.isNaN(q) || q < 0)) throw new ActionError(`${prefix}dòng hàng ${j + 1}: số lượng không hợp lệ`);
    return {
      item_code: it.item_code ?? "",
      item_name: it.item_name ?? "",
      quantity: q ?? "",
      unit: it.unit ?? "",
      note: it.note ?? "",
      custom_fields: customValues(fields, it.custom, `${prefix}dòng hàng ${j + 1}: `),
    };
  });
}

const feeSchema = z.object({
  fee_type_id: z.string().max(40).optional(),
  amount: z.union([z.number(), z.string()]).optional(),
  note: z.string().max(500, "Ghi chú phí tối đa 500 ký tự").optional(),
  declaration_type_id: z.string().max(40).optional(),
  ref_no: z.string().max(100, "Số hóa đơn / chứng từ tối đa 100 ký tự").optional(),
  quantity: z.union([z.number(), z.string()]).optional(),
  unit_price: z.union([z.number(), z.string()]).optional(),
});
const feesSchema = z.array(feeSchema).max(100, "Mỗi chuyến tối đa 100 dòng phí");

/** Chuẩn hóa dòng phí thu khách: số tiền có dấu phẩy hàng nghìn (1,200,000) */
function feeRows(fees: z.infer<typeof feesSchema>, prefix: string) {
  return fees.map((f, j) => {
    const a = f.amount === undefined || f.amount === "" ? null : parseNumberVN(f.amount, true);
    if (a !== null && (Number.isNaN(a) || a < 0)) throw new ActionError(`${prefix}dòng phí ${j + 1}: số tiền không hợp lệ`);
    const q = f.quantity === undefined || f.quantity === "" ? null : parseNumberVN(f.quantity);
    if (q !== null && (Number.isNaN(q) || q < 0)) throw new ActionError(`${prefix}dòng phí ${j + 1}: số lượng không hợp lệ`);
    const u = f.unit_price === undefined || f.unit_price === "" ? null : parseNumberVN(f.unit_price, true);
    if (u !== null && (Number.isNaN(u) || u < 0)) throw new ActionError(`${prefix}dòng phí ${j + 1}: đơn giá không hợp lệ`);
    return {
      fee_type_id: f.fee_type_id ?? "",
      amount: a ?? "",
      note: f.note ?? "",
      declaration_type_id: f.declaration_type_id ?? "",
      ref_no: f.ref_no ?? "",
      quantity: q ?? "",
      unit_price: u ?? "",
    };
  });
}

const shipmentBase = z.object({
  pickupAt: dateTime,
  expectedDeliveryAt: dateTime.optional().or(z.literal("").transform(() => undefined)),
  pickupLocationId: uuid,
  deliveryLocationId: uuid,
  emptyReturnLocationId: optUuid,
  offrouteReturnLocationId: optUuid,
  tripOrder: z.number().int().min(1, "Thứ tự chuyến từ 1 đến 99").max(99, "Thứ tự chuyến từ 1 đến 99").nullable().optional(),
  vehicleTypeId: optUuid,
  vehicleId: optUuid,
  driverId: optUuid,
  priceListId: optUuid,
  unitPrice: optNum("Đơn giá", { min: 0 }),
  pricingUnit: z.enum(["trip", "km", "ton"]).optional(),
  quantity: optNum("Số lượng", { positive: true }),
  surchargeAmount: optNum("Phụ phí", { min: 0 }),
  fuelSupportRate: optNum("Tỷ lệ hỗ trợ dầu", { min: 0, max: 100 }),
  notes: z.string().max(1000).optional(),
  /** Khách yêu cầu chụp chứng từ (không gửi = theo mặc định trong Cấu hình) */
  podPhotoRequired: z.boolean().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
  items: itemsSchema.optional(),
  fees: feesSchema.optional(),
  vehicleDayOrder: dayOrder.nullable().optional(),
});
type ShipmentInput = z.infer<typeof shipmentBase>;
const checkShipment = <T extends z.ZodType<Pick<ShipmentInput, "pickupAt" | "expectedDeliveryAt" | "pickupLocationId" | "deliveryLocationId">>>(schema: T) =>
  schema
    .refine((s) => s.pickupLocationId !== s.deliveryLocationId, {
      message: "Điểm nhận và điểm giao phải khác nhau",
    })
    .refine((s) => !s.expectedDeliveryAt || Date.parse(s.expectedDeliveryAt) >= Date.parse(s.pickupAt), {
      message: "Ngày giao dự kiến không được trước ngày nhận hàng",
    });
const shipmentSchema = checkShipment(shipmentBase);

type Sb = Awaited<ReturnType<typeof createClient>>;
type Created = {
  order_id: string;
  order_code: string;
  shipments: { id: string; shipment_code: string }[];
  itemsError?: string;
};

/** Tạo chuyến mới (đơn mới hoặc thêm vào đơn có sẵn) kèm hàng hóa, phí thu khách; label(i) là tên chuyến trong thông báo lỗi */
async function insertShipments(
  supabase: Sb,
  order: Record<string, unknown>,
  list: ShipmentInput[],
  shipFields: FieldDef[],
  itemFields: FieldDef[],
  label: (i: number) => string,
): Promise<Created> {
  const items = list.map((s, i) => itemRows(s.items ?? [], itemFields, `${label(i)}, `));
  const fees = list.map((s, i) => feeRows(s.fees ?? [], `${label(i)}, `));
  const shipments = list.map((s, i) => ({
    pickup_at: new Date(s.pickupAt).toISOString(),
    expected_delivery_at: s.expectedDeliveryAt ? new Date(s.expectedDeliveryAt).toISOString() : "",
    pickup_location_id: s.pickupLocationId,
    delivery_location_id: s.deliveryLocationId,
    empty_return_location_id: s.emptyReturnLocationId ?? "",
    offroute_return_location_id: s.offrouteReturnLocationId ?? "",
    trip_order: s.tripOrder ?? "",
    vehicle_type_id: s.vehicleTypeId ?? "",
    vehicle_id: s.vehicleId ?? "",
    driver_id: s.driverId ?? "",
    price_list_id: s.priceListId ?? "",
    unit_price: s.unitPrice ?? "",
    pricing_unit: s.pricingUnit ?? "",
    quantity: s.quantity ?? "",
    surcharge_amount: s.surchargeAmount ?? "",
    fuel_support_rate: s.fuelSupportRate ?? "",
    notes: s.notes ?? "",
    custom_fields: customValues(shipFields, s.custom, `${label(i)}: `),
  }));
  const { data, error } = await supabase.rpc("create_transport_order", {
    p_order: order,
    p_shipments: shipments,
  });
  if (error) throw error;
  const created = data as Created;
  // Khách yêu cầu chụp chứng từ: chuyến mới lấy mặc định trong Cấu hình, chỉ ghi lại khi khác
  for (const want of [true, false]) {
    const ids = list.flatMap((s, i) => (s.podPhotoRequired === want && created.shipments[i] ? [created.shipments[i].id] : []));
    if (!ids.length) continue;
    const r = await supabase.from("shipments").update({ pod_photo_required: want }).in("id", ids).neq("pod_photo_required", want);
    if (r.error) created.itemsError = `Chưa lưu được ô "Khách yêu cầu chụp chứng từ": ${toUserMessage(r.error)}. Mở chi tiết chuyến để sửa.`;
  }
  // Hàng hóa từng chuyến: lỗi ở bước này không làm mất đơn đã tạo, báo lại để nhập ở chi tiết chuyến
  for (const [i, rows] of items.entries()) {
    if (!rows.length || !created.shipments[i]) continue;
    const r = await supabase.rpc("set_shipment_items", {
      p_shipment_id: created.shipments[i].id,
      p_items: rows,
    });
    if (r.error) created.itemsError = `Chưa lưu được hàng hóa của chuyến ${created.shipments[i].shipment_code}: ${toUserMessage(r.error)}. Mở chi tiết chuyến để nhập lại.`;
  }
  for (const [i, rows] of fees.entries()) {
    if (!rows.length || !created.shipments[i]) continue;
    const r = await supabase.rpc("set_shipment_fees", {
      p_shipment_id: created.shipments[i].id,
      p_fees: rows,
    });
    if (r.error) created.itemsError = `Chưa lưu được phí thu khách của chuyến ${created.shipments[i].shipment_code}: ${toUserMessage(r.error)}. Mở chi tiết chuyến để nhập lại.`;
  }
  return created;
}

const orderSchema = z.object({
  orderId: optUuid,
  customerId: optUuid,
  payerCustomerId: optUuid,
  orderDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  notes: z.string().max(2000).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
  shipments: z.array(shipmentSchema).min(1, "Đơn hàng phải có ít nhất một chuyến").max(100, "Mỗi lần tạo tối đa 100 chuyến"),
  /** Thứ tự mới của các chuyến đã có của xe trong cùng ngày */
  otherOrders,
});

export type CreateOrderInput = z.input<typeof orderSchema>;

/** Tạo đơn hàng gồm nhiều chuyến (hoặc thêm chuyến vào đơn có sẵn) trong một giao dịch */
export async function createOrder(input: CreateOrderInput): Promise<
  ActionResult<{
    order_id: string;
    order_code: string;
    shipments: { id: string; shipment_code: string }[];
    itemsError?: string;
  }>
> {
  return runAction(async () => {
    const me = await requirePermission("dispatch.create");
    const p = orderSchema.safeParse(input);
    if (!p.success) {
      const issue = p.error.issues[0];
      const idx = issue?.path[0] === "shipments" && typeof issue.path[1] === "number" ? `Chuyến ${issue.path[1] + 1}: ` : "";
      throw new ActionError(idx + (issue?.message ?? "Dữ liệu không hợp lệ"));
    }
    const d = p.data;
    if (!d.orderId && !d.customerId) throw new ActionError("Vui lòng chọn khách hàng.");
    const supabase = await createClient();
    if (!d.orderId) {
      await assertActiveRefs(supabase, [
        { ref: "customers", id: d.customerId, label: "Khách hàng" },
        { ref: "customers", id: d.payerCustomerId, label: "Khách thanh toán" },
      ]);
    }
    const [orderRows, shipRows, itemFieldRows] = await Promise.all([
      loadCustomFields(supabase, "transport_orders"),
      loadCustomFields(supabase, "shipments"),
      loadCustomFields(supabase, "shipment_items"),
    ]);
    const itemFields = moduleCustomFields("shipment_items", visibleCustomRows(itemFieldRows, me.permissions), me.permissions);
    const orderCustom = d.orderId ? {} : customValues(moduleCustomFields("transport_orders", visibleCustomRows(orderRows, me.permissions), me.permissions), d.custom, "Đơn hàng: ");
    const shipFields = moduleCustomFields("shipments", visibleCustomRows(shipRows, me.permissions), me.permissions);
    const order = d.orderId
      ? { id: d.orderId }
      : {
          customer_id: d.customerId,
          payer_customer_id: d.payerCustomerId ?? "",
          order_date: d.orderDate,
          notes: d.notes ?? "",
          custom_fields: orderCustom,
        };
    const created = await insertShipments(supabase, order, d.shipments, shipFields, itemFields, (i) => `Chuyến ${i + 1}`);
    // Thứ tự chuyến của xe trong ngày (khi xe chạy nhiều chuyến cùng ngày); chuyến trả về theo đúng thứ tự gửi lên
    await setDayOrders(supabase, [
      ...(d.otherOrders ?? []),
      ...d.shipments.flatMap((s, i) => (s.vehicleDayOrder && created.shipments[i] ? [{ shipmentId: created.shipments[i].id, order: s.vehicleDayOrder }] : [])),
    ]);
    revalidatePath("/dieu-phoi");
    revalidatePath("/chuyen-xe");
    return created;
  });
}

const assignSchema = z.object({
  shipmentId: uuid,
  driverId: optUuid,
  vehicleId: optUuid,
  /** Thứ tự chuyến của xe trong ngày; null = bỏ thứ tự; không gửi = giữ nguyên */
  vehicleDayOrder: dayOrder.nullable().optional(),
  otherOrders,
});

/** Phân công / đổi / gỡ tài xế và xe cho chuyến */
export async function assignShipment(input: z.input<typeof assignSchema>): Promise<ActionResult> {
  return runAction(
    async () => {
      await requirePermission("dispatch.update");
      const p = assignSchema.safeParse(input);
      if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
      const supabase = await createClient();
      const { error } = await supabase.rpc("assign_shipment", {
        p_shipment_id: p.data.shipmentId,
        p_driver_id: p.data.driverId ?? null,
        p_vehicle_id: p.data.vehicleId ?? null,
      });
      if (error) throw error;
      await setDayOrders(supabase, [
        ...(p.data.otherOrders ?? []),
        ...(p.data.vehicleDayOrder !== undefined ? [{ shipmentId: p.data.shipmentId, order: p.data.vehicleDayOrder }] : []),
      ]);
      revalidatePath("/dieu-phoi", "layout");
      revalidatePath("/chuyen-xe", "layout");
    },
    input.driverId ? "Đã phân công chuyến." : "Đã gỡ phân công.",
  );
}

const cancelSchema = z.object({
  shipmentId: uuid,
  reason: z.string().trim().min(3, "Vui lòng nhập lý do hủy (ít nhất 3 ký tự)").max(500),
});

/** Hủy chuyến: bắt buộc lý do, không xóa dữ liệu */
export async function cancelShipment(input: z.input<typeof cancelSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("dispatch.delete", "shipments.delete");
    const p = cancelSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_shipment", {
      p_shipment_id: p.data.shipmentId,
      p_reason: p.data.reason,
    });
    if (error) throw error;
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
  }, "Đã hủy chuyến.");
}

const actSchema = z.object({
  shipmentId: uuid,
  step: z.enum(["accept", "start", "complete"]),
  result: z.enum(["full", "partial", "failed"]).optional(),
  note: z.string().max(500, "Ghi chú tối đa 500 ký tự").optional(),
  noExpense: z.boolean().nullable().optional(),
  photoSkipReason: z.string().max(500, "Lý do tối đa 500 ký tự").optional(),
});

/** Điều phối làm thay tài xế: nhận đơn, bắt đầu chạy, hoàn thành (bỏ qua ảnh khi có lý do) */
export async function actForDriver(input: z.input<typeof actSchema>): Promise<ActionResult> {
  const p = actSchema.safeParse(input);
  const msg = {
    accept: "Đã nhận chuyến thay tài xế.",
    start: "Đã bắt đầu chạy thay tài xế.",
    complete: "Đã hoàn thành chuyến thay tài xế.",
  };
  return runAction(
    async () => {
      await requirePermission("dispatch.update");
      if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
      const d = p.data;
      const supabase = await createClient();
      const { error } = await supabase.rpc("dispatch_act_for_driver", {
        p_shipment_id: d.shipmentId,
        p_step: d.step,
        p_result: d.result ?? null,
        p_note: d.note?.trim() || null,
        p_no_expense: d.noExpense ?? null,
        p_photo_skip_reason: d.photoSkipReason?.trim() || null,
      });
      if (error) throw error;
      revalidatePath("/dieu-phoi", "layout");
      revalidatePath("/chuyen-xe", "layout");
    },
    p.success ? msg[p.data.step] : undefined,
  );
}

/** Xe đang hoạt động kèm tài xế phụ trách, để gợi ý tài xế khi chọn xe */
export async function vehicleDefaultDriver(vehicleId: string): Promise<ActionResult<{ driverId: string | null; vehicleTypeId: string | null; outsourced: boolean }>> {
  return runAction(async () => {
    await requirePermission("dispatch.create", "dispatch.update");
    if (!uuid.safeParse(vehicleId).success) throw new ActionError("Xe không hợp lệ");
    const supabase = await createClient();
    const { data, error } = await supabase.from("vehicles").select("assigned_driver_id, vehicle_type_id, ownership_type, supplier_id").eq("id", vehicleId).maybeSingle();
    if (error) throw error;
    return {
      driverId: data?.assigned_driver_id ?? null,
      vehicleTypeId: data?.vehicle_type_id ?? null,
      outsourced: data?.ownership_type === "outsourced" || Boolean(data?.supplier_id),
    };
  });
}

export type CarrierHint = { supplierId: string; supplierName: string; planCode: string | null };

/** Nhà xe 3PL của chuyến: đã ghi ở chuyến, hoặc NCC của kế hoạch tạo ra chuyến (Lập kế hoạch) */
export async function shipmentCarrierHint(shipmentId: string): Promise<ActionResult<CarrierHint | null>> {
  return runAction(async () => {
    await requirePermission("dispatch.create", "dispatch.update");
    if (!uuid.safeParse(shipmentId).success) return null;
    const supabase = await createClient();
    const { data: s, error } = await supabase.from("shipments").select("carrier_supplier_id, plan_id").eq("id", shipmentId).maybeSingle();
    if (error) throw error;
    if (!s) return null;
    let supplierId = (s.carrier_supplier_id as string | null) ?? null;
    let planCode: string | null = null;
    if (s.plan_id) {
      const { data: p } = await supabase.from("transport_plans").select("code, supplier_id").eq("id", s.plan_id).maybeSingle();
      if (p) {
        planCode = (p.code as string) ?? null;
        if (!supplierId) supplierId = (p.supplier_id as string | null) ?? null;
      }
    }
    if (!supplierId) return null;
    const { data: sp } = await supabase.from("suppliers").select("name").eq("id", supplierId).maybeSingle();
    return { supplierId, supplierName: (sp?.name as string) ?? "", planCode: s.carrier_supplier_id ? null : planCode };
  });
}

export type Shipment3plInfo = {
  supplier_id: string | null;
  supplier_name: string | null;
  plan_code: string | null;
  from_plan: boolean;
  is_3pl: boolean;
  plate: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  national_id: string | null;
  license_no: string | null;
};

/** Nhà xe 3PL của chuyến (ghi ở chuyến / xe / NCC của kế hoạch) và xe, tài xế 3PL đang gắn */
export async function shipment3plInfo(shipmentId: string): Promise<ActionResult<Shipment3plInfo | null>> {
  return runAction(async () => {
    await requirePermission("dispatch.create", "dispatch.update");
    if (!uuid.safeParse(shipmentId).success) return null;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("shipment_3pl_info", { p_shipment_id: shipmentId });
    if (error) {
      // CSDL chưa nâng cấp 0057: coi như không có thông tin 3PL
      if (error.code === "PGRST202" || error.code === "42883") return null;
      throw error;
    }
    return (data as Shipment3plInfo | null) ?? null;
  });
}

const assign3plSchema = z.object({
  shipmentId: uuid,
  supplierId: uuid,
  plate: z.string().trim().max(20).optional(),
  driverName: z.string().trim().max(150).optional(),
  driverPhone: z.string().trim().max(20).optional(),
  nationalId: z.string().trim().max(20).optional(),
  licenseNo: z.string().trim().max(30).optional(),
});

/** Giao chuyến cho nhà xe 3PL: số xe, tài xế, SĐT, CCCD, GPLX đều không bắt buộc */
export async function assignShipment3pl(input: z.input<typeof assign3plSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("dispatch.update");
    const p = assign3plSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const d = p.data;
    const supabase = await createClient();
    const { error } = await supabase.rpc("assign_shipment_3pl", {
      p_shipment_id: d.shipmentId,
      p_supplier_id: d.supplierId,
      p_plate: d.plate || null,
      p_driver_name: d.driverName || null,
      p_driver_phone: d.driverPhone || null,
      p_national_id: d.nationalId || null,
      p_license_no: d.licenseNo || null,
    });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") throw new ActionError("CSDL chưa nâng cấp Giao chuyến 3PL (dòng 37). Nhờ quản trị chạy SQL nâng cấp.");
      throw error;
    }
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
  }, "Đã giao chuyến cho nhà xe 3PL.");
}

/** Khách thanh toán mặc định trong hồ sơ khách hàng, để tự điền vào đơn hàng */
export async function customerDefaultPayer(customerId: string): Promise<ActionResult<{ id: string; label: string } | null>> {
  return runAction(async () => {
    await requirePermission("dispatch.create", "dispatch.update");
    if (!uuid.safeParse(customerId).success) throw new ActionError("Khách hàng không hợp lệ");
    const supabase = await createClient();
    const { data, error } = await supabase.from("customers").select("default_payer_customer_id").eq("id", customerId).maybeSingle();
    if (error) throw error;
    const payerId = (data as { default_payer_customer_id?: string | null } | null)?.default_payer_customer_id;
    if (!payerId) return null;
    const { data: p, error: e2 } = await supabase.from("customers").select("code, name").eq("id", payerId).eq("status", "active").maybeSingle();
    if (e2) throw e2;
    return p ? { id: payerId, label: `${p.name} – ${p.code}` } : null;
  });
}

export type VehicleDayTrip = {
  id: string;
  shipment_code: string;
  pickup_at: string;
  expected_delivery_at: string | null;
  pickup_name: string | null;
  delivery_name: string | null;
  customer_name: string | null;
  driver_name: string | null;
  status: string;
  vehicle_day_order: number | null;
};

const dayTripsSchema = z.object({
  vehicleId: uuid,
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  excludeShipmentId: optUuid,
});

/** Các chuyến (chưa hủy) của xe trong một ngày: nhận hàng trong ngày hoặc đang chạy dở sang ngày đó */
export async function vehicleTripsOnDay(input: z.input<typeof dayTripsSchema>): Promise<ActionResult<VehicleDayTrip[]>> {
  return runAction(async () => {
    await requirePermission("dispatch.create", "dispatch.update");
    const p = dayTripsSchema.safeParse(input);
    if (!p.success) throw new ActionError("Dữ liệu không hợp lệ");
    const from = startOfDayVN(p.data.day);
    const supabase = await createClient();
    let q = supabase
      .from("shipment_list")
      .select("id, shipment_code, pickup_at, expected_delivery_at, pickup_name, delivery_name, customer_name, driver_name, status, vehicle_day_order")
      .eq("vehicle_id", p.data.vehicleId)
      .neq("status", "cancelled")
      .lt("pickup_at", startOfDayVN(addDaysYMD(p.data.day, 1)))
      .or(`pickup_at.gte.${from},expected_delivery_at.gte.${from}`)
      .order("pickup_at")
      .limit(20);
    if (p.data.excludeShipmentId) q = q.neq("id", p.data.excludeShipmentId);
    const { data, error } = await q;
    if (error) throw error;
    const trips = (data ?? []) as VehicleDayTrip[];
    if (!trips.length) return trips;
    // Chuyến đã giao xong trong ngày này hoặc trước đó thì xe đã trống (không chờ duyệt chi phí hay đóng chuyến),
    // không cần xác nhận "Vẫn giao" hay nhập thứ tự chuyến
    const { data: done, error: e2 } = await supabase
      .from("shipments")
      .select("id")
      .in("id", trips.map((t) => t.id))
      .lt("completed_at", startOfDayVN(addDaysYMD(p.data.day, 1)));
    if (e2) throw e2;
    const finished = new Set((done ?? []).map((r) => r.id as string));
    return trips.filter((t) => !finished.has(t.id));
  });
}

/** Số chuyến trong tháng của một xe hoặc một tài xế */
export type MonthTripCount = {
  /** Tổng chuyến nhận hàng trong tháng (không tính chuyến đã hủy, không tính chuyến đang sửa) */
  month: number;
  /** Trong đó đã giao xong */
  delivered: number;
  /** Số chuyến nhận hàng đúng ngày đang chọn */
  day: number;
  /** Trung bình mỗi xe công ty / mỗi tài xế đang làm trong tháng, để so sánh */
  avg: number;
  /** Ít nhất, nhiều nhất trong các xe / tài xế */
  min: number;
  max: number;
};

const monthCountSchema = z.object({
  kind: z.enum(["vehicle", "driver"]),
  id: uuid,
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  excludeShipmentId: optUuid,
});

/** Xe / tài xế đã có bao nhiêu chuyến trong tháng của ngày nhận hàng, để điều phối chia chuyến đều */
export async function monthTripCount(input: z.input<typeof monthCountSchema>): Promise<ActionResult<MonthTripCount | null>> {
  return runAction(async () => {
    await requirePermission("dispatch.create", "dispatch.update");
    const p = monthCountSchema.safeParse(input);
    if (!p.success) throw new ActionError("Dữ liệu không hợp lệ");
    const { kind, id, day, excludeShipmentId } = p.data;
    const ym = day.slice(0, 7);
    const supabase = await createClient();
    // Xe thuê ngoài 3PL và tài xế phụ trách xe 3PL không đếm số chuyến (chỉ xe, tài xế nội bộ)
    const { data: ov, error: ove } = await supabase.from("vehicles").select("id, assigned_driver_id").or("ownership_type.eq.outsourced,supplier_id.not.is.null").limit(5000);
    if (ove) throw ove;
    const outVehicles = new Set((ov ?? []).map((v) => v.id as string));
    const { data: od, error: ode } = await supabase.from("drivers").select("id").eq("is_outsourced", true).limit(5000);
    if (ode) throw ode;
    const outDrivers = new Set([
      ...(ov ?? []).map((v) => v.assigned_driver_id as string | null).filter((x): x is string => Boolean(x)),
      ...(od ?? []).map((d) => d.id as string),
    ]);
    if (kind === "vehicle" ? outVehicles.has(id) : outDrivers.has(id)) return null;
    const [trips, pool] = await Promise.all([
      loadTrips(supabase, `${ym}-01`, lastDayOfMonth(ym)),
      kind === "vehicle"
        ? supabase.from("vehicles").select("id").eq("status", "active").is("archived_at", null).neq("ownership_type", "outsourced").is("supplier_id", null).limit(5000)
        : supabase.from("drivers").select("id").eq("status", "active").is("archived_at", null).limit(5000),
    ]);
    if (pool.error) throw pool.error;
    const key = kind === "vehicle" ? "vehicle_id" : "driver_id";
    const counts = new Map<string, number>(((pool.data ?? []) as { id: string }[]).filter((r) => !outDrivers.has(r.id)).map((r) => [r.id, 0]));
    const out = { month: 0, delivered: 0, day: 0 };
    for (const t of trips) {
      if (t.id === excludeShipmentId) continue;
      if (t.vehicle_id && outVehicles.has(t.vehicle_id)) continue;
      const k = t[key];
      if (!k) continue;
      if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
      if (k === id) {
        out.month++;
        if (t.completed_at) out.delivered++;
        if (tripDay(t) === day) out.day++;
      }
    }
    const all = [...counts.values()];
    return {
      ...out,
      avg: all.length ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10 : 0,
      min: all.length ? Math.min(...all) : 0,
      max: all.length ? Math.max(...all) : 0,
    };
  });
}

const itemsInput = z.object({ shipmentId: uuid, items: itemsSchema });

/** Sửa hàng hóa (mã hàng) của chuyến ở trang chi tiết */
export async function saveShipmentItems(input: z.input<typeof itemsInput>): Promise<ActionResult<number>> {
  return runAction(async () => {
    const me = await requirePermission("dispatch.create", "dispatch.update");
    const p = itemsInput.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const fields = moduleCustomFields("shipment_items", visibleCustomRows(await loadCustomFields(supabase, "shipment_items"), me.permissions), me.permissions);
    const { data, error } = await supabase.rpc("set_shipment_items", {
      p_shipment_id: p.data.shipmentId,
      p_items: itemRows(p.data.items, fields, ""),
    });
    if (error) throw error;
    revalidatePath(`/chuyen-xe/${p.data.shipmentId}`);
    return data as number;
  }, "Đã lưu hàng hóa của chuyến.");
}

const feesInput = z.object({ shipmentId: uuid, fees: feesSchema });

/** Sửa các khoản phí thu khách của chuyến ở trang chi tiết */
export async function saveShipmentFees(input: z.input<typeof feesInput>): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requirePermission("dispatch.create", "dispatch.update", "shipments.update");
    const p = feesInput.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("set_shipment_fees", {
      p_shipment_id: p.data.shipmentId,
      p_fees: feeRows(p.data.fees, ""),
    });
    if (error) throw error;
    revalidatePath(`/chuyen-xe/${p.data.shipmentId}`);
    revalidatePath("/chuyen-xe");
    return data as number;
  }, "Đã lưu phí thu khách của chuyến.");
}

const orderHeaderSchema = z.object({
  orderId: uuid,
  customerId: uuid,
  payerCustomerId: uuid.nullable().optional(),
  companyEntityId: uuid.nullable().optional(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày đơn hàng không hợp lệ"),
  notes: z.string().max(2000).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

/** Sửa phần đầu đơn hàng tạo sai (khách hàng, khách thanh toán, đơn vị nội bộ, ngày, ghi chú, trường bổ sung) */
export async function updateOrderHeader(input: z.input<typeof orderHeaderSchema>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const me = await requirePermission("dispatch.update");
    const p = orderHeaderSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const d = p.data;
    const supabase = await createClient();
    const { data: cur, error: curErr } = await supabase.from("transport_orders").select("status, custom_fields").eq("id", d.orderId).maybeSingle();
    if (curErr) throw curErr;
    if (!cur) throw new ActionError("Không tìm thấy đơn hàng.");
    if (cur.status === "cancelled") throw new ActionError("Đơn hàng đã hủy, không sửa được.");
    const fields = moduleCustomFields("transport_orders", visibleCustomRows(await loadCustomFields(supabase, "transport_orders"), me.permissions), me.permissions);
    // Giữ nguyên giá trị các trường người sửa không được xem
    const custom = {
      ...((cur.custom_fields as Record<string, unknown>) ?? {}),
      ...customValues(fields, d.custom, "Đơn hàng: "),
    };
    const { data, error } = await supabase
      .from("transport_orders")
      .update({
        customer_id: d.customerId,
        payer_customer_id: d.payerCustomerId ?? d.customerId,
        company_entity_id: d.companyEntityId ?? null,
        order_date: d.orderDate,
        notes: d.notes?.trim() || null,
        custom_fields: custom,
      })
      .eq("id", d.orderId)
      .select("id");
    if (error) throw error;
    if (!data?.length) throw new ActionError("Bạn không có quyền sửa đơn hàng này.");
    revalidatePath(`/dieu-phoi/don-hang/${d.orderId}`);
    revalidatePath("/dieu-phoi");
    revalidatePath("/chuyen-xe");
    return null;
  }, "Đã lưu thay đổi của đơn hàng.");
}

const editShipmentSchema = checkShipment(
  shipmentBase.extend({
    /** Chuyến đã có; không gửi = chuyến mới thêm khi sửa đơn */
    id: optUuid,
    version: z.number().int().optional(),
    /** keep = giữ giá đang lưu (sửa tay được); quote = tìm lại theo bảng giá như lúc tạo */
    priceMode: z.enum(["keep", "quote"]).optional(),
    pricingUnit: z.enum(["trip", "km", "ton", "other"]).optional(),
    /** Có lý do = hủy chuyến này khi lưu */
    cancelReason: z.string().trim().max(500).optional(),
  }),
);

const fullOrderSchema = z.object({
  orderId: uuid,
  customerId: uuid,
  payerCustomerId: optUuid,
  companyEntityId: optUuid,
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày đơn hàng không hợp lệ"),
  notes: z.string().max(2000).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
  shipments: z.array(editShipmentSchema).max(200, "Mỗi đơn tối đa 200 chuyến"),
  otherOrders,
});

export type UpdateOrderFullInput = z.input<typeof fullOrderSchema>;

type CurShipment = {
  id: string;
  shipment_code: string;
  status: string;
  version: number;
  receivable_id: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  pickup_location_id: string;
  delivery_location_id: string;
  fuel_support_base: string | null;
  pricing_snapshot: Record<string, unknown> | null;
  custom_fields: Record<string, unknown> | null;
};

const ASSIGNABLE = ["draft", "assigned", "accepted"];
const CANCELLABLE = ["draft", "assigned", "accepted", "in_transit"];

/**
 * Sửa toàn bộ đơn hàng bằng đúng biểu mẫu lúc tạo: phần đầu đơn, từng chuyến (ngày, điểm, xe, tài xế, giá, phí, hàng hóa,
 * trường bổ sung), thêm chuyến mới, hủy chuyến. Giữ các khóa: chuyến đã lập công nợ không đổi giá/phí/số lượng;
 * đổi tài xế đi qua assign_shipment nên chuyến phải chờ Giám đốc duyệt lại.
 */
export async function updateOrderFull(
  input: UpdateOrderFullInput,
): Promise<ActionResult<{ created: number; cancelled: number; warning?: string; newShipments: { index: number; id: string }[] }>> {
  return runAction(async () => {
    const me = await requirePermission("dispatch.update");
    const p = fullOrderSchema.safeParse(input);
    if (!p.success) {
      const issue = p.error.issues[0];
      const idx = issue?.path[0] === "shipments" && typeof issue.path[1] === "number" ? `Chuyến ${issue.path[1] + 1}: ` : "";
      throw new ActionError(idx + (issue?.message ?? "Dữ liệu không hợp lệ"));
    }
    const d = p.data;
    const label = (i: number) => `Chuyến ${i + 1}`;
    const supabase = await createClient();
    const [orderRes, shipRes, orderRows, shipRows, itemFieldRows] = await Promise.all([
      supabase.from("transport_orders").select("status, customer_id, payer_customer_id, company_entity_id, order_date, notes, custom_fields").eq("id", d.orderId).maybeSingle(),
      supabase
        .from("shipments")
        .select(
          "id, shipment_code, status, version, receivable_id, driver_id, vehicle_id, pickup_location_id, delivery_location_id, fuel_support_base, pricing_snapshot, custom_fields",
        )
        .eq("order_id", d.orderId),
      loadCustomFields(supabase, "transport_orders"),
      loadCustomFields(supabase, "shipments"),
      loadCustomFields(supabase, "shipment_items"),
    ]);
    if (orderRes.error) throw orderRes.error;
    if (shipRes.error) throw shipRes.error;
    const cur = orderRes.data;
    if (!cur) throw new ActionError("Không tìm thấy đơn hàng.");
    if (cur.status === "cancelled") throw new ActionError("Đơn hàng đã hủy, không sửa được.");
    await assertActiveRefs(supabase, [
      { ref: "customers", id: d.customerId, previous: cur.customer_id, label: "Khách hàng" },
      { ref: "customers", id: d.payerCustomerId, previous: cur.payer_customer_id, label: "Khách thanh toán" },
    ]);
    const curShips = new Map(((shipRes.data ?? []) as CurShipment[]).map((r) => [r.id, r]));
    const orderFields = moduleCustomFields("transport_orders", visibleCustomRows(orderRows, me.permissions), me.permissions);
    const shipFields = moduleCustomFields("shipments", visibleCustomRows(shipRows, me.permissions), me.permissions);
    const itemFields = moduleCustomFields("shipment_items", visibleCustomRows(itemFieldRows, me.permissions), me.permissions);

    // 1. Kiểm tra toàn bộ trước khi ghi để không lưu dở dang vì lỗi nhập liệu
    const fresh = d.shipments.map((s, i) => ({ s, i })).filter((x) => !x.s.id);
    if (fresh.length && !me.permissions.has("dispatch.create")) throw new ActionError("Bạn không có quyền thêm chuyến vào đơn hàng.");
    if (fresh.length && cur.status !== "open") throw new ActionError("Đơn hàng đã hoàn thành, không thêm chuyến được.");
    type EditShipment = (typeof d.shipments)[number];
    type Plan =
      | { i: number; s: EditShipment; c: CurShipment; cancel: true }
      | {
          i: number;
          s: EditShipment;
          c: CurShipment;
          cancel: false;
          assignChanged: boolean;
          items: ReturnType<typeof itemRows> | null;
          fees: ReturnType<typeof feeRows> | null;
          custom: Record<string, unknown>;
        };
    const plans = d.shipments.flatMap((s, i): Plan[] => {
      if (!s.id) return [];
      const c = curShips.get(s.id);
      if (!c) throw new ActionError(`${label(i)}: không thuộc đơn hàng này.`);
      if (c.status === "cancelled") throw new ActionError(`${label(i)} (${c.shipment_code}) đã hủy, tải lại trang rồi sửa tiếp.`);
      if (s.version !== undefined && s.version !== c.version) throw new ActionError(`Chuyến ${c.shipment_code} vừa được người khác sửa. Tải lại trang rồi thử lại.`);
      if (s.cancelReason) {
        if (!(me.permissions.has("dispatch.delete") || me.permissions.has("shipments.delete"))) throw new ActionError("Bạn không có quyền hủy chuyến.");
        if (s.cancelReason.length < 3) throw new ActionError(`Chuyến ${c.shipment_code}: nhập lý do hủy (ít nhất 3 ký tự).`);
        if (!CANCELLABLE.includes(c.status)) throw new ActionError(`Chuyến ${c.shipment_code} đã hoàn thành, không hủy được.`);
        if (c.receivable_id) throw new ActionError(`Chuyến ${c.shipment_code} đã lập công nợ, không hủy được. Hủy phiếu công nợ trước.`);
        return [{ i, s, c, cancel: true as const }];
      }
      const assignChanged = (s.driverId ?? null) !== c.driver_id || (s.vehicleId ?? null) !== c.vehicle_id;
      if (assignChanged && !ASSIGNABLE.includes(c.status)) throw new ActionError(`Chuyến ${c.shipment_code} đang chạy hoặc đã xong, không đổi xe, tài xế được.`);
      return [
        {
          i,
          s,
          c,
          cancel: false as const,
          assignChanged,
          // Chuyến đã đóng: CSDL khóa hàng hóa, giữ nguyên
          items: c.status === "closed" ? null : itemRows(s.items ?? [], itemFields, `${label(i)}, `),
          fees: c.receivable_id ? null : feeRows(s.fees ?? [], `${label(i)}, `),
          custom: {
            ...(c.custom_fields ?? {}),
            ...customValues(shipFields, s.custom, `${label(i)}: `),
          },
        },
      ];
    });
    const orderCustom = {
      ...((cur.custom_fields as Record<string, unknown>) ?? {}),
      ...customValues(orderFields, d.custom, "Đơn hàng: "),
    };
    const billed = [...curShips.values()].some((r) => r.receivable_id);
    const payer = d.payerCustomerId ?? d.customerId;
    if (billed && (d.customerId !== cur.customer_id || payer !== cur.payer_customer_id || (d.companyEntityId ?? null) !== cur.company_entity_id)) {
      throw new ActionError("Đơn đã có chuyến lập công nợ: không đổi khách hàng, khách thanh toán, đơn vị nội bộ được. Hủy phiếu công nợ trước.");
    }

    // 2. Phần đầu đơn
    const header = {
      customer_id: d.customerId,
      payer_customer_id: payer,
      company_entity_id: d.companyEntityId ?? null,
      order_date: d.orderDate,
      notes: d.notes?.trim() || null,
      custom_fields: orderCustom,
    };
    const changed =
      header.customer_id !== cur.customer_id ||
      header.payer_customer_id !== cur.payer_customer_id ||
      header.company_entity_id !== cur.company_entity_id ||
      header.order_date !== cur.order_date ||
      header.notes !== (cur.notes ?? null) ||
      JSON.stringify(orderCustom) !== JSON.stringify(cur.custom_fields ?? {});
    if (changed) {
      const { data, error } = await supabase.from("transport_orders").update(header).eq("id", d.orderId).select("id");
      if (error) throw error;
      if (!data?.length) throw new ActionError("Bạn không có quyền sửa đơn hàng này.");
    }

    // 3. Từng chuyến đã có: lỗi giữa chừng báo rõ chuyến nào đã lưu
    const saved: string[] = [];
    const fail = (code: string, e: unknown): never => {
      const msg = toUserMessage(e);
      throw new ActionError(`Chuyến ${code}: ${msg}${saved.length || changed ? ` (đã lưu ${[changed ? "phần đầu đơn" : "", ...saved].filter(Boolean).join(", ")})` : ""}`);
    };
    let cancelled = 0;
    const dayOrders: { shipmentId: string; order: number | null }[] = [];
    for (const plan of plans) {
      const { s, c } = plan;
      try {
        if (plan.cancel) {
          const { error } = await supabase.rpc("cancel_shipment", {
            p_shipment_id: c.id,
            p_reason: s.cancelReason,
          });
          if (error) throw error;
          cancelled++;
          saved.push(c.shipment_code);
          continue;
        }
        const patch: Record<string, unknown> = {
          pickup_at: new Date(s.pickupAt).toISOString(),
          expected_delivery_at: s.expectedDeliveryAt ? new Date(s.expectedDeliveryAt).toISOString() : null,
          pickup_location_id: s.pickupLocationId,
          delivery_location_id: s.deliveryLocationId,
          empty_return_location_id: s.emptyReturnLocationId ?? null,
          offroute_return_location_id: s.offrouteReturnLocationId ?? null,
          trip_order: s.tripOrder ?? null,
          vehicle_type_id: s.vehicleTypeId ?? null,
          notes: s.notes?.trim() || null,
          custom_fields: plan.custom,
          ...(s.podPhotoRequired === undefined ? {} : { pod_photo_required: s.podPhotoRequired }),
        };
        const routeChanged = s.pickupLocationId !== c.pickup_location_id || s.deliveryLocationId !== c.delivery_location_id;
        if (!c.receivable_id) {
          Object.assign(patch, await pricePatch(supabase, d.customerId, s, c));
        } else if (routeChanged) {
          const { data: r } = await supabase
            .from("routes")
            .select("id")
            .eq("pickup_location_id", s.pickupLocationId)
            .eq("delivery_location_id", s.deliveryLocationId)
            .eq("is_active", true)
            .maybeSingle();
          patch.route_id = r?.id ?? null;
        }
        const { data, error } = await supabase.from("shipments").update(patch).eq("id", c.id).eq("version", c.version).select("id");
        if (error) throw error;
        if (!data?.length) throw new ActionError("vừa được người khác sửa. Tải lại trang rồi thử lại.");
        if (plan.items) {
          const it = await supabase.rpc("set_shipment_items", {
            p_shipment_id: c.id,
            p_items: plan.items,
          });
          if (it.error) throw it.error;
        }
        if (plan.fees) {
          const fe = await supabase.rpc("set_shipment_fees", {
            p_shipment_id: c.id,
            p_fees: plan.fees,
          });
          if (fe.error) throw fe.error;
        }
        if (plan.assignChanged) {
          const { error: ae } = await supabase.rpc("assign_shipment", {
            p_shipment_id: c.id,
            p_driver_id: s.driverId ?? null,
            p_vehicle_id: s.vehicleId ?? null,
          });
          if (ae) throw ae;
        }
        if (s.vehicleDayOrder !== undefined)
          dayOrders.push({
            shipmentId: c.id,
            order: s.vehicleId ? s.vehicleDayOrder : null,
          });
        saved.push(c.shipment_code);
      } catch (e) {
        fail(c.shipment_code, e);
      }
    }

    // 4. Chuyến mới thêm khi sửa đơn
    let warning: string | undefined;
    const newShipments: { index: number; id: string }[] = [];
    if (fresh.length) {
      const list = fresh.map((x) => ({
        ...x.s,
        pricingUnit: x.s.pricingUnit === "other" ? undefined : x.s.pricingUnit,
      }));
      const created = await insertShipments(supabase, { id: d.orderId }, list, shipFields, itemFields, (j) => label(fresh[j].i));
      warning = created.itemsError;
      fresh.forEach((x, j) => {
        if (created.shipments[j]) newShipments.push({ index: x.i, id: created.shipments[j].id });
        if (x.s.vehicleDayOrder && created.shipments[j])
          dayOrders.push({
            shipmentId: created.shipments[j].id,
            order: x.s.vehicleDayOrder,
          });
      });
    }
    await setDayOrders(supabase, [...(d.otherOrders ?? []), ...dayOrders]);

    revalidatePath(`/dieu-phoi/don-hang/${d.orderId}`);
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
    return { created: fresh.length, cancelled, warning, newShipments };
  });
}

/** Giá của chuyến khi sửa: giữ giá đang lưu (sửa tay) hoặc tìm lại theo bảng giá giống lúc tạo chuyến */
async function pricePatch(supabase: Sb, customerId: string, s: z.infer<typeof editShipmentSchema>, c: CurShipment): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { quantity: s.quantity ?? 1 };
  const routeChanged = s.pickupLocationId !== c.pickup_location_id || s.deliveryLocationId !== c.delivery_location_id;
  if (s.priceMode !== "quote") {
    Object.assign(out, {
      unit_price: s.unitPrice ?? 0,
      pricing_unit: s.pricingUnit ?? "trip",
      surcharge_amount: s.surchargeAmount ?? 0,
      fuel_support_rate: s.fuelSupportRate ?? null,
    });
    if (s.fuelSupportRate === undefined)
      Object.assign(out, {
        fuel_support_base: null,
        fuel_support_amount: 0,
        fuel_support_rule_id: null,
      });
    else if (!c.fuel_support_base) out.fuel_support_base = "freight_revenue";
    if (routeChanged) {
      const { data: r } = await supabase
        .from("routes")
        .select("id")
        .eq("pickup_location_id", s.pickupLocationId)
        .eq("delivery_location_id", s.deliveryLocationId)
        .eq("is_active", true)
        .maybeSingle();
      out.route_id = r?.id ?? null;
    }
    return out;
  }
  const day = new Date(s.pickupAt).toLocaleDateString("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
  const { data, error } = await supabase.rpc("quote_shipment", {
    p_customer_id: customerId,
    p_pickup: s.pickupLocationId,
    p_delivery: s.deliveryLocationId,
    p_vehicle_type: s.vehicleTypeId ?? null,
    p_on: day,
  });
  if (error) throw error;
  const q = data as QuoteResult;
  const top = q.candidates[0];
  const tied = top ? q.candidates.filter((x) => x.specificity === top.specificity && x.priority === top.priority).length > 1 : false;
  let pl = s.priceListId ? q.candidates.find((x) => x.id === s.priceListId) : undefined;
  if (s.priceListId && !pl) throw new ActionError("bảng giá đã chọn không áp dụng cho chuyến này, chọn lại bảng giá.");
  if (!pl && top) {
    if (tied) throw new ActionError("có nhiều bảng giá ngang nhau, vui lòng chọn một bảng giá.");
    pl = top;
  }
  Object.assign(out, {
    route_id: q.route?.id ?? null,
    price_list_id: pl?.id ?? null,
    unit_price: pl ? pl.unit_price : (s.unitPrice ?? 0),
    pricing_unit: pl ? pl.pricing_unit : (s.pricingUnit ?? "trip"),
    surcharge_amount: s.surchargeAmount ?? pl?.surcharge_amount ?? 0,
  });
  let fuelSource = "none";
  if (s.fuelSupportRate !== undefined || pl?.fuel_support_rate != null) {
    fuelSource = s.fuelSupportRate !== undefined ? "manual" : "price_list";
    Object.assign(out, {
      fuel_support_rate: s.fuelSupportRate ?? pl?.fuel_support_rate,
      fuel_support_base: "freight_revenue",
      fuel_support_rule_id: null,
    });
  } else if (q.fuel_rule) {
    fuelSource = `rule:${q.fuel_rule.scope_type}`;
    Object.assign(out, {
      fuel_support_rate: q.fuel_rule.rate_percent,
      fuel_support_base: q.fuel_rule.calculation_base,
      fuel_support_rule_id: q.fuel_rule.id,
    });
    // Định mức dầu / công thức: giữ số tiền đã tính trước đó (CSDL chỉ tự tính lại các cơ sở theo giá)
  } else {
    Object.assign(out, {
      fuel_support_rate: null,
      fuel_support_base: null,
      fuel_support_amount: 0,
      fuel_support_rule_id: null,
    });
  }
  out.pricing_snapshot = {
    ...(c.pricing_snapshot ?? {}),
    quoted_at: new Date().toISOString(),
    price_source: pl ? "price_list" : s.unitPrice === undefined ? "pending" : "manual",
    price_list_code: pl?.code ?? null,
    price_specificity: pl?.specificity ?? null,
    price_priority: pl?.priority ?? null,
    route_name: q.route?.name ?? null,
    route_distance_km: q.route?.distance_km ?? null,
    fuel_source: fuelSource,
    fuel_rate: out.fuel_support_rate ?? null,
    fuel_base: out.fuel_support_base ?? null,
    edited_from_order_form: true,
  };
  return out;
}

const cancelOrderSchema = z.object({
  orderId: uuid,
  reason: z.string().trim().min(3, "Vui lòng nhập lý do hủy đơn hàng").max(500),
});

/** Hủy cả đơn hàng tạo sai: hủy mọi chuyến chưa hoàn thành, không xóa dữ liệu */
export async function cancelOrder(input: z.input<typeof cancelOrderSchema>): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requirePermission("dispatch.delete", "shipments.delete");
    const p = cancelOrderSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("cancel_transport_order", {
      p_order_id: p.data.orderId,
      p_reason: p.data.reason,
    });
    if (error) throw error;
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
    return data as number;
  }, "Đã hủy đơn hàng.");
}

const tripDecisionSchema = z.object({
  requestIds: z.array(uuid).min(1, "Chưa chọn chuyến").max(200, "Mỗi lần duyệt tối đa 200 chuyến"),
  action: z.enum(["approve", "reject"]),
  comment: z.string().max(1000, "Tối đa 1000 ký tự").optional(),
});

/** Giám đốc duyệt / từ chối một hoặc nhiều chuyến (từ chối bắt buộc lý do) */
export async function decideTrips(input: z.input<typeof tripDecisionSchema>): Promise<ActionResult<{ done: number; failed: string[] }>> {
  return runAction(
    async () => {
      // Giám đốc hoặc người được ủy quyền duyệt hộ (thường là điều phối); CSDL kiểm tra lại quyền từng chuyến
      await requirePermission("approvals.approve", "dispatch.view");
      const p = tripDecisionSchema.safeParse(input);
      if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
      const d = p.data;
      if (d.action === "reject" && !d.comment?.trim()) throw new ActionError("Nhập lý do từ chối");
      const supabase = await createClient();
      let done = 0;
      const failed: string[] = [];
      for (const id of d.requestIds) {
        const { error } = await supabase.rpc("approval_decide", {
          p_request_id: id,
          p_action: d.action,
          p_comment: d.comment?.trim() || null,
          p_amount: null,
        });
        if (error) failed.push(toUserMessage(error));
        else done++;
      }
      if (done === 0 && failed.length) throw new ActionError(failed[0]);
      revalidatePath("/dieu-phoi", "layout");
      revalidatePath("/chuyen-xe", "layout");
      revalidatePath("/phe-duyet");
      return { done, failed };
    },
    input.action === "approve" ? "Đã duyệt chuyến, tài xế đã thấy chuyến." : "Đã từ chối chuyến.",
  );
}

const resubmitSchema = z.object({
  shipmentId: uuid,
  note: z.string().max(500, "Tối đa 500 ký tự").optional(),
});

/** Điều phối gửi duyệt lại chuyến bị Giám đốc từ chối */
export async function resubmitTrip(input: z.input<typeof resubmitSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("dispatch.update");
    const p = resubmitSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.rpc("resubmit_trip_approval", {
      p_shipment_id: p.data.shipmentId,
      p_note: p.data.note?.trim() || null,
    });
    if (error) throw error;
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
    revalidatePath("/phe-duyet");
  }, "Đã gửi Giám đốc duyệt lại.");
}

const delegationSchema = z.object({
  delegateId: uuid,
  /** Ngày hết hạn (YYYY-MM-DD, hết ngày theo giờ Việt Nam); để trống = đến khi thu hồi */
  endsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày hết hạn không hợp lệ")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  note: z.string().max(500, "Ghi chú tối đa 500 ký tự").optional(),
});

/** Giám đốc ủy quyền người khác duyệt hộ chuyến (đi công tác, hội họp) */
export async function grantTripDelegation(input: z.input<typeof delegationSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission();
    const p = delegationSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.rpc("grant_trip_delegation", {
      p_delegate_id: p.data.delegateId,
      p_ends_at: p.data.endsOn ? startOfDayVN(addDaysYMD(p.data.endsOn, 1)) : null,
      p_note: p.data.note?.trim() || null,
    });
    if (error) throw error;
    revalidatePath("/phe-duyet");
    revalidatePath("/dieu-phoi", "layout");
  }, "Đã ủy quyền duyệt chuyến.");
}

/** Thu hồi ủy quyền duyệt chuyến */
export async function revokeTripDelegation(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission();
    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_trip_delegation", {
      p_id: uuid.parse(id),
    });
    if (error) throw error;
    revalidatePath("/phe-duyet");
    revalidatePath("/dieu-phoi", "layout");
  }, "Đã thu hồi ủy quyền.");
}

const restoreSchema = z.object({ shipmentId: uuid });

/** Khôi phục chuyến đã hủy về "Chưa phân công" (mở lại đơn; cont đã trở về Lập kế hoạch được lấy lại) */
export async function restoreShipment(input: z.input<typeof restoreSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("dispatch.delete", "shipments.delete");
    const p = restoreSchema.safeParse(input);
    if (!p.success) throw new ActionError("Chuyến không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.rpc("restore_shipment", { p_shipment_id: p.data.shipmentId });
    if (error) throw error;
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
    revalidatePath("/ke-hoach");
  }, "Đã khôi phục chuyến về Chưa phân công. Phân công lại xe, tài xế.");
}

const deleteCancelledSchema = z.object({ ids: z.array(uuid).min(1, "Chưa chọn chuyến nào").max(2000, "Mỗi lần xóa tối đa 2.000 chuyến"), confirm: z.string().max(20) });
export type DeleteCancelledResult = { deleted: number; orders_deleted: number; skipped: { code: string; reason: string }[] };

/** Xóa vĩnh viễn chuyến đã hủy (CSDL giữ lại chuyến đã có chi phí, tạm ứng, thanh toán, công nợ) */
export async function deleteCancelledShipments(input: z.input<typeof deleteCancelledSchema>): Promise<ActionResult<DeleteCancelledResult>> {
  return runAction(async () => {
    await requirePermission("dispatch.delete", "shipments.delete");
    const p = deleteCancelledSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    if (p.data.confirm.trim().toUpperCase() !== "XOA") throw new ActionError("Gõ XOA để xác nhận xóa vĩnh viễn.");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("delete_cancelled_shipments", { p_ids: p.data.ids, p_confirm: p.data.confirm });
    if (error) throw error;
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
    return data as DeleteCancelledResult;
  });
}

const crewSchema = z.object({
  shipmentId: uuid,
  vehicleId: uuid,
  driverId: uuid,
  reason: z.string().trim().min(3, "Nhập lý do (ít nhất 3 ký tự)").max(500, "Lý do tối đa 500 ký tự"),
  /** Hủy nhận xe đổi sang xe khác: thứ tự xe mới (null = bỏ thứ tự) và thứ tự các chuyến khác của xe mới */
  vehicleDayOrder: dayOrder.nullable().optional(),
  otherOrders,
});

/** Hủy nhận xe (tài xế đã nhận / đang chạy, ví dụ xe hư): giao lại cho xe khác, chuyến về Chờ tài xế nhận */
export async function unacceptShipment(input: z.input<typeof crewSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("dispatch.update");
    const p = crewSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const d = p.data;
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("unaccept_shipment", {
      p_shipment_id: d.shipmentId,
      p_vehicle_id: d.vehicleId,
      p_driver_id: d.driverId,
      p_reason: d.reason,
    });
    if (error) throw error;
    if ((data as { vehicle_changed?: boolean } | null)?.vehicle_changed) {
      await setDayOrders(supabase, [...(d.otherOrders ?? []), ...(d.vehicleDayOrder ? [{ shipmentId: d.shipmentId, order: d.vehicleDayOrder }] : [])]);
    }
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
  }, "Đã hủy nhận xe. Chuyến về Chờ tài xế nhận trên xe mới.");
}

/** Sửa số xe / tài xế của chuyến đang chạy, đã giao hoặc đã đóng (nhập sai), bắt buộc lý do */
export async function correctShipmentCrew(input: z.input<typeof crewSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("dispatch.update", "shipments.update");
    const p = crewSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.rpc("correct_shipment_crew", {
      p_shipment_id: p.data.shipmentId,
      p_vehicle_id: p.data.vehicleId,
      p_driver_id: p.data.driverId,
      p_reason: p.data.reason,
    });
    if (error) throw error;
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
  }, "Đã sửa xe, tài xế của chuyến.");
}

const orderOnlySchema = z.object({ shipmentId: uuid, order: dayOrder.nullable() });

const routeRatesSchema = z.object({
  rows: z
    .array(z.object({ a: uuid, b: uuid, amount: z.number().min(0, "Lương mỗi chuyến không âm").max(100_000_000, "Lương mỗi chuyến quá lớn") }))
    .min(1, "Nhập lương mỗi chuyến cho ít nhất một tuyến")
    .max(1000),
});

/** Điều phối / kế toán điền giá lương chuyến cho các tuyến chưa có giá (lấy từ các chuyến) */
export async function saveRoutePayRates(input: z.input<typeof routeRatesSchema>): Promise<ActionResult<number>> {
  return runAction(async () => {
    await requirePermission("dispatch.update", "settlements.update");
    const p = routeRatesSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_route_pay_rates", { p_rows: p.data.rows });
    if (error) throw error;
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/luong-tai-xe");
    return data as number;
  }, "Đã lưu giá lương chuyến");
}

const driverPaySchema = z.object({
  shipmentId: uuid,
  amount: z.number().min(0).max(100_000_000).nullable(),
  note: z.string().max(300).optional(),
});

/** Kế toán sửa tay lương một chuyến (amount null = theo đơn giá) */
export async function setShipmentDriverPay(input: z.input<typeof driverPaySchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("settlements.update");
    const p = driverPaySchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_shipment_driver_pay", { p_shipment_id: p.data.shipmentId, p_amount: p.data.amount, p_note: p.data.note?.trim() || null });
    if (error) throw error;
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
    revalidatePath("/luong-tai-xe");
  }, input.amount === null ? "Đã trả lương chuyến về theo đơn giá" : "Đã sửa tay lương chuyến");
}

const deliveryDaysSchema = z.object({ shipmentId: uuid, days: z.number().int().min(1, "Số ngày giao từ 1 đến 60").max(60, "Số ngày giao từ 1 đến 60").nullable() });

/** Sửa "Số ngày giao" (chuyến dài ngày) ngay trên bảng Điều phối: bảng chấm công cộng đủ số ngày từ ngày nhận */
export async function setDeliveryDays(input: z.input<typeof deliveryDaysSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("dispatch.update", "dispatch.create");
    const p = deliveryDaysSchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_shipment_delivery_days", { p_shipment_id: p.data.shipmentId, p_days: p.data.days });
    if (error) throw error;
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
    revalidatePath("/cham-cong");
  }, "Đã lưu số ngày giao.");
}

/** Sửa "Thứ tự xe" của một chuyến ngay trên bảng Điều phối (tài xế thấy chuyến có thứ tự nhỏ nhất trước) */
export async function setVehicleOrder(input: z.input<typeof orderOnlySchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("dispatch.update", "dispatch.create");
    const p = orderOnlySchema.safeParse(input);
    if (!p.success) throw new ActionError(p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const supabase = await createClient();
    await setDayOrders(supabase, [{ shipmentId: p.data.shipmentId, order: p.data.order }]);
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
  }, "Đã lưu thứ tự xe.");
}
