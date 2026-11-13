"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { moduleCustomFields, splitCustom, validateRecord } from "@/lib/entities/record";
import { loadCustomFields, visibleCustomRows } from "@/lib/entities/server";

const uuid = z.uuid("Giá trị không hợp lệ");
const money = (label: string) => z.number({ error: `Nhập ${label}` }).positive(`${label} phải lớn hơn 0`).max(1_000_000_000_000);

function refreshFinance() {
  revalidatePath("/chi-phi");
  revalidatePath("/phe-duyet");
  revalidatePath("/cong-no");
  revalidatePath("/bao-cao");
  revalidatePath("/thue-ngoai");
}

/** Kiểm tra và tách giá trị trường bổ sung của module (ứng tiền / chi phí) */
async function customValues(module: "advances" | "expenses" | "payrolls" | "receivables" | "payables", raw: Record<string, unknown> | undefined, perms: Set<string>) {
  const supabase = await createClient();
  const rows = visibleCustomRows(await loadCustomFields(supabase, module), perms);
  const fields = moduleCustomFields(module, rows, perms).filter((f) => !f.readOnly && f.type !== "formula");
  if (!fields.length) return {};
  const { data, errors } = validateRecord(fields, raw ?? {});
  const first = Object.values(errors)[0];
  if (first) throw new ActionError(first);
  return splitCustom(fields, data).custom;
}

const advanceSchema = z.object({
  driverId: uuid,
  amount: money("số tiền ứng"),
  reason: z.string().trim().min(1, "Nhập lý do ứng tiền").max(500),
  note: z.string().max(1000).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
  clientRequestId: uuid,
});

export async function createAdvance(input: z.input<typeof advanceSchema>): Promise<ActionResult<string>> {
  return runAction(async () => {
    const me = await requirePermission("advances.create");
    const d = advanceSchema.parse(input);
    const custom = await customValues("advances", d.custom, me.permissions);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_advance_request", {
      p_driver_id: d.driverId,
      p_amount: d.amount,
      p_reason: d.reason,
      p_note: d.note ?? null,
      p_custom: custom,
      p_client_request_id: d.clientRequestId,
    });
    if (error) throw error;
    refreshFinance();
    return data as string;
  }, "Đã gửi yêu cầu ứng tiền cho Giám đốc duyệt");
}

const expenseSchema = z.object({
  shipmentId: z.uuid("Chọn chuyến"),
  categoryId: z.uuid("Chọn loại chi phí"),
  amount: money("số tiền"),
  incurredAt: z.string().optional(),
  paidBy: z.enum(["driver", "company"]),
  supplierId: uuid.optional(),
  driverId: uuid.optional(),
  note: z.string().max(1000).optional(),
  refNo: z.string().trim().max(100, "Số chứng từ tối đa 100 ký tự").optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
  clientRequestId: uuid,
});

export async function createExpense(input: z.input<typeof expenseSchema>): Promise<ActionResult<string>> {
  return runAction(async () => {
    const me = await requirePermission("expenses.create");
    const d = expenseSchema.parse(input);
    const custom = await customValues("expenses", d.custom, me.permissions);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("add_shipment_expense", {
      p_shipment_id: d.shipmentId,
      p_category_id: d.categoryId,
      p_amount: d.amount,
      p_incurred_at: d.incurredAt ? new Date(d.incurredAt).toISOString() : null,
      p_note: d.note ?? null,
      p_paid_by: d.paidBy,
      p_driver_id: d.driverId ?? null,
      p_custom: custom,
      p_client_request_id: d.clientRequestId,
      p_supplier_id: d.paidBy === "company" ? (d.supplierId ?? null) : null,
      p_ref_no: d.refNo || null,
    });
    if (error) throw error;
    refreshFinance();
    revalidatePath(`/chuyen-xe/${d.shipmentId}`);
    return data as string;
  }, "Đã lưu chi phí");
}

const cancelExpenseSchema = z.object({
  expenseId: uuid,
  shipmentId: uuid.optional(),
  reason: z.string().trim().min(1, "Nhập lý do hủy").max(500),
});

/** Hủy khoản chi nhập sai (giữ lịch sử; muốn sửa thì hủy rồi nhập lại) */
export async function cancelExpense(input: z.input<typeof cancelExpenseSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("expenses.create", "expenses.update", "expenses.delete");
    const d = cancelExpenseSchema.parse(input);
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_shipment_expense", { p_expense_id: d.expenseId, p_reason: d.reason });
    if (error) throw error;
    refreshFinance();
    if (d.shipmentId) revalidatePath(`/chuyen-xe/${d.shipmentId}`);
  }, "Đã hủy khoản chi");
}

const decideSchema = z.object({
  requestId: uuid,
  action: z.enum(["approve", "reject"]),
  comment: z.string().max(1000).optional(),
  amount: z.number().positive().optional(),
});

export async function decideApproval(input: z.input<typeof decideSchema>): Promise<ActionResult> {
  return runAction(async () => {
    // dispatch.view: người được ủy quyền duyệt hộ chuyến; CSDL chỉ cho họ duyệt yêu cầu Duyệt chuyến xe
    await requirePermission("approvals.approve", "dispatch.view");
    const d = decideSchema.parse(input);
    if (d.action === "reject" && !d.comment?.trim()) throw new ActionError("Nhập lý do từ chối");
    const supabase = await createClient();
    const { error } = await supabase.rpc("approval_decide", {
      p_request_id: d.requestId,
      p_action: d.action,
      p_comment: d.comment ?? null,
      p_amount: d.amount ?? null,
    });
    if (error) throw error;
    refreshFinance();
    // Duyệt chuyến xe cũng làm đổi bảng điều phối / chuyến
    revalidatePath("/dieu-phoi", "layout");
    revalidatePath("/chuyen-xe", "layout");
  }, input.action === "approve" ? "Đã duyệt" : "Đã từ chối");
}

const paySchema = z.object({
  advanceId: uuid,
  paymentMethodId: uuid.optional(),
  bankAccountId: uuid.optional(),
  referenceNo: z.string().max(100).optional(),
  paidAt: z.string().optional(),
  note: z.string().max(1000).optional(),
});

export async function payAdvance(input: z.input<typeof paySchema>): Promise<ActionResult<string>> {
  return runAction(async () => {
    await requirePermission("advances.pay");
    const d = paySchema.parse(input);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("pay_advance", {
      p_advance_id: d.advanceId,
      p_payment_method_id: d.paymentMethodId ?? null,
      p_company_bank_account_id: d.bankAccountId ?? null,
      p_reference_no: d.referenceNo ?? null,
      p_paid_at: d.paidAt ? new Date(d.paidAt).toISOString() : null,
      p_note: d.note ?? null,
    });
    if (error) throw error;
    refreshFinance();
    return data as string;
  }, "Đã ghi nhận chuyển tiền");
}

export type DocumentItem = { id: string; file_name: string; doc_type: string; mime_type: string; created_at: string; url: string | null };

const DOC_ENTITIES = ["shipment", "shipment_expense", "advance_request", "purchase_request", "shipment_fee"] as const;

/** Chứng từ của một bản ghi, kèm đường dẫn xem tạm thời (10 phút) */
export async function listDocuments(entityType: string, entityId: string, feeTypeId?: string): Promise<ActionResult<DocumentItem[]>> {
  return runAction(async () => {
    await requirePermission();
    if (!DOC_ENTITIES.includes(entityType as (typeof DOC_ENTITIES)[number]) || !uuid.safeParse(entityId).success) throw new ActionError("Dữ liệu không hợp lệ");
    if (entityType === "shipment_fee" && !uuid.safeParse(feeTypeId).success) throw new ActionError("Dữ liệu không hợp lệ");
    const supabase = await createClient();
    let q = supabase
      .from("documents")
      .select("id, file_name, doc_type, mime_type, created_at, storage_path")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .is("archived_at", null);
    // Tệp của phí chi hộ: theo chuyến + loại phí
    if (entityType === "shipment_fee") q = q.eq("fee_type_id", feeTypeId!);
    const { data, error } = await q.order("created_at");
    if (error) throw error;
    const rows = (data ?? []) as (Omit<DocumentItem, "url"> & { storage_path: string })[];
    if (!rows.length) return [];
    const { data: signed } = await supabase.storage.from("documents").createSignedUrls(rows.map((r) => r.storage_path), 600);
    return rows.map((r, i) => ({ id: r.id, file_name: r.file_name, doc_type: r.doc_type, mime_type: r.mime_type, created_at: r.created_at, url: signed?.[i]?.signedUrl ?? null }));
  });
}

const registerSchema = z.object({
  entityType: z.enum(DOC_ENTITIES),
  entityId: uuid,
  /** Bắt buộc khi entityType = shipment_fee (tệp hóa đơn của một loại phí chi hộ) */
  feeTypeId: uuid.optional(),
  files: z
    .array(
      z.object({
        path: z.string().regex(/^(shipment|shipment_expense|advance_request|purchase_request|shipment_fee)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|pdf)$/),
        name: z.string().min(1).max(200),
        mime: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]),
        size: z.number().int().positive().max(10485760),
        docType: z.enum(["photo", "delivery_note", "receipt", "invoice", "other"]),
      }),
    )
    .min(1)
    .max(10),
});

/** Ghi thông tin tệp nhân viên vừa tải lên Storage thành chứng từ của bản ghi */
export async function registerDocuments(input: z.input<typeof registerSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requirePermission("documents.create");
    const d = registerSchema.parse(input);
    if (d.files.some((f) => !f.path.startsWith(`${d.entityType}/${d.entityId}/`))) throw new ActionError("Đường dẫn tệp không hợp lệ");
    if (d.entityType === "shipment_fee" && !d.feeTypeId) throw new ActionError("Chưa chọn loại phí của tệp");
    const supabase = await createClient();
    const { error } = await supabase.from("documents").insert(
      d.files.map((f) => ({
        bucket: "documents",
        storage_path: f.path,
        file_name: f.name,
        mime_type: f.mime,
        size_bytes: f.size,
        entity_type: d.entityType,
        entity_id: d.entityId,
        doc_type: f.docType,
        uploaded_by: me.id,
        ...(d.entityType === "shipment_fee" ? { fee_type_id: d.feeTypeId } : {}),
      })),
    );
    if (error) throw error;
    if (d.entityType === "shipment") {
      await supabase.from("shipments").update({ document_status: "submitted" }).eq("id", d.entityId).in("document_status", ["missing", "rejected"]);
      revalidatePath(`/chuyen-xe/${d.entityId}`);
    }
    if (d.entityType === "shipment_fee") revalidatePath(`/chuyen-xe/${d.entityId}`);
    if (d.entityType === "purchase_request") revalidatePath("/de-nghi");
    refreshFinance();
  }, "Đã tải chứng từ lên");
}

// ---------------------------------------------------------------- Lương tài xế (Giai đoạn 7)
const month = z
  .string()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, "Chọn tháng")
  .transform((v) => `${v.slice(0, 7)}-01`);
const optMoney = z.number().min(0, "Không được âm").max(1_000_000_000_000).optional();

export type PayrollPreview = {
  driver_name: string;
  period_from: string;
  period_to: string;
  trip_count: number;
  base_salary: number;
  per_trip_salary: number;
  trip_salary: number;
  meal_allowance: number;
  other_allowance: number;
  bonus: number;
  deduction: number;
  expense_count: number;
  expense_reimbursement: number;
  advance_balance: number;
  advance_offset: number;
  advance_carry: number;
  gross_amount: number;
  net_amount: number;
  existing: string | null;
  /** 0062: tính theo thiết lập lương (khoản lương, đơn giá lương chuyến) */
  setup?: boolean;
  pay_type?: "base_and_trip" | "trip_only" | "monthly_only";
  workdays?: number;
  trips_missing_rate?: number;
  components?: PayrollComponentLine[];
  /** Các khoản "nhập tay khi lập bảng lương" đang dùng (để hiện ô nhập) */
  manual_components?: { code: string; name: string; kind: "income" | "deduction" }[];
  /** 0063: có trừ tiền ứng vào lương không; chuyến ngày nghỉ, lễ; hoàn chi phí theo danh mục */
  offset_advance?: boolean;
  offday_trips?: number;
  expense_lines?: { name: string; count: number; amount: number }[];
  /** 0064: ngày công chuẩn (ngày không phải ngày nghỉ, lễ) và tổng hợp chấm công */
  standard_days?: number;
  attendance?: { work: number; leave_paid: number; sick: number; leave_unpaid: number; absent: number; pending: number };
};

export type PayrollComponentLine = {
  code: string;
  name: string;
  kind: "income" | "deduction";
  method: string;
  qty: number;
  rate: number | null;
  amount: number;
};

const manualSchema = z.record(z.string().max(30), z.number().min(0, "Không được âm").max(1_000_000_000_000)).optional();
const previewSchema = z.object({ driverId: uuid, month, bonus: optMoney, deduction: optMoney, manual: manualSchema, offsetAdvance: z.boolean().nullable().optional() });

export async function previewPayroll(input: z.input<typeof previewSchema>): Promise<ActionResult<PayrollPreview>> {
  return runAction(async () => {
    await requirePermission("settlements.update");
    const d = previewSchema.parse(input);
    const supabase = await createClient();
    const [{ data, error }, manual] = await Promise.all([
      supabase.rpc("driver_payroll_preview", {
        p_driver_id: d.driverId,
        p_month: d.month,
        p_bonus: d.bonus ?? 0,
        p_deduction: d.deduction ?? 0,
        p_manual: d.manual ?? {},
        p_offset_advance: d.offsetAdvance ?? null,
      }),
      supabase.from("pay_components").select("code, name, kind").eq("method", "manual").eq("is_active", true).order("sort_order"),
    ]);
    if (error) throw error;
    return { ...(data as PayrollPreview), manual_components: (manual.data ?? []) as PayrollPreview["manual_components"] };
  });
}

const payrollSchema = previewSchema.extend({ note: z.string().max(1000).optional(), custom: z.record(z.string(), z.unknown()).optional() });

export async function createPayroll(input: z.input<typeof payrollSchema>): Promise<ActionResult<string>> {
  return runAction(async () => {
    const me = await requirePermission("settlements.update");
    const d = payrollSchema.parse(input);
    const custom = await customValues("payrolls", d.custom, me.permissions);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_driver_payroll", {
      p_driver_id: d.driverId,
      p_month: d.month,
      p_bonus: d.bonus ?? 0,
      p_deduction: d.deduction ?? 0,
      p_note: d.note ?? null,
      p_custom_fields: custom,
      p_manual: d.manual ?? {},
      p_offset_advance: d.offsetAdvance ?? null,
    });
    if (error) throw error;
    refreshFinance();
    return data as string;
  }, "Đã lập bảng lương và gửi Giám đốc duyệt");
}

export async function createPayrollsForMonth(input: { month: string }): Promise<ActionResult<{ created: number; skipped: number; trips_missing_rate?: number }>> {
  return runAction(async () => {
    await requirePermission("settlements.update");
    const m = month.parse(input.month);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_driver_payrolls_for_month", { p_month: m });
    if (error) throw error;
    refreshFinance();
    return data as { created: number; skipped: number; trips_missing_rate?: number };
  });
}

const reasonSchema = z.object({ id: uuid, reason: z.string().trim().min(1, "Nhập lý do").max(500) });

export async function cancelPayroll(input: z.input<typeof reasonSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("settlements.update");
    const d = reasonSchema.parse(input);
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_driver_payroll", { p_payroll_id: d.id, p_reason: d.reason });
    if (error) throw error;
    refreshFinance();
  }, "Đã hủy bảng lương");
}

const payOutSchema = z.object({
  id: uuid,
  paymentMethodId: uuid.optional(),
  bankAccountId: uuid.optional(),
  referenceNo: z.string().max(100).optional(),
  paidAt: z.string().optional(),
  note: z.string().max(1000).optional(),
});

export async function payPayroll(input: z.input<typeof payOutSchema>): Promise<ActionResult<string>> {
  return runAction(async () => {
    await requirePermission("settlements.update");
    const d = payOutSchema.parse(input);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("pay_driver_payroll", {
      p_payroll_id: d.id,
      p_payment_method_id: d.paymentMethodId ?? null,
      p_company_bank_account_id: d.bankAccountId ?? null,
      p_reference_no: d.referenceNo ?? null,
      p_paid_at: d.paidAt ? new Date(d.paidAt).toISOString() : null,
      p_note: d.note ?? null,
    });
    if (error) throw error;
    refreshFinance();
    return data as string;
  }, "Đã ghi nhận trả lương");
}

// ---------------------------------------------------------------- Công nợ (Giai đoạn 7)
export type BillingShipment = {
  id: string;
  shipment_code: string;
  completed_at: string | null;
  pickup_name: string | null;
  delivery_name: string | null;
  /** Số khách phải trả của chuyến: cước, phụ phí, hỗ trợ dầu, phí khác và chi hộ */
  total_revenue: number;
};

/** Các chuyến đã hoàn thành chưa lập công nợ của một khách hàng thanh toán */
export async function listBillingShipments(customerId: string): Promise<ActionResult<BillingShipment[]>> {
  return runAction(async () => {
    await requirePermission("receivables.create");
    if (!uuid.safeParse(customerId).success) throw new ActionError("Chọn khách hàng");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("billing_shipment_list")
      .select("id, shipment_code, completed_at, pickup_name, delivery_name, total_revenue:amount_due")
      .eq("customer_id", customerId)
      .order("completed_at")
      .limit(500);
    if (error) throw error;
    return (data ?? []) as BillingShipment[];
  });
}

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();
const receivableSchema = z.object({
  mode: z.enum(["shipments", "other"]),
  customerId: uuid,
  shipmentIds: z.array(uuid).max(500).optional(),
  amount: optMoney,
  issuedDate: dateStr,
  dueDate: dateStr,
  invoiceNo: z.string().max(100).optional(),
  note: z.string().max(1000).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

export async function createReceivable(input: z.input<typeof receivableSchema>): Promise<ActionResult<string>> {
  return runAction(async () => {
    const me = await requirePermission("receivables.create");
    const d = receivableSchema.parse(input);
    const custom = await customValues("receivables", d.custom, me.permissions);
    const supabase = await createClient();
    const common = {
      p_issued_date: d.issuedDate ?? null,
      p_due_date: d.dueDate ?? null,
      p_invoice_no: d.invoiceNo ?? null,
      p_note: d.note ?? null,
      p_custom_fields: custom,
    };
    const { data, error } =
      d.mode === "shipments"
        ? await (async () => {
            if (!d.shipmentIds?.length) throw new ActionError("Chọn ít nhất một chuyến");
            return supabase.rpc("create_receivable_from_shipments", { p_shipment_ids: d.shipmentIds, ...common });
          })()
        : await (async () => {
            if (!d.amount) throw new ActionError("Nhập số tiền");
            return supabase.rpc("create_receivable", { p_customer_id: d.customerId, p_amount: d.amount, ...common });
          })();
    if (error) throw error;
    refreshFinance();
    return data as string;
  }, "Đã lập công nợ phải thu");
}

const payableSchema = z.object({
  supplierId: uuid.optional(),
  driverId: uuid.optional(),
  amount: money("số tiền"),
  content: z.string().trim().min(1, "Nhập nội dung").max(500),
  shipmentId: uuid.optional(),
  issuedDate: dateStr,
  dueDate: dateStr,
  invoiceNo: z.string().max(100).optional(),
  note: z.string().max(1000).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

export async function createPayable(input: z.input<typeof payableSchema>): Promise<ActionResult<string>> {
  return runAction(async () => {
    const me = await requirePermission("receivables.create");
    const d = payableSchema.parse(input);
    if (!d.supplierId && !d.driverId) throw new ActionError("Chọn nhà cung cấp hoặc tài xế");
    const custom = await customValues("payables", d.custom, me.permissions);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_payable", {
      p_supplier_id: d.supplierId ?? null,
      p_driver_id: d.driverId ?? null,
      p_amount: d.amount,
      p_content: d.content,
      p_issued_date: d.issuedDate ?? null,
      p_due_date: d.dueDate ?? null,
      p_shipment_id: d.shipmentId ?? null,
      p_invoice_no: d.invoiceNo ?? null,
      p_note: d.note ?? null,
      p_custom_fields: custom,
    });
    if (error) throw error;
    refreshFinance();
    return data as string;
  }, "Đã lập công nợ phải trả");
}

const debtPaySchema = payOutSchema.extend({
  kind: z.enum(["receivable", "payable"]),
  amount: money("số tiền"),
});

export async function recordDebtPayment(input: z.input<typeof debtPaySchema>): Promise<ActionResult<string>> {
  return runAction(
    async () => {
      await requirePermission("receivables.pay");
      const d = debtPaySchema.parse(input);
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("record_debt_payment", {
        p_kind: d.kind,
        p_debt_id: d.id,
        p_amount: d.amount,
        p_payment_method_id: d.paymentMethodId ?? null,
        p_company_bank_account_id: d.bankAccountId ?? null,
        p_reference_no: d.referenceNo ?? null,
        p_paid_at: d.paidAt ? new Date(d.paidAt).toISOString() : null,
        p_note: d.note ?? null,
      });
      if (error) throw error;
      refreshFinance();
      return data as string;
    },
    input.kind === "receivable" ? "Đã ghi nhận thu tiền" : "Đã ghi nhận trả tiền",
  );
}

export async function cancelDebt(input: z.input<typeof reasonSchema> & { kind: "receivable" | "payable" }): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("receivables.delete");
    const d = reasonSchema.parse(input);
    const kind = z.enum(["receivable", "payable"]).parse(input.kind);
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_debt", { p_kind: kind, p_debt_id: d.id, p_reason: d.reason });
    if (error) throw error;
    refreshFinance();
  }, "Đã hủy công nợ");
}

export async function voidPayment(input: z.input<typeof reasonSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("payments.delete");
    const d = reasonSchema.parse(input);
    const supabase = await createClient();
    const { error } = await supabase.rpc("void_payment", { p_payment_id: d.id, p_reason: d.reason });
    if (error) throw error;
    refreshFinance();
  }, "Đã hủy phiếu");
}

export type DebtPayment = {
  id: string;
  code: string;
  amount: number;
  paid_at: string;
  status: string;
  reference_no: string | null;
  void_reason: string | null;
  can_void: boolean;
};

/** Lịch sử phiếu thu/chi của một công nợ */
export async function listDebtPayments(kind: "receivable" | "payable", id: string): Promise<ActionResult<DebtPayment[]>> {
  return runAction(async () => {
    const me = await requirePermission("receivables.view");
    if (!uuid.safeParse(id).success) throw new ActionError("Dữ liệu không hợp lệ");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("payments")
      .select("id, code, amount, paid_at, status, reference_no, void_reason")
      .eq(kind === "receivable" ? "receivable_id" : "payable_id", id)
      .order("paid_at");
    if (error) throw error;
    return ((data ?? []) as Omit<DebtPayment, "can_void">[]).map((p) => ({ ...p, can_void: p.status === "posted" && me.permissions.has("payments.delete") }));
  });
}

// ---------------------------------------------------------------- Thiết lập chung lương tài xế (0063)
export type PayrollSettings = { offset_advance: boolean; weekly_off_days: number[]; deduct_base_unpaid?: boolean; return_trip_percent?: number; can_edit: boolean };

const payrollSettingSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("payroll.offset_advance"), value: z.boolean() }),
  z.object({ key: z.literal("payroll.deduct_base_unpaid"), value: z.boolean() }),
  z.object({ key: z.literal("payroll.return_trip_percent"), value: z.number().min(0).max(200) }),
  z.object({ key: z.literal("payroll.weekly_off_days"), value: z.array(z.number().int().min(0).max(6)).max(7) }),
]);

export async function savePayrollSetting(input: z.input<typeof payrollSettingSchema>): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission("settlements.update");
    const d = payrollSettingSchema.parse(input);
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_payroll_setting", { p_key: d.key, p_value: d.value });
    if (error) throw error;
    revalidatePath("/luong-tai-xe");
    revalidatePath("/cham-cong");
  }, "Đã lưu thiết lập lương");
}
