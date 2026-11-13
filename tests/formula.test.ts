import { describe, expect, it } from "vitest";
import { computeFormula, formulaRefs, parseFormula, validateFormula } from "@/lib/formula";

describe("Bộ tính công thức an toàn", () => {
  it("tính số học đúng thứ tự ưu tiên", () => {
    expect(computeFormula("1 + 2 * 3", {})).toBe(7);
    expect(computeFormula("(1 + 2) * 3", {})).toBe(9);
    expect(computeFormula("-a + 10", { a: 4 })).toBe(6);
    expect(computeFormula("10 % 4", {})).toBe(2);
  });
  it("dùng giá trị trường và hàm", () => {
    expect(computeFormula("ROUND(gia * 0.39, 0)", { gia: 3500000 })).toBe(1365000);
    expect(computeFormula("MAX(a, b, 3)", { a: 1, b: 2 })).toBe(3);
    expect(computeFormula("IF(km > 100, km * 2, 0)", { km: 150 })).toBe(300);
    expect(computeFormula("IF(AND(a > 0, NOT(b)), 1, 2)", { a: 1, b: 0 })).toBe(1);
    // Giá = Đơn giá × (1 + % hỗ trợ dầu/100) + phụ thu; phụ thu trống tính là 0 nhờ N()
    expect(computeFormula("ROUND(unit_price * (1 + fuel_support_rate / 100), 0) + N(phu_thu_ve) + N(phu_thu_ha)", { unit_price: 1000000, fuel_support_rate: 39, phu_thu_ve: 50000, phu_thu_ha: "" })).toBe(1440000);
    expect(computeFormula("a + b", { a: 1, b: null })).toBeNull();
  });
  it("thiếu dữ liệu hoặc chia 0 thì trả về rỗng, không đoán số 0", () => {
    expect(computeFormula("a * 2", {})).toBeNull();
    expect(computeFormula("a / b", { a: 1, b: 0 })).toBeNull();
    // Nhánh IF không được chọn không cần dữ liệu
    expect(computeFormula("IF(1, 5, thieu)", {})).toBe(5);
  });
  it("chặn mã độc và cú pháp sai", () => {
    expect(() => parseFormula("constructor.constructor('alert(1)')()")).toThrow();
    expect(() => parseFormula("a; b")).toThrow();
    expect(() => parseFormula("EVAL(1)")).toThrow(/không được hỗ trợ/);
    expect(() => parseFormula("ROUND()")).toThrow(/đối số/);
    expect(() => parseFormula("(1 + 2")).toThrow();
    expect(() => parseFormula("x".repeat(501))).toThrow(/500/);
    expect(computeFormula("this", { this: 3 })).toBe(3);
  });
  it("kiểm tra tham chiếu trường", () => {
    expect([...formulaRefs(parseFormula("a + b * ROUND(c)"))].sort()).toEqual(["a", "b", "c"]);
    expect(validateFormula("a + b", ["a", "b"])).toBeNull();
    expect(validateFormula("a + z", ["a"])).toMatch(/"z"/);
    expect(validateFormula("self + 1", ["self"], "self")).toMatch(/chính trường/);
  });
});
