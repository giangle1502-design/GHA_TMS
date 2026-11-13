// Kiểm thử giao diện: sửa toàn bộ đơn hàng (form tạo đơn ở chế độ sửa: khách thanh toán, ghi chú) và sửa giá chuyến đã đóng.
import { execFileSync } from "node:child_process";
import { BASE, asUser, check, desktop, finish, shot, visible } from "./e2e-lib.mjs";

const sql = (q) => execFileSync("psql", ["-Atq", "-d", process.env.E2E_DB ?? "gha_e2e", "-c", q]).toString().trim();
const toast = (page, text) => visible(page.locator("[data-sonner-toast]").filter({ hasText: text }), 15000);

const sid = sql("select id from public.shipments where status = 'assigned' order by created_at limit 1");
const oid = sql(`select order_id from public.shipments where id = '${sid}'`);
// Chuẩn bị: chuyến đã hoàn thành và đã đóng
for (const st of ["accepted", "in_transit", "driver_completed", "closed"]) sql(`update public.shipments set status = '${st}' where id = '${sid}'`);

await asUser("dieuphoi@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/dieu-phoi/don-hang/${oid}`);
  await page.getByRole("link", { name: "Sửa toàn bộ đơn" }).click();
  await page.waitForURL(/\/sua$/);
  await page.locator("#order-payer").click();
  await page.getByPlaceholder("Gõ để tìm…").fill("Mẫu B");
  await page.getByRole("option", { name: /Công ty Mẫu B/ }).click();
  await page.locator("#order-notes").fill("Sửa khách thanh toán do nhập sai");
  await shot(page, "eo-01-sua-don");
  await page.getByRole("button", { name: /Lưu thay đổi đơn/ }).click();
  check(await toast(page, "Đã lưu đơn"), "Lưu sửa toàn bộ đơn hàng");
  check(sql(`select c.name || '|' || o.notes from public.transport_orders o join public.customers c on c.id = o.payer_customer_id where o.id = '${oid}'`) === "Công ty Mẫu B|Sửa khách thanh toán do nhập sai",
    "Đơn hàng đổi khách thanh toán và ghi chú");
  check(await visible(page.getByText("Sửa khách thanh toán do nhập sai")), "Trang đơn hiện ghi chú mới");

  await page.goto(`${BASE}/chuyen-xe/${sid}`);
  await page.getByRole("button", { name: "Sửa chuyến" }).click();
  const e = page.getByRole("dialog");
  await e.getByLabel("Đơn giá (đ)").fill("3,000,000");
  await e.getByRole("button", { name: "Lưu thay đổi" }).click();
  check(await toast(page, "Đã lưu thay đổi của chuyến"), "Sửa giá chuyến đã đóng (chưa lập công nợ)");
  check(sql(`select unit_price::bigint from public.shipments where id = '${sid}'`) === "3000000", "Giá chuyến đã đóng được cập nhật");
});

await finish();
