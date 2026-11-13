import { describe, expect, it } from "vitest";
import { bucketOf, isoWeek, resolvePeriod, weekStart } from "@/lib/report-period";

describe("kỳ báo cáo", () => {
  it("tuần ISO, thứ Hai đầu tuần", () => {
    expect(isoWeek("2026-11-01")).toBe("2026-W44");
    expect(isoWeek("2024-12-30")).toBe("2025-W01");
    expect(weekStart("2026-W44")).toBe("2026-10-26");
  });
  it("mặc định là tháng hiện tại, chia theo ngày", () => {
    const p = resolvePeriod({}, "2026-02-10");
    expect([p.kind, p.from, p.to, p.by]).toEqual(["thang", "2026-02-01", "2026-02-28", "ngay"]);
  });
  it("năm chia theo tháng; khoảng ngày đảo ngược tự sửa", () => {
    expect(resolvePeriod({ ky: "nam", nam: "2026" }, "2026-02-10")).toMatchObject({ from: "2026-01-01", to: "2026-12-31", by: "thang" });
    expect(resolvePeriod({ ky: "ngay", tu: "2026-11-05", den: "2026-11-01" })).toMatchObject({ from: "2026-11-01", to: "2026-11-05" });
  });
  it("nhãn kỳ con", () => {
    expect(bucketOf("2026-10-28", "thang")).toEqual({ key: "2026-10", label: "10/2026" });
    expect(bucketOf("2026-10-28", "ngay").label).toBe("28/10/2026");
  });
});
