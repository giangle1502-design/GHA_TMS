import { describe, expect, it } from "vitest";
import { addMonthsYMD, bucketForRange, dashFilterQuery, monthsForTrend, parseDashFilter, previousRange, vnDate } from "@/lib/dashboard-filter";

const today = "2026-11-18"; // thứ Tư

describe("parseDashFilter", () => {
  it("mặc định là tháng này tính đến hôm nay", () => {
    expect(parseDashFilter({}, today)).toMatchObject({ ky: "thang", tu: "2026-11-01", den: today, kh: "" });
  });
  it("kỳ có sẵn", () => {
    expect(parseDashFilter({ ky: "hom-nay" }, today)).toMatchObject({ tu: today, den: today });
    expect(parseDashFilter({ ky: "tuan" }, today)).toMatchObject({ tu: "2026-11-16", den: today });
    expect(parseDashFilter({ ky: "7-ngay" }, today)).toMatchObject({ tu: "2026-11-12", den: today });
    expect(parseDashFilter({ ky: "nam" }, today)).toMatchObject({ tu: "2026-01-01", den: today });
  });
  it("tự chọn ngày: đảo nếu ngược, giới hạn 3 năm, có ngày mà thiếu ky thì hiểu là tự chọn", () => {
    expect(parseDashFilter({ tu: "2026-10-31", den: "2026-10-01" }, today)).toMatchObject({ ky: "tuy-chon", tu: "2026-10-01", den: "2026-10-31" });
    expect(parseDashFilter({ ky: "tuy-chon", tu: "2010-01-01", den: "2026-01-01" }, today).tu).toBe("2023-01-02");
  });
  it("bỏ mã không hợp lệ", () => {
    const id = "10000000-0000-0000-0000-000000000001";
    expect(parseDashFilter({ kh: id, tx: "abc", xe: "1;drop", tuyen: [id] }, today)).toMatchObject({ kh: id, tx: "", xe: "", tuyen: id });
  });
});

describe("previousRange", () => {
  it("tháng đến hôm nay → cùng kỳ tháng trước, kẹp cuối tháng", () => {
    expect(previousRange({ from: "2026-11-01", to: "2026-11-18" }).range).toEqual({ from: "2026-10-01", to: "2026-10-18" });
    expect(previousRange({ from: "2026-03-01", to: "2026-03-31" }).range).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("năm đến hôm nay → cùng kỳ năm trước", () => {
    const p = previousRange({ from: "2026-01-01", to: "2026-11-18" });
    expect(p.range).toEqual({ from: "2025-01-01", to: "2025-11-18" });
    expect(p.label).toBe("cùng kỳ năm trước");
  });
  it("hôm nay → hôm qua, kể cả ngày mùng 1", () => {
    expect(previousRange({ from: "2026-11-01", to: "2026-11-01" }, "hom-nay")).toEqual({ range: { from: "2026-10-31", to: "2026-10-31" }, label: "hôm trước" });
  });
  it("khoảng tự chọn → ngay trước, cùng số ngày", () => {
    expect(previousRange({ from: "2026-10-10", to: "2026-10-19" }).range).toEqual({ from: "2026-09-30", to: "2026-10-09" });
  });
});

describe("tiện ích", () => {
  it("cộng tháng", () => {
    expect(addMonthsYMD("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsYMD("2026-01-15", -1)).toBe("2025-12-15");
  });
  it("chia cột theo độ dài kỳ", () => {
    expect(bucketForRange({ from: "2026-11-01", to: "2026-11-30" })).toBe("ngay");
    expect(bucketForRange({ from: "2026-06-01", to: "2026-11-30" })).toBe("tuan");
    expect(bucketForRange({ from: "2026-01-01", to: "2026-11-30" })).toBe("thang");
  });
  it("biểu đồ tháng: ít nhất 6 tháng, mở rộng theo kỳ", () => {
    expect(monthsForTrend({ from: "2026-11-01", to: "2026-11-18" })).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(monthsForTrend({ from: "2026-01-01", to: "2026-11-18" })).toHaveLength(11);
  });
  it("ngày giờ Việt Nam", () => {
    expect(vnDate("2026-10-31T17:30:00+00:00")).toBe("2026-11-01");
  });
  it("tham số URL gọn", () => {
    expect(dashFilterQuery({ ky: "thang", tu: "2026-11-01", den: today, kh: "", tx: "", xe: "", tuyen: "" })).toBe("");
    expect(dashFilterQuery({ ky: "tuy-chon", tu: "2026-10-01", den: "2026-10-31", kh: "k", tx: "", xe: "", tuyen: "" })).toBe("ky=tuy-chon&tu=2026-10-01&den=2026-10-31&kh=k");
  });
});
