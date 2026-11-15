import { describe, expect, it } from "vitest";
import {
  buildMatcher,
  containerCheckOk,
  coreKey,
  detectColumns,
  isoDate,
  looksDelivered,
  looksScientific,
  matchKey,
  normalizeContainer,
  orderGroupKey,
  parseQty,
  parseTSV,
  toRecords,
  tripNote,
} from "@/lib/paste-orders";

const HEAD =
  "BCT\tPHÁP NHÂN\tNCC\tSỐ TỜ KHAI\tNGÀY KHAI\tLUỒNG KHAI\tMÃ HÀNG\tSỐ LƯỢNG 1 CONT\tLOẠI CONT\tSỐ CONT\tNGÀY GIAO\tĐIỂM GIAO\tPXK\tTình trạng giao\tLưu bãi\tNgày gia hạn\tLưu cont\tPhí gia hạn\tHóa đơn gia hạn\tĐIỂM LẤY CONT";
const R1 = "1323\tVAP\tTOYOTA\t108800497260\t09/11/2026\t\tLDPE2107F\t24,750\t40\tMEDU7450682\t16/11/2026\tDUY PHÁT - NHẬN EIR\t\tChưa giao\t11/11/2026\t16/11/2026\t19/11/2026\t\t\tSP-ITC";
const R2 = "579\tPLA\tIVICTSING\t108801749600\t09/11/2026\t\tLLDPE118WJ\t24,750\t40\tSEGU4186696\t16/11/2026\tNÔNG NGHIỆP MIỀN NAM\t\tChưa giao\t15/11/2026\t\t15/11/2026\t\t\tCATLAI";

describe("dán từ Excel", () => {
  it("đọc dữ liệu tab, ô có xuống dòng trong ngoặc kép, bỏ dòng trống", () => {
    expect(parseTSV('a\t"b\nc"\td\r\n\r\ne\tf\n')).toEqual([
      ["a", "b c", "d"],
      ["e", "f"],
    ]);
    expect(parseTSV('x\t"có ""ngoặc"""')).toEqual([["x", 'có "ngoặc"']]);
  });

  it("nhận dòng tiêu đề của bảng theo dõi", () => {
    const rows = parseTSV([HEAD, R1, R2].join("\r\n"));
    const d = detectColumns(rows);
    expect(d.headerRow).toBe(0);
    const recs = toRecords(rows, d.map, d.headerRow);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ phap_nhan: "VAP", so_to_khai: "108800497260", ma_hang: "LDPE2107F", so_cont: "MEDU7450682", diem_lay_cont: "SP-ITC", diem_giao: "DUY PHÁT - NHẬN EIR" });
  });

  it("không có tiêu đề: hiểu theo thứ tự cột mặc định", () => {
    const rows = parseTSV([R1, R2].join("\n"));
    const d = detectColumns(rows);
    expect(d.headerRow).toBeNull();
    const recs = toRecords(rows, d.map, d.headerRow);
    expect(recs[1]).toMatchObject({ phap_nhan: "PLA", ngay_giao: "16/11/2026", diem_lay_cont: "CATLAI", so_luong: "24,750" });
  });

  it("khóa so tên bỏ dấu, bỏ ký tự đặc biệt", () => {
    expect(matchKey("SP-ITC")).toBe(matchKey("SP - ITC"));
    expect(matchKey("SPITC")).toBe(matchKey("sp itc"));
    expect(matchKey("KNQ LONG BÌNH")).toBe(matchKey("KNQ LONG BINH"));
    expect(matchKey("KHO VĨNH CƯỜNG")).toBe(matchKey("KHO VINH CUONG"));
    expect(matchKey("KHO SOTRAN ")).toBe(matchKey("KHO SOTRAN"));
    expect(matchKey("KHO SOTRAN CŨ")).not.toBe(matchKey("KHO SOTRAN MỚI"));
    expect(coreKey("KHO LINH PHÁT")).toBe(coreKey("LINHPHAT"));
    expect(coreKey("Cảng Cát Lái")).toBe("catlai");
  });

  it("ghép địa điểm: tên gọi đã nhớ, mã, tên, bỏ chữ Kho/Cảng; nhiều kết quả thì không tự chọn", () => {
    const locs = [
      { id: "a", code: "DD0001", name: "Cảng SP-ITC" },
      { id: "b", code: "DD0002", name: "Cảng Cát Lái" },
      { id: "c", code: "DD0003", name: "Kho SOTRANS cũ" },
      { id: "d", code: "DD0004", name: "Kho SOTRANS mới" },
      { id: "e", code: "DD0005", name: "KNQ Long Bình" },
    ];
    const m = buildMatcher(locs, [{ alias: "KHO SOTRAN CŨ", target_id: "c" }], { core: true });
    expect(m("SPITC")).toEqual({ status: "ok", id: "a", how: "core" });
    expect(m("SP - ITC")).toEqual({ status: "ok", id: "a", how: "core" });
    expect(m("CATLAI")).toEqual({ status: "ok", id: "b", how: "core" });
    expect(m("KNQ LONG BINH")).toEqual({ status: "ok", id: "e", how: "name" });
    expect(m("dd0002")).toEqual({ status: "ok", id: "b", how: "code" });
    expect(m("KHO SOTRAN CŨ")).toEqual({ status: "ok", id: "c", how: "alias" });
    const amb = m("KHO SOTRAN");
    expect(amb.status).toBe("none");
    expect(amb.status === "none" && amb.candidates.sort()).toEqual(["c", "d"]);
    expect(m("")).toEqual({ status: "empty" });
    // tên gọi trỏ tới mục không còn trong danh mục thì bỏ qua
    expect(buildMatcher(locs, [{ alias: "X", target_id: "zz" }])("X").status).toBe("none");
  });

  it("hai mục trùng tên thì báo nhiều kết quả", () => {
    const m = buildMatcher([
      { id: "1", code: "VAP", name: "Việt An Pha" },
      { id: "2", code: "VAP2", name: "Việt An Pha" },
    ]);
    expect(m("VAP")).toEqual({ status: "ok", id: "1", how: "code" });
    expect(m("viet an pha").status).toBe("ambiguous");
  });

  it("giá trị: ngày, số lượng, số cont, cảnh báo", () => {
    expect(isoDate("16/11/2026")).toBe("2026-11-16");
    expect(isoDate("abc")).toBeNull();
    expect(parseQty("24,750")).toBe(24750);
    expect(parseQty("x")).toBeNull();
    expect(normalizeContainer("medu 745068-2")).toBe("MEDU7450682");
    expect(containerCheckOk("MEDU7450682")).toBe(true);
    expect(containerCheckOk("CSQU3054383")).toBe(true);
    expect(containerCheckOk("CSQU3054384")).toBe(false);
    expect(looksScientific("1.08801E+11")).toBe(true);
    expect(looksScientific("108801749600")).toBe(false);
    expect(looksDelivered("Chưa giao")).toBe(false);
    expect(looksDelivered("Đã giao")).toBe(true);
  });

  it("gộp đơn theo khách + tờ khai + điểm giao + ngày; tắt gộp hoặc không có tờ khai thì mỗi dòng một đơn", () => {
    const p = { customerId: "k", toKhai: "108801749600", deliveryId: "g", date: "2026-11-16" };
    expect(orderGroupKey(p, 1, true)).toBe(orderGroupKey(p, 2, true));
    expect(orderGroupKey(p, 1, false)).not.toBe(orderGroupKey(p, 2, false));
    expect(orderGroupKey({ ...p, toKhai: "" }, 1, true)).not.toBe(orderGroupKey({ ...p, toKhai: "" }, 2, true));
  });

  it("ghi chú chuyến gom các cột phụ", () => {
    expect(tripNote({ so_to_khai: "108800497260", ngay_khai: "09/11/2026", bct: "1323", ncc: "TOYOTA", loai_cont: "40", luu_cont: "19/11/2026" })).toBe(
      "Tờ khai 108800497260 ngày 09/11/2026 · BCT 1323 · NCC TOYOTA · Cont 40' · Lưu cont đến 19/11/2026",
    );
  });
});
