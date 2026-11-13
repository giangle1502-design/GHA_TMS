// Kiểm thử giao diện Giai đoạn 4: tạo đơn nhiều chuyến, báo giá, phân công, hủy, bảng chuyến kiểu Excel, chi tiết chuyến.
// Chạy sau scripts/e2e-smoke.mjs trên CSDL cục bộ đã nạp supabase/seed.dev.sql.
// Cách chạy: (biến môi trường như e2e-smoke.mjs) node scripts/e2e-phase4.mjs [thư-mục-ảnh]
import { BASE, asUser, check, desktop, finish, phone, shot, urlMatches, visible } from "./e2e-lib.mjs";

const toast = (page, text) => visible(page.locator("[data-sonner-toast]").filter({ hasText: text }), 15000);
const dialog = (page) => page.getByRole("dialog").last();

async function pick(page, trigger, search, option) {
  await trigger.click();
  await page.getByPlaceholder("Gõ để tìm…").fill(search);
  await page.getByRole("option", { name: option }).first().click();
}

let orderUrl = "";

// ---------------------------------------------------------------------------
// A. Điều phối tạo đơn hàng 2 chuyến, phân công, hủy
// ---------------------------------------------------------------------------
await asUser("dieuphoi@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/dieu-phoi`);
  check(await visible(page.getByRole("heading", { name: "Điều phối" })), "Màn hình điều phối mở được, không còn ghi chưa triển khai");
  check(!(await page.getByText("Chưa triển khai").isVisible()), "Không còn thông báo Giai đoạn 4");
  await page.getByRole("link", { name: "Tạo đơn hàng" }).click();
  check(await urlMatches(page, /\/dieu-phoi\/tao-don/), "Mở màn hình tạo đơn hàng");

  await pick(page, page.locator("#order-customer"), "Mẫu A", "Công ty Mẫu A");
  const s1 = page.locator("[data-slot=card]").filter({ hasText: "Chuyến 1" });
  await pick(page, s1.getByLabel("Loại xe"), "8 tấn", "Xe tải 8 tấn");
  await pick(page, s1.getByLabel("Điểm nhận *"), "Bình Dương", "Kho Mẫu Bình Dương");
  await pick(page, s1.getByLabel("Điểm giao *"), "Cát Lái", "Cảng Cát Lái");
  check(await visible(s1.getByText("Bảng giá áp dụng")), "Tự tìm bảng giá theo khách hàng, điểm nhận, điểm giao, loại xe");
  check(await visible(s1.getByText("BG001")), "Hiện mã bảng giá được áp dụng");
  check(await visible(s1.getByText("4,865,000")), "Xem trước tổng doanh thu = cước 3,500,000 + hỗ trợ dầu 39%");
  await pick(page, s1.getByLabel("Xe (có thể chọn sau)"), "000.01", "51C-000.01");
  check(await visible(s1.getByText("Nguyễn Văn Mẫu")), "Chọn xe tự gợi ý tài xế phụ trách");
  await s1.getByRole("button", { name: "Nhân bản" }).click();
  const s2 = page.locator("[data-slot=card]").filter({ hasText: "Chuyến 2" });
  check(await visible(s2.getByText("BG001")), "Nhân bản chuyến giữ tuyến và bảng giá");
  // Điều phối không có quyền tạo tài xế: báo rõ thay vì im lặng
  await s2.getByLabel("Tài xế (có thể phân công sau)").click();
  await page.getByPlaceholder("Gõ để tìm…").fill("Lê Văn Mới");
  check(await visible(page.getByText("Chưa có “Lê Văn Mới”")), "Không tìm thấy thì báo rõ");
  check(await visible(page.getByText("chưa có quyền thêm mới")), "Người không có quyền tạo tài xế được hướng dẫn nhờ quản trị viên");
  await page.keyboard.press("Escape");
  await shot(page, "p4-01-tao-don");
  // Dữ liệu mẫu có sẵn một chuyến cùng ngày của XE001: xác nhận vẫn giao cho xe này
  const sameDay = page.getByLabel("Vẫn giao cho xe này");
  if (await sameDay.first().isVisible().catch(() => false)) await sameDay.first().check();
  await page.getByRole("button", { name: /Lưu đơn hàng \(2 chuyến\)/ }).click();
  check(await toast(page, "Đã lưu 2 chuyến"), "Lưu đơn hàng 2 chuyến");
  check(await urlMatches(page, /\/dieu-phoi\/don-hang\//), "Chuyển tới trang đơn hàng sau khi lưu");
  orderUrl = page.url();
  const rows = page.locator("tbody tr");
  check((await rows.count()) === 2, "Đơn hàng hiển thị đủ 2 chuyến");
  check(await visible(rows.first().getByText("Chờ tài xế nhận")), "Chuyến có tài xế ở trạng thái Chờ tài xế nhận");
  check(await visible(rows.nth(1).getByText("Nháp – chưa phân công")), "Chuyến nhân bản chưa có tài xế ở trạng thái Nháp");

  // Phân công chuyến 2
  await rows.nth(1).getByRole("button", { name: "Phân công" }).click();
  await pick(page, dialog(page).getByLabel("Xe"), "000.02", "51C-000.02");
  check(await visible(dialog(page).getByText("Trần Văn Thử")), "Hộp phân công gợi ý tài xế của xe");
  await dialog(page).getByRole("button", { name: "Lưu phân công" }).click();
  check(await toast(page, "Đã phân công chuyến"), "Phân công chuyến");
  check(await visible(rows.nth(1).getByText("Trần Văn Thử")), "Bảng cập nhật tài xế vừa phân công");

  // Hủy chuyến 2
  await rows.nth(1).getByRole("button", { name: "Hủy chuyến" }).click();
  check(await dialog(page).getByRole("button", { name: "Xác nhận hủy" }).isDisabled(), "Chưa nhập lý do thì không hủy được");
  await dialog(page).getByLabel("Lý do hủy").fill("Khách báo hoãn");
  await dialog(page).getByRole("button", { name: "Xác nhận hủy" }).click();
  check(await toast(page, "Đã hủy chuyến"), "Hủy chuyến có lý do");
  check(await visible(rows.nth(1).getByText("Đã hủy")), "Chuyến chuyển sang Đã hủy, không bị xóa");
  check(await visible(page.getByText("+1 đã hủy")), "Đơn hàng đếm riêng chuyến đã hủy");
  await shot(page, "p4-02-don-hang");

  // Thêm chuyến vào đơn có sẵn: không có bảng giá -> nhập tay
  await page.getByRole("link", { name: "Thêm chuyến" }).click();
  check(await urlMatches(page, /tao-don\?don=/), "Mở thêm chuyến vào đơn có sẵn");
  const s3 = page.locator("[data-slot=card]").filter({ hasText: "Chuyến 1" });
  await pick(page, s3.getByLabel("Điểm nhận *"), "Long An", "Kho Mẫu Long An");
  await pick(page, s3.getByLabel("Điểm giao *"), "Cát Lái", "Cảng Cát Lái");
  check(await visible(s3.getByText("Không có bảng giá phù hợp")), "Không có bảng giá thì gợi ý nhập giá thủ công hoặc để trống");
  await s3.getByLabel("Đơn giá (đ)", { exact: true }).fill("2000000");
  check(await visible(s3.getByText("2,780,000")), "Giá nhập tay vẫn tính hỗ trợ dầu theo quy tắc mặc định");
  await page.getByRole("button", { name: /Lưu 1 chuyến vào đơn/ }).click();
  check(await toast(page, "Đã lưu 1 chuyến"), "Thêm chuyến vào đơn có sẵn");
  check(await urlMatches(page, /\/dieu-phoi\/don-hang\//), "Quay lại trang đơn hàng");
  check(await visible(page.locator("tbody tr").nth(2)), "Đơn hàng có 3 chuyến");

  await page.goto(`${BASE}/dieu-phoi`);
  check(await visible(page.getByRole("tab", { name: /Chờ tài xế nhận/ })), "Bảng điều phối có tab trạng thái");
  await shot(page, "p4-03-dieu-phoi");
});

// ---------------------------------------------------------------------------
// B. Bảng chuyến kiểu Excel: sửa nhanh, xuất Excel, chi tiết chuyến
// ---------------------------------------------------------------------------
await asUser("dieuphoi@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/chuyen-xe`);
  check(await visible(page.getByRole("heading", { name: "Quản lý chuyến xe" })), "Bảng tổng hợp chuyến mở được");
  const row = page.locator("tbody tr").filter({ hasText: "Nguyễn Văn Mẫu" }).filter({ hasText: "KH001" }).first();
  const code = (await row.locator("td").nth(1).innerText()).trim();
  await row.locator("td").nth(11).getByRole("button").click();
  const input = row.getByRole("spinbutton", { name: /Đơn giá/ });
  await input.fill("4000000");
  await input.press("Enter");
  check(await toast(page, "đã lưu đơn giá"), "Sửa nhanh đơn giá trên bảng");
  check(await visible(row.getByText("1,560,000")), "Hỗ trợ dầu tự tính lại sau khi sửa đơn giá (39% × 4,000,000)");
  check(await visible(row.getByText("5,560,000")), "Tổng doanh thu cập nhật ngay trên dòng");

  const download = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
  await page.getByRole("button", { name: "Xuất Excel" }).click();
  const file = await download;
  check(Boolean(file) && /chuyen-xe_.*\.xlsx$/.test(file?.suggestedFilename() ?? ""), "Xuất bảng chuyến ra Excel");
  await shot(page, "p4-04-bang-chuyen");

  await row.getByRole("link", { name: code }).click();
  check(await urlMatches(page, /\/chuyen-xe\/[0-9a-f-]{36}$/), "Mở chi tiết chuyến từ bảng");
  check(await visible(page.getByText("Lịch sử trạng thái")), "Chi tiết chuyến có lịch sử trạng thái");
  check(await visible(page.getByRole("cell", { name: "Đơn giá" })), "Lịch sử thay đổi ghi nhận sửa đơn giá");
  check(await visible(page.getByText(/^Giá: /)), "Chi tiết chuyến ghi nguồn giá đã chụp");
  await shot(page, "p4-05-chi-tiet");
});

// ---------------------------------------------------------------------------
// C. Phân quyền: kế toán xem bảng chuyến, không vào điều phối, không phân công
// ---------------------------------------------------------------------------
await asUser("ketoan@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/dieu-phoi`);
  check(await urlMatches(page, /khong-co-quyen/), "Kế toán không vào được màn hình điều phối");
  await page.goto(`${BASE}/chuyen-xe`);
  check(await visible(page.locator("tbody tr").first()), "Kế toán xem được bảng chuyến");
  await page.locator("tbody tr").first().locator("td").nth(1).getByRole("link").click();
  await page.getByText("Lịch sử trạng thái").waitFor();
  check((await page.getByRole("button", { name: /Phân công|Đổi/ }).count()) === 0, "Kế toán không thấy nút phân công");
});

// ---------------------------------------------------------------------------
// C2. Super Admin tạo nhanh tài xế, loại xe ngay trong màn hình tạo đơn
// ---------------------------------------------------------------------------
await asUser("owner@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/dieu-phoi/tao-don`);
  const s1 = page.locator("[data-slot=card]").filter({ hasText: "Chuyến 1" });
  await s1.getByLabel("Tài xế (có thể phân công sau)").click();
  await page.getByPlaceholder("Gõ để tìm…").fill("Lê Văn Mới");
  await page.getByRole("button", { name: "Thêm mới “Lê Văn Mới”" }).click();
  check((await dialog(page).getByLabel("Họ tên").inputValue()) === "Lê Văn Mới", "Hộp thêm nhanh điền sẵn tên vừa gõ");
  await dialog(page).getByLabel("Số điện thoại").fill("0912345678").catch(() => {});
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await visible(s1.getByText("Lê Văn Mới")), "Tài xế mới được chọn ngay vào chuyến, không phải quay lại danh mục");
  await s1.getByLabel("Loại xe", { exact: true }).click();
  await page.getByPlaceholder("Gõ để tìm…").fill("Xe ben");
  await page.getByRole("button", { name: "Thêm mới “Xe ben”" }).click();
  check(await visible(dialog(page).getByText("Gõ hoặc chọn gợi ý")), "Ô tên loại xe có hướng dẫn và gợi ý");
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await visible(s1.getByText("Xe ben")), "Loại xe mới được chọn ngay");
  await pick(page, s1.getByLabel("Điểm nhận *"), "Long An", "Kho Mẫu Long An");
  await pick(page, s1.getByLabel("Điểm giao *"), "Bình Dương", "Kho Mẫu Bình Dương");
  await page.locator("#order-customer").click();
  await page.getByPlaceholder("Gõ để tìm…").fill("Mẫu B");
  await page.getByRole("option", { name: /Công ty Mẫu B/ }).first().click();
  await s1.getByRole("button", { name: "Tạo bảng giá cho tuyến này" }).click();
  await dialog(page).getByLabel("Đơn giá *").fill("2500000").catch(() => {});
  await dialog(page).getByRole("button", { name: "Lưu" }).click();
  check(await visible(s1.getByText("Bảng giá áp dụng")), "Tạo bảng giá ngay trong màn hình tạo đơn, chuyến tự áp giá mới");
  await shot(page, "p4-07-tao-nhanh");
});

// ---------------------------------------------------------------------------
// D. Tài xế: không còn nút từ chối
// ---------------------------------------------------------------------------
await asUser(null, phone, async (page) => {
  await page.goto(`${BASE}/tx`);
  await page.getByLabel("Số xe").fill("51C00001");
  await page.getByRole("button", { name: "Xem chuyến" }).click();
  check(await visible(page.getByRole("button", { name: /Nhận đơn/ }).first()), "Ứng dụng tài xế hiện chuyến được phân công");
  check((await page.getByRole("button", { name: "Từ chối" }).count()) === 0, "Không còn nút từ chối chuyến");
});

await asUser("dieuphoi@khanhha.test", phone, async (page) => {
  await page.goto(orderUrl || `${BASE}/dieu-phoi`);
  await shot(page, "p4-06-don-hang-dien-thoai");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 1, "Trang đơn hàng không tràn ngang trên điện thoại");
});

await finish();
