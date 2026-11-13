// Kiểm thử giao diện Giai đoạn 7: lập bảng lương tài xế -> Giám đốc duyệt -> Kế toán trả lương (cấn trừ tạm ứng),
// tài xế xem lương trên điện thoại, lập công nợ từ chuyến, thu nhiều lần, hủy phiếu, công nợ phải trả, báo cáo.
// Chạy ngay sau e2e-phase6.mjs (tài xế Nguyễn Văn Mẫu đã hoàn thành 1 chuyến, được ứng 1.500.000, chi phí cầu đường 120.000 đã duyệt).
// Cần CSDL cục bộ (PGHOST/PGPORT/PGUSER, CSDL gha_e2e) để đặt mức lương và đơn giá chuyến.
import { execFileSync } from "node:child_process";
import { BASE, asUser, check, desktop, finish, phone, shot, visible } from "./e2e-lib.mjs";

const toast = (page, text) => visible(page.locator("[data-sonner-toast]").filter({ hasText: text }), 15000);
const dialog = (page) => page.getByRole("dialog").last();
const pick = async (page, scope, label, query, option) => {
  await scope.getByLabel(label, { exact: true }).click();
  await page.getByPlaceholder("Gõ để tìm…").fill(query);
  await page.getByRole("option", { name: option }).first().click();
};

execFileSync("psql", ["-q", "-d", process.env.E2E_DB ?? "gha_e2e", "-c", `
  update public.drivers set base_salary = 8000000, per_trip_salary = 300000, meal_allowance = 500000 where full_name = 'Nguyễn Văn Mẫu';
  update public.shipments set unit_price = 5000000 where status = 'driver_completed' and driver_id = (select id from public.drivers where full_name = 'Nguyễn Văn Mẫu');`]);

// ---------------------------------------------------------------------------
// A. Kế toán lập bảng lương
// ---------------------------------------------------------------------------
await asUser("ketoan@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/chi-phi?tab=payrolls`);
  await page.getByRole("button", { name: "Tạo bảng lương" }).click();
  const d = dialog(page);
  await pick(page, d, "Tài xế *", "Mẫu", /Nguyễn Văn Mẫu/);
  const sheet = d.getByLabel("Bảng tính lương");
  check(await visible(sheet.getByText("1 chuyến × 300,000")), "Bảng tính đếm 1 chuyến đã xong trong tháng");
  check(await visible(sheet.getByText("1 khoản đã duyệt")), "Bảng tính có chi phí tự trả đã duyệt");
  await d.getByLabel("Thưởng").fill("200000");
  // 8.000.000 + 300.000 + 500.000 + 200.000 + 120.000 = 9.120.000; trừ 1.500.000 đã ứng = 7.620.000
  check(await visible(sheet.getByText("9,120,000")), "Tổng được nhận 9,120,000");
  check(await visible(sheet.getByText("7,620,000")), "Thực nhận sau khi trừ tiền ứng 7,620,000");
  await shot(page, "p7-01-lap-bang-luong");
  await d.getByRole("button", { name: "Lập và gửi duyệt" }).click();
  check(await toast(page, "Đã lập bảng lương"), "Lập bảng lương, gửi Giám đốc duyệt");
  const row = page.locator("tbody tr").filter({ hasText: "Nguyễn Văn Mẫu" }).first();
  check(await visible(row.getByText("Chờ duyệt")), "Bảng lương hiện trạng thái Chờ duyệt");
  check(await visible(row.getByText("7,620,000")), "Danh sách hiện thực nhận");
});

// ---------------------------------------------------------------------------
// B. Giám đốc duyệt
// ---------------------------------------------------------------------------
await asUser("giamdoc@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/phe-duyet`);
  const row = page.locator("tbody tr").filter({ hasText: "Lương tháng" }).first();
  check(await visible(row), "Giám đốc thấy bảng lương chờ duyệt");
  await row.getByRole("button", { name: /^Duyệt/ }).click();
  check(await visible(dialog(page).getByLabel("Số tiền duyệt")).then((v) => !v), "Bảng lương không sửa được số tiền khi duyệt");
  await dialog(page).getByRole("button", { name: "Xác nhận duyệt" }).click();
  check(await toast(page, "Đã duyệt"), "Giám đốc duyệt bảng lương");
});

// ---------------------------------------------------------------------------
// C. Kế toán trả lương, lập và thu công nợ
// ---------------------------------------------------------------------------
await asUser("ketoan@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/chi-phi?tab=payrolls`);
  const row = page.locator("tbody tr").filter({ hasText: "Nguyễn Văn Mẫu" }).first();
  await row.getByRole("button", { name: /Trả lương/ }).click();
  check(await visible(dialog(page).getByText("1,500,000")), "Hộp trả lương ghi số tiền ứng được cấn trừ");
  await dialog(page).getByLabel("Số giao dịch ngân hàng").fill("FT-LUONG-10");
  await dialog(page).getByRole("button", { name: "Xác nhận đã trả" }).click();
  check(await toast(page, "Đã ghi nhận trả lương"), "Ghi nhận trả lương");
  check(await visible(row.getByText("Đã trả lương")), "Bảng lương chuyển Đã trả lương");
  await shot(page, "p7-02-tra-luong");

  // Lập công nợ từ chuyến chưa lập
  await page.goto(`${BASE}/cong-no?tab=billing`);
  const ship = page.locator("tbody tr").first();
  check(await visible(ship.getByText("6,950,000")), "Chuyến hoàn thành hiện tổng tiền gồm hỗ trợ dầu 39%");
  await ship.getByRole("link", { name: /Lập công nợ/ }).click();
  await page.waitForURL(/tab=receivables/);
  const d = dialog(page);
  check(await visible(d.getByText("Lập công nợ phải thu")), "Bấm Lập công nợ mở sẵn biểu mẫu");
  check(await d.getByRole("checkbox").first().isChecked(), "Chuyến vừa chọn đã được đánh dấu");
  await d.getByLabel("Số hóa đơn").fill("0000123");
  await shot(page, "p7-03-lap-cong-no");
  await d.getByRole("button", { name: "Lập công nợ" }).click();
  check(await toast(page, "Đã lập công nợ phải thu"), "Lập công nợ phải thu");
  const ar = page.locator("tbody tr").filter({ hasText: "0000123" }).first();
  check(await visible(ar.getByText("Chưa thanh toán")), "Công nợ mới ở trạng thái Chưa thanh toán");

  // Thu 2 lần, hủy 1 phiếu
  await ar.getByRole("button", { name: /Thu tiền/ }).click();
  await dialog(page).getByLabel("Số tiền lần này *").fill("3000000");
  await dialog(page).getByRole("button", { name: "Xác nhận thu tiền" }).click();
  check(await toast(page, "Đã ghi nhận thu tiền"), "Thu lần 1: 3,000,000");
  check(await visible(ar.getByText("Thanh toán một phần")), "Công nợ chuyển Thanh toán một phần");
  check(await visible(ar.getByText("3,950,000")), "Còn phải thu 3,950,000");
  await ar.getByRole("button", { name: /Thu tiền/ }).click();
  check((await dialog(page).getByLabel("Số tiền lần này *").inputValue()) === "3,950,000", "Lần thu sau điền sẵn số còn nợ");
  await dialog(page).getByRole("button", { name: "Xác nhận thu tiền" }).click();
  check(await toast(page, "Đã ghi nhận thu tiền"), "Thu lần 2 đủ số còn lại");
  check(await visible(ar.getByText("Đã thanh toán đủ")), "Công nợ Đã thanh toán đủ");
  await ar.getByRole("button", { name: /Lịch sử/ }).click();
  await dialog(page).locator("li").nth(1).waitFor();
  check((await dialog(page).locator("li").count()) === 2, "Lịch sử có 2 lần thu");
  await dialog(page).getByRole("button", { name: "Hủy phiếu" }).last().click();
  await dialog(page).getByLabel("Lý do *").fill("Ghi nhầm, khách chưa chuyển");
  await dialog(page).getByRole("button", { name: "Hủy phiếu" }).click();
  check(await toast(page, "Đã hủy phiếu"), "Hủy phiếu thu ghi nhầm có lý do");
  check(await visible(page.getByText("Đã hủy: Ghi nhầm")), "Phiếu đã hủy vẫn hiện trong lịch sử (không xóa)");
  await page.keyboard.press("Escape");
  check(await visible(ar.getByText("Thanh toán một phần")), "Hủy phiếu thì công nợ trở lại Thanh toán một phần");
  await shot(page, "p7-04-thu-tien");

  // Phải trả
  await page.goto(`${BASE}/cong-no?tab=payables`);
  await page.getByRole("button", { name: "Tạo công nợ phải trả" }).click();
  const p = dialog(page);
  check(await visible(p.getByText("Lập công nợ phải trả")), "Mở biểu mẫu công nợ phải trả");
  await p.getByLabel("Trả cho").selectOption("driver");
  await pick(page, p, "Tài xế *", "Mẫu", /Nguyễn Văn Mẫu/);
  await p.getByLabel("Nội dung *").fill("Thuê xe ngoài chở hộ");
  await p.getByLabel("Số tiền *").fill("2000000");
  await p.getByRole("button", { name: "Lập công nợ" }).click();
  check(await toast(page, "Đã lập công nợ phải trả"), "Lập công nợ phải trả");
  const ap = page.locator("tbody tr").filter({ hasText: "Thuê xe ngoài" }).first();
  await ap.getByRole("button", { name: /Trả tiền/ }).click();
  await dialog(page).getByLabel("Số tiền lần này *").fill("500000");
  await dialog(page).getByRole("button", { name: "Xác nhận trả tiền" }).click();
  check(await toast(page, "Đã ghi nhận trả tiền"), "Trả nhà cung cấp lần 1");
  check(await visible(ap.getByText("1,500,000")), "Còn phải trả 1,500,000");

  await page.goto(`${BASE}/cong-no?tab=payments`);
  check(await visible(page.locator("tbody tr").filter({ hasText: "Trả lương tài xế" })), "Phiếu thu chi có phiếu trả lương");
  check(await visible(page.locator("tbody tr").filter({ hasText: "Đã hủy" })), "Phiếu thu chi có phiếu đã hủy");
  await shot(page, "p7-05-phieu-thu-chi");
});

// ---------------------------------------------------------------------------
// D. Báo cáo
// ---------------------------------------------------------------------------
await asUser("giamdoc@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/bao-cao`);
  check(await visible(page.getByText("Doanh thu tháng này")), "Báo cáo có thẻ doanh thu tháng");
  check(await visible(page.getByText("6,950,000").first()), "Doanh thu tháng gồm chuyến đã hoàn thành");
  check(await visible(page.getByRole("img", { name: /Doanh thu, Chi phí, Lợi nhuận/ })), "Báo cáo có biểu đồ 6 tháng");
  const r = page.locator("tbody tr").filter({ hasText: "Nguyễn Văn Mẫu" }).first();
  check(await visible(r.getByText("6,830,000")), "Lợi nhuận chuyến = 6,950,000 - 120,000 chi phí");
  await page.getByRole("button", { name: /Tìm kiếm nâng cao/ }).click();
  await dialog(page).getByLabel("Trường điều kiện 1").selectOption({ label: "Lợi nhuận" });
  await dialog(page).getByLabel("Phép so sánh 1").selectOption("gte");
  await dialog(page).getByLabel("Giá trị 1").fill("1000000");
  await dialog(page).getByRole("button", { name: "Áp dụng" }).click();
  await page.waitForURL(/a=profit/);
  check(await visible(r), "Tìm kiếm nâng cao theo lợi nhuận trên báo cáo");
  await shot(page, "p7-06-bao-cao");
  await page.goto(`${BASE}/bao-cao?tab=report_advance`);
  check(await visible(page.locator("tbody tr").filter({ hasText: "Nguyễn Văn Mẫu" }).getByText("1,500,000").first()), "Báo cáo tạm ứng: đã ứng và đã trừ vào lương");
});

// ---------------------------------------------------------------------------
// E. Tài xế xem lương trên điện thoại
// ---------------------------------------------------------------------------
await asUser("taixe.a@khanhha.test", phone, async (page) => {
  await page.goto(`${BASE}/tx/tien`);
  const pr = page.locator("[data-payroll]").first();
  check(await visible(pr.getByText("Đã trả lương")), "Tài xế thấy bảng lương đã trả");
  check(await visible(pr.getByText("7,620,000")), "Tài xế thấy số thực nhận");
  check(await visible(pr.getByText("−1,500,000")), "Tài xế thấy tiền ứng đã trừ");
  await shot(page, "p7-07-dien-thoai-luong");
});

await finish();
