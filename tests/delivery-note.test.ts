import { describe, expect, it } from "vitest";
import { GHA_COMPANY, noteCompany, noteDateText, noteFileName, type DeliveryNoteData } from "@/lib/delivery-note";

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

  it("đặt tên tệp PDF an toàn", () => {
    expect(noteFileName("CX/0001 A")).toBe("Phieu-giao-hang-CX-0001-A.pdf");
  });
});
