import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/entities/record";
import { PageHeader } from "@/components/layout/page-header";
import { todayVN } from "@/lib/format";
import { blankForm, type PaymentFormData } from "@/lib/payment-request-form";
import { PaymentFormEditor, type SavedForm } from "./payment-form-editor";

export const metadata: Metadata = { title: "Đề nghị thanh toán, tạm ứng" };

const COLS =
  "id, code, form_type, form_date, recipient, requester_name, department, content, amount, advance_amount, due_date, payment_method, bank_account_no, bank_name, account_holder, attachment_count, items, overhead_ids, notes, created_at";

type Raw = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

function toForm(r: Raw): PaymentFormData {
  return {
    id: s(r.id),
    code: s(r.code),
    form_type: r.form_type === "advance" ? "advance" : "payment",
    form_date: s(r.form_date),
    recipient: s(r.recipient),
    requester_name: s(r.requester_name),
    department: s(r.department),
    content: s(r.content),
    amount: Number(r.amount ?? 0),
    advance_amount: Number(r.advance_amount ?? 0),
    due_date: s(r.due_date),
    payment_method: r.payment_method === "transfer" ? "transfer" : "cash",
    bank_account_no: s(r.bank_account_no),
    bank_name: s(r.bank_name),
    account_holder: s(r.account_holder),
    attachment_count: r.attachment_count === null || r.attachment_count === undefined ? null : Number(r.attachment_count),
    items: Array.isArray(r.items)
      ? (r.items as Raw[]).map((i) => ({ content: s(i.content), invoice_no: s(i.invoice_no), invoice_date: s(i.invoice_date), amount: Number(i.amount ?? 0) }))
      : [],
    overhead_ids: Array.isArray(r.overhead_ids) ? (r.overhead_ids as string[]) : [],
    notes: s(r.notes),
  };
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requirePagePermission("overhead.view", "overhead.create");
  const sp = await searchParams;
  const supabase = await createClient();
  const id = typeof sp.id === "string" && isUuid(sp.id) ? sp.id : null;
  const [list, one] = await Promise.all([
    supabase.from("payment_request_forms").select(COLS).order("form_date", { ascending: false }).order("created_at", { ascending: false }).limit(300),
    id ? supabase.from("payment_request_forms").select(COLS).eq("id", id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (list.error) throw list.error;
  if (one.error) throw one.error;
  const type = sp.loai === "advance" ? "advance" : "payment";
  const initial = one.data ? toForm(one.data as Raw) : { ...blankForm(type, todayVN()), requester_name: me.fullName ?? "" };
  const saved: SavedForm[] = ((list.data ?? []) as Raw[]).map((r) => ({
    id: s(r.id),
    code: s(r.code),
    form_type: r.form_type === "advance" ? "advance" : "payment",
    form_date: s(r.form_date),
    requester_name: s(r.requester_name),
    content: s(r.content),
    amount: Number(r.amount ?? 0),
  }));
  return (
    <>
      <PageHeader
        title="Đề nghị thanh toán, tạm ứng"
        description="Lập và in Giấy đề nghị thanh toán (mẫu 05-TT) và Giấy đề nghị tạm ứng (mẫu 03-TT) trên khổ A4 có logo GHA. Số tiền tự đọc thành chữ; lấy được các khoản từ Chi phí ngoài chuyến. Phiếu đã lưu in lại được bất cứ lúc nào."
      />
      <PaymentFormEditor
        key={initial.id ?? `new-${type}`}
        initial={initial}
        saved={saved}
        can={{
          create: me.permissions.has("overhead.create"),
          update: me.permissions.has("overhead.update") || me.permissions.has("overhead.create"),
          delete: me.permissions.has("overhead.delete"),
          markPaid: me.permissions.has("overhead.update"),
          pickOverhead: me.permissions.has("overhead.view"),
        }}
      />
    </>
  );
}
