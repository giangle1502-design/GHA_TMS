import { describe, expect, it } from "vitest";
import { matchCondition } from "@/lib/advanced-filter";

describe("matchCondition (lọc trên trình duyệt)", () => {
  it("chữ: không phân biệt dấu, hoa thường", () => {
    expect(matchCondition("Nguyễn Văn Đức", "text", "contains", "van duc")).toBe(true);
    expect(matchCondition("61K31295", "text", "starts", "61k")).toBe(true);
    expect(matchCondition("61K31295", "text", "eq", "61K3")).toBe(false);
  });
  it("số và trống", () => {
    expect(matchCondition(3, "number", "gte", "3")).toBe(true);
    expect(matchCondition(2, "number", "gt", "3")).toBe(false);
    expect(matchCondition(null, "number", "empty", "")).toBe(true);
    expect(matchCondition(0, "number", "notempty", "")).toBe(true);
  });
  it("ngày và lựa chọn", () => {
    expect(matchCondition("2026-10-29T08:00:00Z", "date", "eq", "2026-10-29")).toBe(true);
    expect(matchCondition("owned", "select", "eq", "owned")).toBe(true);
    expect(matchCondition("leased", "select", "neq", "owned")).toBe(true);
  });
});
