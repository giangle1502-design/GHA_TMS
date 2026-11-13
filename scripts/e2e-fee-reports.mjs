// Kiểm thử giao diện: báo cáo riêng Cước vận chuyển, Phí chi hộ, Bốc xếp; chi phí bốc xếp trả nhà thầu.
import { execFileSync } from "node:child_process";
import { BASE, asUser, check, desktop, finish, shot, visible } from "./e2e-lib.mjs";

const sql = (q) => execFileSync("psql", ["-Atq", "-d", process.env.E2E_DB ?? "gha_e2e", "-c", q]).toString().trim();
const toast = (page, text) => visible(page.locator("[data-sonner-toast]").filter({ hasText: text }), 15000);

// Chuẩn bị: chuyến đang chạy có phí bốc xếp 500.000 và chi hộ 200.000 thu khách
sql("update public.shipments set status = 'accepted' where id = (select id from public.shipments where status = 'assigned' order by created_at limit 1)");
sql("update public.shipments set status = 'in_transit' where status = 'accepted'");
const [sid, code] = sql("select id || '|' || shipment_code from public.shipments where status = 'in_transit' order by created_at limit 1").split("|");
sql(`insert into public.shipment_fees (shipment_id, line_no, fee_type_id, fee_kind, amount, note)
     select '${sid}'::uuid, 1, id, fee_kind, 500000, null from public.fee_types where name = 'Phí bốc xếp'
     union all select '${sid}'::uuid, 2, id, fee_kind, 200000, 'Phí cảng' from public.fee_types where name = 'Phí chi hộ'`);
sql(`update public.shipments set extra_fee_amount = 500000, pass_through_amount = 200000 where id = '${sid}'`);

await asUser("owner@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/chuyen-xe/${sid}`);
  await page.getByRole("button", { name: "Nhập chi phí" }).click();
  const d = page.getByRole("dialog");
  await d.locator("#exp-cat").click();
  await page.getByPlaceholder("Gõ để tìm…").fill("Bốc xếp");
  await page.getByRole("option", { name: "Bốc xếp" }).click();
  await d.locator("#exp-amount").fill("350000");
  check(await visible(d.getByText("Nhà thầu nhận tiền")), "Công ty trả thì có ô Nhà thầu nhận tiền");
  await d.locator("#exp-supplier").click();
  await page.getByPlaceholder("Gõ để tìm…").fill("Tổ bốc xếp Tân Cảng");
  await page.getByRole("button", { name: "Thêm mới “Tổ bốc xếp Tân Cảng”" }).click();
  const q = page.getByRole("dialog").last();
  await q.getByRole("button", { name: /^Lưu/ }).click();
  check(await visible(d.locator("#exp-supplier").filter({ hasText: "Tổ bốc xếp Tân Cảng" })), "Thêm nhanh nhà thầu ngay trong ô chọn");
  await shot(page, "fr-01-chi-phi-nha-thau");
  await d.getByRole("button", { name: /^Lưu/ }).last().click();
  check(await toast(page, "Đã lưu chi phí"), "Lưu chi phí bốc xếp trả nhà thầu");
  check(sql(`select sp.name from public.shipment_expenses e join public.suppliers sp on sp.id = e.supplier_id where e.shipment_id = '${sid}'`) === "Tổ bốc xếp Tân Cảng", "Chi phí ghi đúng nhà thầu");
  sql(`update public.shipment_expenses set status = 'approved' where shipment_id = '${sid}'`);

  await page.goto(`${BASE}/dieu-phoi`);
  await page.getByRole("navigation", { name: "Báo cáo cước phí" }).getByRole("link", { name: "Bốc xếp" }).click();
  check(await visible(page.getByRole("columnheader", { name: /Thu khách bốc xếp/ })), "Từ Điều phối mở thẳng báo cáo Bốc xếp");
  await page.goto(`${BASE}/chuyen-xe`);
  check(await visible(page.getByRole("navigation", { name: "Báo cáo cước phí" }).getByRole("link", { name: "Phí chi hộ" })), "Quản lý chuyến xe có lối vào báo cáo Phí chi hộ");
  await page.goto(`${BASE}/bao-cao?tab=report_freight`);
  check(await visible(page.getByRole("cell", { name: code }).first()), "Báo cáo Cước vận chuyển có chuyến");
  check(await visible(page.getByRole("columnheader", { name: /Tổng cước/ })), "Báo cáo cước có cột Tổng cước");
  await page.goto(`${BASE}/bao-cao?tab=report_pass_through`);
  check(await visible(page.getByRole("cell", { name: "Phí cảng" }).first()), "Báo cáo Phí chi hộ có khoản chi hộ");
  await page.goto(`${BASE}/bao-cao?tab=report_loading`);
  const row = page.locator("tbody tr").filter({ hasText: code });
  check(await visible(row.getByText("Tổ bốc xếp Tân Cảng")), "Báo cáo Bốc xếp có nhà thầu");
  check(await visible(row.getByText("150,000")), "Báo cáo Bốc xếp tính chênh lệch thu khách trừ chi (500,000 − 350,000)");
  await shot(page, "fr-02-bao-cao-boc-xep");
});

await finish();
