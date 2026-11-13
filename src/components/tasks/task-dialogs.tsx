"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Pencil, Play, X } from "lucide-react";
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
import { TASK_PRIORITY } from "@/lib/entities/definitions";
import type { CustomFieldRow } from "@/lib/entities/types";
import { todayVN } from "@/lib/format";
import { createTask, taskAction, updateTask } from "@/lib/tasks/actions";

export type TaskInitial = {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  dueTime: string | null;
  customerId: string | null;
  customerLabel: string | null;
  assignees: { id: string; name: string }[];
  custom: Record<string, unknown>;
};

/** Cộng ngày (YYYY-MM-DD) */
function addDays(d: string, n: number) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Biểu mẫu giao việc / sửa việc */
function TaskForm({
  open,
  onOpenChange,
  customRows,
  canAddField,
  onDone,
  initial,
  prefill,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customRows: CustomFieldRow[];
  canAddField: boolean;
  onDone: (id?: string) => void;
  initial?: TaskInitial;
  prefill?: Record<string, string>;
}) {
  const fields = useMemo(() => moduleCustomFields("tasks", customRows), [customRows]);
  const today = todayVN();
  const [title, setTitle] = useState(initial?.title ?? prefill?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? "normal");
  const [startDate, setStartDate] = useState(initial ? (initial.startDate ?? "") : today);
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [dueTime, setDueTime] = useState(initial?.dueTime?.slice(0, 5) ?? "");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? prefill?.customer ?? "");
  const [assignees, setAssignees] = useState<{ id: string; name: string }[]>(initial?.assignees ?? []);
  const [addKey, setAddKey] = useState(0);
  const [custom, setCustom] = useState<Record<string, unknown>>(initial?.custom ?? {});
  const rid = useRef(crypto.randomUUID());
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      if (!title.trim()) return void toast.error("Nhập tên công việc");
      if (!assignees.length) return void toast.error("Chọn ít nhất một người được giao");
      if (dueDate && startDate && dueDate < startDate) return void toast.error("Hạn hoàn thành phải từ ngày bắt đầu trở đi");
      if (dueTime && !dueDate) return void toast.error("Chọn ngày hạn trước khi chọn giờ");
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        priority: priority as "normal",
        assignees: assignees.map((a) => a.id),
        startDate: startDate || null,
        dueDate: dueDate || null,
        dueTime: dueTime || null,
        customerId: customerId || null,
        custom,
      };
      const r = initial ? await updateTask({ ...payload, id: initial.id }) : await createTask({ ...payload, clientRequestId: rid.current });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      onDone(initial ? initial.id : (r.data as string | undefined));
    });

  const quickDue = [
    { label: "Hôm nay", v: today },
    { label: "Ngày mai", v: addDays(today, 1) },
    { label: "3 ngày", v: addDays(today, 3) },
    { label: "1 tuần", v: addDays(today, 7) },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Sửa công việc" : "Giao việc"}</DialogTitle>
          <DialogDescription>
            {initial
              ? "Đổi hạn, đổi người hoặc nội dung. Người mới thêm và người đang làm được báo khi đổi hạn."
              : "Người được giao nhận thông báo ngay, bấm Bắt đầu làm, cập nhật % tiến độ rồi Báo hoàn thành để bạn xác nhận."}
          </DialogDescription>
        </DialogHeader>
        {canAddField ? (
          <div>
            <AddFieldButton module="tasks" entityKey="tasks" customRows={customRows} label="Thêm trường cho biểu mẫu này" />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-4">
            <Field label="Tên công việc *" htmlFor="tk-title" help="Ngắn gọn, bắt đầu bằng động từ. Ví dụ: Đối chiếu công nợ khách ABC tháng 10">
              <Input id="tk-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} autoFocus />
            </Field>
          </div>
          <div className="sm:col-span-4">
            <Field label="Nội dung, yêu cầu" htmlFor="tk-desc" help="Cần làm gì, kết quả mong muốn, lưu ý. Ví dụ: Gửi bảng đối chiếu qua email, khách ký xác nhận trước thứ 6">
              <Textarea id="tk-desc" value={description} maxLength={5000} rows={4} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-4 space-y-1.5">
            <Label htmlFor="tk-add-person">Người được giao *</Label>
            {assignees.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {assignees.map((a) => (
                  <li key={a.id} className="flex items-center gap-1 rounded-full border bg-muted px-2.5 py-0.5 text-sm">
                    {a.name}
                    <button
                      type="button"
                      className="rounded-full p-0.5 hover:bg-background"
                      aria-label={`Bỏ ${a.name}`}
                      onClick={() => setAssignees((xs) => xs.filter((x) => x.id !== a.id))}
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="max-w-md">
              <ReferenceSelect
                key={addKey}
                id="tk-add-person"
                refKey="staff"
                value=""
                allowQuickCreate={false}
                onChange={(v, label) => {
                  if (!v) return;
                  setAssignees((xs) => (xs.some((x) => x.id === v) ? xs : [...xs, { id: v, name: label }]));
                  setAddKey((k) => k + 1);
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Chọn một hoặc nhiều nhân viên (gõ tên để tìm). Nhân viên mới phải được mời vào phần mềm ở Người dùng trước.
            </p>
          </div>
          <Field label="Mức ưu tiên" htmlFor="tk-pri" help="Gấp: thông báo ghi [GẤP]">
            <NativeSelect id="tk-pri" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {TASK_PRIORITY.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Ngày bắt đầu" htmlFor="tk-start">
            <Input id="tk-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Hạn hoàn thành" htmlFor="tk-due" help="Để trống nếu không có hạn">
            <Input id="tk-due" type="date" value={dueDate} min={startDate || undefined} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field label="Giờ hạn" htmlFor="tk-due-time" help="Để trống = hết ngày (23:59)">
            <Input id="tk-due-time" type="time" value={dueTime} disabled={!dueDate} onChange={(e) => setDueTime(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-1.5 sm:col-span-4">
            <span className="text-xs text-muted-foreground">Chọn nhanh hạn:</span>
            {quickDue.map((q) => (
              <Button key={q.label} type="button" size="sm" variant={dueDate === q.v ? "default" : "outline"} className="h-7 px-2" onClick={() => setDueDate(q.v)}>
                {q.label}
              </Button>
            ))}
          </div>
          <div className="sm:col-span-2">
            <Field label="Khách hàng liên quan" htmlFor="tk-cus" help="Không bắt buộc. Gõ tên khách chưa có để thêm mới ngay">
              <ReferenceSelect id="tk-cus" refKey="customers" value={customerId} initialLabel={initial?.customerLabel ?? undefined} onChange={(v) => setCustomerId(v)} />
            </Field>
          </div>
        </div>
        <CustomFieldsEditor fields={fields} idPrefix="tk-cf-" initial={initial?.custom} onChange={setCustom} className="lg:grid-cols-2" />
        <p className="text-xs text-muted-foreground">Đính kèm tệp (ảnh, PDF, Excel, Word) ở trang chi tiết việc sau khi giao.</p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Đóng
          </Button>
          <Button disabled={pending} onClick={submit}>
            {pending ? "Đang lưu…" : initial ? "Lưu thay đổi" : "Giao việc"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Nút "Giao việc" trên bảng (CREATE_ACTIONS.task) */
export function CreateTaskDialog({ open, onOpenChange, customRows, canAddField, onDone, prefill }: CreateActionProps) {
  const router = useRouter();
  if (!open) return null;
  return (
    <TaskForm
      open={open}
      onOpenChange={onOpenChange}
      customRows={customRows}
      canAddField={canAddField}
      prefill={prefill}
      onDone={(id) => {
        onDone();
        if (id) router.push(`/giao-viec/${id}`);
      }}
    />
  );
}

/** Nút "Sửa" ở trang chi tiết việc */
export function EditTaskButton({ initial, customRows, canAddField }: { initial: TaskInitial; customRows: CustomFieldRow[]; canAddField: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-4" /> Sửa, gia hạn, đổi người
      </Button>
      {open ? (
        <TaskForm
          open={open}
          onOpenChange={setOpen}
          customRows={customRows}
          canAddField={canAddField}
          initial={initial}
          onDone={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

/** Nút trên từng dòng bảng việc: mở chi tiết, bắt đầu làm, xác nhận hoàn thành */
export function TaskRowActions({ row, onDone }: RowActionProps) {
  const [pending, start] = useTransition();
  const run = (action: "start" | "approve") =>
    start(async () => {
      const r = await taskAction({ id: String(row.id), action });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      onDone();
    });
  return (
    <>
      <Button asChild size="sm" variant="ghost" className="h-7 px-2">
        <Link href={`/giao-viec/${String(row.id)}`} aria-label={`Mở ${String(row.code)}`}>
          <ExternalLink className="size-3.5" /> Mở
        </Link>
      </Button>
      {row.can_work && row.status === "todo" ? (
        <Button size="sm" className="h-7 px-2" disabled={pending} onClick={() => run("start")} aria-label={`Bắt đầu ${String(row.code)}`}>
          <Play className="size-3.5" /> Bắt đầu
        </Button>
      ) : null}
      {row.can_confirm ? (
        <Button size="sm" className="h-7 px-2" disabled={pending} onClick={() => run("approve")} aria-label={`Xác nhận ${String(row.code)}`}>
          <Check className="size-3.5" /> Xác nhận xong
        </Button>
      ) : null}
    </>
  );
}
