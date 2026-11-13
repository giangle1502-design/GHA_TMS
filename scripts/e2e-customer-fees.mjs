// Kiểm thử giao diện: phí thu khách theo loại phí (bốc xếp, chi hộ), thêm nhanh loại phí, báo cáo theo loại phí.
import { execFileSync } from "node:child_process";
import { BASE, asUser, check, desktop, finish, shot, visible } from "./e2e-lib.mjs";

const sql = (q) => execFileSync("psql", ["-Atq", "-d", process.env.E2E_DB ?? "gha_e2e", "-c", q]).toString().trim();
const toast = (page, text) => visible(page.locator("[data-sonner-toast]").filter({ hasText: text }), 15000);
// Chuẩn bị: một chuyến đang chạy (báo cáo chỉ tính chuyến đã chạy hoặc hoàn thành)
sql("update public.shipments set status = 'accepted' where id = (select id from public.shipments where status = 'assigned' order by created_at limit 1)");
sql("update public.shipments set status = 'in_transit' where status = 'accepted'");
const [sid, code] = sql(
  "select id || '|' || shipment_code from public.shipments where status in ('in_transit','driver_completed') and receivable_id is null order by created_at limit 1",
).split("|");
const base = Number(sql(`select (freight_amount + surcharge_amount + fuel_support_amount)::bigint from public.shipments where id = '${sid}'`));

async function pickFee(page, row, name) {
  await page.locator(`#ct-fee-type-${row}`).click();
  await page.getByPlaceholder("Gõ để tìm…").fill(name);
  await page.getByRole("option", { name }).click();
}

await asUser("dieuphoi@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/dieu-phoi/tao-don`);
  check(await visible(page.getByRole("button", { name: "Thêm phí" }).first()), "Form tạo đơn có khung Phí khác thu khách");

  await page.goto(`${BASE}/chuyen-xe/${sid}`);
  await page.getByRole("button", { name: "Thêm phí thu khách" }).click();
  const d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Thêm phí" }).click();
  await pickFee(page, 1, "Phí bốc xếp");
  await d.getByLabel("Số tiền phí dòng 1").fill("500,000");
  await d.getByLabel("Ghi chú phí dòng 1").fill("Bốc 2 đầu");
  await d.getByRole("button", { name: "Thêm phí" }).click();
  await pickFee(page, 2, "Phí chi hộ");
  await d.getByLabel("Số tiền phí dòng 2").fill("1,000,000");
  check(await visible(d.getByText("Chi hộ", { exact: true })), "Dòng chi hộ được đánh dấu Chi hộ");
  check(await visible(d.getByText("1,000,000 ₫").or(d.getByText("1,000,000 đ"))), "Khung phí cộng tổng chi hộ");
  await shot(page, "cf-01-nhap-phi");
  await d.getByRole("button", { name: "Lưu phí" }).click();
  check(await toast(page, "Đã lưu phí thu khách"), "Lưu phí thu khách của chuyến");
  check(sql(`select extra_fee_amount::bigint || '|' || pass_through_amount::bigint from public.shipments where id = '${sid}'`) === "500000|1000000", "Tách phí tính doanh thu và chi hộ trong CSDL");
  check(await visible(page.getByText("Phí bốc xếp (Bốc 2 đầu)")), "Chi tiết chuyến hiện từng khoản phí");
  check(await visible(page.getByText("Khách phải trả")), "Chi tiết chuyến hiện số khách phải trả");
  await shot(page, "cf-02-chi-tiet");
});

// Kế toán (có quyền danh mục) thêm nhanh loại phí mới ngay trong ô chọn
await asUser("ketoan@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/chuyen-xe/${sid}`);
  await page.getByRole("button", { name: "Sửa phí thu khách" }).click();
  const d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Thêm phí" }).click();
  await page.locator("#ct-fee-type-3").click();
  await page.getByPlaceholder("Gõ để tìm…").fill("Phí nâng hạ");
  await page.getByRole("button", { name: "Thêm mới “Phí nâng hạ”" }).click();
  const q = page.getByRole("dialog").filter({ hasText: "Cách tính" });
  check((await q.getByLabel("Tên loại phí").inputValue()) === "Phí nâng hạ", "Hộp thêm nhanh loại phí điền sẵn tên");
  await q.getByRole("button", { name: /^Lưu/ }).click();
  check(await visible(page.locator("#ct-fee-type-3").filter({ hasText: "Phí nâng hạ" })), "Loại phí mới được chọn ngay");
  await d.getByLabel("Số tiền phí dòng 3").fill("300000");
  await d.getByRole("button", { name: "Lưu phí" }).click();
  check(await toast(page, "Đã lưu phí thu khách"), "Kế toán lưu thêm phí");
  check(sql(`select extra_fee_amount::bigint from public.shipments where id = '${sid}'`) === "800000", "Phí nâng hạ cộng vào doanh thu");
});

await asUser("owner@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/bao-cao?tab=report_fee_type`);
  check(await visible(page.getByRole("cell", { name: "Phí bốc xếp" }).first()), "Báo cáo Doanh thu theo loại phí có Phí bốc xếp");
  check(await visible(page.getByRole("cell", { name: "Cước vận chuyển" }).first()), "Báo cáo có dòng Cước vận chuyển");
  await shot(page, "cf-03-bao-cao");
  await page.goto(`${BASE}/bao-cao?tab=report_fee_lines`);
  await page.getByPlaceholder(/Tìm/).first().fill(code);
  check(await visible(page.getByRole("cell", { name: "Phí chi hộ" }).first()), "Báo cáo Cước phí từng chuyến có khoản chi hộ");
  const rev = Number(sql(`select total_revenue::bigint from public.shipment_list where id = '${sid}'`));
  check(rev === base + 800000, `Doanh thu chuyến cộng phí, không cộng chi hộ (${rev})`);
});

await finish();
