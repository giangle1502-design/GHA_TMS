import { describe, expect, it } from "vitest";
import { addressSimilarity, deliveryNoteSummary, noteNumber, parseDeliveryNoteText } from "@/lib/delivery-note-parse";

// Chữ đọc từ ảnh biên bản giao hàng (mô phỏng kết quả bộ đọc: có ký tự lạ, tên hàng xuống dòng)
const VAP = `VIET AN PHA BIÊN BẢN GIAO HÀNG
Ngày giao: 23/11/2026
Số phiếu: PXK261123012
Số đơn hàng: SO261121008
Công ty bán: CÔNG TY TNHH VIỆT AN PHA
Địa chỉ: Số 34 Đường D17A, Khu TĐC Mỹ Phước I mở rộng, Phường Thới Hòa, TP HCM
Mã số thuế: 0100000001
Công ty mua: CÔNG TY TNHH GUMI POLYMER VINA
Địa chỉ: KCN Lộc An - Bình Sơn, Xã Long An, Huyện Long Thành, Đồng Nai
Mã số thuế: 0100000002
Đơn vị vận chuyển: LALAMOVE
Số xe: 51C-12345
Thông tin tài xế: TRẦN VĂN B
Thông tin hàng hóa
Số thứ | Mã hàng Tên mặt hàng Đơn vị Số lượng xuất Số bao Ghi chú
tự
1 | LDPE2426K | Hạt nhựa nguyên sinh LDPE 2426K | KG 1,000 40
Tổng cộng 1,000 40
ĐẠI DIỆN BÊN GIAO ĐẠI DIỆN KHÁCH HÀNG`;

const PLA = `BIÊN BẢN GIAO HÀNG
Ngày giao: 23/11/2026
Số phiếu: PXK261123009
Số đơn hàng: SO260915007
Công ty bán: CÔNG TY TNHH PLASTIC VIỆT NAM
Địa chỉ: Số A7 Khu dân cư ấp Mới 1, đường Liên xã Tân Xuân - Trung Chánh, Xã Hóc Môn, Thành phố Hồ Chí Minh, Việt Nam
Mã số thuế:
Công ty mua: CÔNG TY CỔ PHẦN XUẤT NHẬP KHẨU NAM THIÊN SÁNG
Địa chỉ: 1.15 và 1.16, tầng trệt + lửng, tòa nhà Ruby Garden, số 2A Nguyễn Sỹ Sách, Phường Tân Sơn, TP Hồ Chí Minh
Mã số thuế: 0100000003
Đơn vị vận chuyển: GHA
Thông tin tài xế: NGUYỄN VĂN A - CCCD: 001200000000
Thông tin hàng hóa
Số thứ Mã hàng Tên mặt hàng Đơn vị Số lượng Số bao Ghi chú
tự xuất
1 EVA EVA - ETHYLENE-VINYL ACETATE KG 24,750 990
COPOLYMER EVA
Tổng cộng 24,750 990`;

describe("parseDeliveryNoteText", () => {
  it("đọc phiếu Việt An Pha", () => {
    const p = parseDeliveryNoteText(VAP);
    expect(p.date).toBe("2026-11-23");
    expect(p.voucherNo).toBe("PXK261123012");
    expect(p.orderNo).toBe("SO261121008");
    expect(p.seller).toEqual({ name: "CÔNG TY TNHH VIỆT AN PHA", address: expect.stringContaining("D17A"), taxCode: "0100000001" });
    expect(p.buyer.name).toBe("CÔNG TY TNHH GUMI POLYMER VINA");
    expect(p.buyer.address).toContain("Long Thành");
    expect(p.buyer.taxCode).toBe("0100000002");
    expect(p.carrier).toBe("LALAMOVE");
    expect(p.plate).toBe("51C-12345");
    expect(p.driver).toBe("TRẦN VĂN B");
    expect(p.items).toEqual([{ code: "LDPE2426K", name: "Hạt nhựa nguyên sinh LDPE 2426K", unit: "KG", quantity: 1000, bags: 40 }]);
  });

  it("đọc phiếu Plastic Việt Nam: MST trống, CCCD tài xế, tên hàng xuống dòng", () => {
    const p = parseDeliveryNoteText(PLA);
    expect(p.seller.taxCode).toBe("");
    expect(p.buyer.name).toBe("CÔNG TY CỔ PHẦN XUẤT NHẬP KHẨU NAM THIÊN SÁNG");
    expect(p.buyer.taxCode).toBe("0100000003");
    expect(p.carrier).toBe("GHA");
    expect(p.plate).toBe("");
    expect(p.driver).toBe("NGUYỄN VĂN A");
    expect(p.driverIdNo).toBe("001200000000");
    expect(p.items).toEqual([{ code: "EVA", name: "EVA - ETHYLENE-VINYL ACETATE COPOLYMER EVA", unit: "KG", quantity: 24750, bags: 990 }]);
    expect(deliveryNoteSummary(p)).toBe("Số đơn hàng SO260915007 · Số phiếu PXK261123009 · Vận chuyển GHA, tài xế NGUYỄN VĂN A (CCCD 001200000000)");
  });

  it("ảnh mất dấu tiếng Việt vẫn nhận nhãn", () => {
    const p = parseDeliveryNoteText("Ngay giao: 23/11/2026\nSo phieu: PXK1\nSo don hang SO2\nCong ty mua: ABC\nDia chi: X");
    expect(p).toMatchObject({ date: "2026-11-23", voucherNo: "PXK1", orderNo: "SO2", buyer: { name: "ABC", address: "X" } });
  });
});

describe("noteNumber / addressSimilarity", () => {
  it("số kiểu Việt Nam", () => {
    expect(noteNumber("1,000")).toBe(1000);
    expect(noteNumber("24.750")).toBe(24750);
    expect(noteNumber("40")).toBe(40);
    expect(noteNumber("abc")).toBeNull();
  });
  it("địa chỉ", () => {
    const phieu = "KCN Lộc An - Bình Sơn, Xã Long An, Huyện Long Thành, Đồng Nai";
    expect(addressSimilarity(phieu, "KCN Lộc An Bình Sơn, Long Thành, Đồng Nai")).toBeGreaterThan(0.6);
    expect(addressSimilarity(phieu, "KCN Phú Mỹ, Bà Rịa - Vũng Tàu")).toBeLessThan(0.3);
  });
});
