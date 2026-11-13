"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, Eye, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { CustomFieldsEditor } from "@/components/entities/custom-fields-editor";
import { AddFieldButton } from "@/components/entities/add-field-button";
import { Field, type CreateActionProps } from "@/components/finance/create-dialogs";
import type { RowActionProps } from "@/components/finance/row-actions";
import { moduleCustomFields } from "@/lib/entities/record";
import { LEAVE_TYPES } from "@/lib/entities/definitions";
import { formatDate, formatDateTime, todayVN } from "@/lib/format";
import { decideApproval } from "@/lib/finance/actions";
import { acceptHandover, cancelLeave, createLeave, loadLeaveHandovers, loadMyCustomers, type LeaveHandoverRow } from "@/lib/leave/actions";
import { countLeaveDays } from "@/lib/leave/days";

type CustomerLine = { customerId: string; name: string; selected: boolean; receiverId: string; receiverLabel: string };
type TaskLine = { key: number; task: string; receiverId: string; receiverLabel: string };
let taskSeq = 0;

/** Tạo đơn xin nghỉ: loại nghỉ, ngày, bàn giao từng khách hàng / việc khác cho người nhận */
export function CreateLeaveDialog({ open, onOpenChange, customRows, canAddField, onDone }: CreateActionProps) {
  const fields = useMemo(() => moduleCustomFields("leaves", customRows), [customRows]);
  const today = todayVN();
  const [leaveType, setLeaveType] = useState("annual");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [days, setDays] = useState("1");
  const [daysTouched, setDaysTouched] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [customers, setCustomers] = useState<CustomerLine[]>([]);
  const [tasks, setTasks] = useState<TaskLine[]>([]);
  const [allReceiver, setAllReceiver] = useState("");
  const [addKey, setAddKey] = useState(0);
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState(false);
  const rid = useRef(crypto.randomUUID());
  const [pending, start_] = useTransition();

  // Khách do mình phụ trách: hiện sẵn để chọn bàn giao
  useEffect(() => {
    if (!open || loaded) return;
    loadMyCustomers().then((r) => {
      setLoaded(true);
      if (r.ok && r.data)
        setCustomers(r.data.map((c) => ({ customerId: c.id, name: `${c.name} (${c.code})`, selected: true, receiverId: "", receiverLabel: "" })));
    });
  }, [open, loaded]);

  const autoDays = countLeaveDays(start, end);
  const shownDays = daysTouched ? days : String(autoDays || "");

  const setReceiverAll = (id: string, label: string) => {
    setAllReceiver(id);
    if (!id) return;
    setCustomers((cs) => cs.map((c) => (c.selected ? { ...c, receiverId: id, receiverLabel: label } : c)));
    setTasks((ts) => ts.map((t) => ({ ...t, receiverId: id, receiverLabel: label })));
  };

  const submit = () =>
    start_(async () => {
      const n = Number(shownDays.replace(",", "."));
      if (!start || !end) return void toast.error("Chọn ngày bắt đầu và ngày kết thúc");
      if (end < start) return void toast.error("Ngày kết thúc phải từ ngày bắt đầu trở đi");
      if (!(n > 0)) return void toast.error("Nhập số ngày nghỉ");
      const chosen = customers.filter((c) => c.selected);
      const missing = chosen.find((c) => !c.receiverId);
      if (missing) return void toast.error(`Chọn người nhận cho khách ${missing.name}`);
      const taskRows = tasks.filter((t) => t.task.trim() || t.receiverId);
      if (taskRows.some((t) => !t.task.trim())) return void toast.error("Ghi nội dung công việc bàn giao");
      if (taskRows.some((t) => !t.receiverId)) return void toast.error("Chọn người nhận cho từng việc bàn giao");
      const r = await createLeave({
        leaveType: leaveType as "annual",
        startDate: start,
        endDate: end,
        days: n,
        reason: reason.trim() || undefined,
        handoverNote: note.trim() || undefined,
        handovers: [
          ...chosen.map((c) => ({ customerId: c.customerId, receiverId: c.receiverId })),
          ...taskRows.map((t) => ({ task: t.task.trim(), receiverId: t.receiverId })),
        ],
        custom,
        clientRequestId: rid.current,
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      onDone();
    });

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Tạo đơn xin nghỉ</DialogTitle>
          <DialogDescription>
            Đơn chuyển Giám đốc duyệt. Duyệt xong, người nhận bàn giao được báo và bấm “Nhận bàn giao”; trong những ngày nghỉ, khách được giao hiện là người nhận đang phụ trách thay.
          </DialogDescription>
        </DialogHeader>
        {canAddField ? (
          <div>
            <AddFieldButton module="leaves" entityKey="leave_requests" customRows={customRows} label="Thêm trường cho biểu mẫu này" />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Loại nghỉ *" htmlFor="lv-type" help="Phép, ốm, không lương hoặc khác (khác/không lương phải ghi lý do)">
            <NativeSelect id="lv-type" value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
              {LEAVE_TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Từ ngày *" htmlFor="lv-start">
            <Input
              id="lv-start"
              type="date"
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (end < e.target.value) setEnd(e.target.value);
              }}
            />
          </Field>
          <Field label="Đến ngày *" htmlFor="lv-end">
            <Input id="lv-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <Field label="Số ngày nghỉ *" htmlFor="lv-days" help="Tự tính, không tính Chủ nhật. Nghỉ nửa ngày thì sửa thành 0.5, 1.5…">
            <Input
              id="lv-days"
              inputMode="decimal"
              value={shownDays}
              onChange={(e) => {
                setDaysTouched(true);
                setDays(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 5));
              }}
            />
          </Field>
          <div className="sm:col-span-4">
            <Field label="Lý do" htmlFor="lv-reason" wide help="Ví dụ: Về quê đám cưới em, khám bệnh">
              <Input id="lv-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </Field>
          </div>
        </div>

        <section className="space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Bàn giao khách hàng</h3>
              <p className="text-xs text-muted-foreground">
                Khách bạn đang phụ trách được liệt kê sẵn. Bỏ chọn khách không cần bàn giao; mỗi khách chọn một người nhận (giao cho nhiều người khác nhau được).
              </p>
            </div>
            <div className="w-full space-y-1 sm:w-64">
              <Label htmlFor="lv-all">Giao tất cả cho</Label>
              <ReferenceSelect id="lv-all" refKey="staff" value={allReceiver} onChange={setReceiverAll} allowQuickCreate={false} />
            </div>
          </div>
          {customers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loaded ? "Bạn chưa được gán là Nhân viên phụ trách của khách nào (gán ở Khách hàng → cột Nhân viên phụ trách). Có thể thêm khách bên dưới." : "Đang tải…"}
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {customers.map((c, i) => (
                <li key={c.customerId} className="grid items-center gap-2 p-2 sm:grid-cols-[1fr_16rem_auto]">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={c.selected}
                      onChange={(e) => setCustomers((cs) => cs.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)))}
                      aria-label={`Bàn giao ${c.name}`}
                    />
                    {c.name}
                  </label>
                  <ReferenceSelect
                    id={`lv-c-${i}`}
                    refKey="staff"
                    value={c.receiverId}
                    initialLabel={c.receiverLabel}
                    disabled={!c.selected}
                    allowQuickCreate={false}
                    onChange={(v, label) => setCustomers((cs) => cs.map((x, j) => (j === i ? { ...x, receiverId: v, receiverLabel: label } : x)))}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Bỏ ${c.name}`}
                    onClick={() => setCustomers((cs) => cs.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="max-w-md space-y-1">
            <Label htmlFor="lv-add-customer">Thêm khách khác</Label>
            <ReferenceSelect
              key={addKey}
              id="lv-add-customer"
              refKey="customers"
              value=""
              onChange={(v, label) => {
                if (!v) return;
                setCustomers((cs) =>
                  cs.some((c) => c.customerId === v)
                    ? cs
                    : [...cs, { customerId: v, name: label, selected: true, receiverId: allReceiver, receiverLabel: "" }],
                );
                setAddKey((k) => k + 1);
              }}
            />
          </div>
        </section>

        <section className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">Bàn giao việc khác</h3>
              <p className="text-xs text-muted-foreground">Ví dụ: Theo dõi công nợ khách A, gửi bảng kê cuối tháng, nhận hồ sơ xe.</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTasks((ts) => [...ts, { key: ++taskSeq, task: "", receiverId: allReceiver, receiverLabel: "" }])}
            >
              <Plus className="size-4" /> Thêm việc
            </Button>
          </div>
          {tasks.map((t, i) => (
            <div key={t.key} className="grid items-center gap-2 sm:grid-cols-[1fr_16rem_auto]">
              <Input
                aria-label={`Công việc ${i + 1}`}
                value={t.task}
                maxLength={1000}
                placeholder="Nội dung công việc"
                onChange={(e) => setTasks((ts) => ts.map((x) => (x.key === t.key ? { ...x, task: e.target.value } : x)))}
              />
              <ReferenceSelect
                id={`lv-t-${t.key}`}
                refKey="staff"
                value={t.receiverId}
                initialLabel={t.receiverLabel}
                allowQuickCreate={false}
                onChange={(v, label) => setTasks((ts) => ts.map((x) => (x.key === t.key ? { ...x, receiverId: v, receiverLabel: label } : x)))}
              />
              <Button size="icon" variant="ghost" aria-label={`Xóa việc ${i + 1}`} onClick={() => setTasks((ts) => ts.filter((x) => x.key !== t.key))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <Field label="Ghi chú bàn giao chung" htmlFor="lv-note" help="Hồ sơ để ở đâu, liên hệ ai khi cần gấp…">
            <Textarea id="lv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </Field>
        </section>

        <CustomFieldsEditor fields={fields} idPrefix="lv-cf-" onChange={setCustom} className="lg:grid-cols-2" />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Đóng
          </Button>
          <Button disabled={pending} onClick={submit}>
            {pending ? "Đang gửi…" : "Gửi Giám đốc duyệt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HandoverList({ leaveId }: { leaveId: string }) {
  const [rows, setRows] = useState<LeaveHandoverRow[] | null>(null);
  useEffect(() => {
    loadLeaveHandovers(leaveId).then((r) => setRows(r.ok ? (r.data ?? []) : []));
  }, [leaveId]);
  if (!rows) return <p className="text-sm text-muted-foreground">Đang tải…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">Không có bàn giao.</p>;
  return (
    <ul className="divide-y rounded-md border text-sm">
      {rows.map((h) => (
        <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
          <span>
            {h.customer_name ? (
              <>
                Khách <b>{h.customer_name}</b>
              </>
            ) : (
              h.task
            )}{" "}
            → {h.receiver_name}
          </span>
          <span className={h.status === "accepted" ? "text-green-700" : "text-amber-700"}>
            {h.status === "accepted" ? `Đã nhận ${formatDateTime(h.accepted_at)}` : "Chưa nhận"}
            {h.receiver_note ? ` · ${h.receiver_note}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Thao tác trên dòng đơn xin nghỉ: xem bàn giao, Giám đốc duyệt / từ chối, người xin hủy */
export function LeaveRowActions({ row, onDone }: RowActionProps) {
  const [mode, setMode] = useState<"view" | "approve" | "reject" | "cancel" | null>(null);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const type = LEAVE_TYPES.find((t) => t.value === row.leave_type)?.label ?? "";
  const period = `${formatDate(String(row.start_date))} – ${formatDate(String(row.end_date))} (${String(row.days)} ngày)`;
  const run = () =>
    start(async () => {
      if ((mode === "reject" || mode === "approve") && row.approval_request_id) {
        if (mode === "reject" && !comment.trim()) return void toast.error("Nhập lý do từ chối");
        const r = await decideApproval({ requestId: String(row.approval_request_id), action: mode, comment: comment.trim() || undefined });
        if (!r.ok) return void toast.error(r.error);
        toast.success(r.message);
      } else if (mode === "cancel") {
        const r = await cancelLeave({ id: String(row.id), reason: comment.trim() || undefined });
        if (!r.ok) return void toast.error(r.error);
        toast.success(r.message);
      }
      setMode(null);
      setComment("");
      onDone();
    });
  return (
    <>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setMode("view")} aria-label={`Xem ${String(row.code)}`}>
        <Eye className="size-3.5" /> Xem
      </Button>
      {row.can_approve ? (
        <>
          <Button size="sm" className="h-7 px-2" onClick={() => setMode("approve")} aria-label={`Duyệt ${String(row.code)}`}>
            <Check className="size-3.5" /> Duyệt
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-destructive" onClick={() => setMode("reject")} aria-label={`Từ chối ${String(row.code)}`}>
            <X className="size-3.5" /> Từ chối
          </Button>
        </>
      ) : null}
      {row.can_cancel ? (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => setMode("cancel")} aria-label={`Hủy ${String(row.code)}`}>
          Hủy đơn
        </Button>
      ) : null}
      <Dialog open={mode !== null} onOpenChange={(o) => !o && !pending && setMode(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {mode === "approve" ? "Duyệt đơn xin nghỉ" : mode === "reject" ? "Từ chối đơn xin nghỉ" : mode === "cancel" ? "Hủy đơn xin nghỉ" : `Đơn ${String(row.code)}`}
            </DialogTitle>
            <DialogDescription>
              {String(row.requester_name ?? "")} · {type} · {period}
            </DialogDescription>
          </DialogHeader>
          {row.reason ? <p className="text-sm">Lý do: {String(row.reason)}</p> : null}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Bàn giao</p>
            <HandoverList leaveId={String(row.id)} />
            {row.handover_note ? <p className="text-sm text-muted-foreground">Ghi chú: {String(row.handover_note)}</p> : null}
          </div>
          {row.reject_reason ? <p className="text-sm text-destructive">Lý do từ chối: {String(row.reject_reason)}</p> : null}
          {mode && mode !== "view" ? (
            <div className="space-y-1.5">
              <Label htmlFor="lv-comment">{mode === "reject" ? "Lý do từ chối *" : mode === "cancel" ? "Lý do hủy" : "Ghi chú (không bắt buộc)"}</Label>
              <Textarea
                id="lv-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={1000}
                placeholder={mode === "reject" ? "Ví dụ: Đang cao điểm, chưa có người nhận khách" : ""}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMode(null)} disabled={pending}>
              Đóng
            </Button>
            {mode && mode !== "view" ? (
              <Button variant={mode === "approve" ? "default" : "destructive"} disabled={pending} onClick={run}>
                {pending ? "Đang lưu…" : mode === "approve" ? "Duyệt" : mode === "reject" ? "Từ chối" : "Hủy đơn"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Người nhận bấm "Nhận bàn giao" */
export function HandoverRowActions({ row, onDone }: RowActionProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [all, setAll] = useState(true);
  const [pending, start] = useTransition();
  if (!row.can_accept) return null;
  return (
    <>
      <Button size="sm" className="h-7 px-2" onClick={() => setOpen(true)} aria-label={`Nhận bàn giao ${String(row.item_label ?? "")}`}>
        <Check className="size-3.5" /> Nhận bàn giao
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nhận bàn giao</DialogTitle>
            <DialogDescription>
              {String(row.requester_name ?? "")} nghỉ {formatDate(String(row.start_date))} – {formatDate(String(row.end_date))}. Bạn phụ trách thay:{" "}
              <b>{String(row.item_label ?? "")}</b>
            </DialogDescription>
          </DialogHeader>
          {row.handover_note ? <p className="text-sm text-muted-foreground">Ghi chú bàn giao: {String(row.handover_note)}</p> : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Nhận luôn mọi mục khác của đơn này giao cho tôi
          </label>
          <div className="space-y-1.5">
            <Label htmlFor="ho-note">Ghi chú (không bắt buộc)</Label>
            <Textarea id="ho-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Ví dụ: Đã nắm lịch giao hàng tuần này" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Đóng
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await acceptHandover({ id: String(row.id), note: note.trim() || undefined, all });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(`Đã nhận ${r.data ?? 1} mục bàn giao`);
                  setOpen(false);
                  onDone();
                })
              }
            >
              {pending ? "Đang lưu…" : "Xác nhận nhận"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
