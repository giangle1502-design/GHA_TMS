"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Loader2, Paperclip, Play, RotateCcw, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/driver-link/upload";
import { formatDateTime } from "@/lib/format";
import { addTaskComment, listTaskFiles, registerTaskFiles, taskAction, type TaskFile } from "@/lib/tasks/actions";

type Flags = { status: string; progress: number; canWork: boolean; canManage: boolean; isMine: boolean; assignedByMe: boolean };
type Mode = "progress" | "submit" | "reopen" | "cancel" | "approve" | null;

/** Mở trang lần đầu: đánh dấu đã xem (người giao thấy "Đã xem") */
export function MarkSeen({ taskId, enabled }: { taskId: string; enabled: boolean }) {
  const done = useRef(false);
  useEffect(() => {
    if (!enabled || done.current) return;
    done.current = true;
    const supabase = createClient();
    void supabase.rpc("mark_task_seen", { p_id: taskId });
  }, [taskId, enabled]);
  return null;
}

/** Các nút thao tác theo vai trò: người được giao (bắt đầu, tiến độ, báo xong), người giao (xác nhận, làm lại, hủy) */
export function TaskWorkPanel({ taskId, flags }: { taskId: string; flags: Flags }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState(String(flags.progress));
  const [pending, start] = useTransition();
  const open = flags.status === "todo" || flags.status === "in_progress";

  const run = (action: "start" | "progress" | "submit" | "approve" | "reopen" | "cancel") =>
    start(async () => {
      if ((action === "reopen" || action === "cancel") && !note.trim()) return void toast.error(action === "reopen" ? "Ghi lý do làm lại" : "Ghi lý do hủy");
      const p = Number(progress);
      if (action === "progress" && !(Number.isInteger(p) && p >= 0 && p <= 100)) return void toast.error("Tiến độ là số nguyên từ 0 đến 100");
      const r = await taskAction({ id: taskId, action, note: note.trim() || undefined, progress: action === "progress" ? p : undefined });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setMode(null);
      setNote("");
      router.refresh();
    });

  const titles: Record<Exclude<Mode, null>, string> = {
    progress: "Cập nhật tiến độ",
    submit: "Báo hoàn thành",
    approve: "Xác nhận hoàn thành",
    reopen: "Yêu cầu làm lại",
    cancel: "Hủy công việc",
  };

  const buttons: React.ReactNode[] = [];
  if (flags.canWork && flags.status === "todo")
    buttons.push(
      <Button key="start" disabled={pending} onClick={() => run("start")}>
        <Play className="size-4" /> Bắt đầu làm
      </Button>,
    );
  if (flags.canWork && open)
    buttons.push(
      <Button key="progress" variant="outline" disabled={pending} onClick={() => setMode("progress")}>
        Cập nhật % tiến độ
      </Button>,
      <Button key="submit" disabled={pending} onClick={() => setMode("submit")}>
        <Check className="size-4" /> Báo hoàn thành
      </Button>,
    );
  if (flags.canManage && (flags.status === "submitted" || (open && !flags.isMine)))
    buttons.push(
      <Button key="approve" disabled={pending} onClick={() => setMode("approve")} variant={flags.status === "submitted" ? "default" : "outline"}>
        <Check className="size-4" /> Xác nhận hoàn thành
      </Button>,
    );
  if (flags.canManage && (flags.status === "submitted" || flags.status === "done"))
    buttons.push(
      <Button key="reopen" variant="outline" disabled={pending} onClick={() => setMode("reopen")}>
        <RotateCcw className="size-4" /> Yêu cầu làm lại
      </Button>,
    );
  if (flags.canManage && flags.status !== "done" && flags.status !== "cancelled")
    buttons.push(
      <Button key="cancel" variant="ghost" className="text-destructive" disabled={pending} onClick={() => setMode("cancel")}>
        <X className="size-4" /> Hủy việc
      </Button>,
    );
  if (!buttons.length) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">{buttons}</div>
      <Dialog open={mode !== null} onOpenChange={(o) => !o && !pending && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode ? titles[mode] : ""}</DialogTitle>
            <DialogDescription>
              {mode === "submit"
                ? "Ghi kết quả đã làm. Người giao được báo để xác nhận hoặc yêu cầu làm lại."
                : mode === "reopen"
                  ? "Việc chuyển lại Đang làm, người được giao nhận thông báo kèm lý do."
                  : mode === "cancel"
                    ? "Người được giao được báo là việc đã hủy."
                    : mode === "approve"
                      ? "Việc chuyển sang Hoàn thành, người được giao nhận thông báo."
                      : "Người giao việc được báo tiến độ mới."}
            </DialogDescription>
          </DialogHeader>
          {mode === "progress" ? (
            <div className="space-y-1.5">
              <Label htmlFor="tk-progress">Tiến độ (%)</Label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Number(progress) || 0}
                  onChange={(e) => setProgress(e.target.value)}
                  className="w-full"
                  aria-label="Kéo chọn tiến độ"
                />
                <Input
                  id="tk-progress"
                  inputMode="numeric"
                  className="w-20"
                  value={progress}
                  onChange={(e) => setProgress(e.target.value.replace(/\D/g, "").slice(0, 3))}
                />
              </div>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="tk-note">
              {mode === "submit" ? "Kết quả" : mode === "reopen" ? "Lý do làm lại *" : mode === "cancel" ? "Lý do hủy *" : "Ghi chú (không bắt buộc)"}
            </Label>
            <Textarea
              id="tk-note"
              value={note}
              maxLength={5000}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                mode === "submit"
                  ? "Ví dụ: Đã gửi đối chiếu 5 khách, 4 khách đã ký"
                  : mode === "reopen"
                    ? "Ví dụ: Còn thiếu khách C, bổ sung trước thứ 6"
                    : mode === "progress"
                      ? "Ví dụ: Đã gửi 3/5 khách"
                      : ""
              }
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMode(null)} disabled={pending}>
              Đóng
            </Button>
            {mode ? (
              <Button variant={mode === "cancel" ? "destructive" : "default"} disabled={pending} onClick={() => run(mode)}>
                {pending ? "Đang lưu…" : titles[mode]}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Ô gửi trao đổi */
export function CommentBox({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      if (!body.trim()) return void toast.error("Nhập nội dung trao đổi");
      const r = await addTaskComment({ id: taskId, body: body.trim() });
      if (!r.ok) return void toast.error(r.error);
      setBody("");
      router.refresh();
    });
  return (
    <div className="space-y-2">
      <Label htmlFor="tk-comment">Trao đổi</Label>
      <Textarea
        id="tk-comment"
        value={body}
        maxLength={5000}
        rows={3}
        placeholder="Hỏi thêm, báo vướng mắc, nhắc việc… (Ctrl + Enter để gửi). Mọi người trong việc đều được báo."
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
        }}
      />
      <div className="flex justify-end">
        <Button size="sm" disabled={pending || !body.trim()} onClick={send}>
          <Send className="size-4" /> {pending ? "Đang gửi…" : "Gửi"}
        </Button>
      </div>
    </div>
  );
}

const ALLOWED = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

/** Tệp đính kèm của việc: ai trong việc cũng xem và tải lên được */
export function TaskFiles({ taskId, count, canUpload }: { taskId: string; count: number; canUpload: boolean }) {
  const router = useRouter();
  const [files, setFiles] = useState<TaskFile[] | null>(null);
  const [loading, startLoad] = useTransition();
  const [uploading, startUpload] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const load = () =>
    startLoad(async () => {
      const r = await listTaskFiles(taskId);
      if (r.ok) setFiles(r.data ?? []);
      else toast.error(r.error);
    });
  useEffect(() => {
    if (count > 0) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, count]);

  const upload = (list: FileList | null) =>
    startUpload(async () => {
      if (!list?.length) return;
      const picked = Array.from(list).slice(0, 10);
      const bad = picked.find((f) => !ALLOWED.includes(f.type));
      if (bad) return void toast.error(`Tệp ${bad.name} không hỗ trợ (chỉ ảnh, PDF, Excel .xlsx, Word .docx)`);
      const supabase = createClient();
      const done: { path: string; name: string; mime: string; size: number }[] = [];
      for (const f of picked) {
        const blob = f.type.startsWith("image/") ? await compressImage(f) : f;
        const mime = blob.type || f.type;
        if (blob.size > 10485760) return void toast.error(`Tệp ${f.name} lớn hơn 10 MB`);
        const path = `task/${taskId}/${crypto.randomUUID()}.${EXT[mime] ?? "jpg"}`;
        const { error } = await supabase.storage.from("documents").upload(path, blob, { contentType: mime, upsert: false });
        if (error) return void toast.error("Tải tệp không thành công: " + f.name);
        done.push({ path, name: f.name.slice(0, 200), mime, size: blob.size });
      }
      const r = await registerTaskFiles({ taskId, files: done });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      if (input.current) input.current.value = "";
      router.refresh();
      load();
    });

  return (
    <div className="space-y-2">
      {loading && !files ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Đang tải…
        </p>
      ) : count > 0 && files && files.length ? (
        <ul className="divide-y rounded-md border text-sm">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
              <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 text-primary hover:underline">
                {f.mime_type.startsWith("image/") && f.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt="" className="size-10 rounded object-cover" />
                ) : (
                  <FileText className="size-4 shrink-0" />
                )}
                <span className="truncate">{f.file_name}</span>
              </a>
              <span className="text-xs text-muted-foreground">
                {f.uploader ?? ""} · {formatDateTime(f.created_at)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Chưa có tệp đính kèm.</p>
      )}
      {canUpload ? (
        <>
          <input
            ref={input}
            type="file"
            multiple
            accept="image/*,application/pdf,.xlsx,.docx"
            className="hidden"
            onChange={(e) => upload(e.target.files)}
          />
          <Button size="sm" variant="outline" disabled={uploading} onClick={() => input.current?.click()}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />} {uploading ? "Đang tải lên…" : "Đính kèm tệp"}
          </Button>
          <p className="text-xs text-muted-foreground">Ảnh, PDF, Excel (.xlsx), Word (.docx); tối đa 10 tệp mỗi lần, 10 MB mỗi tệp.</p>
        </>
      ) : null}
    </div>
  );
}
