import { describe, expect, it } from "vitest";
import { GHA_COMPANY, NOTE_BATCH_MAX, noteBatchBaseName, noteBaseName, noteCompany, noteDateText, parseNoteIds, safeBackHref, isGhaYard, noteTimeText, type DeliveryNoteData } from "@/lib/delivery-note";

describe("phiếu giao hàng", () => {
  it("ghi ngày theo kiểu chứng từ", () => {
    expect(noteDateText("2026-11-15")).toBe("Ngày 15 tháng 11 năm 2026");
    expect(noteDateText(null)).toContain("Ngày ......");
  });

  it("dùng thông tin GHA mặc định khi danh mục công ty trống", () => {
    const d = { company: { name: "GHA", tax_code: null, address: " ", phone: null } } as unknown as DeliveryNoteData;
    expect(noteCompany(d)).toEqual({ name: "GHA", tax_code: GHA_COMPANY.tax_code, address: GHA_COMPANY.address, phone: null });
    expect(noteCompany({ company: null } as unknown as DeliveryNoteData).name).toBe(GHA_COMPANY.name);
  });

  it("đặt tên tệp PDF = Điểm nhận - Mã chuyến, bỏ ký tự không hợp lệ", () => {
    expect(noteBaseName("SP-ITC", "SNOV-0004")).toBe("SP-ITC - SNOV-0004");
    expect(noteBaseName("Kho A/B: \"Cát Lái\"?", "CX|0001")).toBe("Kho A B Cát Lái - CX 0001");
    expect(noteBaseName(null, "SNOV-0004")).toBe("SNOV-0004");
    expect(noteBaseName("  ", "")).toBe("Phieu giao hang");
  });
});

describe("in phiếu giao hàng hàng loạt", () => {
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";
  it("chỉ nhận UUID hợp lệ, bỏ trùng, giữ thứ tự", () => {
    expect(parseNoteIds(`${b}, ${a.toUpperCase()},xyz,${b}`)).toEqual([b, a]);
    expect(parseNoteIds(undefined)).toEqual([]);
    expect(parseNoteIds([a, b])).toEqual([a, b]);
  });
  it("giới hạn số phiếu mỗi lần in", () => {
    const many = Array.from({ length: NOTE_BATCH_MAX + 5 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(parseNoteIds(many.join(","))).toHaveLength(NOTE_BATCH_MAX);
  });
  it("đường quay lại chỉ là đường nội bộ", () => {
    expect(safeBackHref("/dieu-phoi?tu=2026-11-16", "/x")).toBe("/dieu-phoi?tu=2026-11-16");
    expect(safeBackHref("//evil.com", "/x")).toBe("/x");
    expect(safeBackHref("https://evil.com", "/x")).toBe("/x");
    expect(safeBackHref("/\\evil.com", "/x")).toBe("/x");
    expect(safeBackHref(undefined, "/x")).toBe("/x");
  });
  it("tên tệp PDF nhiều phiếu", () => {
    const n = (pickup_name: string | null, shipment_code: string) => ({ pickup_name, shipment_code });
    expect(noteBatchBaseName([n("SP-ITC", "SNOV-0004")])).toBe("SP-ITC - SNOV-0004");
    expect(noteBatchBaseName([n("SP-ITC", "SNOV-0004"), n("SP-ITC", "SNOV-0005")])).toBe("SP-ITC - SNOV-0004, SNOV-0005");
    expect(noteBatchBaseName(["1", "2", "3", "4"].map((i) => n("SP-ITC", `SNOV-000${i}`)))).toBe("SP-ITC - SNOV-0001 đến SNOV-0004 (4 chuyến)");
    expect(noteBatchBaseName([n("SP-ITC", "A-1"), n("Cát Lái", "A-2")])).toBe("Nhiều điểm nhận - A-1, A-2");
  });
});

describe("xác nhận nhận hàng Bãi xe GHA", () => {
  it("nhận ra Bãi xe GHA dù viết khác dấu, hoa thường", () => {
    expect(isGhaYard("BÃI XE GHA")).toBe(true);
    expect(isGhaYard("Bãi  xe GHA - Tân Đông Hiệp")).toBe(true);
    expect(isGhaYard("bai xe gha")).toBe(true);
    expect(isGhaYard("Kho VAP")).toBe(false);
    expect(isGhaYard(null)).toBe(false);
  });
  it("giờ nhận theo giờ Việt Nam", () => {
    expect(noteTimeText("2026-11-16T07:30:00Z")).toBe("16/11/2026 14:30");
    expect(noteTimeText(null)).toBe("");
  });
});
