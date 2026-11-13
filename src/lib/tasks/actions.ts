"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ActionError, requirePermission, runAction, type ActionResult } from "@/lib/auth/action";
import { moduleCustomFields, splitCustom, validateRecord } from "@/lib/entities/record";
import { loadCustomFields, visibleCustomRows } from "@/lib/entities/server";

const uuid = z.uuid("Giá trị không hợp lệ");
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Chọn ngày");

function refresh(id?: string) {
  revalidatePath("/giao-viec");
  if (id) revalidatePath(`/giao-viec/${id}`);
}

const taskSchema = z
  .object({
    title: z.string().trim().min(1, "Nhập tên công việc").max(300, "Tên công việc tối đa 300 ký tự"),
    description: z.string().trim().max(5000).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"], { error: "Chọn mức ưu tiên" }),
    assignees: z.array(uuid).min(1, "Chọn ít nhất một người được giao").max(50),
    startDate: day.optional().nullable(),
    dueDate: day.optional().nullable(),
    dueTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/, "Giờ không hợp lệ")
      .optional()
      .nullable(),
    customerId: uuid.optional().nullable(),
    custom: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => !d.dueDate || !d.startDate || d.dueDate >= d.startDate, { message: "Hạn hoàn thành phải từ ngày bắt đầu trở đi" })
  .refine((d) => !d.dueTime || d.dueDate, { message: "Chọn ngày hạn trước khi chọn giờ" });

async function cleanCustom(perms: Set<string>, input: Record<string, unknown> | undefined) {
  const supabase = await createClient();
  const rows = visibleCustomRows(await loadCustomFields(supabase, "tasks"), perms);
  const fields = moduleCustomFields("tasks", rows, perms).filter((f) => !f.readOnly && f.type !== "formula");
  if (!fields.length) return {};
  const { data, errors } = validateRecord(fields, input ?? {});
  const first = Object.values(errors)[0];
  if (first) throw new ActionError(first);
  return splitCustom(fields, data).custom;
}

export async function createTask(input: z.input<typeof taskSchema> & { clientRequestId: string }): Promise<ActionResult<string>> {
  return runAction(async () => {
    const me = await requirePermission("tasks.create");
    const d = taskSchema.parse(input);
    const rid = uuid.parse(input.clientRequestId);
    const custom = await cleanCustom(me.permissions, d.custom);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_task", {
      p_title: d.title,
      p_assignees: d.assignees,
      p_description: d.description || null,
      p_priority: d.priority,
      p_start_date: d.startDate || null,
      p_due_date: d.dueDate || null,
      p_due_time: d.dueTime || null,
      p_customer_id: d.customerId || null,
      p_custom: custom,
      p_client_request_id: rid,
    });
    if (error) throw error;
    refresh();
    return data as string;
  }, "Đã giao việc, người được giao đã nhận thông báo");
}

export async function updateTask(input: z.input<typeof taskSchema> & { id: string }): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requirePermission();
    const id = uuid.parse(input.id);
    const d = taskSchema.parse(input);
    const custom = await cleanCustom(me.permissions, d.custom);
    const supabase = await createClient();
    const { error } = await supabase.rpc("update_task", {
      p_id: id,
      p_title: d.title,
      p_assignees: d.assignees,
      p_description: d.description || null,
      p_priority: d.priority,
      p_start_date: d.startDate || null,
      p_due_date: d.dueDate || null,
      p_due_time: d.dueTime || null,
      p_customer_id: d.customerId || null,
      p_custom: custom,
    });
    if (error) throw error;
    refresh(id);
  }, "Đã lưu thay đổi");
}

const ACTION_MESSAGES: Record<string, string> = {
  start: "Đã chuyển sang Đang làm",
  progress: "Đã cập nhật tiến độ",
  submit: "Đã báo hoàn thành",
  approve: "Đã xác nhận hoàn thành",
  reopen: "Đã yêu cầu làm lại",
  cancel: "Đã hủy việc",
};

export async function taskAction(input: { id: string; action: string; note?: string; progress?: number }): Promise<ActionResult<string>> {
  const d = z
    .object({
      id: uuid,
      action: z.enum(["start", "progress", "submit", "approve", "reopen", "cancel"]),
      note: z.string().trim().max(5000).optional(),
      progress: z.number().int().min(0).max(100).optional(),
    })
    .safeParse(input);
  if (!d.success) return { ok: false, error: d.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  return runAction(async () => {
    await requirePermission();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("task_action", {
      p_id: d.data.id,
      p_action: d.data.action,
      p_note: d.data.note || null,
      p_progress: d.data.progress ?? null,
    });
    if (error) throw error;
    refresh(d.data.id);
    return data as string;
  }, ACTION_MESSAGES[d.data.action]);
}

export async function addTaskComment(input: { id: string; body: string }): Promise<ActionResult> {
  return runAction(async () => {
    await requirePermission();
    const d = z.object({ id: uuid, body: z.string().trim().min(1, "Nhập nội dung trao đổi").max(5000) }).parse(input);
    const supabase = await createClient();
    const { error } = await supabase.rpc("add_task_comment", { p_id: d.id, p_body: d.body });
    if (error) throw error;
    refresh(d.id);
  }, "Đã gửi");
}

const FILE_PATH = /^task\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|pdf|xlsx|docx)$/;

/** Ghi tệp vừa tải lên Storage (task/<id>/...) thành tệp đính kèm của việc */
export async function registerTaskFiles(input: {
  taskId: string;
  files: { path: string; name: string; mime: string; size: number }[];
}): Promise<ActionResult> {
  return runAction(async () => {
    const me = await requirePermission();
    const d = z
      .object({
        taskId: uuid,
        files: z
          .array(
            z.object({
              path: z.string().regex(FILE_PATH, "Đường dẫn tệp không hợp lệ"),
              name: z.string().min(1).max(200),
              mime: z.enum([
                "image/jpeg",
                "image/png",
                "image/webp",
                "image/heic",
                "application/pdf",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              ]),
              size: z.number().int().positive().max(10485760, "Mỗi tệp tối đa 10 MB"),
            }),
          )
          .min(1)
          .max(10),
      })
      .parse(input);
    if (d.files.some((f) => !f.path.startsWith(`task/${d.taskId}/`))) throw new ActionError("Đường dẫn tệp không hợp lệ");
    const supabase = await createClient();
    const { error } = await supabase.from("documents").insert(
      d.files.map((f) => ({
        bucket: "documents",
        storage_path: f.path,
        file_name: f.name,
        mime_type: f.mime,
        size_bytes: f.size,
        entity_type: "task",
        entity_id: d.taskId,
        doc_type: f.mime.startsWith("image/") ? "photo" : "other",
        uploaded_by: me.id,
      })),
    );
    if (error) throw error;
    refresh(d.taskId);
  }, "Đã đính kèm tệp");
}

export type TaskFile = { id: string; file_name: string; mime_type: string; created_at: string; uploader: string | null; url: string | null };

/** Tệp đính kèm của việc, đường dẫn xem tạm 10 phút */
export async function listTaskFiles(taskId: string): Promise<ActionResult<TaskFile[]>> {
  return runAction(async () => {
    await requirePermission();
    const id = uuid.parse(taskId);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("documents")
      .select("id, file_name, mime_type, created_at, storage_path, uploaded_by")
      .eq("entity_type", "task")
      .eq("entity_id", id)
      .is("archived_at", null)
      .order("created_at");
    if (error) throw error;
    const rows = (data ?? []) as { id: string; file_name: string; mime_type: string; created_at: string; storage_path: string; uploaded_by: string | null }[];
    if (!rows.length) return [];
    const ids = [...new Set(rows.map((r) => r.uploaded_by).filter(Boolean))] as string[];
    const [{ data: signed }, { data: people }] = await Promise.all([
      supabase.storage.from("documents").createSignedUrls(rows.map((r) => r.storage_path), 600),
      supabase.from("staff_directory").select("id, display_name").in("id", ids),
    ]);
    const names = new Map((people ?? []).map((p: { id: string; display_name: string }) => [p.id, p.display_name]));
    return rows.map((r, i) => ({
      id: r.id,
      file_name: r.file_name,
      mime_type: r.mime_type,
      created_at: r.created_at,
      uploader: r.uploaded_by ? (names.get(r.uploaded_by) ?? null) : null,
      url: signed?.[i]?.signedUrl ?? null,
    }));
  });
}
