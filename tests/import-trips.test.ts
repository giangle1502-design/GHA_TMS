import { describe, expect, it } from "vitest";
import { CORE_COLUMNS, cellToRaw, groupKey, mapHeaders, normalizePlate, parseDateVN, parseNum, parseStatus, parseUnit } from "@/lib/import-trips";

describe("nhập chuyến từ Excel", () => {
  it("đọc ngày dd/mm/yyyy, yyyy-mm-dd, số ngày Excel, ô ngày", () => {
    expect(parseDateVN("20/10/2026")).toBe("2026-10-20");
    expect(parseDateVN("5/1/26")).toBe("2026-01-05");
    expect(parseDateVN("2026-10-20")).toBe("2026-10-20");
    expect(parseDateVN(46315)).toBe("2026-10-20");
    expect(parseDateVN(cellToRaw(new Date(Date.UTC(2026, 9, 20))))).toBe("2026-10-20");
    expect(parseDateVN("31/02/2026")).toBe("invalid");
    expect(parseDateVN("abc")).toBe("invalid");
    expect(parseDateVN(null)).toBeNull();
  });
  it("số tiền dấu phẩy hàng nghìn", () => {
    expect(parseNum("1,200,000", true)).toBe(1200000);
    expect(parseNum(2500000, true)).toBe(2500000);
    expect(parseNum("39", false)).toBe(39);
    expect(parseNum("abc")).toBe("invalid");
  });
  it("biển số, trạng thái, đơn vị", () => {
    expect(normalizePlate("61k-312.95")).toBe("61K31295");
    expect(parseStatus("Đã hoàn thành")).toBe("completed");
    expect(parseStatus("đã phân công")).toBe("assigned");
    expect(parseStatus("Chờ phân công")).toBe("draft");
    expect(parseStatus("")).toBeNull();
    expect(parseStatus("lung tung")).toBe("invalid");
    expect(parseUnit("Tấn")).toBe("ton");
    expect(parseUnit("chuyến")).toBe("trip");
  });
  it("ghép tiêu đề cột, có dấu *, tên khác, báo thiếu cột bắt buộc", () => {
    const m = mapHeaders(["Mã khách hàng *", "Biển số", "ngay nhan hang", "Cột lạ"], CORE_COLUMNS);
    expect([...m.map.values()]).toEqual(["ma_kh", "bien_so", "ngay_nhan"]);
    expect(m.unknown).toEqual(["Cột lạ"]);
    expect(m.missing).toEqual(["Điểm nhận", "Điểm giao"]);
  });
  it("gộp đơn theo cột Gộp đơn và khách hàng", () => {
    expect(groupKey({ nhom: "DH1", ma_kh: "KH001" }, 2)).toBe(groupKey({ nhom: "dh1", ma_kh: "kh001" }, 3));
    expect(groupKey({ nhom: "DH1", ma_kh: "KH001" }, 2)).not.toBe(groupKey({ nhom: "DH1", ma_kh: "KH002" }, 3));
    expect(groupKey({ nhom: null, ma_kh: "KH001" }, 2)).not.toBe(groupKey({ nhom: null, ma_kh: "KH001" }, 3));
  });
});
