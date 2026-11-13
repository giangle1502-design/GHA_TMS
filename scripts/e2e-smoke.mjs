// Kiểm thử khói (smoke test) giao diện với Supabase CỤC BỘ + dữ liệu mẫu (supabase/seed.dev.sql).
// Đăng nhập bằng email/mật khẩu của tài khoản thử nghiệm @khanhha.test (chỉ tồn tại ở môi trường cục bộ),
// sau đó kiểm tra quyền truy cập từng trang và chụp ảnh màn hình.
//
// Cách chạy: BASE_URL=http://localhost:3000 SUPABASE_URL=... SUPABASE_ANON_KEY=... TEST_PASSWORD=... \
//            CHROMIUM_PATH=/đường/dẫn/chrome node scripts/e2e-smoke.mjs [thư-mục-ảnh]
import { mkdirSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_ANON_KEY;
const PASSWORD = process.env.TEST_PASSWORD;
const OUT = process.argv[2] ?? "e2e-screenshots";
if (!SB_URL || !SB_KEY || !PASSWORD) throw new Error("Thiếu SUPABASE_URL / SUPABASE_ANON_KEY / TEST_PASSWORD");
mkdirSync(OUT, { recursive: true });

async function sessionCookies(email) {
  const jar = [];
  const sb = createServerClient(SB_URL, SB_KEY, {
    cookies: { getAll: () => jar, setAll: (cs) => cs.forEach((c) => jar.push(c)) },
  });
  const { error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Đăng nhập ${email} thất bại: ${error.message}`);
  const host = new URL(BASE).hostname;
  return jar.map((c) => ({ name: c.name, value: c.value, domain: host, path: "/", httpOnly: false, secure: false, sameSite: "Lax" }));
}

let failures = 0;
function check(cond, msg) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${msg}`);
  if (!cond) failures++;
}
// Chờ phần tử xuất hiện (trang render dạng streaming)
const visible = (locator, timeout = 10000) =>
  locator.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
// Chờ URL khớp (chuyển hướng có thể xảy ra phía trình duyệt khi streaming)
const urlMatches = (page, re, timeout = 10000) => page.waitForURL(re, { timeout }).then(() => true, () => false);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

async function asUser(email, viewport, fn) {
  const ctx = await browser.newContext({ viewport, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  if (email) await ctx.addCookies(await sessionCookies(email));
  const page = await ctx.newPage();
  try {
    await fn(page);
  } finally {
    await ctx.close();
  }
}
const desktop = { width: 1366, height: 860 };
const phone = { width: 390, height: 844 };
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

// 1. Khách chưa đăng nhập
await asUser(null, desktop, async (page) => {
  await page.goto(`${BASE}/tong-quan`);
  check(await urlMatches(page, /\/dang\-nhap/), "Chưa đăng nhập -> chuyển về trang đăng nhập");
  check(await visible(page.getByRole("button", { name: "Đăng nhập bằng Google" })), "Trang đăng nhập có nút Google");
  await shot(page, "01-dang-nhap");
});

// 2. Tài khoản Google chưa được mời
await asUser("stranger@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/tong-quan`);
  check(await urlMatches(page, /\/cho\-cap\-quyen/), "Tài khoản chưa được mời -> trang chờ cấp quyền");
  await shot(page, "02-cho-cap-quyen");
});

// 3. Super Admin
await asUser("owner@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/`);
  check(await urlMatches(page, /\/tong-quan$/), "Super Admin vào Tổng quan");
  check(await visible(page.getByText("Chuyến trong tháng")), "Dashboard hiển thị số chuyến tháng");
  check(await visible(page.getByText("Tài khoản chờ cấp quyền")), "Dashboard hiển thị tài khoản chờ cấp quyền");
  await shot(page, "03-tong-quan-super-admin");

  await page.goto(`${BASE}/nguoi-dung`);
  check(await visible(page.getByText("stranger@khanhha.test")), "Danh sách người dùng có tài khoản chờ");
  await shot(page, "04-nguoi-dung");

  // Cấp quyền cho tài khoản đang chờ qua giao diện
  await page.getByRole("button", { name: "Cấp quyền truy cập" }).click();
  await page.getByLabel("Email Google").fill("stranger@khanhha.test");
  await page.getByText("Người chỉ xem báo cáo", { exact: true }).click();
  await shot(page, "05-cap-quyen-dialog");
  await page.getByRole("button", { name: "Cấp quyền", exact: true }).click();
  await page.getByText("Đã cấp quyền truy cập").waitFor({ timeout: 10000 });
  check(true, "Cấp quyền qua giao diện thành công");

  await page.goto(`${BASE}/nguoi-dung?tab=roles`);
  check(await visible(page.getByText("Vai trò và quyền").first()), "Ma trận vai trò hiển thị");
  await shot(page, "06-ma-tran-quyen");

  await page.goto(`${BASE}/nhat-ky`);
  check(await visible(page.locator("details")), "Nhật ký có bản ghi");
  await page.locator("details summary").first().click();
  await shot(page, "07-nhat-ky");

  await page.goto(`${BASE}/cau-hinh`);
  check(await visible(page.getByText("Tên doanh nghiệp hiển thị")), "Trang cấu hình hiển thị tham số");
  await shot(page, "08-cau-hinh");

  await page.goto(`${BASE}/bieu-mau`);
  check(await visible(page.getByText("Chưa triển khai – sẽ hoàn thiện ở Giai đoạn 8")), "Màn hình chưa làm ghi rõ giai đoạn");
  await shot(page, "09-chua-trien-khai");

  await page.goto(`${BASE}/thong-bao`);
  check(await visible(page.getByText("Tài khoản mới chờ cấp quyền").first()), "Có thông báo tài khoản chờ cấp quyền");
});

// 4. Tài khoản vừa được cấp quyền chỉ xem báo cáo
await asUser("stranger@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/`);
  check(await urlMatches(page, /\/tong-quan$/), "Sau khi được cấp quyền vào được Tổng quan");
  await visible(page.getByText("Tổng quan tài chính"));
  check((await page.getByRole("link", { name: /Người dùng và phân quyền/ }).count()) === 0, "Người xem báo cáo không thấy menu phân quyền");
  await page.goto(`${BASE}/nguoi-dung`);
  check(await urlMatches(page, /\/khong\-co\-quyen/), "Gõ thẳng URL trang phân quyền -> bị chặn phía máy chủ");
});

// 5. Điều phối
await asUser("dieuphoi@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/tong-quan`);
  check(await visible(page.getByText("Chờ tài xế nhận chuyến")), "Điều phối thấy chỉ tiêu chuyến");
  check((await page.getByRole("link", { name: "Nhật ký hệ thống" }).count()) === 0, "Điều phối không thấy menu nhật ký");
  await page.goto(`${BASE}/nhat-ky`);
  check(await urlMatches(page, /\/khong\-co\-quyen/), "Điều phối bị chặn khỏi nhật ký");
  await shot(page, "10-dieu-phoi-khong-co-quyen");
});

// 6. Tài xế trên điện thoại: mở link, nhập số xe, nhận đơn (không cần tài khoản)
await asUser("taixe.a@khanhha.test", phone, async (page) => {
  await page.goto(`${BASE}/`);
  check(await urlMatches(page, /\/tx$/), "Tài xế vào thẳng ứng dụng tài xế");
  check(await visible(page.getByText("Nhập số xe để xem chuyến")), "Ứng dụng tài xế hỏi số xe");
  await page.goto(`${BASE}/tong-quan`);
  check(await urlMatches(page, /\/khong\-co\-quyen/), "Tài xế không vào được Tổng quan quản trị");
});
await asUser(null, phone, async (page) => {
  await page.goto(`${BASE}/tx`);
  check(await urlMatches(page, /\/tx$/), "Mở link tài xế không bị bắt đăng nhập");
  const plate = page.getByLabel("Số xe");
  await plate.fill("99x-999.99");
  check((await plate.inputValue()) === "99X99999", "Ô số xe tự viết hoa và bỏ dấu chấm, gạch");
  await page.getByRole("button", { name: "Xem chuyến" }).click();
  check(await visible(page.getByText("Không tìm thấy xe có biển số này")), "Sai số xe thì báo rõ");
  await plate.fill("51c00001");
  await page.getByRole("button", { name: "Xem chuyến" }).click();
  check(await visible(page.getByText("Kho Mẫu Bình Dương").first()), "Nhập số xe thấy chuyến dạng thẻ");
  check((await page.locator("[data-trip]").count()) === 1, "Xe chỉ thấy chuyến của mình");
  check(await visible(page.getByRole("link", { name: "Chỉ đường" }).first()), "Có nút chỉ đường Google Maps");
  await shot(page, "11-tai-xe-dien-thoai");
  await page.getByRole("button", { name: /Nhận đơn/ }).click();
  check(await visible(page.getByText("Đã nhận lúc")), "Bấm Nhận đơn xong thẻ chuyển sang Đã nhận");
  await page.reload();
  check(await visible(page.getByText("Đã nhận lúc")), "Mở lại link vẫn nhớ xe, không phải nhập lại");
  await shot(page, "11b-tai-xe-da-nhan");
  await page.getByRole("button", { name: "Đổi xe" }).click();
  await plate.fill("51C00002");
  await page.getByRole("button", { name: "Xem chuyến" }).click();
  check(await visible(page.getByText("Xe chưa có chuyến nào")), "Xe khác không thấy chuyến của xe 51C00001");
});
await asUser("dieuphoi@khanhha.test", desktop, async (page) => {
  await page.goto(`${BASE}/dieu-phoi`);
  check(await visible(page.getByText("Đã nhận").first()), "Điều phối thấy chuyến tài xế đã nhận");
});

// 7. Giao diện điện thoại của khu quản trị
await asUser("owner@khanhha.test", phone, async (page) => {
  await page.goto(`${BASE}/tong-quan`);
  await page.getByRole("button", { name: "Mở menu" }).click();
  check(await visible(page.getByRole("link", { name: "Người dùng và phân quyền" })), "Menu di động mở được");
  await shot(page, "12-menu-dien-thoai");
});

await browser.close();
console.log(failures ? `${failures} KIỂM THỬ THẤT BẠI` : "TẤT CẢ KIỂM THỬ GIAO DIỆN ĐỀU ĐẠT");
process.exit(failures ? 1 : 0);
