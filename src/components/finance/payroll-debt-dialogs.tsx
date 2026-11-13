"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { CustomFieldsEditor } from "@/components/entities/custom-fields-editor";
import { AddFieldButton } from "@/components/entities/add-field-button";
import { moduleCustomFields } from "@/lib/entities/record";
import { formatDateTime, formatVND, todayVN } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  createPayable,
  createPayroll,
  createPayrollsForMonth,
  createReceivable,
  listBillingShipments,
  previewPayroll,
  type BillingShipment,
  type PayrollComponentLine,
  type PayrollPreview,
} from "@/lib/finance/actions";
import { Field, MoneyField, type CreateActionProps } from "./create-dialogs";

const thisMonth = () => todayVN().slice(0, 7);

function Line({ label, value, sub, strong, minus }: { label: string; value: number; sub?: string; strong?: boolean; minus?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1", strong && "border-t pt-2 font-semibold")}>
      <span>
        {label}
        {sub ? <span className="ml-1 text-xs text-muted-foreground">{sub}</span> : null}
      </span>
      <span className={cn("tabular-nums", minus && value > 0 && "text-destructive")}>
        {minus && value > 0 ? "−" : ""}
        {formatVND(value)}
      </span>
    </div>
  );
}

/** Diễn giải cách tính một khoản: "24 ngày × 40,000", "42 chuyến"… */
function componentSub(c: PayrollComponentLine): string | undefined {
  if (c.method === "trip_rate") return `${c.qty} chuyến`;
  if (c.method === "per_workday" && c.rate != null) return `${c.qty} ngày × ${formatVND(c.rate)}`;
  if (c.method === "per_trip" && c.rate != null) return `${c.qty} chuyến × ${formatVND(c.rate)}`;
  if (c.method === "per_trip_offday" && c.rate != null) return `${c.qty} chuyến ngày nghỉ × ${formatVND(c.rate)}`;
  if (c.method === "over_trips" && c.rate != null) return `${c.qty} chuyến vượt × ${formatVND(c.rate)}`;
  return undefined;
}

/** Kế toán lập bảng lương tháng cho tài xế: xem trước từng khoản rồi gửi Giám đốc duyệt */
export function CreatePayrollDialog({ open, onOpenChange, customRows, canAddField, onDone }: CreateActionProps) {
  const fields = useMemo(() => moduleCustomFields("payrolls", customRows), [customRows]);
  const [driver, setDriver] = useState("");
  const [month, setMonth] = useState(thisMonth());
  const [bonus, setBonus] = useState<number | null>(null);
  const [deduction, setDeduction] = useState<number | null>(null);
  const [manual, setManual] = useState<Record<string, number | null>>({});
  const manualClean = useMemo(
    () => Object.fromEntries(Object.entries(manual).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0)),
    [manual],
  );
  const [offset, setOffset] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [bulkPending, startBulk] = useTransition();

  useEffect(() => {
    if (!driver || !month) return;
    let alive = true;
    const t = setTimeout(async () => {
      const r = await previewPayroll({ driverId: driver, month, bonus: bonus ?? 0, deduction: deduction ?? 0, manual: manualClean, offsetAdvance: offset });
      if (!alive) return;
      if (r.ok) {
        setPreview(r.data ?? null);
        setPreviewError(null);
      } else {
        setPreview(null);
        setPreviewError(r.error);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [driver, month, bonus, deduction, manualClean, offset]);

  const p = driver ? preview : null;
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && !bulkPending && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Lập bảng lương tài xế</DialogTitle>
          <DialogDescription>
            Thực nhận = lương cơ bản + lương chuyến + phụ cấp + thưởng − khấu trừ + chi phí tài xế tự trả đã duyệt − tiền đã ứng. Bảng lương chuyển Giám đốc
            duyệt, sau đó kế toán ghi nhận trả lương.
          </DialogDescription>
        </DialogHeader>
        {canAddField ? (
          <div>
            <AddFieldButton module="payrolls" entityKey="payrolls" customRows={customRows} label="Thêm trường cho biểu mẫu này" />
          </div>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,20rem)]">
          <div className="grid content-start gap-3 sm:grid-cols-2">
            <Field label="Tài xế *" htmlFor="pr-driver" help="Mức lương lấy từ Lương tài xế (đơn giá lương chuyến, mức lương theo khoản); chưa thiết lập thì lấy từ hồ sơ tài xế">
              <ReferenceSelect id="pr-driver" refKey="drivers_internal" value={driver} onChange={(v) => setDriver(v)} />
            </Field>
            <Field label="Tháng *" htmlFor="pr-month" help="Tính các chuyến hoàn thành trong tháng này">
              <Input id="pr-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <Field label="Thưởng" htmlFor="pr-bonus" help="Ví dụ thưởng chuyên cần, thưởng an toàn">
              <MoneyField id="pr-bonus" value={bonus} onChange={setBonus} />
            </Field>
            <Field label="Khấu trừ" htmlFor="pr-deduction" help="Ví dụ phạt, bảo hiểm, bồi thường hàng hỏng">
              <MoneyField id="pr-deduction" value={deduction} onChange={setDeduction} />
            </Field>
            {(preview?.manual_components ?? []).map((c) => (
              <Field
                key={c.code}
                label={c.name}
                htmlFor={`pr-m-${c.code}`}
                help={c.kind === "deduction" ? "Khoản trừ nhập tay tháng này (Lương tài xế → Khoản lương)" : "Khoản nhập tay tháng này, để trống nếu không có (Lương tài xế → Khoản lương)"}
              >
                <MoneyField id={`pr-m-${c.code}`} value={manual[c.code] ?? null} onChange={(v) => setManual((m) => ({ ...m, [c.code]: v }))} />
              </Field>
            ))}
            <Field
              label="Trừ tiền ứng vào lương"
              htmlFor="pr-offset"
              wide
              help="Mặc định theo Lương tài xế → Hướng dẫn, thiết lập chung. Bỏ tích: trả đủ lương, tiền ứng giữ lại để tài xế hoàn riêng."
            >
              <label className="flex items-center gap-2 text-sm">
                <input
                  id="pr-offset"
                  type="checkbox"
                  className="size-4"
                  checked={offset ?? preview?.offset_advance ?? true}
                  onChange={(e) => setOffset(e.target.checked)}
                />
                Trừ tiền đã ứng còn dư vào lương tháng này
              </label>
            </Field>
            <Field label="Ghi chú" htmlFor="pr-note" wide>
              <Textarea id="pr-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Ví dụ: Thưởng chuyên cần tháng 10" />
            </Field>
            <div className="sm:col-span-2">
              <CustomFieldsEditor fields={fields} idPrefix="pr-cf-" onChange={setCustom} className="lg:grid-cols-2" />
            </div>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm" aria-label="Bảng tính lương">
            <div className="mb-1 font-medium">Bảng tính {month ? `tháng ${month.slice(5, 7)}/${month.slice(0, 4)}` : ""}</div>
            {!driver ? (
              <p className="py-6 text-center text-muted-foreground">Chọn tài xế để xem bảng tính.</p>
            ) : previewError ? (
              <p className="py-6 text-center text-destructive">{previewError}</p>
            ) : !p ? (
              <p className="py-6 text-center text-muted-foreground">Đang tính…</p>
            ) : (
              <>
                {p.attendance ? (
                  <div className="mb-2 rounded border bg-card px-2 py-1.5 text-xs">
                    <div>
                      Chấm công: <b>{p.attendance.work}</b> ngày đi làm / {p.standard_days ?? "?"} ngày công chuẩn
                      {p.attendance.leave_paid ? ` · nghỉ có lương ${p.attendance.leave_paid}` : ""}
                      {p.attendance.sick ? ` · nghỉ BHXH ${p.attendance.sick}` : ""}
                      {p.attendance.leave_unpaid ? ` · không lương ${p.attendance.leave_unpaid}` : ""}
                      {p.attendance.absent ? ` · không báo ${p.attendance.absent}` : ""}
                    </div>
                    {p.attendance.pending ? (
                      <div className="mt-1 text-amber-700 dark:text-amber-400">
                        Còn {p.attendance.pending} ngày chờ xác nhận (chưa tính công).{" "}
                        <a href={`/cham-cong?thang=${month}`} target="_blank" rel="noreferrer" className="underline">
                          Mở Chấm công tài xế
                        </a>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {p.setup && p.components ? (
                  <>
                    {p.components.map((c) => (
                      <Line key={c.code} label={c.name} sub={componentSub(c)} value={c.amount} minus={c.kind === "deduction"} />
                    ))}
                    <Line label="Thưởng" value={p.bonus} />
                    <Line label="Khấu trừ khác" value={p.deduction - p.components.filter((c) => c.kind === "deduction").reduce((a, c) => a + c.amount, 0)} minus />
                  </>
                ) : (
                  <>
                    <Line label="Lương cơ bản" value={p.base_salary} />
                    <Line label="Lương chuyến" sub={`${p.trip_count} chuyến`} value={p.trip_salary} />
                    <Line label="Phụ cấp ăn" value={p.meal_allowance} />
                    <Line label="Phụ cấp khác" value={p.other_allowance} />
                    <Line label="Thưởng" value={p.bonus} />
                    <Line label="Khấu trừ" value={p.deduction} minus />
                  </>
                )}
                <Line label="Hoàn chi phí tự trả" sub={`${p.expense_count} khoản đã duyệt`} value={p.expense_reimbursement} />
                {(p.expense_lines ?? []).map((e) => (
                  <div key={e.name} className="flex justify-between gap-3 pl-3 text-xs text-muted-foreground">
                    <span>
                      {e.name} ({e.count})
                    </span>
                    <span className="tabular-nums">{formatVND(e.amount)}</span>
                  </div>
                ))}
                <Line label="Tổng được nhận" value={p.gross_amount} strong />
                <Line label="Trừ tiền đã ứng" sub={`đang giữ ${formatVND(p.advance_balance)}`} value={p.advance_offset} minus />
                <Line label="Thực nhận" value={p.net_amount} strong />
                {p.advance_carry > 0 ? (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    Tạm ứng còn {formatVND(p.advance_carry)} chưa trừ hết, tự chuyển sang tháng sau.
                  </p>
                ) : null}
                {p.trips_missing_rate ? (
                  <p className="mt-2 text-xs text-destructive">
                    {p.trips_missing_rate} chuyến chưa có đơn giá lương nên đang tính 0 đồng.{" "}
                    <a href="/luong-tai-xe?tab=trip_pay_lines" target="_blank" rel="noreferrer" className="underline">
                      Xem bảng kê, bổ sung đơn giá
                    </a>
                  </p>
                ) : null}
                {p.existing ? (
                  <p className="mt-2 text-xs text-destructive">Tài xế đã có bảng lương tháng này ({p.existing}). Hủy bảng cũ nếu muốn lập lại.</p>
                ) : null}
              </>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={pending || bulkPending || !month}
            title="Lập bảng lương với số liệu tự tính cho mọi tài xế có phát sinh trong tháng, bỏ qua tài xế đã có bảng lương"
            onClick={() =>
              startBulk(async () => {
                const r = await createPayrollsForMonth({ month });
                if (!r.ok) return void toast.error(r.error);
                toast.success(`Đã lập ${r.data?.created ?? 0} bảng lương${r.data?.skipped ? `, bỏ qua ${r.data.skipped} tài xế đã có` : ""}`);
                if (r.data?.trips_missing_rate) toast.warning(`${r.data.trips_missing_rate} chuyến chưa có đơn giá lương (tính 0 đồng). Xem Lương tài xế → Bảng kê lương chuyến.`);
                onDone();
              })
            }
          >
            <Users /> {bulkPending ? "Đang lập…" : "Lập cho tất cả tài xế"}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending || bulkPending}>
              Đóng
            </Button>
            <Button
              disabled={pending || bulkPending || Boolean(p?.existing)}
              onClick={() =>
                start(async () => {
                  if (!driver) return void toast.error("Chọn tài xế");
                  const r = await createPayroll({
                    driverId: driver,
                    month,
                    bonus: bonus ?? 0,
                    deduction: deduction ?? 0,
                    manual: manualClean,
                    offsetAdvance: offset,
                    note: note.trim() || undefined,
                    custom,
                  });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(`${r.message} (${r.data})`);
                  onDone();
                })
              }
            >
              {pending ? "Đang lưu…" : "Lập và gửi duyệt"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lập công nợ phải thu: gom các chuyến đã hoàn thành của một khách hàng, hoặc một khoản thu khác */
export function CreateReceivableDialog({ open, onOpenChange, customRows, canAddField, onDone, prefill }: CreateActionProps) {
  const fields = useMemo(() => moduleCustomFields("receivables", customRows), [customRows]);
  const [mode, setMode] = useState<"shipments" | "other">("shipments");
  const [customer, setCustomer] = useState(prefill?.customer ?? "");
  const [ships, setShips] = useState<BillingShipment[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(prefill?.shipment ? [prefill.shipment] : []));
  const [amount, setAmount] = useState<number | null>(null);
  const [issued, setIssued] = useState(todayVN());
  const [due, setDue] = useState("");
  const [invoice, setInvoice] = useState("");
  const [note, setNote] = useState("");
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!customer || mode !== "shipments") return;
    let alive = true;
    (async () => {
      const r = await listBillingShipments(customer);
      if (!alive) return;
      if (!r.ok) return void toast.error(r.error);
      setShips(r.data ?? []);
      setPicked((old) => new Set([...old].filter((id) => r.data?.some((s) => s.id === id))));
    })();
    return () => {
      alive = false;
    };
  }, [customer, mode]);

  const total = (ships ?? []).filter((s) => picked.has(s.id)).reduce((a, s) => a + Number(s.total_revenue), 0);
  const toggle = (id: string) =>
    setPicked((old) => {
      const n = new Set(old);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Lập công nợ phải thu</DialogTitle>
          <DialogDescription>Công nợ nội bộ để theo dõi thu tiền, không thay cho hóa đơn điện tử.</DialogDescription>
        </DialogHeader>
        {canAddField ? (
          <div>
            <AddFieldButton module="receivables" entityKey="receivables" customRows={customRows} label="Thêm trường cho biểu mẫu này" />
          </div>
        ) : null}
        <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm" role="radiogroup" aria-label="Loại công nợ">
          {(
            [
              ["shipments", "Từ chuyến đã hoàn thành"],
              ["other", "Khoản thu khác"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={mode === v}
              className={cn("flex-1 rounded-md px-3 py-1.5", mode === v ? "bg-background font-medium shadow-sm" : "text-muted-foreground")}
              onClick={() => setMode(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Khách hàng thanh toán *" htmlFor="ar-customer" help="Gõ tên hoặc mã để tìm; chưa có thì bấm Thêm mới">
            <ReferenceSelect id="ar-customer" refKey="customers" value={customer} onChange={(v) => setCustomer(v)} />
          </Field>
          {mode === "other" ? (
            <Field label="Số tiền *" htmlFor="ar-amount">
              <MoneyField id="ar-amount" value={amount} onChange={setAmount} />
            </Field>
          ) : (
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Tổng tiền các chuyến đã chọn</span>
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 font-semibold tabular-nums">{formatVND(total)}</div>
            </div>
          )}
          <Field label="Ngày lập" htmlFor="ar-issued">
            <Input id="ar-issued" type="date" value={issued} onChange={(e) => setIssued(e.target.value)} />
          </Field>
          <Field label="Hạn thanh toán" htmlFor="ar-due" help="Để trống: ngày lập + số ngày công nợ của khách hàng">
            <Input id="ar-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Số hóa đơn" htmlFor="ar-invoice" help="Ví dụ 0000123 (nếu đã xuất hóa đơn)">
            <Input id="ar-invoice" value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={100} />
          </Field>
          <Field
            label={mode === "other" ? "Nội dung *" : "Nội dung"}
            htmlFor="ar-note"
            help={mode === "other" ? "Ví dụ: Phí lưu ca, phí bốc xếp" : "Để trống: Cước vận chuyển N chuyến"}
          >
            <Input id="ar-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </Field>
        </div>
        {mode === "shipments" ? (
          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
              <span className="font-medium">Chuyến chưa lập công nợ {ships ? `(${ships.length})` : ""}</span>
              {ships?.length ? (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setPicked(picked.size === ships.length ? new Set() : new Set(ships.map((s) => s.id)))}
                >
                  {picked.size === ships.length ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                </button>
              ) : null}
            </div>
            <div className="max-h-64 overflow-y-auto">
              {!customer ? (
                <p className="p-4 text-center text-sm text-muted-foreground">Chọn khách hàng để xem các chuyến.</p>
              ) : ships === null ? (
                <p className="p-4 text-center text-sm text-muted-foreground">Đang tải…</p>
              ) : ships.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">Khách hàng này không còn chuyến hoàn thành nào chưa lập công nợ.</p>
              ) : (
                ships.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0 hover:bg-muted/40">
                    <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Chọn chuyến ${s.shipment_code}`} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{s.shipment_code}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.pickup_name} → {s.delivery_name} · {s.completed_at ? formatDateTime(s.completed_at) : ""}
                      </span>
                    </span>
                    <span className="tabular-nums">{formatVND(Number(s.total_revenue))}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        ) : null}
        <CustomFieldsEditor fields={fields} idPrefix="ar-cf-" onChange={setCustom} className="lg:grid-cols-2" />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Đóng
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (!customer) return void toast.error("Chọn khách hàng");
                const r = await createReceivable({
                  mode,
                  customerId: customer,
                  shipmentIds: mode === "shipments" ? [...picked] : undefined,
                  amount: mode === "other" ? (amount ?? undefined) : undefined,
                  issuedDate: issued || undefined,
                  dueDate: due || undefined,
                  invoiceNo: invoice.trim() || undefined,
                  note: note.trim() || undefined,
                  custom,
                });
                if (!r.ok) return void toast.error(r.error);
                toast.success(`${r.message} (${r.data})`);
                onDone();
              })
            }
          >
            {pending ? "Đang lưu…" : "Lập công nợ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lập công nợ phải trả nhà cung cấp (hoặc tài xế/xe ngoài) */
export function CreatePayableDialog({ open, onOpenChange, customRows, canAddField, onDone }: CreateActionProps) {
  const fields = useMemo(() => moduleCustomFields("payables", customRows), [customRows]);
  const [kind, setKind] = useState<"supplier" | "driver">("supplier");
  const [partner, setPartner] = useState("");
  const [content, setContent] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [ship, setShip] = useState("");
  const [issued, setIssued] = useState(todayVN());
  const [due, setDue] = useState("");
  const [invoice, setInvoice] = useState("");
  const [note, setNote] = useState("");
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lập công nợ phải trả</DialogTitle>
          <DialogDescription>Ví dụ hóa đơn sửa xe, thuê xe ngoài, nhiên liệu mua công nợ. Trả nhiều lần được.</DialogDescription>
        </DialogHeader>
        {canAddField ? (
          <div>
            <AddFieldButton module="payables" entityKey="payables" customRows={customRows} label="Thêm trường cho biểu mẫu này" />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Trả cho" htmlFor="ap-kind">
            <NativeSelect
              id="ap-kind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as "supplier" | "driver");
                setPartner("");
              }}
            >
              <option value="supplier">Nhà cung cấp</option>
              <option value="driver">Tài xế / xe ngoài</option>
            </NativeSelect>
          </Field>
          <Field label={kind === "supplier" ? "Nhà cung cấp *" : "Tài xế *"} htmlFor="ap-partner" help="Gõ để tìm; chưa có thì bấm Thêm mới">
            <ReferenceSelect
              key={kind}
              id="ap-partner"
              refKey={kind === "supplier" ? "suppliers" : "drivers"}
              value={partner}
              onChange={(v) => setPartner(v)}
            />
          </Field>
          <Field label="Nội dung *" htmlFor="ap-content" wide help="Ví dụ: Sửa phanh xe 51C12345">
            <Input id="ap-content" value={content} onChange={(e) => setContent(e.target.value)} maxLength={500} />
          </Field>
          <Field label="Số tiền *" htmlFor="ap-amount">
            <MoneyField id="ap-amount" value={amount} onChange={setAmount} />
          </Field>
          <Field label="Chuyến liên quan" htmlFor="ap-ship" help="Không bắt buộc">
            <ReferenceSelect id="ap-ship" refKey="shipment_ref" value={ship} allowQuickCreate={false} onChange={(v) => setShip(v)} />
          </Field>
          <Field label="Ngày lập" htmlFor="ap-issued">
            <Input id="ap-issued" type="date" value={issued} onChange={(e) => setIssued(e.target.value)} />
          </Field>
          <Field label="Hạn thanh toán" htmlFor="ap-due" help="Để trống: ngày lập + số ngày công nợ của nhà cung cấp">
            <Input id="ap-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Số hóa đơn" htmlFor="ap-invoice">
            <Input id="ap-invoice" value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={100} />
          </Field>
          <Field label="Ghi chú" htmlFor="ap-note">
            <Input id="ap-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          </Field>
        </div>
        <CustomFieldsEditor fields={fields} idPrefix="ap-cf-" onChange={setCustom} className="lg:grid-cols-2" />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Đóng
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (!partner) return void toast.error(kind === "supplier" ? "Chọn nhà cung cấp" : "Chọn tài xế");
                if (!amount) return void toast.error("Nhập số tiền");
                const r = await createPayable({
                  supplierId: kind === "supplier" ? partner : undefined,
                  driverId: kind === "driver" ? partner : undefined,
                  amount,
                  content,
                  shipmentId: ship || undefined,
                  issuedDate: issued || undefined,
                  dueDate: due || undefined,
                  invoiceNo: invoice.trim() || undefined,
                  note: note.trim() || undefined,
                  custom,
                });
                if (!r.ok) return void toast.error(r.error);
                toast.success(`${r.message} (${r.data})`);
                onDone();
              })
            }
          >
            {pending ? "Đang lưu…" : "Lập công nợ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
