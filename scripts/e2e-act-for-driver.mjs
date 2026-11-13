// Kiểm thử giao diện: Điều phối làm thay tài xế (nhận đơn, bắt đầu chạy, hoàn thành bỏ qua ảnh có lý do, bổ sung ảnh sau).
// Chạy trên CSDL vừa reset (chuyến mẫu SHP đang "Chờ tài xế nhận").
import { execFileSync } from "node:child_process";
import zlib from "node:zlib";
import { BASE, asUser, check, desktop, finish, shot, visible } from "./e2e-lib.mjs";

const sql = (q) => execFileSync("psql", ["-Atq", "-d", process.env.E2E_DB ?? "gha_e2e", "-c", q]).toString().trim();
function png(w = 64, h = 48) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = x * 4;
      raw[o + 1] = y * 5;
      raw[o + 2] = 128;
    }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const toast = (page, text) => visible(page.locator("[data-sonner-toast]").filter({ hasText: text }), 15000);
const id = sql("select id from public.shipments where status = 'assigned' and driver_id is not null order by created_at limit 1");
const row = () => sql(`select status || '|' || document_status || '|' || coalesce(photo_skip_reason, '') from public.shipments where id = '${id}'`).split("|");

await asUser("dieuphoi@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/chuyen-xe/${id}`);
  await page.getByRole("button", { name: "Nhận đơn thay tài xế" }).click();
  check(await toast(page, "Đã nhận chuyến thay tài xế"), "Điều phối nhận đơn thay tài xế");
  await page.getByRole("button", { name: "Bắt đầu chạy thay tài xế" }).click();
  check(await toast(page, "Đã bắt đầu chạy thay tài xế"), "Điều phối bắt đầu chạy thay");
  check(row()[0] === "in_transit", "Chuyến chuyển sang Đang chạy");

  await page.getByRole("button", { name: "Hoàn thành chuyến thay tài xế" }).click();
  const d = page.getByRole("dialog");
  await d.getByRole("radio", { name: "Không phát sinh chi phí" }).click();
  await d.getByRole("button", { name: "Lưu hoàn thành" }).click();
  check(await visible(d.getByText(/hoặc ghi lý do chưa có chứng từ/)), "Không ảnh, không lý do thì báo lỗi");
  await d.getByLabel("Lý do chưa có ảnh, chứng từ").fill("Khách chưa in được phiếu, bổ sung ngày mai");
  await shot(page, "af-01-hoan-thanh-thay");
  await d.getByRole("button", { name: "Lưu hoàn thành" }).click();
  check(await toast(page, "Đã hoàn thành chuyến thay tài xế"), "Hoàn thành thay tài xế khi chưa có ảnh");
  const [st, doc, reason] = row();
  check(st === "driver_completed" && doc === "missing" && reason.startsWith("Khách chưa in"), `Chuyến hoàn thành, chứng từ vẫn Thiếu, lưu lý do (${st}, ${doc})`);
  check(await visible(page.getByText(/Hoàn thành khi chưa có ảnh, chứng từ/)), "Chi tiết chuyến nhắc bổ sung chứng từ");
  check(sql(`select count(*) from public.shipment_status_history where shipment_id = '${id}' and note like '%thay tài xế%'`) === "3", "Lịch sử ghi 3 bước làm thay");

  // Bổ sung ảnh sau bằng nút Chứng từ
  await page.getByRole("button", { name: /Chứng từ/ }).first().click();
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles([{ name: "phieu.png", mimeType: "image/png", buffer: png() }]);
  check(await toast(page, "Đã tải chứng từ lên"), "Tải phiếu ký nhận bổ sung");
  const [, doc2, reason2] = row();
  check(doc2 === "submitted" && reason2 === "", `Bổ sung ảnh: chứng từ Đã nộp, xóa lý do (${doc2})`);
  await page.keyboard.press("Escape");
  await page.reload();
  check(!(await visible(page.getByText(/Hoàn thành khi chưa có ảnh, chứng từ/), 1500)), "Hết nhắc bổ sung chứng từ");
  await shot(page, "af-02-da-bo-sung");
});

await asUser("ketoan@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/chuyen-xe/${id}`);
  check(!(await visible(page.getByText(/Làm thay tài xế/), 1500)), "Kế toán không thấy phần làm thay tài xế");
});

await finish();
