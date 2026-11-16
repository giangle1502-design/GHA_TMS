import { describe, expect, it } from "vitest";
import { invoiceDirection, invoiceDirectionHint, invoiceToFormValues, invoiceToTaxInvoiceValues, parseInvoiceText } from "@/lib/invoice-parse";

// Chữ đọc từ ảnh hóa đơn xăng (ảnh rõ, theo mẫu LE gửi 15/11/2026)
const CLEAN = `Mẫu số 1
Ký hiệu: C26MAV
Số: 422579
HOÁ ĐƠN GIÁ TRỊ GIA TĂNG
Ngày 27 tháng 07 năm 2026
MCCQT: M1-26-Y1WPA-00003448432
Tên người bán: CÔNG TY CỔ PHẦN AV CONNECT VIỆT NAM
Mã số thuế: 0313650711
Địa chỉ: 345 Quốc lộ 13, khu phố 5, Phường Hiệp Bình, Thành phố Hồ Chí Minh, Việt Nam
Tên người mua: CÔNG TY TNHH GHA LOGISTICS & SERVICES
Mã số thuế: 3703489735
Hình thức thanh toán: Tiền mặt
STT Tính chất Loại hàng hóa đặc trưng Tên hàng hóa, dịch vụ Đơn vị tính Số lượng Đơn giá Chiết khấu Thuế suất Thành tiền chưa có thuế GTGT
1 Hàng hóa, dịch vụ Xăng E10 RON 95 Mức 3 lít 23,33 21.430 KKKNT 500.000
Thuế suất Tổng tiền chưa thuế Tổng tiền thuế
KKKNT 500.000 0
Tổng tiền chưa thuế (Tổng cộng thành tiền chưa có thuế) 500.000
Tổng tiền thuế (Tổng cộng tiền thuế) 0
Tổng tiền phí 0
Tổng tiền thanh toán bằng số 500.000
Tổng tiền thanh toán bằng chữ Năm trăm nghìn đồng`;

describe("đọc hóa đơn từ ảnh", () => {
  it("hóa đơn xăng KKKNT", () => {
    const p = parseInvoiceText(CLEAN);
    expect(p).toMatchObject({
      invoice_date: "2026-07-27",
      invoice_no: "422579",
      invoice_symbol: "C26MAV",
      seller_name: "CÔNG TY CỔ PHẦN AV CONNECT VIỆT NAM",
      seller_tax_code: "0313650711",
      quantity: 23.33,
      unit_price: 21430,
      amount: 500000,
      vat_rate: 0,
      vat_label: "KKKNT",
      vat_amount: 0,
      total: 500000,
      is_fuel: true,
    });
    expect(p.description).toMatch(/^Xăng E10 RON 95/);
  });
  it("hóa đơn dầu 10%", () => {
    const p = parseInvoiceText(`HÓA ĐƠN GIÁ TRỊ GIA TĂNG
Ngày 03 tháng 11 năm 2026
Ký hiệu: 1C26TAA Số: 0001234
Đơn vị bán hàng: CÔNG TY TNHH XĂNG DẦU ABC
Mã số thuế: 0301234567
Họ tên người mua hàng: Lê Văn Giang
Tên đơn vị: CÔNG TY TNHH GHA LOGISTICS & SERVICE
Mã số thuế: 3703489735
1 Dầu DO 0,05S-II Lít 120,5 19.850 2.391.925
Cộng tiền hàng: 2.391.925
Thuế suất GTGT: 10% Tiền thuế GTGT: 239.193
Tổng cộng tiền thanh toán: 2.631.118`);
    expect(p).toMatchObject({
      invoice_date: "2026-11-03",
      invoice_no: "1234",
      seller_name: "CÔNG TY TNHH XĂNG DẦU ABC",
      seller_tax_code: "0301234567",
      quantity: 120.5,
      unit_price: 19850,
      amount: 2391925,
      vat_rate: 10,
      vat_amount: 239193,
      total: 2631118,
    });
  });
  it("ảnh mờ: vẫn lấy được phần đọc được, không bịa số", () => {
    const p = parseInvoiceText("Ngày 27 thàng 07 rim 2026\nTên người Ban: CONG TY CO PHAN AV CONNECT VIET NAM:\nTổng tiền thanh toán bằng số 500.000");
    expect(p.invoice_date).toBe("2026-07-27");
    expect(p.seller_name).toBe("CONG TY CO PHAN AV CONNECT VIET NAM");
    expect(p.total).toBe(500000);
    expect(p.invoice_no).toBeNull();
  });
});

// Chữ thật Tesseract đọc được từ ảnh hóa đơn xăng (có lỗi: mất dấu phẩy số lít, dấu "[" , "Tong")
const OCR_REAL = `HOÁ PON GIA TRI GIA TANG

Tên người bán: CÔNG TY CO PHAN AV CONNECT VIET NAM

Mã số thuế: 0313650711
Địa chi: 345 Quốc lộ 13, khu phổ 5, Phường Hiệp Bình, TP Hồ Chi Minh

Tên người mua: CÔNG TY TNHH GHA LOGISTICS & SERVICES

Mã số thuế: 3703489735

Hình thức thanh toán: Tiền mặt

Ngày 27 thúng 07 năm 2026
MCCQT: M1-26-Y1WPA-00003448432

Mẫu số 1
Ký hiệu: C26MAV
Số: 422579

.        ~       Tên hàng hóa, dịch | Đơn vị        Số        Đơn       Thuế | Thành tiền chưa có thuế
STT| Tính chất                 vụ                  tính       lượng       giá         suất                   GTGT
| | Hàng hoa, dịch | Xăng E10 ROƠN 95 lự,            2333 [21.430 |KKKNT [500.000
vu                   Mức 3
Tong tiền chưa thuế (Tống cộng thành tiền chưa có thuế)                                                                  500.000
Tổng tiên thuế (Tổng cộng tiền thuế)                                                                                                            0
Tổng tiền thanh toán bằng số                                                                                                             500.000

Tổng tiền thanh toán bằng chữ

Năm trăm nghìn dồng`;

it("chữ OCR thật có lỗi vẫn ra đúng số", () => {
  expect(parseInvoiceText(OCR_REAL)).toMatchObject({
    invoice_date: "2026-07-27", invoice_no: "422579", seller_tax_code: "0313650711",
    quantity: 23.33, unit_price: 21430, amount: 500000, vat_rate: 0, vat_amount: 0, total: 500000, description: "Xăng E10 ROƠN 95",
  });
});

describe("điền biểu mẫu chi phí ngoài chuyến", () => {
  it("chuyển sang giá trị ô nhập, ghi ký hiệu và MST vào ghi chú", () => {
    const v = invoiceToFormValues(parseInvoiceText(CLEAN), "");
    expect(v).toMatchObject({
      has_invoice: true,
      expense_date: "2026-07-27",
      invoice_date: "2026-07-27",
      invoice_no: "422579",
      quantity: "23.33",
      unit_price: "21,430",
      amount: "500,000",
      vat_rate: "0",
      notes: "Ký hiệu HĐ C26MAV · MST người bán 0313650711 · Thuế suất KKKNT",
    });
  });
});

// Hóa đơn GHA xuất cho khách (bán ra)
const SALE = `HÓA ĐƠN GIÁ TRỊ GIA TĂNG
Ký hiệu: 1C26TGH
Số: 0000045
Ngày 05 tháng 11 năm 2026
Đơn vị bán hàng: CÔNG TY TNHH GHA LOGISTICS & SERVICES
Mã số thuế: 3703489735
Họ tên người mua hàng:
Tên đơn vị: CÔNG TY TNHH VẬN TẢI KHÁCH ABC
Mã số thuế: 0301234567
1 Cước vận chuyển container tháng 10/2026 Chuyến 10 1.000.000 10.000.000
Cộng tiền hàng: 10.000.000
Thuế suất GTGT: 8% Tiền thuế GTGT: 800.000
Tổng cộng tiền thanh toán: 10.800.000`;

describe("điền sổ hóa đơn từ ảnh", () => {
  it("bán ra: đối tác là người mua, không lấy MST của GHA", () => {
    const p = parseInvoiceText(SALE);
    expect(p.gha_is_seller).toBe(true);
    expect(p.buyer_name).toBe("CÔNG TY TNHH VẬN TẢI KHÁCH ABC");
    const v = invoiceToTaxInvoiceValues(p, "sale", "");
    expect(v).toMatchObject({
      invoice_date: "2026-11-05",
      invoice_symbol: "1C26TGH",
      invoice_no: "45", // bỏ số 0 đầu, CSDL cũng chuẩn hóa như vậy
      partner_name: "CÔNG TY TNHH VẬN TẢI KHÁCH ABC",
      partner_tax_code: "0301234567",
      amount: "10,000,000",
      vat_rate: "8",
      vat_amount: "800,000",
    });
    expect(invoiceDirectionHint(p, "sale")).toBeNull();
    expect(invoiceDirection(p)).toBe("sale");
    expect(invoiceDirectionHint(p, "purchase")).toMatch(/bán ra/);
  });
  it("mua vào: hóa đơn xăng KKKNT, đối tác là người bán", () => {
    const p = parseInvoiceText(CLEAN);
    expect(p.gha_is_buyer).toBe(true);
    const v = invoiceToTaxInvoiceValues(p, "purchase", "");
    expect(v).toMatchObject({
      invoice_date: "2026-07-27",
      invoice_symbol: "C26MAV",
      invoice_no: "422579",
      partner_name: "CÔNG TY CỔ PHẦN AV CONNECT VIỆT NAM",
      partner_tax_code: "0313650711",
      amount: "500,000",
      vat_rate: "KKKNT",
      vat_amount: "0",
    });
    expect(String(v.description)).toMatch(/^Xăng E10 RON 95.*23,33 lít$/);
    expect(v.notes).toBe("Đơn giá 21,430 đ/lít");
    expect(invoiceDirectionHint(p, "purchase")).toBeNull();
    expect(invoiceDirection(p)).toBe("purchase");
    expect(invoiceDirectionHint(p, "sale")).toMatch(/mua vào/);
  });
});
