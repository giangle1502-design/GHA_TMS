import { describe, expect, it } from "vitest";
import { formTotal, numberToVietnameseWords as w } from "@/lib/payment-request-form";

describe("số thành chữ", () => {
  it("đọc đúng các trường hợp thường gặp", () => {
    expect(w(0)).toBe("Không đồng");
    expect(w(15)).toBe("Mười lăm đồng");
    expect(w(21)).toBe("Hai mươi mốt đồng");
    expect(w(105)).toBe("Một trăm lẻ năm đồng");
    expect(w(1_250_000)).toBe("Một triệu hai trăm năm mươi nghìn đồng");
    expect(w(2_005_000)).toBe("Hai triệu không trăm lẻ năm nghìn đồng");
    expect(w(10_000_000)).toBe("Mười triệu đồng");
    expect(w(34_524_000)).toBe("Ba mươi tư triệu năm trăm hai mươi tư nghìn đồng");
    expect(w(1_000_000_000)).toBe("Một tỷ đồng");
    expect(w(1_200_000_500)).toBe("Một tỷ hai trăm triệu năm trăm đồng");
    expect(w(1_000_045)).toBe("Một triệu không trăm bốn mươi lăm đồng");
  });
  it("tổng đề nghị thanh toán cộng các khoản", () => {
    expect(formTotal({ form_type: "payment", amount: 9, items: [{ content: "a", invoice_no: "", invoice_date: "", amount: 100 }, { content: "b", invoice_no: "", invoice_date: "", amount: 50 }] })).toBe(150);
    expect(formTotal({ form_type: "advance", amount: 9, items: [] })).toBe(9);
  });
});
