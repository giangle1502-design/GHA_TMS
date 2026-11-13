// Kiểm thử giao diện: hiện/ẩn trường bổ sung theo giá trị trường khác
// (ví dụ đơn hàng: "NCC" = 3-PL thì mới hiện "Nhà xe 3-PL"; trường ẩn không bắt buộc nhập).
// Cần CSDL cục bộ (PGHOST/PGPORT/PGUSER, CSDL gha_e2e) để tạo sẵn trường "NCC".
import { execFileSync } from "node:child_process";
import { BASE, asUser, check, desktop, finish, hidden, shot, visible } from "./e2e-lib.mjs";

const dialog = (page) => page.getByRole("dialog");
execFileSync("psql", ["-q", "-d", process.env.E2E_DB ?? "gha_e2e", "-c",
  `insert into public.field_definitions (module, field_key, label, data_type, options) values ('transport_orders', 'ncc', 'NCC', 'single_select',
   '[{"value":"noi_bo","label":"Xe nội bộ"},{"value":"3pl","label":"3-PL"}]') on conflict do nothing`]);

await asUser("owner@khanhha.test", desktop, async (page) => {
  // Thêm trường "Nhà xe 3-PL" bắt buộc, chỉ hiện khi NCC = 3-PL
  await page.goto(`${BASE}/truong-du-lieu?module=transport_orders`);
  await page.getByRole("button", { name: "Thêm trường" }).click();
  await page.locator("#fd-label").fill("Nhà xe 3-PL");
  await dialog(page).getByLabel("Bắt buộc nhập").check();
  await page.locator("#fd-showif").selectOption({ label: "NCC" });
  await dialog(page).getByLabel("3-PL", { exact: true }).check();
  await shot(page, "v-01-dieu-kien");
  await dialog(page).getByRole("button", { name: /^Lưu/ }).click();
  check(await visible(page.getByText("chỉ hiện khi NCC = 3-PL")), "Bảng trường ghi rõ điều kiện hiện");

  // Mở lại để sửa: điều kiện đã lưu được điền sẵn
  await page.getByRole("row", { name: /Nhà xe 3-PL/ }).getByRole("button", { name: "Sửa" }).click();
  check((await page.locator("#fd-showif").inputValue()) === "ncc" && (await dialog(page).getByLabel("3-PL", { exact: true }).isChecked()), "Sửa trường hiện lại điều kiện đã lưu");
  await page.keyboard.press("Escape");

  // Form tạo đơn: ẩn/hiện theo NCC
  await page.goto(`${BASE}/dieu-phoi/tao-don`);
  await page.waitForLoadState("networkidle");
  const card = page.locator("[data-slot=card]").filter({ hasText: "Thông tin đơn hàng" });
  check(await hidden(card.getByLabel(/Nhà xe 3-PL/)), "Chưa chọn NCC thì ẩn Nhà xe 3-PL");
  await card.getByLabel("NCC").selectOption({ label: "3-PL" });
  check(await visible(card.getByLabel(/Nhà xe 3-PL/)), "Chọn NCC = 3-PL thì hiện Nhà xe 3-PL");
  await shot(page, "v-02-hien-3pl");
  await card.getByLabel("NCC").selectOption({ label: "Xe nội bộ" });
  check(await hidden(card.getByLabel(/Nhà xe 3-PL/)), "Chọn Xe nội bộ thì ẩn Nhà xe 3-PL");

  // Lưu đơn với Xe nội bộ: trường bắt buộc đang ẩn không chặn lưu
  const s1 = page.locator("[data-slot=card]").filter({ hasText: "Chuyến 1" });
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
  const unit = s1.getByLabel(/Đơn giá/);
  if (await unit.isVisible().catch(() => false)) await unit.fill("3000000").catch(() => {});
  await page.getByRole("button", { name: /Lưu đơn hàng/ }).click();
  check(await page.waitForURL(/\/dieu-phoi\/don-hang\//, { timeout: 15000 }).then(() => true, () => false), "Lưu đơn Xe nội bộ dù Nhà xe 3-PL (bắt buộc) đang ẩn");
  const saved = execFileSync("psql", ["-Atq", "-d", process.env.E2E_DB ?? "gha_e2e", "-c",
    "select custom_fields->>'ncc' || '|' || coalesce(custom_fields->>'nha_xe_3_pl', 'null') from public.transport_orders order by created_at desc limit 1"]).toString().trim();
  check(saved === "noi_bo|null", `Đơn lưu NCC = Xe nội bộ, Nhà xe 3-PL để trống (thấy: ${saved})`);

  // Chọn 3-PL mà bỏ trống Nhà xe 3-PL thì bị chặn
  await page.goto(`${BASE}/dieu-phoi/tao-don`);
  await page.waitForLoadState("networkidle");
  await card.getByLabel("NCC").selectOption({ label: "3-PL" });
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
  if (await unit.isVisible().catch(() => false)) await unit.fill("3000000").catch(() => {});
  await page.getByRole("button", { name: /Lưu đơn hàng/ }).click();
  check(await visible(page.getByText(/Nhà xe 3-PL là bắt buộc/)), "Chọn 3-PL mà bỏ trống Nhà xe 3-PL thì báo bắt buộc");
});

await finish();
