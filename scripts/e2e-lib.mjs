// Tiện ích dùng chung cho kiểm thử giao diện với Supabase CỤC BỘ (tài khoản thử nghiệm @khanhha.test).
import { mkdirSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { chromium } from "playwright-core";

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_ANON_KEY;
const PASSWORD = process.env.TEST_PASSWORD;
if (!SB_URL || !SB_KEY || !PASSWORD) throw new Error("Thiếu SUPABASE_URL / SUPABASE_ANON_KEY / TEST_PASSWORD");
if (!/localhost|127\.0\.0\.1/.test(SB_URL)) throw new Error("Chỉ chạy kiểm thử giao diện với Supabase cục bộ.");

export const OUT = process.argv[2] ?? "e2e-screenshots";
mkdirSync(OUT, { recursive: true });

export async function sessionCookies(email) {
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
export function check(cond, msg) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${msg}`);
  if (!cond) failures++;
}
export const visible = (locator, timeout = 10000) =>
  locator.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);
export const hidden = (locator, timeout = 5000) =>
  locator.first().waitFor({ state: "hidden", timeout }).then(() => true, () => false);
export const urlMatches = (page, re, timeout = 10000) => page.waitForURL(re, { timeout }).then(() => true, () => false);

export const desktop = { width: 1366, height: 860 };
export const phone = { width: 390, height: 844 };

export const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });

export async function asUser(email, viewport, fn) {
  const ctx = await browser.newContext({ viewport, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh", acceptDownloads: true });
  if (email) await ctx.addCookies(await sessionCookies(email));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  [lỗi trang] ${e.message}`));
  try {
    await fn(page);
  } catch (e) {
    check(false, `Lỗi không mong đợi: ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: `${OUT}/loi-${Date.now()}.png`, fullPage: true }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

export const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

export async function finish() {
  await browser.close();
  console.log(failures ? `${failures} KIỂM THỬ THẤT BẠI` : "TẤT CẢ KIỂM THỬ GIAO DIỆN ĐỀU ĐẠT");
  process.exit(failures ? 1 : 0);
}
