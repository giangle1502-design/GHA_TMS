// Kiểm thử giao diện: tài khoản đã đăng nhập nhưng "Chờ cấp quyền" được cấp vai trò ở trang Phân quyền
// và được kích hoạt ngay; mỗi vai trò hiện danh sách quyền có sẵn.
import { BASE, asUser, check, desktop, finish, shot, visible } from "./e2e-lib.mjs";

await asUser("stranger@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/`);
  check(await visible(page.getByText(/chờ cấp quyền|chưa được cấp quyền/i).first()), "Tài khoản chưa được cấp quyền thấy trang chờ");
});

await asUser("owner@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/nguoi-dung`);
  const row = page.getByRole("row", { name: /stranger@khanhha.test/ });
  await row.getByRole("link", { name: "Cấp quyền" }).click();
  await page.waitForURL(/\/nguoi-dung\/[0-9a-f-]+/);
  check(await visible(page.getByText(/đã đăng nhập nhưng chưa được cấp quyền/)), "Trang Phân quyền hướng dẫn kích hoạt tài khoản chờ");
  const role = page.locator("div").filter({ has: page.getByLabel("Kế toán", { exact: true }) }).last();
  await role.getByText(/Xem quyền có sẵn/).click();
  check(await visible(role.getByText(/Ứng tiền: xem, tạo, sửa, duyệt, thanh toán, xuất/)), "Vai trò Kế toán hiện quyền có sẵn");
  await page.getByLabel("Kế toán", { exact: true }).check();
  await shot(page, "pu-01-cap-quyen");
  await page.getByRole("button", { name: "Lưu vai trò" }).click();
  check(await visible(page.locator("[data-sonner-toast]").filter({ hasText: "kích hoạt tài khoản" })), "Lưu vai trò kích hoạt tài khoản chờ");
  await page.reload();
  check(await visible(page.getByText("Hoạt động", { exact: true }).first()), "Trạng thái chuyển sang Hoạt động");

  await page.goto(`${BASE}/nguoi-dung`);
  await page.getByRole("button", { name: "Cấp quyền truy cập" }).click();
  check(await visible(page.getByRole("dialog").getByText(/Xem quyền có sẵn/).first()), "Hộp cấp quyền hiện quyền có sẵn của từng vai trò");
});

await asUser("stranger@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/cong-no`);
  check(!(await page.getByText(/chờ cấp quyền/i).first().isVisible().catch(() => false)) && (await visible(page.getByRole("heading", { name: /Công nợ/ }).first())), "Sau khi cấp, Kế toán mở được Công nợ");
});

await finish();
