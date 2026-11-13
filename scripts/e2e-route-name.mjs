// Kiểm thử giao diện: tên tuyến tự ghép "Điểm nhận → Điểm giao" khi thêm tuyến đường.
import { BASE, asUser, check, desktop, finish, shot } from "./e2e-lib.mjs";

await asUser("owner@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/khach-hang?tab=routes`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Thêm mới", exact: true }).first().click();
  const d = page.getByRole("dialog");
  for (const [label, q, name] of [["Điểm nhận", "Cát Lái", "Cảng Cát Lái"], ["Điểm giao", "Long An", "Kho Mẫu Long An"]]) {
    await d.getByLabel(label, { exact: false }).first().click();
    await page.getByPlaceholder("Gõ để tìm…").fill(q);
    await page.getByRole("option", { name: new RegExp(name) }).first().click();
  }
  const v = await d.getByLabel(/Tên tuyến/).inputValue();
  check(/Cảng Cát Lái.* → Kho Mẫu Long An/.test(v), `Tên tuyến tự ghép (thấy: ${v})`);
  await d.getByLabel(/Tên tuyến/).fill("Tuyến riêng của tôi");
  await d.getByLabel("Điểm giao", { exact: false }).first().click();
  await page.getByPlaceholder("Gõ để tìm…").fill("Bình Dương");
  await page.getByRole("option", { name: /Kho Mẫu Bình Dương/ }).first().click();
  check((await d.getByLabel(/Tên tuyến/).inputValue()) === "Tuyến riêng của tôi", "Đã sửa tên tay thì không bị ghi đè");
  await shot(page, "rn-01-tuyen");
});

await finish();
