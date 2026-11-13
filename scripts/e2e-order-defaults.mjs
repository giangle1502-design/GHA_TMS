// Kiểm thử giao diện: ngày nhận/giao chỉ có ngày, khách thanh toán tự điền theo hồ sơ khách hàng,
// tạo chuyến khi chưa có giá, sửa/xóa trường ngay trong khung "Thứ tự trên biểu mẫu".
// Cần CSDL cục bộ (gha_e2e): tạo sẵn trường bổ sung và khách thanh toán mặc định.
import { execFileSync } from "node:child_process";
import { BASE, asUser, check, desktop, finish, shot, visible } from "./e2e-lib.mjs";

const sql = (q) => execFileSync("psql", ["-Atq", "-d", process.env.E2E_DB ?? "gha_e2e", "-c", q]).toString().trim();
sql(`insert into public.field_definitions (module, field_key, label, data_type) values ('shipments', 'loai_xe_trung', 'Loại xe trùng', 'short_text') on conflict do nothing`);
sql(`update public.customers set default_payer_customer_id = (select id from public.customers where code = 'KH002') where code = 'KH001'`);
const toast = (page, text) => visible(page.locator("[data-sonner-toast]").filter({ hasText: text }), 15000);

await asUser("owner@khanhha.test", desktop, async (page) => {
  // Khung thứ tự có nút sửa / xóa cho trường bổ sung, không có cho trường hệ thống
  await page.goto(`${BASE}/truong-du-lieu?module=shipments`);
  const list = page.getByRole("list", { name: /Thứ tự trường trên biểu mẫu/ });
  await list.locator("li[data-layout-key=loai_xe_trung]").waitFor();
  check(await visible(list.getByRole("button", { name: "Sửa Loại xe trùng" })), "Khung thứ tự có nút sửa trường bổ sung");
  check(!(await visible(list.getByRole("button", { name: "Xóa Ngày nhận hàng" }), 1000)), "Trường hệ thống không có nút xóa");
  await list.getByRole("button", { name: "Sửa Loại xe trùng" }).click();
  check(await visible(page.getByRole("dialog").getByText(/Sửa trường “Loại xe trùng”/)), "Bấm sửa mở hộp sửa trường");
  await page.keyboard.press("Escape");
  await list.getByRole("button", { name: "Xóa Loại xe trùng" }).click();
  await page.getByRole("button", { name: "Xóa", exact: true }).click();
  check(await toast(page, "Đã xóa"), "Xóa trường ngay trong khung thứ tự");
  await page.reload();
  await list.locator("li[data-layout-key=pickup_at]").waitFor();
  check((await list.locator("li[data-layout-key=loai_xe_trung]").count()) === 0, "Trường đã xóa biến mất khỏi khung thứ tự");
  await shot(page, "od-01-khung-thu-tu");

  // Tạo đơn: chỉ chọn ngày, khách thanh toán tự điền, không nhập giá
  await page.goto(`${BASE}/dieu-phoi/tao-don`);
  await page.waitForLoadState("networkidle");
  const s1 = page.locator("[data-slot=card]").filter({ hasText: "Chuyến 1" });
  check((await s1.getByLabel("Ngày nhận hàng *").getAttribute("type")) === "date", "Ngày nhận hàng chỉ chọn ngày");
  check((await s1.getByLabel("Ngày giao dự kiến").getAttribute("type")) === "date", "Ngày giao dự kiến chỉ chọn ngày");
  await s1.getByLabel("Ngày nhận hàng *").fill("2026-11-02");
  await s1.getByLabel("Ngày giao dự kiến").fill("2026-11-03");
  await page.locator("#order-customer").click();
  await page.getByPlaceholder("Gõ để tìm…").fill("Mẫu A");
  await page.getByRole("option", { name: /Công ty Mẫu A/ }).first().click();
  check(await visible(page.locator("#order-payer").filter({ hasText: /Công ty Mẫu B/ })), "Chọn khách KH001 tự điền khách thanh toán KH002");
  for (const [label, q, name] of [["Điểm nhận *", "Cát Lái", "Cảng Cát Lái"], ["Điểm giao *", "Bình Dương", "Kho Mẫu Bình Dương"]]) {
    await s1.getByLabel(label).click();
    await page.getByPlaceholder("Gõ để tìm…").fill(q);
    await page.getByRole("option", { name: new RegExp(name) }).first().click();
  }
  await page.waitForTimeout(1200);
  check(await visible(s1.getByPlaceholder("Để trống nếu tính giá sau")), "Ô đơn giá cho để trống");
  await shot(page, "od-02-tao-don");
  await page.getByRole("button", { name: /Lưu đơn hàng/ }).click();
  await page.waitForURL(/\/dieu-phoi\/don-hang\//, { timeout: 20000 });
  const row = sql(`select to_char(pickup_at at time zone 'Asia/Ho_Chi_Minh','YYYY-MM-DD HH24:MI') || '|' || to_char(expected_delivery_at at time zone 'Asia/Ho_Chi_Minh','YYYY-MM-DD HH24:MI:SS') || '|' || unit_price || '|' || (pricing_snapshot->>'price_source') || '|' || (select code from public.customers c where c.id = o.payer_customer_id)
    from public.shipments s join public.transport_orders o on o.id = s.order_id order by s.created_at desc limit 1`);
  const [pick, exp, price, src, payer] = row.split("|");
  check(pick === "2026-11-02 00:00", `Ngày nhận lưu đầu ngày (thấy ${pick})`);
  check(exp === "2026-11-03 23:59:59", `Ngày giao dự kiến lưu cuối ngày (thấy ${exp})`);
  check(Number(price) === 0 && src === "pending", `Chuyến chưa có giá được tạo (giá ${price}, nguồn ${src})`);
  check(payer === "KH002", `Đơn lưu khách thanh toán tự điền (thấy ${payer})`);

  await page.goto(`${BASE}/chuyen-xe`);
  check(await visible(page.getByText("Chưa có giá").first()), "Bảng chuyến xe ghi Chưa có giá");
  await shot(page, "od-03-chuyen-xe");
});

await finish();
