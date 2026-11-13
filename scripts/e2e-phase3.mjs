// Kiểm thử giao diện Giai đoạn 3: danh mục, bảng cấu hình được, nút "+", nhập/xuất Excel, trường động, phân quyền.
// Chạy sau scripts/e2e-smoke.mjs trên CSDL cục bộ đã nạp supabase/seed.dev.sql.
// Cách chạy: (biến môi trường như e2e-smoke.mjs) node scripts/e2e-phase3.mjs [thư-mục-ảnh]
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE, asUser, check, desktop, finish, hidden, shot, urlMatches, visible } from "./e2e-lib.mjs";

const toast = (page, text) => visible(page.locator("[data-sonner-toast]").filter({ hasText: text }), 15000);

async function pickRef(page, key, search, option) {
  await page.locator(`#f_${key}`).click();
  await page.getByPlaceholder("Gõ để tìm…").fill(search);
  await page.getByRole("option", { name: option }).first().click();
}

async function openNew(page) {
  await page.getByRole("button", { name: "Thêm mới" }).click();
  await page.getByRole("dialog").waitFor();
}

const dialog = (page) => page.getByRole("dialog").last();

// ---------------------------------------------------------------------------
// A. Trường dữ liệu động (Super Admin)
// ---------------------------------------------------------------------------
await asUser("owner@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/truong-du-lieu?module=vehicles`);
  await page.getByRole("button", { name: "Thêm trường" }).click();
  await page.locator("#fd-label").fill("Tải trọng hàng hóa (tấn)");
  check((await page.locator("#fd-key").inputValue()) === "tai_trong_hang_hoa_tan", "Mã trường tự sinh từ tên hiển thị (bỏ dấu)");
  await page.locator("#fd-type").selectOption("decimal");
  await page.getByLabel("Hiện trên bảng mặc định").check();
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await toast(page, "Đã thêm trường dữ liệu"), "Thêm trường số thập phân cho phương tiện");

  await page.getByRole("button", { name: "Thêm trường" }).click();
  await page.locator("#fd-label").fill("Tải trọng quy đổi kg");
  await page.locator("#fd-type").selectOption("formula");
  await page.locator("#fd-formula").fill("tai_trong_hang_hoa_tan * ");
  check(await visible(page.getByText("Công thức kết thúc đột ngột")), "Công thức sai cú pháp bị báo lỗi ngay");
  check(await dialog(page).getByRole("button", { name: "Lưu" }).isDisabled(), "Không lưu được khi công thức sai");
  await page.locator("#fd-formula").fill("bien_khong_co * 2");
  check(await visible(page.getByText('Trường "bien_khong_co" không tồn tại')), "Công thức dùng trường không tồn tại bị chặn");
  await page.locator("#fd-formula").fill("tai_trong_hang_hoa_tan * 1000");
  check(await visible(page.getByText("Công thức hợp lệ.")), "Công thức hợp lệ được chấp nhận");
  await page.getByLabel("Hiện trên bảng mặc định").check();
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await toast(page, "Đã thêm trường dữ liệu"), "Thêm trường công thức");
  check(await visible(page.getByRole("cell", { name: "tai_trong_quy_doi_kg" })), "Danh sách trường hiện trường mới");

  // Sửa trường: tạo phiên bản mới + xem lịch sử
  const row = page.getByRole("row").filter({ hasText: "tai_trong_hang_hoa_tan" }).first();
  await row.getByRole("button", { name: "Sửa" }).click();
  check(await visible(page.getByText("Phân tích ảnh hưởng")), "Mở sửa trường hiện phân tích ảnh hưởng");
  check(await visible(page.getByText("Tải trọng quy đổi kg").last()), "Phân tích ảnh hưởng liệt kê công thức đang dùng trường");
  await page.locator("#fd-desc").fill("Tải trọng hàng thực chở");
  await page.locator("#fd-note").fill("Thêm mô tả");
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await toast(page, "tạo phiên bản mới"), "Sửa trường tạo phiên bản mới");
  check(await visible(row.getByText("v2")), "Phiên bản tăng lên v2");
  await row.getByRole("button", { name: "Lịch sử" }).click();
  check(await visible(page.getByText("Thêm mô tả")), "Lịch sử phiên bản có ghi chú thay đổi");
  await shot(page, "p3-01-lich-su-phien-ban");
  await page.keyboard.press("Escape");
});

// ---------------------------------------------------------------------------
// B. Phương tiện: thêm có trường động + tạo nhanh loại xe, kiểm tra dữ liệu, tìm kiếm, cấu hình bảng
// ---------------------------------------------------------------------------
await asUser("owner@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/phuong-tien`);
  check(await visible(page.getByRole("columnheader", { name: /Tải trọng hàng hóa/ })), "Cột trường động xuất hiện trên bảng");

  await openNew(page);
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await visible(page.getByText("Biển số là bắt buộc")), "Bỏ trống trường bắt buộc bị báo lỗi");

  await page.locator("#f_plate_number").fill("51D-999.99");
  check((await page.locator("#f_plate_number").inputValue()) === "51D99999", "Ô biển số tự viết hoa, bỏ dấu chấm và gạch");
  await page.getByRole("button", { name: "Thêm loại xe mới" }).click();
  await dialog(page).locator("#f_name").fill("Xe đầu kéo thử nghiệm");
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await toast(page, "Đã thêm loại xe"), 'Nút "+" tạo nhanh loại xe ngay trong biểu mẫu');
  check(await visible(page.locator("#f_vehicle_type_id").filter({ hasText: "Xe đầu kéo thử nghiệm" })), "Loại xe vừa tạo được chọn sẵn");
  await page.locator("#f_tai_trong_hang_hoa_tan").fill("2,5");
  await page.locator("#f_registration_expiry").fill("2027-03-31");
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await toast(page, "Đã thêm phương tiện"), "Lưu phương tiện mới");
  const newRow = page.getByRole("row").filter({ hasText: "51D99999" });
  check(await visible(newRow), "Phương tiện mới hiện trên bảng");
  check(await visible(newRow.getByText(/^XE\d{3}$/)), "Mã xe tự sinh dạng XE###");
  check(await visible(newRow.getByText("2,500")), "Trường công thức tính đúng (2,5 tấn × 1000 = 2,500)");

  await openNew(page);
  await page.locator("#f_plate_number").fill("51d 99999");
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await toast(page, "trùng"), "Biển số trùng (khác cách viết) bị chặn");
  await page.keyboard.press("Escape");

  await page.getByLabel("Tìm kiếm").fill("999");
  await page.getByLabel("Tìm kiếm").press("Enter");
  await page.waitForURL(/q=999/);
  check(await hidden(page.getByRole("row").filter({ hasText: "51C-000.01" })), "Tìm kiếm lọc đúng dòng");

  await page.goto(`${BASE}/phuong-tien`);
  await page.getByRole("button", { name: "Cột" }).click();
  await page.locator("label").filter({ hasText: /^Hãng xe$/ }).locator("input").uncheck();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Lưu cấu hình" }).click();
  check(await toast(page, "Đã lưu cấu hình bảng"), "Lưu cấu hình bảng theo người dùng");
  await page.reload();
  await page.getByRole("columnheader", { name: /Biển số/ }).waitFor();
  check((await page.getByRole("columnheader", { name: /^Hãng xe/ }).count()) === 0, "Cấu hình ẩn cột được giữ sau khi tải lại");
  await page.getByRole("button", { name: "Mặc định" }).click();
  check(await toast(page, "khôi phục cấu hình mặc định"), "Khôi phục cấu hình mặc định");
  check(await visible(page.getByRole("columnheader", { name: /^Hãng xe/ })), "Cột hiện lại sau khi khôi phục");

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: "Xuất Excel" }).click()]);
  check(download.suggestedFilename().endsWith(".xlsx"), "Xuất Excel tải về tệp .xlsx");

  // Nhập CSV: 1 dòng hợp lệ, 2 dòng lỗi
  const dir = mkdtempSync(join(tmpdir(), "gha-"));
  const csv = join(dir, "xe.csv");
  writeFileSync(csv, "Biển số,Loại xe,Trạng thái,Năm sản xuất\n51E-111.11,Xe tải 8 tấn,Đang hoạt động,2021\n51E-222.22,Loại không tồn tại,active,2020\n,Xe tải 8 tấn,active,abc\n");
  await page.getByRole("button", { name: "Nhập Excel" }).click();
  await page.getByLabel("Chọn tệp").setInputFiles(csv);
  check(await visible(page.getByText("1 hợp lệ")), "Xem trước nhập: 1 dòng hợp lệ");
  check(await visible(page.getByText("2 lỗi")), "Xem trước nhập: 2 dòng lỗi");
  check(await visible(page.getByText('không tìm thấy "Loại không tồn tại"')), "Báo lỗi tham chiếu không tồn tại theo từng dòng");
  check(await visible(page.getByText("Biển số là bắt buộc")), "Báo lỗi thiếu trường bắt buộc theo từng dòng");
  await shot(page, "p3-02-xem-truoc-nhap");
  await page.getByRole("button", { name: "Nhập 1 dòng hợp lệ" }).click();
  check(await toast(page, "Đã nhập 1 dòng"), "Chỉ ghi dòng hợp lệ");
  check(await visible(page.getByRole("row").filter({ hasText: "51E11111" })), "Dòng nhập từ CSV hiện trên bảng");

  // Không xóa được xe đã có chuyến
  await page.getByRole("row").filter({ hasText: "51C-000.01" }).getByRole("button", { name: "Xóa" }).click();
  await dialog(page).getByRole("button", { name: "Xóa" }).click();
  check(await toast(page, "không xóa được"), "Xe đã có chuyến không xóa được, gợi ý chuyển trạng thái");
  await page.keyboard.press("Escape");
  await page.getByRole("row").filter({ hasText: "51E11111" }).getByRole("button", { name: "Xóa" }).click();
  await dialog(page).getByRole("button", { name: "Xóa" }).click();
  check(await toast(page, "Đã xóa"), "Xóa được xe chưa phát sinh nghiệp vụ");
  await shot(page, "p3-03-phuong-tien");

  // Chi tiết xe: tài chính + lịch trả nợ
  await page.getByRole("row").filter({ hasText: "51D99999" }).getByRole("link").first().click();
  await page.waitForURL(/\/phuong-tien\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Nhập thông tin" }).click();
  await dialog(page).locator("#f_purchase_price").fill("1.000.000.000");
  await dialog(page).locator("#f_depreciation_months").fill("100");
  await dialog(page).locator("#f_loan_principal").fill("600000000");
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await toast(page, "Đã lưu"), "Lưu thông tin tài chính xe");
  check(await visible(page.getByText("10,000,000 ₫")), "Khấu hao tháng tự tính (1 tỷ / 100 tháng)");
  await page.getByRole("button", { name: "Thêm" }).first().click();
  await dialog(page).locator("#f_installment_no").fill("1");
  await dialog(page).locator("#f_due_date").fill("2026-11-15");
  await dialog(page).locator("#f_principal_due").fill("10000000");
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await toast(page, "Đã thêm kỳ trả nợ"), "Thêm kỳ trả nợ");
  check(await visible(page.getByText("Dư nợ gốc (theo lịch trả nợ)")), "Dư nợ chỉ hiện khi đã có lịch trả nợ");
  check(await visible(page.getByText("600,000,000 ₫").first()), "Dư nợ gốc = số tiền vay − gốc đã trả");
  await shot(page, "p3-04-chi-tiet-xe");
});

// ---------------------------------------------------------------------------
// C. Điều phối: phân quyền dữ liệu nhạy cảm, tạo nhanh địa điểm trong tuyến, tra cứu giá
// ---------------------------------------------------------------------------
await asUser("dieuphoi@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/phuong-tien`);
  await page.getByRole("columnheader", { name: /Biển số/ }).waitFor();
  check((await page.getByRole("button", { name: "Thêm mới" }).count()) === 0, "Điều phối không có nút thêm xe (không có quyền tạo)");
  await page.getByRole("link", { name: "XE001" }).click();
  check(await visible(page.getByText("chỉ hiện với người có quyền xem dữ liệu nhạy cảm")), "Điều phối không thấy tài chính xe");
  check((await page.getByText("Giá mua").count()) === 0, "Không lộ giá mua xe cho điều phối");

  await page.goto(`${BASE}/tai-xe`);
  await page.getByRole("link", { name: "TX001" }).click();
  check(await visible(page.getByText("CCCD và tài khoản ngân hàng chỉ hiện")), "Điều phối không thấy CCCD, tài khoản ngân hàng tài xế");

  await page.goto(`${BASE}/khach-hang?tab=routes`);
  await openNew(page);
  await dialog(page).locator("#f_name").fill("Kho mới - Cát Lái");
  await page.getByRole("button", { name: "Thêm địa điểm mới" }).first().click();
  await dialog(page).locator("#f_name").fill("Kho Mới Thử Nghiệm");
  await dialog(page).locator("#f_full_address").fill("Đường số 1, KCN Thử, Đồng Nai");
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await toast(page, "Đã thêm địa điểm"), 'Tạo nhanh địa điểm bằng nút "+" trong biểu mẫu tuyến');
  await pickRef(page, "delivery_location_id", "Cát Lái", "Cảng Cát Lái (mẫu) – Cát Lái, Thủ Đức, TP.HCM");
  await dialog(page).locator("#f_distance_km").fill("45,5");
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await toast(page, "Đã thêm tuyến đường"), "Lưu tuyến với địa điểm vừa tạo");
  check(await visible(page.getByRole("row").filter({ hasText: "Kho Mới Thử Nghiệm" })), "Tuyến mới hiện với tên địa điểm");
  await shot(page, "p3-05-tuyen-duong");

  await page.goto(`${BASE}/danh-muc`);
  await page.getByRole("columnheader", { name: /Tên loại xe/ }).waitFor();
  check((await page.getByRole("button", { name: "Thêm mới" }).count()) === 0, "Điều phối chỉ xem danh mục hệ thống");

  await page.goto(`${BASE}/bang-gia`);
  check((await page.getByRole("button", { name: "Thêm mới" }).count()) === 0, "Điều phối không sửa được bảng giá");
  await page.getByRole("button", { name: "Tra cứu giá áp dụng" }).click();
  const d = dialog(page);
  await d.getByRole("button", { name: "Chọn khách hàng" }).click();
  await page.getByRole("option", { name: /Công ty Mẫu A/ }).click();
  await d.getByRole("button", { name: "Chọn loại xe" }).click();
  await page.getByRole("option", { name: "Xe tải 8 tấn" }).click();
  await d.getByRole("button", { name: "Chọn địa điểm" }).first().click();
  await page.getByRole("option", { name: /Kho Mẫu Bình Dương/ }).click();
  await d.getByRole("button", { name: "Chọn địa điểm" }).first().click();
  await page.getByRole("option", { name: /Cảng Cát Lái/ }).click();
  await d.getByRole("button", { name: "Tra cứu", exact: true }).click();
  check(await visible(d.getByText("Được áp dụng")), "Tra cứu giá chọn đúng bảng giá cụ thể nhất");
  check(await visible(d.getByText("BG001")), "Bảng giá áp dụng là BG001");
  await shot(page, "p3-06-tra-cuu-gia");
});

// ---------------------------------------------------------------------------
// D. Kế toán: bảng giá chồng lấn bị chặn
// ---------------------------------------------------------------------------
await asUser("ketoan@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/bang-gia`);
  await openNew(page);
  await pickRef(page, "customer_id", "Mẫu A", /Công ty Mẫu A/);
  await pickRef(page, "pickup_location_id", "Bình Dương", /Kho Mẫu Bình Dương/);
  await pickRef(page, "delivery_location_id", "Cát Lái", /Cảng Cát Lái/);
  await pickRef(page, "vehicle_type_id", "8 tấn", "Xe tải 8 tấn");
  await dialog(page).locator("#f_unit_price").fill("3,800,000");
  await dialog(page).locator("#f_effective_from").fill("2026-12-01");
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await toast(page, "chồng lấn"), "Bảng giá cùng phạm vi, cùng ưu tiên, trùng thời gian bị chặn");
  await dialog(page).locator("#f_priority").fill("10");
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await toast(page, "Đã thêm bảng giá"), "Bảng giá ưu tiên cao hơn được lưu");
});

// ---------------------------------------------------------------------------
// E. Giao diện mới: Tổng quan có biểu đồ từ dữ liệu thật, tab lọc trạng thái, tìm nhanh chức năng
// ---------------------------------------------------------------------------
await asUser("owner@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/tong-quan`);
  check(await visible(page.getByText("Số chuyến 14 ngày gần đây")), "Tổng quan có biểu đồ số chuyến theo ngày");
  check(await visible(page.getByRole("img", { name: /Biểu đồ tròn/ })), "Tổng quan có biểu đồ trạng thái chuyến");
  check(await visible(page.locator("tbody").getByText("Chờ tài xế nhận")), "Chuyến gần đây hiển thị nhãn trạng thái");
  check(await visible(page.getByText("Tạm ứng tài xế đang giữ")), "Tổng quan có chỉ tiêu tài chính tính từ dữ liệu thật");
  await shot(page, "p3-07-tong-quan");

  await page.getByRole("combobox", { name: "Tìm chức năng" }).fill("bang gia");
  await page.keyboard.press("Enter");
  check(await urlMatches(page, /\/bang-gia/), "Tìm nhanh chức năng không dấu mở đúng màn hình");

  await page.goto(`${BASE}/phuong-tien`);
  const tabs = page.getByRole("tablist", { name: /Lọc theo trạng thái/ });
  check(await visible(tabs.getByRole("tab", { name: /Tất cả/ })), "Bảng phương tiện có dãy tab trạng thái");
  await tabs.getByRole("tab", { name: /Đang sửa chữa/ }).click();
  check(await urlMatches(page, /f_status=maintenance/), "Bấm tab lọc theo trạng thái");
  check(await visible(page.getByText("Không có dữ liệu phù hợp")), "Tab trạng thái chưa có xe hiển thị danh sách trống");
  await tabs.getByRole("tab", { name: /Đang hoạt động/ }).click();
  check(await urlMatches(page, /f_status=active/), "Chuyển tab trạng thái khác");
  check(await visible(page.locator("tbody").getByText("Đang hoạt động").first()), "Trạng thái hiển thị dạng nhãn màu trong bảng");
  await shot(page, "p3-08-tab-trang-thai");
});

await finish();
