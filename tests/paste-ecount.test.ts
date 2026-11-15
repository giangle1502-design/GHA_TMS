import { describe, expect, it } from "vitest";
import { buildMatcher, containerOf, deliveryDisplay, deliveryNames, detectColumns, groupRef, parseTSV, pickupNames, toRecords, tripNote } from "@/lib/paste-orders";

const CK_HEAD =
  "Ngày ▼\tCông ty\tSố STO\tSố phiếu chuyển kho\tĐiểm đi\tTên kho xuất\tĐiểm đến\tTên kho nhập\tMã hàng\tSố lượng\tĐơn vị vận tải Tên\tSố xe\tNhập kiện/xá";
const CK_ROW = "03/11/2026\tCÔNG TY TNHH VIỆT AN PHA\t261103-4\tPCK261103004\tCẢNG CLGN\tVAP - KHO CẢNG\t\tVAP - GHA\tHDPEF1\t25,500\tGHA\tTEMU8427340\tHàng kiện";
const GH_HEAD =
  "Ngày\tSố phiếu giao hàng\tCông ty Tên\tKho xuất\tĐiểm đi\tMã Khách hàng/Nhà cung cấp\tKhách hàng/Nhà cung cấp Tên\tĐơn vị vận tải Tên\tSố xe\tMã hàng\tSố lượng\tXuất kiện";
const GH_ROW =
  "01/11/2026\tPXK261001001\tCÔNG TY TNHH VIỆT AN PHA\tVAP - KHO MUA NỘI ĐỊA\tKHO OPEC\tDTNVIETNAM\tCÔNG TY CỔ PHẦN SẢN XUẤT THƯƠNG MẠI ĐẦU TƯ NHỰA VIỆT NAM\tGHA\t51C12345\tPP37MK10\t24,750\tHàng kiện";

describe("mẫu Ecount", () => {
  it("nhận ra phiếu chuyển kho theo tiêu đề", () => {
    const rows = parseTSV([CK_HEAD, CK_ROW].join("\n"));
    const d = detectColumns(rows);
    expect(d.template).toBe("ecount_ck");
    expect(d.headerRow).toBe(0);
    const [r] = toRecords(rows, d.map, d.headerRow);
    expect(r).toMatchObject({ ngay_giao: "03/11/2026", phap_nhan: "CÔNG TY TNHH VIỆT AN PHA", so_sto: "261103-4", so_phieu: "PCK261103004", ma_hang: "HDPEF1", so_luong: "25,500" });
    expect(containerOf(r)).toBe("TEMU8427340");
    expect(groupRef(r)).toBe("PCK261103004");
    expect(pickupNames(r)).toEqual(["CẢNG CLGN", "VAP - KHO CẢNG"]);
    expect(deliveryNames(r)).toEqual(["VAP - GHA"]);
    expect(tripNote(r)).toContain("STO 261103-4");
  });

  it("nhận ra phiếu giao hàng; số xe không phải số cont thì để vào ghi chú", () => {
    const rows = parseTSV([GH_HEAD, GH_ROW].join("\n"));
    const d = detectColumns(rows);
    expect(d.template).toBe("ecount_gh");
    const [r] = toRecords(rows, d.map, d.headerRow);
    expect(r).toMatchObject({ pxk: "PXK261001001", kho_xuat: "VAP - KHO MUA NỘI ĐỊA", diem_di: "KHO OPEC", ma_kh_nhan: "DTNVIETNAM", ma_hang: "PP37MK10" });
    expect(containerOf(r)).toBe("");
    expect(groupRef(r)).toBe("PXK261001001");
    expect(pickupNames(r)).toEqual(["KHO OPEC", "VAP - KHO MUA NỘI ĐỊA"]);
    expect(deliveryDisplay(r)).toBe("CÔNG TY CỔ PHẦN SẢN XUẤT THƯƠNG MẠI ĐẦU TƯ NHỰA VIỆT NAM");
    expect(tripNote(r)).toContain("51C12345");
  });

  it("không có tiêu đề thì dùng mẫu người dùng chọn", () => {
    const rows = parseTSV(CK_ROW);
    const d = detectColumns(rows, "ecount_ck");
    expect(d.template).toBe("ecount_ck");
    expect(d.headerRow).toBeNull();
    expect(toRecords(rows, d.map, d.headerRow)[0].so_phieu).toBe("PCK261103004");
  });

  it("ghép tên công ty đầy đủ với khách hàng bỏ chữ Công ty TNHH", () => {
    const m = buildMatcher([{ id: "v", code: "VAP", name: "Việt An Pha" }], [], { core: true });
    expect(m("CÔNG TY TNHH VIỆT AN PHA")).toMatchObject({ status: "ok", id: "v" });
  });
});

describe("đọc từ ảnh chụp Ecount", () => {
  it("bỏ mảnh dòng bị cắt, nhận ngày mất dấu /, số cont đọc sai vẫn được báo", async () => {
    const { isoDate, containerCheckOk } = await import("@/lib/paste-orders");
    const rows = parseTSV([GH_HEAD, "\t\t£#uxr ri\t\t\t\tNAM)\t\t\t\t\t", GH_ROW].join("\n"));
    const d = detectColumns(rows);
    expect(toRecords(rows, d.map, d.headerRow)).toHaveLength(1);
    expect(isoDate("03112026")).toBe("2026-11-03");
    const r = { so_xe: "TEXIUS427340" };
    expect(containerOf(r)).toBe("TEXIUS427340");
    expect(containerCheckOk(containerOf(r))).toBe(false);
    expect(containerOf({ so_xe: "51C-123.45" })).toBe("");
  });
});
