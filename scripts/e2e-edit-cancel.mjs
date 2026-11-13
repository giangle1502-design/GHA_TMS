// Kiểm thử giao diện: sửa chuyến tạo sai (Sửa chuyến) và hủy cả đơn hàng.
import { execFileSync } from "node:child_process";
import { BASE, asUser, check, desktop, finish, shot, visible } from "./e2e-lib.mjs";

const sql = (q) => execFileSync("psql", ["-Atq", "-d", process.env.E2E_DB ?? "gha_e2e", "-c", q]).toString().trim();
const toast = (page, text) => visible(page.locator("[data-sonner-toast]").filter({ hasText: text }), 15000);
const sid = sql("select id from public.shipments where status not in ('closed','cancelled') order by created_at limit 1");

await asUser("dieuphoi@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/chuyen-xe/${sid}`);
  await page.getByRole("button", { name: "Sửa chuyến" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Ngày nhận hàng *").fill("2026-11-05");
  await d.getByLabel("Số lượng").fill("2");
  await d.getByLabel("Đơn giá (đ)").fill("1,200,000");
  await d.getByLabel("Ghi chú cho tài xế").fill("Đã sửa ghi chú");
  await shot(page, "ec-01-sua-chuyen");
  await d.getByRole("button", { name: "Lưu thay đổi" }).click();
  check(await toast(page, "Đã lưu thay đổi của chuyến"), "Lưu sửa chuyến");
  const row = sql(`select to_char(pickup_at at time zone 'Asia/Ho_Chi_Minh','YYYY-MM-DD') || '|' || quantity::int || '|' || unit_price::bigint || '|' || freight_amount::bigint || '|' || notes from public.shipments where id = '${sid}'`);
  check(row === "2026-11-05|2|1200000|2400000|Đã sửa ghi chú", `Chuyến cập nhật ngày, số lượng, giá, cước tự tính (thấy ${row})`);

  const oid = sql(`select order_id from public.shipments where id = '${sid}'`);
  await page.goto(`${BASE}/dieu-phoi/don-hang/${oid}`);
  check(await visible(page.getByRole("button", { name: "Sửa", exact: true }).first()), "Bảng chuyến có nút Sửa ở cột Thao tác");
  await page.getByRole("button", { name: "Hủy đơn hàng" }).click();
  await page.getByLabel("Lý do hủy").fill("Tạo trùng đơn");
  await page.getByRole("button", { name: "Xác nhận hủy đơn" }).click();
  check(await toast(page, "Đã hủy đơn hàng"), "Hủy cả đơn hàng");
  check(sql(`select status from public.transport_orders where id = '${oid}'`) === "cancelled", "Đơn chuyển Đã hủy");
  check(sql(`select count(*) from public.shipments where order_id = '${oid}' and status <> 'cancelled'`) === "0", "Mọi chuyến của đơn đã hủy");
  await page.goto(`${BASE}/chuyen-xe/${sid}`);
  check(!(await visible(page.getByRole("button", { name: "Sửa chuyến" }), 1500)), "Chuyến đã hủy không còn nút Sửa chuyến");
});

await finish();
