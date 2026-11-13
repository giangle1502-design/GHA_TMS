// Trò chuyện trong ứng dụng (0043): kiểu dữ liệu và hàm phụ dùng chung cho trang Trò chuyện và biểu tượng trên đầu trang.
import { TIME_ZONE } from "@/lib/format";

export type ChatRoom = {
  id: string;
  kind: "direct" | "group";
  display_name: string;
  other_user_id: string | null;
  member_count: number;
  my_role: "admin" | "member";
  last_message_at: string | null;
  created_at: string;
  last_body: string | null;
  last_kind: "text" | "system" | null;
  last_attachment_name: string | null;
  last_deleted: boolean | null;
  last_sender_id: string | null;
  last_sender_name: string | null;
  unread_count: number;
};

export type ChatMessage = {
  id: string;
  room_id: string;
  sender_id: string | null;
  kind: "text" | "system";
  body: string;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  client_id: string | null;
  created_at: string;
  deleted_at: string | null;
  pending?: boolean; // đang gửi (hiện mờ)
};

export type ChatMember = { room_id: string; user_id: string; role: "admin" | "member"; joined_at: string; last_read_at: string; display_name: string; role_names: string | null };
export type StaffPerson = { id: string; display_name: string; role_names: string | null; status: string };

export const MESSAGE_COLUMNS =
  "id, room_id, sender_id, kind, body, attachment_path, attachment_name, attachment_mime, attachment_size, client_id, created_at, deleted_at";

/** Sự kiện trong trình duyệt báo biểu tượng Trò chuyện trên đầu trang đếm lại tin chưa đọc */
export const CHAT_READ_EVENT = "chat:read";

/** Loại tệp được gửi kèm (bucket documents chỉ nhận các loại này, tối đa 10 MB) */
export const CHAT_FILE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};
export const CHAT_FILE_ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.pdf,.xlsx,.docx," + Object.keys(CHAT_FILE_TYPES).join(",");
export const CHAT_MAX_FILE = 10 * 1024 * 1024;

/** Đoán loại tệp theo đuôi khi trình duyệt không cho biết (thường gặp với .heic, .xlsx trên điện thoại) */
export function chatFileMime(file: { name: string; type: string }): string | null {
  if (CHAT_FILE_TYPES[file.type]) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const byExt: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return byExt[ext] ?? null;
}

const timeFmt = new Intl.DateTimeFormat("vi-VN", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("vi-VN", { timeZone: TIME_ZONE, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
const shortDayFmt = new Intl.DateTimeFormat("vi-VN", { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit" });

export function chatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}
export function chatDayKey(iso: string): string {
  return dayKeyFmt.format(new Date(iso));
}
/** "Hôm nay", "Hôm qua" hoặc "thứ hai, 02/11/2026" */
export function chatDayLabel(iso: string, now: Date = new Date()): string {
  const key = chatDayKey(iso);
  if (key === dayKeyFmt.format(now)) return "Hôm nay";
  if (key === dayKeyFmt.format(new Date(now.getTime() - 86400000))) return "Hôm qua";
  return dayFmt.format(new Date(iso));
}
/** Giờ (trong ngày) hoặc ngày/tháng cho danh sách cuộc trò chuyện */
export function chatListTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  return chatDayKey(iso) === dayKeyFmt.format(now) ? chatTime(iso) : shortDayFmt.format(new Date(iso));
}

/** Dòng xem trước tin cuối trong danh sách */
export function roomPreview(r: ChatRoom): string {
  if (!r.last_kind) return r.kind === "group" ? "Nhóm mới, chưa có tin nhắn" : "Chưa có tin nhắn";
  if (r.last_kind === "system") return r.last_body ?? "";
  const who = r.kind === "group" || r.last_sender_name === "Bạn" ? `${r.last_sender_name ?? ""}: ` : "";
  if (r.last_deleted) return `${who}Tin nhắn đã thu hồi`;
  if (r.last_body?.trim()) return who + r.last_body.replace(/\s+/g, " ");
  if (r.last_attachment_name) return `${who}📎 ${r.last_attachment_name}`;
  return who;
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(-2)
      .map((s) => s[0]?.toUpperCase())
      .join("") || "?"
  );
}

/** Bỏ dấu tiếng Việt để tìm "nguyen" ra "Nguyễn" */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export function formatFileSize(n: number | null | undefined): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Thứ tự danh sách: cuộc trò chuyện có tin mới nhất lên đầu */
export function sortRooms(rows: ChatRoom[]): ChatRoom[] {
  return [...rows].sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at));
}
