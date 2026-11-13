# Hướng dẫn đưa KHÁNH HÀ TMS lên mạng (gói miễn phí)

Dành cho người không cần biết lập trình. Làm lần lượt 4 bước, mỗi bước đều dùng tài khoản **khanhhanlog@gmail.com** (GitHub: `khanhhanlog-dot`).

| Dịch vụ | Dùng để | Gói |
|---|---|---|
| Supabase | Cơ sở dữ liệu, đăng nhập | Free |
| Vercel | Chạy ứng dụng, cấp đường link | Hobby (miễn phí) |
| Google Cloud | Cho phép đăng nhập bằng Google | Miễn phí |

> **Lưu ý về Vercel Hobby:** điều khoản của Vercel chỉ cho gói Hobby dùng cá nhân, phi thương mại. Dùng để chạy thử là ổn; **trước khi công ty dùng thật hằng ngày**, vào Vercel → Settings → Billing bấm nâng lên Pro (khoảng 20 USD/tháng). Đường link và dữ liệu giữ nguyên, không phải cài lại.

---

## Bước 1. Tạo cơ sở dữ liệu Supabase

1. Vào https://supabase.com → **Start your project** → **Continue with GitHub** (đang đăng nhập GitHub `khanhhanlog-dot`).
2. Bấm **New project**:
   - Name: `khanh-ha-tms`
   - Database Password: bấm **Generate a password**, rồi **lưu mật khẩu này lại** (không cần gửi cho Claude).
   - Region: **Southeast Asia (Singapore)**
   - Plan: Free → **Create new project**. Chờ khoảng 1–2 phút.
3. Cài cấu trúc dữ liệu:
   - Mở tệp cài đặt trên GitHub: https://github.com/khanhhanlog-dot/quan_ly_van_tai_kh/blob/main/supabase/deploy/cai-dat-lan-dau.sql
   - Bấm nút **Copy raw file** (biểu tượng hai tờ giấy, góc phải phía trên nội dung tệp).
   - Trong Supabase, menu trái chọn **SQL Editor** → **New query** → dán vào → bấm **Run**.
   - Thấy dòng "Success. No rows returned" là xong. Nếu Supabase hỏi về câu lệnh có thể làm thay đổi dữ liệu, bấm **Run this query**.
4. Đặt Super Admin đầu tiên (người có toàn quyền). Trong SQL Editor, **New query**, dán và **Run**:

   ```sql
   insert into public.user_invitations (email, role_codes, note)
   values ('khanhhanlog@gmail.com', '{super_admin}', 'Super Admin đầu tiên');
   ```

   Muốn dùng email khác làm Super Admin thì thay email trong câu trên.
5. Lấy 2 thông tin gửi cho Claude: menu trái **Project Settings** → **Data API** (hoặc **API Keys**):
   - **Project URL** (dạng `https://xxxx.supabase.co`)
   - **Publishable key** (bắt đầu bằng `sb_publishable_`), hoặc **anon public key** nếu dự án hiển thị kiểu cũ.

   Hai thông tin này là khóa công khai, gửi được. **Không gửi** *secret key* hay *service_role key*.

## Bước 2. Đưa ứng dụng lên Vercel

1. Vào https://vercel.com/signup → chọn **Hobby** → **Continue with GitHub**.
2. **Add New… → Project** → chọn repo `QUAN_LY_VAN_TAI_KH` → **Import**. Nếu không thấy repo, bấm **Adjust GitHub App Permissions** và cho phép repo này.
3. Mở mục **Environment Variables**, thêm 2 dòng bắt buộc (có thể dán nguyên cả 2 dòng `TÊN=giá trị` vào ô Key, Vercel tự tách):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL ở Bước 1.5 |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key ở Bước 1.5 (nếu là anon key thì đặt tên `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
   | `NEXT_PUBLIC_SITE_URL` | *không bắt buộc*: chỉ cần khi gắn tên miền riêng; bỏ trống thì ứng dụng tự dùng link đang mở |

4. Bấm **Deploy**, chờ khoảng 2–3 phút. Vercel cho một đường link, ví dụ `https://quan-ly-van-tai-kh.vercel.app`. Đây là **link ứng dụng**; link tài xế là link này thêm `/tx` ở cuối.
5. Nếu sau này gắn tên miền riêng, thêm `NEXT_PUBLIC_SITE_URL` bằng tên miền đó trong **Settings → Environment Variables**, rồi **Deployments → ⋯ → Redeploy**.
6. Vùng chạy đã được đặt sẵn là **Singapore (sin1)** trong tệp `vercel.json` (cùng vùng với Supabase). Kiểm tra ở **Settings → Functions → Function Region**; nếu Supabase không ở Singapore thì báo Claude đổi cho khớp.

## Bước 3. Bật đăng nhập Google

1. Vào https://console.cloud.google.com (đăng nhập `khanhhanlog@gmail.com`) → chọn **Select a project → New project**, đặt tên `khanh-ha-tms` → **Create**.
2. Menu **APIs & Services → OAuth consent screen** (có thể hiện là **Google Auth Platform**) → **Get started**:
   - App name: `KHÁNH HÀ TMS`, User support email: `khanhhanlog@gmail.com`
   - Audience: **External**
   - Contact email: `khanhhanlog@gmail.com` → **Create**.
   - Vào **Audience** → bấm **Publish app** để mọi tài khoản Google đều đăng nhập được (hệ thống vẫn chỉ cho vào người đã được mời).
3. **Clients** (hoặc **Credentials → Create credentials → OAuth client ID**):
   - Application type: **Web application**
   - Authorized JavaScript origins: link ứng dụng ở Bước 2.4
   - Authorized redirect URIs: `https://xxxx.supabase.co/auth/v1/callback` (thay `xxxx.supabase.co` bằng Project URL của anh/chị)
   - **Create** → sao chép **Client ID** và **Client secret**.
4. Quay lại Supabase → **Authentication → Sign In / Providers → Google** → bật **Enable**, dán Client ID và Client secret → **Save**.
5. Supabase → **Authentication → URL Configuration**:
   - Site URL: link ứng dụng
   - Redirect URLs → **Add URL**: `link-ứng-dụng/auth/callback` (ví dụ `https://quan-ly-van-tai-kh.vercel.app/auth/callback`)

Client secret chỉ dán vào Supabase, không cần gửi cho Claude.

## Bước 4. Kiểm tra

1. Mở link ứng dụng → **Đăng nhập bằng Google** bằng email Super Admin ở Bước 1.4.
2. Vào được trang **Tổng quan** là thành công. Từ đây mời thêm người dùng và tài xế ở màn hình **Người dùng và phân quyền**.
3. Gửi link cho Claude để kiểm tra lại toàn bộ.

## Nâng cấp khi có giai đoạn mới

Mỗi giai đoạn có thể kèm một tệp nâng cấp cơ sở dữ liệu trong thư mục `supabase/deploy/` (ví dụ `nang-cap-giai-doan-4.sql`). Làm theo thứ tự:

1. Mở tệp nâng cấp trên GitHub → **Copy raw file**.
2. Supabase → **SQL Editor** → **New query** → dán → **Run**. Thấy "Success" là xong. Tệp tự báo "đã được nâng cấp trước đó" nếu lỡ chạy lần hai, không làm hỏng dữ liệu.
3. Báo Claude để đưa mã mới lên Vercel (hoặc Vercel tự cập nhật khi mã mới vào nhánh `main`).

Chạy tệp nâng cấp **trước** khi mã mới lên Vercel: mã cũ vẫn chạy bình thường với cơ sở dữ liệu đã nâng cấp, còn mã mới cần cơ sở dữ liệu mới.

## Khi gặp lỗi

| Hiện tượng | Cách xử lý |
|---|---|
| Chạy tệp cài đặt báo lỗi "already exists" | Tệp đã chạy rồi. Không chạy lại; báo Claude kèm ảnh chụp lỗi |
| Đăng nhập Google báo `redirect_uri_mismatch` | Kiểm tra lại Bước 3.3: redirect URI phải đúng `https://xxxx.supabase.co/auth/v1/callback` |
| Đăng nhập xong quay về trang lỗi hoặc localhost | Kiểm tra Bước 3.5 và biến `NEXT_PUBLIC_SITE_URL` ở Vercel |
| Đăng nhập được nhưng báo "chờ cấp quyền" | Email chưa được mời. Super Admin mời ở màn hình Người dùng, hoặc kiểm tra lại email ở Bước 1.4 |
