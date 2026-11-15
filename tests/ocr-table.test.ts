import { describe, expect, it } from "vitest";
import { findGridLines, gridToTSV, wordsToGrid, type OcrWord } from "@/lib/ocr-table";
import { headerField } from "@/lib/paste-orders";

/** Ảnh xám giả: nền trắng, đường kẻ xám ở các vị trí cho trước, vài nét chữ ngắn */
function sheet(w: number, h: number, xs: number[], ys: number[]) {
  const g = new Uint8ClampedArray(w * h).fill(255);
  for (const x of xs) for (let y = 0; y < h; y++) g[y * w + x] = 210;
  for (const y of ys) for (let x = 0; x < w; x++) g[y * w + x] = 210;
  for (let y = 5; y < 12; y++) g[y * w + 30] = 0; // nét chữ dọc ngắn, không phải đường kẻ
  return g;
}

const W = (text: string, x0: number, y0: number, x1: number, y1: number, conf = 95): OcrWord => ({ text, x0, y0, x1, y1, conf });

describe("đọc bảng từ ảnh", () => {
  it("tìm đường kẻ ô, bỏ qua nét chữ", () => {
    const { xs, ys } = findGridLines(sheet(200, 60, [50, 120], [20, 40]), 200, 60);
    expect(xs).toEqual([50, 120]);
    expect(ys).toEqual([20, 40]);
  });

  it("xếp chữ vào ô theo đường kẻ, nối chữ nhiều dòng, bỏ ký tự rác, đánh dấu ô chưa chắc", () => {
    const words = [
      W("SỐ", 5, 2, 20, 10), W("CONT", 22, 2, 45, 10), W("|", 49, 0, 51, 20),
      W("ĐIỂM", 60, 2, 80, 10), W("GIAO", 60, 11, 80, 18),
      W("MEDU7450682", 5, 25, 45, 35, 50), W("DUY", 55, 25, 70, 35), W("PHÁT", 72, 25, 95, 35),
    ];
    const g = wordsToGrid(words, { xs: [50, 120], ys: [20, 40] }, { w: 200, h: 60 });
    expect(g.rows).toEqual([
      ["SỐ CONT", "ĐIỂM GIAO"],
      ["MEDU7450682", "DUY PHÁT"],
    ]);
    expect(g.unsure).toEqual([
      [false, false],
      [true, false],
    ]);
    expect(gridToTSV(g.rows)).toBe("SỐ CONT\tĐIỂM GIAO\nMEDU7450682\tDUY PHÁT");
  });

  it("không có đường kẻ: gom theo khoảng trống", () => {
    const words = [W("579", 0, 0, 20, 10), W("PLA", 60, 0, 80, 10), W("580", 0, 20, 20, 30), W("VAP", 60, 20, 80, 30)];
    expect(wordsToGrid(words, { xs: [], ys: [] }, { w: 100, h: 40 }).rows).toEqual([
      ["579", "PLA"],
      ["580", "VAP"],
    ]);
  });

  it("nhận tiêu đề có chữ thừa do nút lọc / đọc thiếu", () => {
    expect(headerField("BCT SN")).toBe("bct");
    expect(headerField("PHAP NHÂN v")).toBe("phap_nhan");
    expect(headerField("NGÀY GIAO JY")).toBe("ngay_giao");
    expect(headerField("LUON G KHAI")).toBe("luong_khai");
    expect(headerField("so LƯỢNG 1CON,")).toBe("so_luong");
    expect(headerField("Tinh trang gia")).toBe("tinh_trang");
    expect(headerField("ĐIỂM LẤY CONT v")).toBe("diem_lay_cont");
    expect(headerField("Lưu cont v")).toBe("luu_cont");
    expect(headerField("xyz")).toBeNull();
  });
});

describe("đường kẻ nhòe", () => {
  it("đường kẻ 1 điểm ảnh bị phóng to nhòe sang 2 cột vẫn được nhận", async () => {
    const { findGridLines } = await import("@/lib/ocr-table");
    const w = 40;
    const h = 30;
    const g = new Array(w * h).fill(255);
    for (let y = 0; y < h; y++) {
      g[y * w + 20] = 238;
      g[y * w + 21] = 238;
    }
    expect(findGridLines(g, w, h).xs).toEqual([20]);
  });
});
