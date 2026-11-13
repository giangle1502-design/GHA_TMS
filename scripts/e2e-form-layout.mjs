// Kiểm thử giao diện: sắp thứ tự trường trên biểu mẫu (Quản lý trường dữ liệu → Thứ tự trên biểu mẫu),
// áp dụng cho form tạo đơn/chuyến của Điều phối và hộp tạo mới của danh mục.
// Cần CSDL cục bộ (PGHOST/PGPORT/PGUSER, CSDL gha_e2e) để tạo sẵn một trường bổ sung.
import { execFileSync } from "node:child_process";
import { BASE, asUser, check, desktop, finish, shot, visible } from "./e2e-lib.mjs";

const toast = (page, text) => visible(page.locator("[data-sonner-toast]").filter({ hasText: text }), 15000);
execFileSync("psql", ["-q", "-d", process.env.E2E_DB ?? "gha_e2e", "-c",
  "insert into public.field_definitions (module, field_key, label, data_type, is_visible) values ('shipments', 'so_container', 'Số container', 'short_text', true) on conflict do nothing"]);

await asUser("owner@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/truong-du-lieu`);
  check(await visible(page.getByRole("link", { name: "Chuyến xe (Điều phối)" })), "Quản lý trường có mục Chuyến xe (Điều phối)");
  check(await visible(page.getByRole("link", { name: "Đơn hàng (Điều phối)" })), "Quản lý trường có mục Đơn hàng (Điều phối)");
  await page.getByRole("link", { name: "Chuyến xe (Điều phối)" }).click();
  await page.waitForURL(/module=shipments/);
  await page.locator("li[data-layout-key=pickup_at]").waitFor();
  const list = page.getByRole("list", { name: /Thứ tự trường trên biểu mẫu/ });
  await list.waitFor();
  const keys = () => list.locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-layout-key")));
  const before = await keys();
  check(before[0] === "pickup_at" && before.at(-1) === "so_container", `Mặc định: trường hệ thống trước, trường bổ sung cuối (thấy: ${before.join(", ")})`);

  // Kéo "Số container" lên đầu
  await list.locator("li[data-layout-key=so_container]").dragTo(list.locator("li[data-layout-key=pickup_at]"));
  check((await keys())[0] === "so_container", "Kéo thả đưa Số container lên đầu");
  // Bấm mũi tên đưa "Tài xế" lên ngay sau Số container
  for (let i = 0; i < 10 && (await keys())[1] !== "driver_id"; i++) await page.getByRole("button", { name: "Đưa Tài xế lên" }).click();
  check((await keys()).slice(0, 2).join() === "so_container,driver_id", "Bấm mũi tên đổi vị trí Tài xế");
  await shot(page, "fl-01-thu-tu");
  await page.getByRole("button", { name: "Lưu thứ tự" }).click();
  check(await toast(page, "Đã lưu thứ tự"), "Lưu thứ tự trường");
  await page.reload();
  check((await keys()).slice(0, 2).join() === "so_container,driver_id", "Tải lại trang vẫn giữ thứ tự đã lưu");

  // Form tạo đơn hàng hiện đúng thứ tự
  await page.goto(`${BASE}/dieu-phoi/tao-don`);
  const card = page.locator("div").filter({ has: page.getByText("Chuyến 1", { exact: true }) }).last();
  const labels = await page.locator('label[for^="s"]').evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ""));
  check(labels[0]?.startsWith("Số container") && labels[1]?.startsWith("Tài xế"), `Form chuyến hiện Số container, Tài xế đầu tiên (thấy: ${labels.slice(0, 3).join(" | ")})`);
  void card;
  await shot(page, "fl-02-tao-don");

  // Danh mục: đưa "Tài xế phụ trách" lên đầu hộp tạo xe
  await page.goto(`${BASE}/truong-du-lieu?module=vehicles`);
  await list.waitFor();
  const first = (await keys())[0];
  await list.locator("li[data-layout-key=assigned_driver_id]").dragTo(list.locator(`li[data-layout-key=${first}]`));
  await page.getByRole("button", { name: "Lưu thứ tự" }).click();
  check(await toast(page, "Đã lưu thứ tự"), "Lưu thứ tự trường của xe");
  await page.goto(`${BASE}/phuong-tien`);
  await page.getByRole("button", { name: "Thêm mới", exact: true }).first().click();
  const firstLabel = await page.getByRole("dialog").locator("label").first().textContent();
  check(firstLabel?.startsWith("Tài xế phụ trách"), `Hộp tạo xe hiện Tài xế phụ trách đầu tiên (thấy: ${firstLabel})`);
  await page.keyboard.press("Escape");
  // Khôi phục mặc định cho các kiểm thử khác
  await page.goto(`${BASE}/truong-du-lieu?module=vehicles`);
  await page.getByRole("button", { name: "Mặc định" }).click();
  await page.getByRole("button", { name: "Lưu thứ tự" }).click();
  check(await toast(page, "Đã lưu thứ tự"), "Khôi phục thứ tự mặc định");
});

await asUser("dieuphoi@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/truong-du-lieu?module=shipments`);
  const ok = await visible(page.getByRole("list", { name: /Thứ tự trường trên biểu mẫu/ }), 5000);
  check(!ok || !(await visible(page.getByRole("button", { name: "Lưu thứ tự" }), 2000)), "Người không có quyền cấu hình trường không lưu được thứ tự");
});

await finish();
