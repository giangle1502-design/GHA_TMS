import { describe, expect, it } from "vitest";
import { carrierValues, filterCostCont, toTSV, type SheetData } from "@/lib/cost-cont-import";
import { deliveryMethodOf, detectColumns, parseTSV, toRecords, tripNote } from "@/lib/paste-orders";

// Tiêu đề thật của sheet COST CONT (file MUA_2026.xlsm), cột A → AR
const HEADER = [
  "BCT", "PHÁP NHÂN", "NCC", "SỐ TỜ KHAI", "NGÀY KHAI", "LUỒNG KHAI", "MÃ HÀNG", "TỔNG ĐƠN", "Hình thức vận chuyển", "SỐ LƯỢNG 1 CONT",
  "LOẠI CONT", "SỐ CONT", "NGÀY GIAO", "ĐIỂM GIAO", "PXK", "Tình trạng giao", "Lưu bãi", "Ngày gia hạn", "Lưu cont", "Phí gia hạn",
  "Hóa đơn gia hạn", "ĐIỂM LẤY CONT", "Hãng tàu", "Số Bill", "Hàng cầm", "Phí bốc xếp", "NHÀ VẬN CHUYỂN", "Phí nâng", "Ngày xuất HĐ",
  "Số hóa đơn", "Đơn vị xuất", "PHÍ VẬN CHUYỂN", "HĐ phí v/c", "Phí tờ khai/cont", "Hóa đơn tờ khai", "Thuế", "Tổng", "Phí hạ rỗng",
  "Phụ thu phí nâng", "Số hóa đơn", "Nhà xuất HĐ", "Số hóa đơn Phụ thu phí nâng", "Nhà xuất HĐ", "",
];
const row = (over: Record<number, string>) => HEADER.map((_, i) => over[i] ?? "");
const GHA = row({ 0: "1298.4", 1: "VAP", 2: "TOYOTA", 3: "108816800630", 4: "13/11/2026", 6: "LLDPE2607G", 7: "198000", 8: "pallet", 9: "24750", 10: "40", 11: "FFAU5201607", 12: "17/11/2026", 13: "BÃI ANH GIANG", 15: "Da giao", 21: "CATLAI", 22: "MAERSK", 23: "721632727", 24: "Không", 26: "GHA" });
const OTHER = row({ 1: "PLA", 6: "X", 9: "24750", 12: "17/11/2026", 13: "KHO A", 21: "VICT", 26: "QUANGLOC" });
const OLD = row({ 1: "PLA", 6: "Y", 9: "24750", 12: "05/10/2026", 13: "KHO A", 21: "VICT", 26: "gha" });
const PENDING = row({ 1: "VAP", 6: "Z", 8: "xá", 9: "25000", 12: "19/11/2026", 13: "MẠNH NAM", 15: "Chua giao", 21: "KNQ LONG BÌNH", 26: " GHA " });
const data: SheetData = { fileName: "MUA_2026.xlsm", sheet: "COST CONT", header: HEADER, rows: [GHA, OTHER, OLD, PENDING] };

describe("Nhập từ sheet COST CONT", () => {
  it("chỉ lấy dòng Nhà vận chuyển (cột AA) = GHA trong khoảng ngày giao", () => {
    const r = filterCostCont(data, { carrier: "GHA", from: "2026-11-01", to: "2026-11-30", onlyPending: false });
    expect(r.carrierRows).toBe(3);
    expect(r.rows).toEqual([GHA, PENDING]);
    expect(filterCostCont(data, { carrier: "GHA", from: "", to: "", onlyPending: true }).rows).toEqual([OLD, PENDING]);
    expect(carrierValues(data)[0]).toEqual({ value: "GHA", rows: 3 });
  });

  it("đọc đúng Số lượng 1 cont, Hình thức giao, Điểm lấy cont khi có dòng tiêu đề", () => {
    const grid = parseTSV(toTSV(HEADER, [GHA]));
    const d = detectColumns(grid);
    expect(d.template).toBe("theo_doi");
    expect(d.headerRow).toBe(0);
    const [rec] = toRecords(grid, d.map, d.headerRow);
    expect(rec.so_luong).toBe("24750");
    expect(rec.ma_hang).toBe("LLDPE2607G");
    expect(rec.so_cont).toBe("FFAU5201607");
    expect(rec.ngay_giao).toBe("17/11/2026");
    expect(rec.diem_giao).toBe("BÃI ANH GIANG");
    expect(rec.diem_lay_cont).toBe("CATLAI");
    expect(rec.don_vi_vt).toBe("GHA");
    expect(deliveryMethodOf(rec)).toBe("pallet");
    expect(tripNote(rec)).toContain("Hãng tàu MAERSK");
    expect(tripNote(rec)).not.toContain("Hàng cầm");
  });

  it("dán không kèm tiêu đề vẫn đọc đúng cột theo thứ tự COST CONT", () => {
    const grid = parseTSV([GHA].map((r) => r.join("\t")).join("\n"));
    const d = detectColumns(grid);
    expect(d.headerRow).toBeNull();
    const [rec] = toRecords(grid, d.map, d.headerRow);
    expect(rec.so_luong).toBe("24750");
    expect(rec.so_cont).toBe("FFAU5201607");
    expect(rec.hinh_thuc).toBe("pallet");
    expect(rec.diem_lay_cont).toBe("CATLAI");
  });
});
