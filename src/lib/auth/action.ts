import "server-only";
import "@/lib/zod-vi";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import type { Permission } from "@/lib/permissions";

export type ActionResult<T = void> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

export class ActionError extends Error {}

/**
 * Dùng trong Server Action: kiểm tra đăng nhập, trạng thái và quyền phía máy chủ.
 * RLS trong CSDL vẫn là lớp kiểm tra cuối cùng.
 */
export async function requirePermission(...anyOf: Permission[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ActionError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
  if (user.status !== "active") throw new ActionError("Tài khoản chưa được cấp quyền hoặc đã bị khóa.");
  if (anyOf.length > 0 && !anyOf.some((p) => user.permissions.has(p))) {
    throw new ActionError("Bạn không có quyền thực hiện thao tác này.");
  }
  return user;
}

type PgLikeError = { code?: string; message?: string; details?: string | null } | null | undefined;

/** Chuyển lỗi PostgreSQL/PostgREST thành thông báo tiếng Việt cho người dùng. */
export function toUserMessage(err: PgLikeError | unknown): string {
  if (err instanceof ActionError) return err.message;
  const e = err as PgLikeError;
  const code = e?.code;
  const msg = e?.message ?? "";
  if (code === "42501" && /[À-ỹ]/.test(msg)) return msg; // thông báo tiếng Việt từ trigger/hàm
  if (code === "22023" && /[À-ỹ]/.test(msg)) return msg;
  if (code === "42501" || /row-level security/i.test(msg)) return "Bạn không có quyền thực hiện thao tác này.";
  if (code === "23505") return "Dữ liệu bị trùng với bản ghi đã có.";
  if (code === "23503") return "Dữ liệu đang được tham chiếu hoặc tham chiếu không tồn tại.";
  if (code === "23514") return "Dữ liệu không hợp lệ theo ràng buộc của hệ thống.";
  if (code === "23P01") return "Dữ liệu chồng lấn với bản ghi đang hiệu lực.";
  if (code === "P0001" && msg) return msg;
  return "Đã có lỗi xảy ra. Vui lòng thử lại hoặc liên hệ quản trị viên.";
}

/** Bọc server action: bắt lỗi và trả về ActionResult, không lộ lỗi thô ra giao diện. */
export async function runAction<T>(fn: () => Promise<T>, successMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: successMessage };
  } catch (err) {
    if (!(err instanceof ActionError)) console.error("[action]", err);
    return { ok: false, error: toUserMessage(err) };
  }
}
