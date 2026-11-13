// Kiểm thử giao diện: bảng hàng hóa (nhiều mã hàng) của chuyến: thêm dòng, dán từ Excel, cột công thức, sửa ở chi tiết chuyến.
import { execFileSync } from "node:child_process";
import { BASE, asUser, check, desktop, finish, shot, visible } from "./e2e-lib.mjs";

const sql = (q) => execFileSync("psql", ["-Atq", "-d", process.env.E2E_DB ?? "gha_e2e", "-c", q]).toString().trim();
sql(`insert into public.field_definitions (module, field_key, label, data_type, formula, display_format) values
  ('shipment_items', 'don_gia_hang', 'Đơn giá hàng', 'currency', null, null),
  ('shipment_items', 'thanh_tien', 'Thành tiền', 'formula', 'quantity * N(don_gia_hang)', 'currency') on conflict do nothing`);

await asUser("dieuphoi@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/dieu-phoi/tao-don`);
  await page.waitForLoadState("networkidle");
  const s1 = page.locator("[data-slot=card]").filter({ hasText: "Chuyến 1" });
  await page.locator("#order-customer").click();
  await page.getByPlaceholder("Gõ để tìm…").fill("Mẫu A");
  await page.getByRole("option", { name: /Công ty Mẫu A/ }).first().click();
  for (const [label, q, name] of [["Điểm nhận *", "Bình Dương", "Kho Mẫu Bình Dương"], ["Điểm giao *", "Cát Lái", "Cảng Cát Lái"]]) {
    await s1.getByLabel(label).click();
    await page.getByPlaceholder("Gõ để tìm…").fill(q);
    await page.getByRole("option", { name: new RegExp(name) }).first().click();
  }
  await s1.getByRole("button", { name: "Thêm dòng" }).click();
  await s1.getByLabel("Mã hàng dòng 1").fill("MH001");
  await s1.getByLabel("Tên hàng dòng 1").fill("Thép cuộn");
  await s1.getByLabel("Số lượng dòng 1").fill("2");
  await s1.getByLabel("Đơn giá hàng dòng 1").fill("150000");
  check(await visible(s1.getByRole("cell", { name: "300,000" }).first()), "Cột công thức Thành tiền tự tính trên từng dòng");
  await s1.getByRole("button", { name: "Dán từ Excel" }).click();
  await page.getByLabel("Dữ liệu dán từ Excel").fill("MH002\tTôn lạnh\t3\tcuộn\nMH003\tỐng thép\t5\tbó");
  await page.getByRole("button", { name: "Thêm vào bảng" }).click();
  check(await visible(s1.getByText("Tổng 3 dòng")), "Dán từ Excel thêm 2 dòng");
  check(await visible(s1.getByRole("cell", { name: "10", exact: true })), "Tổng số lượng 10");
  await shot(page, "si-01-tao-don");
  await page.getByRole("button", { name: /Lưu đơn hàng/ }).click();
  await page.waitForURL(/\/dieu-phoi\/don-hang\//, { timeout: 20000 });
  const sid = sql("select id from public.shipments order by created_at desc limit 1");
  check(sql(`select string_agg(item_code || '=' || quantity::int, ',' order by line_no) from public.shipment_items where shipment_id = '${sid}'`) === "MH001=2,MH002=3,MH003=5", "Lưu 3 dòng hàng hóa theo thứ tự");
  check(sql(`select custom_fields->>'don_gia_hang' from public.shipment_items where shipment_id = '${sid}' and line_no = 1`) === "150000", "Lưu cột bổ sung của dòng hàng");

  await page.goto(`${BASE}/chuyen-xe/${sid}`);
  check(await visible(page.getByText("Hàng hóa (3 mã hàng)")), "Chi tiết chuyến hiện hàng hóa");
  await page.getByRole("button", { name: "Sửa hàng hóa" }).click();
  await page.getByRole("button", { name: "Xóa dòng 2" }).click();
  await page.getByRole("button", { name: "Lưu hàng hóa" }).click();
  check(await visible(page.getByText("Hàng hóa (2 mã hàng)")), "Sửa hàng hóa ở chi tiết chuyến");
  await shot(page, "si-02-chi-tiet");
});

await asUser("ketoan@khanhha.test", desktop, async (page) => {
  const sid = sql("select id from public.shipments order by created_at desc limit 1");
  await page.goto(`${BASE}/chuyen-xe/${sid}`);
  check(await visible(page.getByText("Hàng hóa (2 mã hàng)")), "Kế toán xem được hàng hóa");
  check(!(await visible(page.getByRole("button", { name: "Sửa hàng hóa" }), 1000)), "Kế toán không sửa được hàng hóa");
});

await finish();
