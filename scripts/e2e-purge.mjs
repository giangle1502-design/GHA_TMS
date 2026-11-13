// Kiểm thử giao diện: xóa dữ liệu thử trong ứng dụng (đặt mật khẩu xóa dữ liệu → nhập mật khẩu → gõ XOA DU LIEU → Xóa).
// Chạy trên CSDL vừa reset (xóa sạch đơn hàng, chuyến).
import { execFileSync } from "node:child_process";
import { BASE, asUser, check, desktop, finish, shot, visible } from "./e2e-lib.mjs";

const sql = (q) => execFileSync("psql", ["-Atq", "-d", process.env.E2E_DB ?? "gha_e2e", "-c", q]).toString().trim();
const toast = (page, text) => visible(page.locator("[data-sonner-toast]").filter({ hasText: text }), 15000);
const PW = "XoaThu-2026";

await asUser("ketoan@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/cau-hinh`);
  check(!(await visible(page.getByRole("button", { name: "Xóa dữ liệu", exact: true }), 3000)), "Người không phải Admin không thấy nút Xóa dữ liệu");
});

await asUser("admin@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/cau-hinh`);
  check(await page.getByRole("button", { name: "Xóa dữ liệu", exact: true }).isDisabled(), "Chưa đặt mật khẩu xóa dữ liệu thì chưa bấm Xóa được");
  await page.getByRole("button", { name: "Đặt mật khẩu xóa dữ liệu" }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Mật khẩu mới", { exact: true }).fill(PW);
  await d.getByLabel("Nhập lại mật khẩu mới").fill(PW);
  await d.getByRole("button", { name: "Lưu mật khẩu" }).click();
  check(await toast(page, "Đã lưu mật khẩu xóa dữ liệu"), "Đặt mật khẩu xóa dữ liệu");

  const before = Number(sql("select count(*) from public.shipments"));
  await page.getByRole("button", { name: "Xóa dữ liệu", exact: true }).click();
  d = page.getByRole("dialog");
  await d.getByLabel("Mật khẩu xóa dữ liệu").fill("sai-mat-khau");
  await d.getByRole("button", { name: "Tiếp tục" }).click();
  check(await toast(page, "Mật khẩu xóa dữ liệu không đúng"), "Sai mật khẩu thì báo lỗi, không sang bước xóa");
  await d.getByLabel("Mật khẩu xóa dữ liệu").fill(PW);
  await d.getByRole("button", { name: "Tiếp tục" }).click();
  check(await visible(d.getByText(/Sẽ xóa \(/)), "Đúng mật khẩu thì xem trước số dòng sẽ xóa");
  const xoa = d.getByRole("button", { name: "Xóa", exact: true });
  check(await xoa.isDisabled(), "Chưa gõ chữ xác nhận thì nút Xóa bị khóa");
  await d.getByLabel(/để xác nhận/).fill("xoa du lieu");
  await shot(page, "purge-01-xac-nhan");
  await xoa.click();
  check(await toast(page, "Đã xóa dữ liệu thử"), "Xóa dữ liệu thử thành công");
  check(before > 0 && sql("select count(*) from public.shipments") === "0" && sql("select count(*) from public.transport_orders") === "0", "Đơn hàng, chuyến đã bị xóa");
  check(Number(sql("select count(*) from public.customers")) > 0, "Khách hàng được giữ lại");
  check(sql("select count(*) from public.audit_logs where action = 'test_data.password_failed'") === "1", "Lần nhập sai được ghi nhật ký");
});

await finish();
