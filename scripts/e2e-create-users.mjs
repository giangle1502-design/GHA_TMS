// Tạo các tài khoản thử nghiệm @khanhha.test trên Supabase CỤC BỘ (sau khi nạp supabase/seed.dev.sql).
// Dùng service role key của Supabase cục bộ, chạy bằng Node trên máy, KHÔNG dùng với dự án thật.
// Cách chạy: SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... TEST_PASSWORD=... node scripts/e2e-create-users.mjs
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.TEST_PASSWORD;
if (!url || !key || !password) throw new Error("Thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / TEST_PASSWORD");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) throw new Error("Chỉ chạy với Supabase cục bộ (localhost).");

const emails = [
  "owner@khanhha.test",
  "admin@khanhha.test",
  "dieuphoi@khanhha.test",
  "ketoan@khanhha.test",
  "giamdoc@khanhha.test",
  "taixe.a@khanhha.test",
  "taixe.b@khanhha.test",
  "stranger@khanhha.test",
];
for (const email of emails) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `Người dùng ${email.split("@")[0]}` } }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(res.ok ? `Đã tạo ${email}` : `Bỏ qua ${email}: ${body.msg ?? body.message ?? res.status}`);
}
