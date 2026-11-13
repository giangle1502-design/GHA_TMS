// Kiểm thử giao diện quy chuẩn màn hình: tìm kiếm nâng cao, kéo đổi cột, kéo giãn dòng,
// chọn cột bảng chuyến, trường bổ sung cho đơn hàng/chuyến, ô tìm kiếm điều phối.
// Cần CSDL cục bộ (PGHOST/PGPORT/PGUSER, CSDL gha_e2e) để tạo sẵn một trường bổ sung.
import { execFileSync } from "node:child_process";
import { BASE, asUser, check, desktop, finish, shot, visible, hidden } from "./e2e-lib.mjs";

const dialog = (page) => page.getByRole("dialog").last();
execFileSync("psql", ["-q", "-d", process.env.E2E_DB ?? "gha_e2e", "-c",
  "insert into public.field_definitions (module, field_key, label, data_type, is_visible) values ('shipments', 'so_container', 'Số container', 'short_text', true) on conflict do nothing"]);

await asUser("owner@khanhha.test", desktop, async (page) => {
  // 1. Tìm kiếm nâng cao trên danh mục
  await page.goto(`${BASE}/phuong-tien`);
  await page.getByRole("columnheader", { name: /Biển số/ }).waitFor();
  const before = await page.locator("tbody tr").count();
  await page.getByRole("button", { name: /Tìm kiếm nâng cao/ }).click();
  await dialog(page).getByLabel("Trường điều kiện 1").selectOption({ label: "Biển số" });
  await dialog(page).getByLabel("Phép so sánh 1").selectOption("contains");
  await dialog(page).getByLabel("Giá trị 1").fill("000.02");
  await dialog(page).getByRole("button", { name: "Áp dụng" }).click();
  await page.waitForURL(/a=plate_number\.contains/);
  check(await visible(page.getByText("Biển số có chứa “000.02”")), "Điều kiện tìm kiếm nâng cao hiện thành nhãn");
  check(await hidden(page.getByRole("row").filter({ hasText: "51C-000.01" })), "Tìm kiếm nâng cao lọc đúng dòng");
  check(before >= 2 && (await page.locator("tbody tr").count()) === 1, "Chỉ còn một xe khớp điều kiện");
  await shot(page, "s-01-tim-kiem-nang-cao");
  await page.getByRole("button", { name: "Bỏ tất cả" }).click();
  await page.waitForURL((u) => !u.search.includes("a="));

  // 2. Kéo tiêu đề cột để đổi chỗ
  const headers = async () => (await page.locator("thead th").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  const h0 = await headers();
  const iBrand = h0.findIndex((t) => t.startsWith("Hãng xe"));
  const iPlate = h0.findIndex((t) => t.startsWith("Biển số"));
  await page.locator("thead th").filter({ hasText: "Hãng xe" }).dragTo(page.locator("thead th").filter({ hasText: "Biển số" }));
  const h1 = await headers();
  check(iBrand > iPlate && h1.findIndex((t) => t.startsWith("Hãng xe")) < h1.findIndex((t) => t.startsWith("Biển số")), "Kéo tiêu đề cột đổi được vị trí cột");

  // 3. Kéo mép dưới dòng để đổi chiều cao
  const row = page.locator("tbody tr").first();
  const hBefore = (await row.boundingBox()).height;
  const handle = row.locator("td").first().locator("div[title^='Kéo để đổi chiều cao']");
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 10, box.y + 60, { steps: 5 });
  await page.mouse.up();
  const hAfter = (await row.boundingBox()).height;
  check(hAfter > hBefore + 30, `Kéo mép dòng tăng chiều cao dòng (${Math.round(hBefore)} → ${Math.round(hAfter)})`);
  await shot(page, "s-02-keo-cot-dong");

  // 4. Thêm trường ngay trong biểu mẫu, không rời trang
  await page.goto(`${BASE}/danh-muc?tab=vehicle_types`);
  await page.getByRole("button", { name: "Thêm mới" }).click();
  await dialog(page).getByRole("button", { name: "Thêm trường cho biểu mẫu này" }).click();
  await page.locator("#fd-label").fill("Số trục");
  await page.locator("#fd-type").selectOption("integer");
  await dialog(page).getByRole("button", { name: /^Lưu/ }).click();
  check(await visible(page.getByRole("dialog").filter({ hasText: "Thêm loại xe" }).getByLabel("Số trục")), "Thêm trường ngay trong biểu mẫu, trường mới hiện luôn");
  await shot(page, "s-02b-them-truong-trong-form");
  await page.keyboard.press("Escape");

  // 5. Tạo đơn có trường bổ sung của chuyến
  await page.goto(`${BASE}/dieu-phoi/tao-don`);
  const s1 = page.locator("[data-slot=card]").filter({ hasText: "Chuyến 1" });
  check(await visible(s1.getByLabel("Số container")), "Màn hình tạo đơn hiện trường bổ sung của chuyến");
  check(await visible(s1.getByRole("button", { name: "Thêm trường cho chuyến" })), "Tạo đơn có nút thêm trường cho chuyến");
  await page.locator("#order-customer").click();
  await page.getByPlaceholder("Gõ để tìm…").fill("Mẫu A");
  await page.getByRole("option", { name: /Công ty Mẫu A/ }).first().click();
  for (const [label, q, name] of [
    ["Điểm nhận *", "Bình Dương", "Kho Mẫu Bình Dương"],
    ["Điểm giao *", "Cát Lái", "Cảng Cát Lái"],
  ]) {
    await s1.getByLabel(label).click();
    await page.getByPlaceholder("Gõ để tìm…").fill(q);
    await page.getByRole("option", { name: new RegExp(name) }).first().click();
  }
  await s1.getByLabel("Loại xe", { exact: true }).click();
  await page.getByPlaceholder("Gõ để tìm…").fill("8 tấn");
  await page.getByRole("option", { name: /Xe tải 8 tấn/ }).first().click();
  await s1.getByLabel("Số container").fill("TGHU1234567");
  const unit = s1.getByLabel(/Đơn giá/);
  if (await unit.isVisible().catch(() => false)) await unit.fill("3000000").catch(() => {});
  await page.getByRole("button", { name: /Lưu đơn hàng/ }).click();
  await page.waitForURL(/\/dieu-phoi\/don-hang\//, { timeout: 15000 });
  await page.locator("tbody tr").first().getByRole("link").first().click();
  await page.waitForURL(/\/chuyen-xe\//);
  check(await visible(page.getByText("TGHU1234567")), "Chi tiết chuyến hiện giá trị trường bổ sung");
  await shot(page, "s-03-chi-tiet-truong-bo-sung");

  // 6. Bảng chuyến: cột bổ sung, ẩn cột, tìm kiếm nâng cao theo trường bổ sung
  await page.goto(`${BASE}/chuyen-xe`);
  check(await visible(page.getByRole("columnheader", { name: "Số container" })), "Bảng chuyến có cột trường bổ sung");
  await page.getByRole("button", { name: "Cột", exact: true }).click();
  await page.getByRole("checkbox", { name: "Đơn hàng" }).uncheck();
  await page.keyboard.press("Escape");
  check(await hidden(page.getByRole("columnheader", { name: "Đơn hàng" })), "Ẩn được cột trên bảng chuyến");
  await page.getByRole("button", { name: /Tìm kiếm nâng cao/ }).click();
  await dialog(page).getByLabel("Trường điều kiện 1").selectOption({ label: "Số container (bổ sung)" });
  await dialog(page).getByLabel("Giá trị 1").fill("TGHU");
  await dialog(page).getByRole("button", { name: "Áp dụng" }).click();
  await page.waitForURL(/a=cf_so_container/);
  check((await page.locator("tbody tr").count()) === 1, "Tìm kiếm nâng cao theo trường bổ sung trên bảng chuyến");
  await shot(page, "s-04-bang-chuyen");

  // 7. Ô tìm kiếm trên bảng điều phối
  await page.goto(`${BASE}/dieu-phoi?q=khong-co-chuyen-nay`);
  check(await visible(page.getByText("Không có chuyến phù hợp với từ khóa.")), "Bảng điều phối có ô tìm kiếm");
  check(await visible(page.getByLabel("Từ khóa")), "Điều phối giữ từ khóa trên ô tìm kiếm");
  check(await visible(page.getByLabel("Nhận hàng từ ngày")) && (await visible(page.getByLabel("Đến ngày"))), "Điều phối lọc được từ ngày đến ngày");
  check(await visible(page.getByRole("button", { name: /Tìm kiếm nâng cao/ })), "Điều phối có tìm kiếm nâng cao");
  await page.getByRole("tab", { name: /Xe chưa có đơn/ }).click();
  check(await visible(page.getByText(/Xe công ty chưa có đơn/)), "Điều phối có báo cáo xe chưa có đơn");
});

await finish();
