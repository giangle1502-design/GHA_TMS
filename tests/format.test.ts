import { describe, expect, it } from "vitest";
import { addDaysYMD, formatDate, formatDateTime, formatVND, startOfDayVN, todayVN } from "@/lib/format";

describe("Định dạng Việt Nam", () => {
  it("ngày dd/MM/yyyy, không lệch ngày với chuỗi YYYY-MM-DD", () => {
    expect(formatDate("2026-10-16")).toBe("16/10/2026");
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
  });
  it("ngày giờ theo múi giờ Asia/Ho_Chi_Minh", () => {
    // 17:30 UTC = 00:30 ngày hôm sau ở Việt Nam
    expect(formatDateTime("2026-10-16T17:30:00Z")).toBe("17/10/2026 00:30");
  });
  it("tiền VND không có số lẻ, phân cách hàng nghìn bằng dấu phẩy", () => {
    const s = formatVND(3500000);
    expect(s).toBe("3,500,000 ₫");
    expect(formatVND(null)).toBe("");
  });
  it("hôm nay theo giờ VN", () => {
    expect(todayVN(new Date("2026-10-16T18:00:00Z"))).toBe("2026-10-17");
    expect(todayVN(new Date("2026-10-16T16:59:00Z"))).toBe("2026-10-16");
  });
  it("đầu ngày giờ VN quy ra UTC", () => {
    expect(startOfDayVN("2026-10-16")).toBe("2026-10-15T17:00:00.000Z");
  });
  it("cộng ngày lịch qua tháng/năm", () => {
    expect(addDaysYMD("2026-12-20", 30)).toBe("2027-01-19");
  });
});
