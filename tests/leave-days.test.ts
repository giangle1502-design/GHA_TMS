import { describe, expect, it } from "vitest";
import { countLeaveDays } from "@/lib/leave/days";

describe("Số ngày nghỉ gợi ý", () => {
  it("một ngày", () => expect(countLeaveDays("2026-11-02", "2026-11-02")).toBe(1));
  it("không tính Chủ nhật", () => expect(countLeaveDays("2026-11-07", "2026-11-09")).toBe(2)); // T7, CN, T2
  it("cả tuần làm việc 6 ngày", () => expect(countLeaveDays("2026-11-02", "2026-11-08")).toBe(6));
  it("ngày sai thứ tự", () => expect(countLeaveDays("2026-11-09", "2026-11-02")).toBe(0));
  it("chỉ Chủ nhật", () => expect(countLeaveDays("2026-11-08", "2026-11-08")).toBe(0));
});
