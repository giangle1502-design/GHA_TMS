import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn() }));

const { toUserMessage, ActionError, runAction, requirePermission } = await import("@/lib/auth/action");
const session = await import("@/lib/auth/session");

describe("Thông báo lỗi tiếng Việt", () => {
  it("giữ nguyên thông báo tiếng Việt từ trigger CSDL", () => {
    expect(toUserMessage({ code: "42501", message: "Không được tự thay đổi vai trò của chính mình" })).toBe(
      "Không được tự thay đổi vai trò của chính mình",
    );
  });
  it("chuyển lỗi RLS thành thông báo không có quyền", () => {
    expect(toUserMessage({ code: "42501", message: 'new row violates row-level security policy for table "x"' })).toBe(
      "Bạn không có quyền thực hiện thao tác này.",
    );
  });
  it("lỗi trùng dữ liệu", () => {
    expect(toUserMessage({ code: "23505", message: "duplicate key" })).toBe("Dữ liệu bị trùng với bản ghi đã có.");
  });
  it("không lộ lỗi thô", () => {
    expect(toUserMessage(new Error("connection refused 10.0.0.1"))).not.toContain("10.0.0.1");
  });
  it("runAction trả về ok=false thay vì ném lỗi", async () => {
    const res = await runAction(async () => {
      throw new ActionError("Thiếu dữ liệu");
    });
    expect(res).toEqual({ ok: false, error: "Thiếu dữ liệu" });
  });
});

describe("requirePermission phía máy chủ", () => {
  const base = { id: "u1", email: "a@b.c", fullName: null, avatarUrl: null, phone: null, roles: [], isDriver: false };
  it("từ chối khi chưa đăng nhập", async () => {
    vi.mocked(session.getCurrentUser).mockResolvedValueOnce(null);
    await expect(requirePermission("users.view")).rejects.toThrow(/đăng nhập/);
  });
  it("từ chối tài khoản chờ cấp quyền", async () => {
    vi.mocked(session.getCurrentUser).mockResolvedValueOnce({ ...base, status: "pending", permissions: new Set(["users.view"]) });
    await expect(requirePermission("users.view")).rejects.toThrow(/chưa được cấp quyền/);
  });
  it("từ chối khi thiếu quyền", async () => {
    vi.mocked(session.getCurrentUser).mockResolvedValueOnce({ ...base, status: "active", permissions: new Set(["reports.view"]) });
    await expect(requirePermission("users.configure")).rejects.toThrow(/không có quyền/);
  });
  it("cho phép khi có một trong các quyền", async () => {
    vi.mocked(session.getCurrentUser).mockResolvedValueOnce({ ...base, status: "active", permissions: new Set(["dispatch.view"]) });
    await expect(requirePermission("shipments.view", "dispatch.view")).resolves.toMatchObject({ id: "u1" });
  });
});
