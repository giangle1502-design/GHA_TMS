import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { signInWithGoogle } from "@/app/auth/actions";
import { formatDateTime, formatVND } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { AdvanceButton, CancelRequestButton, SignOutDriverButton } from "./money-forms";
import { EditExpenseButton } from "../expense-forms";
import { parseDriverAppSettings } from "@/lib/driver-link/settings";

export const metadata: Metadata = { title: "Ứng tiền và chi phí" };
export const dynamic = "force-dynamic";

type Finance = {
  ok: boolean;
  driver_id: string | null;
  driver_name: string | null;
  categories: { id: string; name: string; group: string; requires_image: boolean; requires_approval: boolean }[];
  trips: { id: string; label: string }[];
  advances: { id: string; code: string; amount: number; approved: number | null; reason: string; status: string; created_at: string; shipment_code: string | null; reject_reason: string | null }[];
  expenses: {
    id: string;
    code: string;
    amount: number;
    category: string;
    category_id: string;
    note: string | null;
    status: string;
    incurred_at: string;
    shipment_code: string;
    reject_reason: string | null;
    files: number;
    editable: boolean;
  }[];
  month: { advance_paid: number; expense_approved: number; expense_pending: number };
};

type Payrolls = {
  ok: boolean;
  advance_balance: number;
  payrolls: { code: string; period: string; trip_count: number; salary: number; expense_reimbursement: number; advance_offset: number; net_amount: number; status: string; paid_at: string | null }[];
};

const STATUS: Record<string, { label: string; variant: "warning" | "success" | "secondary" | "info" | "destructive" }> = {
  pending: { label: "Chờ Giám đốc duyệt", variant: "warning" },
  approved: { label: "Đã duyệt", variant: "info" },
  paid: { label: "Đã chuyển tiền", variant: "success" },
  rejected: { label: "Bị từ chối", variant: "destructive" },
  cancelled: { label: "Đã hủy", variant: "secondary" },
};
const PAYROLL_STATUS: typeof STATUS = {
  pending: { label: "Chờ Giám đốc duyệt", variant: "warning" },
  approved: { label: "Đã duyệt, chờ trả lương", variant: "info" },
  paid: { label: "Đã trả lương", variant: "success" },
  rejected: { label: "Đang lập lại", variant: "secondary" },
};
const ADV_STATUS: typeof STATUS = { ...STATUS, approved: { label: "Đã duyệt, chờ kế toán chuyển tiền", variant: "info" as const } };

type Me = { ok: boolean; signed_in: boolean; email?: string; driver_name?: string | null };

export default async function DriverMoney() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const me = claims?.claims?.sub ? ((await supabase.rpc("driver_me")).data as Me | null) : null;
  if (!me?.signed_in) return <SignInCard />;
  if (!me.ok)
    return (
      <div className="space-y-3 rounded-2xl bg-card p-5 shadow-xs">
        <h1 className="text-lg font-semibold">Tài khoản chưa gắn với hồ sơ tài xế</h1>
        <p className="text-sm">
          Bạn đang đăng nhập bằng <b>{me.email}</b>. Nhờ văn phòng ghi đúng email này vào hồ sơ tài xế (Danh mục → Tài xế → Email), sau đó mở lại trang này.
        </p>
        <SignOutDriverButton />
      </div>
    );

  const [finRes, payRes, cfgRes] = await Promise.all([supabase.rpc("driver_me_finance"), supabase.rpc("driver_me_payrolls"), supabase.rpc("driver_app_settings")]);
  const settings = parseDriverAppSettings(cfgRes.data);
  if (finRes.error) throw finRes.error;
  const f = finRes.data as Finance;
  const pay = (payRes.data ?? { ok: false, advance_balance: 0, payrolls: [] }) as Payrolls;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-card p-4 shadow-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            Tài xế <span className="font-semibold text-foreground">{f.driver_name}</span>
            <div className="text-xs">{me.email}</div>
          </div>
          <SignOutDriverButton />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Đã ứng tháng này" value={f.month.advance_paid} />
          <Stat label="Chi phí đã duyệt" value={f.month.expense_approved} />
          <Stat label="Chi phí chờ duyệt" value={f.month.expense_pending} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Tiền ứng đang giữ: <b className="tabular-nums text-foreground">{formatVND(pay.advance_balance ?? 0)}</b>. Cuối tháng kế toán đối soát: lương cộng chi phí tự trả
          đã duyệt, trừ tiền đã ứng.
        </p>
      </div>

      <AdvanceButton trips={f.trips} />
      <p className="text-xs text-muted-foreground">Chi phí chuyến được nhập khi bấm &quot;Hoàn thành chuyến&quot;; nhập sót thì bấm &quot;Bổ sung chi phí&quot; trên thẻ chuyến.</p>

      {pay.payrolls?.length ? (
        <Section title="Bảng lương" empty="">
          {pay.payrolls.map((p) => {
            const st = PAYROLL_STATUS[p.status] ?? { label: p.status, variant: "secondary" as const };
            return (
              <li key={p.code} data-payroll={p.code} className="rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm text-muted-foreground">Lương tháng {p.period}</div>
                    <div className="text-lg font-semibold tabular-nums">{formatVND(p.net_amount)}</div>
                  </div>
                  <Badge variant={st.variant}>{st.label}</Badge>
                </div>
                <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sm">
                  <span>Lương ({p.trip_count} chuyến)</span>
                  <span className="text-right tabular-nums">{formatVND(p.salary)}</span>
                  <span>Hoàn chi phí tự trả</span>
                  <span className="text-right tabular-nums">{formatVND(p.expense_reimbursement)}</span>
                  <span>Trừ tiền đã ứng</span>
                  <span className="text-right tabular-nums">−{formatVND(p.advance_offset)}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {p.code}
                  {p.paid_at ? ` · Trả ngày ${formatDateTime(p.paid_at)}` : ""}
                </div>
              </li>
            );
          })}
        </Section>
      ) : null}

      <Section title="Yêu cầu ứng tiền" empty="Chưa có yêu cầu ứng tiền trong 2 tháng gần đây.">
        {f.advances.map((a) => {
          const st = ADV_STATUS[a.status] ?? { label: a.status, variant: "secondary" as const };
          return (
            <li key={a.id} data-advance={a.code} className="rounded-2xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-lg font-semibold tabular-nums">{formatVND(a.approved ?? a.amount)}</div>
                  {a.approved !== null && Number(a.approved) !== Number(a.amount) ? (
                    <div className="text-xs text-muted-foreground">Xin {formatVND(a.amount)}, được duyệt {formatVND(a.approved)}</div>
                  ) : null}
                </div>
                <Badge variant={st.variant}>{st.label}</Badge>
              </div>
              <div className="mt-1 text-sm">{a.reason}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {a.code} · {formatDateTime(a.created_at)}
                {a.shipment_code ? ` · Chuyến ${a.shipment_code}` : ""}
              </div>
              {a.reject_reason ? <p className="mt-2 rounded-lg bg-destructive/10 p-2 text-sm">Lý do từ chối: {a.reject_reason}</p> : null}
              {a.status === "pending" ? <CancelRequestButton kind="advance" id={a.id} /> : null}
            </li>
          );
        })}
      </Section>

      <Section title="Chi phí đã nhập" empty="Chưa nhập chi phí nào trong 2 tháng gần đây.">
        {f.expenses.map((e) => {
          const st = STATUS[e.status] ?? { label: e.status, variant: "secondary" as const };
          return (
            <li key={e.id} data-expense={e.code} className="rounded-2xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{e.category}</div>
                  <div className="text-lg font-semibold tabular-nums">{formatVND(e.amount)}</div>
                </div>
                <Badge variant={st.variant}>{st.label}</Badge>
              </div>
              {e.note ? <div className="mt-1 text-sm">{e.note}</div> : null}
              <div className="mt-1 text-xs text-muted-foreground">
                {e.code} · Chuyến {e.shipment_code} · {formatDateTime(e.incurred_at)} · {e.files} ảnh
              </div>
              {e.reject_reason ? <p className="mt-2 rounded-lg bg-destructive/10 p-2 text-sm">Lý do từ chối: {e.reject_reason}</p> : null}
              {e.editable ? (
                <div className="mt-2 flex flex-wrap items-start gap-2">
                  {settings.expense_enabled ? <EditExpenseButton expense={e} categories={f.categories} photos={settings.photos_enabled} /> : null}
                  <CancelRequestButton kind="expense" id={e.id} />
                </div>
              ) : null}
            </li>
          );
        })}
      </Section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted px-1 py-2">
      <div className="text-sm font-semibold tabular-nums">{formatVND(value)}</div>
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section>
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children.length ? <ul className="space-y-2">{children}</ul> : <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">{empty}</p>}
    </section>
  );
}

function SignInCard() {
  return (
    <div className="space-y-4 rounded-2xl bg-card p-5 shadow-xs">
      <h1 className="text-lg font-semibold">Ứng tiền, chi phí và bảng lương</h1>
      <p className="text-sm text-muted-foreground">
        Đăng nhập bằng tài khoản Google (Gmail) của bạn để xin ứng tiền, xem chi phí và lương. Bạn chạy xe nào cũng dùng được. Email phải trùng email văn phòng ghi trong hồ sơ tài xế.
      </p>
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value="/tx/tien" />
        <button type="submit" className="flex h-14 w-full items-center justify-center gap-2 rounded-xl border bg-card text-lg font-semibold">
          <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
            <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
            <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
            <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
            <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
          </svg>
          Đăng nhập bằng Google
        </button>
      </form>
      <p className="text-xs text-muted-foreground">Nhận chuyến và hoàn thành chuyến vẫn dùng biển số xe ở mục &quot;Chuyến&quot;, không cần đăng nhập.</p>
    </div>
  );
}
