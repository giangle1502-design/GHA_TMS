// Kiểm thử giao diện: trường công thức của chuyến dùng Đơn giá, % hỗ trợ dầu (hệ thống) và phụ thu (trường bổ sung).
// Cần CSDL cục bộ (gha_e2e) để tạo sẵn hai trường phụ thu.
import { execFileSync } from "node:child_process";
import { BASE, asUser, check, desktop, finish, shot, visible } from "./e2e-lib.mjs";

execFileSync("psql", ["-q", "-d", process.env.E2E_DB ?? "gha_e2e", "-c",
  `insert into public.field_definitions (module, field_key, label, data_type) values
   ('shipments', 'phu_thu_ve', 'Phụ thu vé', 'currency'), ('shipments', 'phu_thu_ha_trai_tuyen', 'Phụ thu hạ trái tuyến', 'currency') on conflict do nothing`]);

await asUser("owner@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/truong-du-lieu?module=shipments`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Thêm trường" }).click();
  await page.locator("#fd-label").fill("Giá");
  await page.locator("#fd-type").selectOption("formula");
  const d = page.getByRole("dialog");
  check(await visible(d.getByRole("button", { name: /Đơn giá unit_price/ })), "Công thức của chuyến có Đơn giá để chọn");
  check(await visible(d.getByRole("button", { name: /% hỗ trợ dầu fuel_support_rate/ })), "Công thức của chuyến có % hỗ trợ dầu để chọn");
  await d.getByRole("button", { name: /Đơn giá unit_price/ }).click();
  check((await page.locator("#fd-formula").inputValue()) === "unit_price", "Bấm tên trường chèn mã vào công thức");
  await page.locator("#fd-formula").fill("ROUND(unit_price * (1 + fuel_support_rate / 100), 0) + N(phu_thu_ve) + N(phu_thu_ha_trai_tuyen)");
  check(await visible(d.getByText("Công thức hợp lệ.")), "Công thức giá hợp lệ");
  await page.locator("#fd-fmt").selectOption("currency");
  await shot(page, "pf-01-cong-thuc");
  await d.getByRole("button", { name: /^Lưu/ }).click();
  check(await visible(page.getByRole("cell", { name: "Giá", exact: true })), "Lưu trường công thức Giá");

  await page.goto(`${BASE}/dieu-phoi/tao-don`);
  await page.waitForLoadState("networkidle");
  const s1 = page.locator("[data-slot=card]").filter({ hasText: "Chuyến 1" });
  check(await visible(s1.getByRole("link", { name: /Sửa, xóa, sắp xếp trường/ })), "Form tạo đơn có lối vào sửa, xóa trường");
  for (const [label, q, name] of [
    ["Điểm nhận *", "Bình Dương", "Kho Mẫu Bình Dương"],
    ["Điểm giao *", "Cát Lái", "Cảng Cát Lái"],
  ]) {
    await s1.getByLabel(label).click();
    await page.getByPlaceholder("Gõ để tìm…").fill(q);
    await page.getByRole("option", { name: new RegExp(name) }).first().click();
  }
  await page.locator("#order-customer").click();
  await page.getByPlaceholder("Gõ để tìm…").fill("Mẫu A");
  await page.getByRole("option", { name: /Công ty Mẫu A/ }).first().click();
  await s1.getByLabel("Loại xe", { exact: true }).click();
  await page.getByPlaceholder("Gõ để tìm…").fill("8 tấn");
  await page.getByRole("option", { name: /Xe tải 8 tấn/ }).first().click();
  await s1.getByLabel("Phụ thu vé").fill("50000");
  await page.waitForTimeout(1500);
  const giaBox = s1.locator("div.space-y-1\\.5").filter({ has: page.getByText("Giá", { exact: true }) }).first();
  const text = (await giaBox.textContent()) ?? "";
  // Bảng giá mẫu BG001: 3.500.000, hỗ trợ dầu 39% => 4.865.000 + 50.000 vé (hạ trái tuyến trống = 0)
  check(/4,915,000/.test(text), `Form tạo đơn tính Giá = Đơn giá × (1 + % dầu) + phụ thu (thấy: ${text.replace(/\s+/g, " ").slice(0, 80)})`);
  check((await s1.locator("div.rounded-lg.border").filter({ has: page.getByLabel("Phụ phí (đ)") }).filter({ has: page.getByText("Phụ thu vé", { exact: true }) }).count()) > 0, "Phụ thu và công thức giá nằm trong khung Giá");
  await shot(page, "pf-02-tao-don");
  await s1.getByRole("button", { name: "Thêm phụ thu / công thức giá" }).click();
  await page.locator("#fd-type").selectOption("formula");
  const d2 = page.getByRole("dialog");
  check(await visible(d2.getByRole("button", { name: /Phụ thu vé phu_thu_ve/ })), "Ngay trên form tạo đơn, công thức chọn được phụ thu đã thêm");
  await page.keyboard.press("Escape");

  // Sắp xếp các ô trong khung Giá: đưa "Phụ thu vé" lên trước "Phụ phí"
  await page.goto(`${BASE}/truong-du-lieu?module=shipments`);
  const list = page.getByRole("list", { name: /Thứ tự trường trên biểu mẫu/ });
  await list.locator("li[data-layout-key=phu_thu_ve]").waitFor();
  check(await visible(list.locator("li[data-layout-key=fuel_support_rate]")), "Danh sách thứ tự có các ô của khung Giá");
  const keys = () => list.locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-layout-key")));
  for (let i = 0; i < 20; i++) {
    const k = await keys();
    if (k.indexOf("phu_thu_ve") < k.indexOf("surcharge_amount")) break;
    await page.getByRole("button", { name: "Đưa Phụ thu vé lên" }).click();
  }
  await page.getByRole("button", { name: "Lưu thứ tự" }).click();
  await page.locator("[data-sonner-toast]").filter({ hasText: "Đã lưu thứ tự" }).waitFor();
  await page.goto(`${BASE}/dieu-phoi/tao-don`);
  const t1 = page.locator("[data-slot=card]").filter({ hasText: "Chuyến 1" });
  for (const [label, q, name] of [["Điểm nhận *", "Bình Dương", "Kho Mẫu Bình Dương"], ["Điểm giao *", "Cát Lái", "Cảng Cát Lái"]]) {
    await t1.getByLabel(label).click();
    await page.getByPlaceholder("Gõ để tìm…").fill(q);
    await page.getByRole("option", { name: new RegExp(name) }).first().click();
  }
  await t1.getByLabel("Phụ phí (đ)").waitFor();
  const box = t1.locator("div.rounded-lg.border").filter({ has: page.getByLabel("Phụ phí (đ)") }).last();
  const labels = await box.locator("label").evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ""));
  check(labels.indexOf("Phụ thu vé") >= 0 && labels.indexOf("Phụ thu vé") < labels.indexOf("Phụ phí (đ)"), `Khung Giá hiện theo thứ tự đã sắp (thấy: ${labels.join(" | ")})`);
  await shot(page, "pf-03-thu-tu-khung-gia");
});

await finish();
