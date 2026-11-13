# KHÁNH HÀ TMS – Phần mềm quản lý vận tải (Công ty Vận tải Khánh Hà)

Ứng dụng web quản lý vận tải: điều phối, chuyến xe, ứng dụng tài xế, chi phí, phê duyệt, quyết toán, công nợ, báo cáo.
Công nghệ: Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 · Supabase (PostgreSQL, Auth Google, Storage) · Vercel.

**Trạng thái hiện tại:** xong Giai đoạn 1 (thiết kế, CSDL, RLS) và Giai đoạn 2 (giao diện, đăng nhập, phân quyền, người dùng, nhật ký, cấu hình).
Chi tiết từng chức năng: [`docs/trang-thai-tinh-nang.md`](docs/trang-thai-tinh-nang.md). Các điểm nghiệp vụ cần chủ doanh nghiệp xác nhận: [`docs/00-diem-can-xac-nhan.md`](docs/00-diem-can-xac-nhan.md).

## Mục lục tài liệu

| Tệp | Nội dung |
|---|---|
| `docs/00-diem-can-xac-nhan.md` | Câu hỏi nghiệp vụ cần xác nhận |
| `docs/01-yeu-cau-nghiep-vu.md` | Tài liệu yêu cầu nghiệp vụ |
| `docs/02-kien-truc.md` | Kiến trúc hệ thống |
| `docs/03-co-so-du-lieu.md` | Sơ đồ cơ sở dữ liệu |
| `docs/04-man-hinh.md` | Danh sách màn hình |
| `docs/05-server-actions.md` | API / Server Actions / hàm CSDL |
| `docs/06-trang-thai-shipment.md` | Quy trình trạng thái Shipment |
| `docs/07-quy-trinh-phe-duyet.md` | Quy trình phê duyệt |
| `docs/08-ma-tran-phan-quyen.md` | Ma trận phân quyền |
| `docs/09-ke-hoach-giai-doan.md` | Kế hoạch triển khai theo giai đoạn |
| `docs/10-chi-phi-goi-mien-phi.md` | Chi phí và giới hạn gói miễn phí |
| `docs/trang-thai-tinh-nang.md` | Trạng thái từng chức năng |

## Cấu trúc thư mục

```
src/app/(auth)        Đăng nhập, chờ cấp quyền, không có quyền
src/app/(app)         Khu vực văn phòng (sidebar + header), mỗi module một thư mục
src/app/tx            Ứng dụng tài xế (giao diện điện thoại)
src/app/auth          Đăng nhập Google, callback, đăng xuất
src/lib/auth          Lấy người dùng hiện tại, kiểm tra quyền phía máy chủ
src/lib/supabase      Supabase client (server, trình duyệt, proxy làm mới phiên)
src/components        Thành phần giao diện dùng chung
supabase/migrations   Toàn bộ cấu trúc CSDL, RLS, trigger, dữ liệu danh mục chuẩn
supabase/tests        Kiểm thử bảo mật CSDL (RLS, chống tự cấp quyền, nhật ký bất biến…)
supabase/seed.dev.sql Dữ liệu mẫu CHỈ cho máy phát triển (tự từ chối nếu CSDL có dữ liệu thật)
scripts/              Kiểm thử CSDL, kiểm thử giao diện E2E
tests/                Kiểm thử đơn vị (Vitest)
```

## 1. Chạy trên máy phát triển

Yêu cầu: Node.js 20+ (khuyến nghị 22), npm, Git. Để kiểm thử CSDL cần PostgreSQL 15+ cục bộ. Để chạy Supabase đầy đủ cục bộ cần Docker + Supabase CLI.

```bash
npm install
cp .env.example .env.local   # điền URL và publishable key (xem mục 2 hoặc 1.2)
npm run dev                  # http://localhost:3000
```

### 1.1 Kiểm tra chất lượng mã

```bash
npm run typecheck   # TypeScript
npm run lint        # ESLint
npm test            # kiểm thử đơn vị (Vitest)
npm run build       # build production
```

### 1.2 Kiểm thử bảo mật CSDL (không cần Supabase)

Chạy toàn bộ migration trên một CSDL Postgres **tạm** rồi chạy 103 kiểm thử (RLS, trường dữ liệu động, mã tự sinh, tài xế chỉ thấy chuyến của mình, không tự cấp quyền, không sửa/xóa nhật ký, không xóa dữ liệu có phát sinh tài chính…):

```bash
# dùng PGHOST/PGPORT/PGUSER nếu Postgres không ở mặc định; TEST_DB đổi tên CSDL tạm (mặc định gha_tms_test)
npm run test:db
```

Kết quả mong đợi: mọi dòng `PASS`, dòng cuối báo tất cả kiểm thử đạt.

### 1.3 Supabase cục bộ + dữ liệu mẫu + kiểm thử giao diện E2E

```bash
npx supabase start                      # cần Docker; in ra API URL, anon key, service_role key
npx supabase db reset                   # chạy migration + supabase/seed.dev.sql
# tạo tài khoản thử nghiệm @khanhha.test (chỉ cục bộ)
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<service_role cục bộ> \
TEST_PASSWORD=<mật khẩu tùy chọn> node scripts/e2e-create-users.mjs
```

Ghi `.env.local` với URL `http://127.0.0.1:54321` và anon key cục bộ, rồi `npm run build && npm start`. Chạy kiểm thử giao diện (cần Chromium; `npx playwright install chromium` nếu máy chưa có):

```bash
BASE_URL=http://localhost:3000 SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<anon cục bộ> \
TEST_PASSWORD=<mật khẩu ở trên> CHROMIUM_PATH=<đường dẫn chrome> node scripts/e2e-smoke.mjs e2e-screenshots
# Giai đoạn 3: danh mục, trường động, nhập/xuất Excel, bảng giá (chạy trên dữ liệu mới)
TEST_PASSWORD=<mật khẩu ở trên> CHROMIUM_PATH=<đường dẫn chrome> node scripts/e2e-phase3.mjs e2e-screenshots-gd3
```

Kịch bản kiểm thử: chuyển hướng khi chưa đăng nhập; tài khoản chưa được mời bị giữ ở trang chờ; Super Admin xem tổng quan, mời người dùng qua giao diện, ma trận quyền, nhật ký, cấu hình; người xem báo cáo bị chặn khi gõ thẳng URL; điều phối bị chặn xem nhật ký; tài xế A chỉ thấy chuyến của mình kèm link Google Maps; tài xế B không thấy chuyến của người khác; menu điện thoại. Kiểm thử thay đổi dữ liệu (mời tài khoản `stranger`), nên muốn chạy lại thì `npx supabase db reset` và tạo lại tài khoản.

Các kịch bản có tài xế nhận đơn viết trước tính năng "Giám đốc duyệt chuyến": tắt tham số trước khi chạy, ví dụ `update public.system_settings set value = 'false' where key = 'dispatch.require_director_approval';`.

> Đăng nhập email/mật khẩu chỉ dùng cho kiểm thử cục bộ. Ứng dụng thật chỉ đăng nhập bằng Google.

## 2. Tạo dự án Supabase thật

> Hướng dẫn từng bước bằng giao diện web cho người không chuyên: [docs/huong-dan-trien-khai.md](docs/huong-dan-trien-khai.md).

1. Đăng nhập [supabase.com](https://supabase.com) bằng **tài khoản email mới của công ty**, tạo Organization, rồi **New project**: region **Southeast Asia (Singapore)**, đặt mật khẩu CSDL mạnh và lưu vào trình quản lý mật khẩu.
2. Chạy migration (chọn một cách):
   - **Supabase CLI (khuyến nghị):**
     ```bash
     npx supabase login
     npx supabase link --project-ref <ma-du-an>
     npx supabase db push          # chỉ chạy supabase/migrations, KHÔNG chạy seed.dev.sql
     ```
   - **Thủ công (không cần cài gì):** mở SQL Editor, dán toàn bộ `supabase/deploy/cai-dat-lan-dau.sql` rồi Run. Tệp này ghép sẵn mọi migration, tạo lại bằng `bash scripts/build-deploy-sql.sh` mỗi khi thêm migration.
3. **Không** chạy `supabase/seed.dev.sql` trên dự án thật (tệp tự từ chối nếu phát hiện tài khoản thật).
4. Project Settings → API: lấy **Project URL** và **Publishable key** (hoặc anon key). **Không** dùng service_role key trong ứng dụng.

## 3. Đăng nhập Google

1. Vào [Google Cloud Console](https://console.cloud.google.com) bằng tài khoản công ty, tạo project `gha-tms`.
2. APIs & Services → **OAuth consent screen**: chọn *External* (nếu dùng Gmail thường) hoặc *Internal* (nếu có Google Workspace), điền tên ứng dụng, email hỗ trợ; scope chỉ cần `email`, `profile`, `openid`; bấm **Publish app**.
3. **Credentials → Create credentials → OAuth client ID** → *Web application*:
   - Authorized JavaScript origins: `https://<ten-mien-ung-dung>` và `http://localhost:3000`
   - Authorized redirect URIs: `https://<ma-du-an>.supabase.co/auth/v1/callback`
4. Supabase → Authentication → **Sign In / Providers → Google**: bật, dán Client ID và Client Secret.
5. Supabase → Authentication → **URL Configuration**:
   - Site URL: `https://<ten-mien-ung-dung>`
   - Redirect URLs: `https://<ten-mien-ung-dung>/auth/callback`, `http://localhost:3000/auth/callback` (và `https://*-<ten-team>.vercel.app/auth/callback` nếu muốn thử trên bản xem trước Vercel)

### 3.1 Tạo Super Admin đầu tiên

Hệ thống chỉ cho vào những email **đã được mời**; người khác đăng nhập Google sẽ ở trạng thái *chờ cấp quyền*. Mời Super Admin đầu tiên bằng SQL Editor:

```sql
insert into public.user_invitations (email, role_codes, note)
values ('email-cua-chu-doanh-nghiep@gmail.com', '{super_admin}', 'Super Admin đầu tiên');
```

Sau đó đăng nhập Google bằng đúng email đó, tài khoản được kích hoạt với vai trò Super Admin. Từ đây mọi người dùng khác được mời qua màn hình **Người dùng và phân quyền**.

## 4. Triển khai lên Vercel

> ⚠️ Gói **Vercel Hobby chỉ cho phép dùng cá nhân, phi thương mại**. Phần mềm vận hành cho công ty cần **Vercel Pro** (20 USD/tháng) hoặc chuyển sang Cloudflare Workers (miễn phí, cho phép thương mại). Xem `docs/10-chi-phi-goi-mien-phi.md`.

1. Đẩy mã lên repo GitHub riêng tư của công ty.
2. [vercel.com](https://vercel.com) → **Add New → Project** → chọn repo; Framework: Next.js (tự nhận); Region function: `sin1` (Singapore) trong Settings → Functions.
3. **Environment Variables** (Production và Preview):

   | Biến | Giá trị |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL của Supabase |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (hoặc đặt `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
   | `NEXT_PUBLIC_SITE_URL` | `https://<ten-mien-ung-dung>` |

4. Deploy. Cập nhật tên miền thật vào Google OAuth (mục 3, bước 3) và Supabase URL Configuration (mục 3, bước 5).
5. Kiểm tra: mở trang, đăng nhập Google bằng email Super Admin, vào **Tổng quan**.

## 5. Sao lưu và khôi phục

Gói Supabase Free **không có bản sao lưu tải về**. Bắt buộc tự sao lưu định kỳ (tối thiểu mỗi tuần, và trước mỗi lần chạy migration mới):

```bash
# Lấy chuỗi kết nối: Supabase → Connect → Session pooler (cổng 5432)
export DB_URL='postgresql://postgres.<ma-du-an>:<mat-khau>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres'

# Sao lưu (Supabase CLI, tách cấu trúc, dữ liệu và vai trò)
npx supabase db dump --db-url "$DB_URL" -f backup/schema.sql
npx supabase db dump --db-url "$DB_URL" -f backup/data.sql --data-only --use-copy
npx supabase db dump --db-url "$DB_URL" -f backup/roles.sql --role-only

# Hoặc pg_dump (PostgreSQL 17 client)
pg_dump "$DB_URL" -Fc -n public -n private -n auth -f backup/gha-tms-$(date +%Y%m%d).dump
```

Khôi phục vào một dự án Supabase **mới** (không ghi đè dự án đang chạy khi chưa kiểm tra):

```bash
psql "$NEW_DB_URL" -f backup/roles.sql
psql "$NEW_DB_URL" -f backup/schema.sql
psql "$NEW_DB_URL" -c "set session_replication_role = replica" -f backup/data.sql
```

Tệp chứng từ trong Storage (bucket `documents`) không nằm trong bản dump CSDL; tải về định kỳ bằng lệnh `supabase storage` của Supabase CLI (xem `npx supabase storage --help`) hoặc nâng cấp Supabase Pro để có sao lưu tự động hằng ngày.
Lưu bản sao lưu ở nơi riêng tư (ổ công ty/Google Drive giới hạn quyền), vì có thông tin nhạy cảm (CCCD, tài khoản ngân hàng). Nên thử khôi phục ít nhất mỗi quý.

## 6. Nguyên tắc bảo mật đã áp dụng

- Chỉ dùng publishable/anon key ở trình duyệt; mọi truy vấn đi qua RLS với JWT người dùng. Không có service_role key trong mã ứng dụng.
- Quyền kiểm tra ở 3 lớp: menu/nút (giao diện), server action/trang (`requirePermission`, `requirePagePermission`), CSDL (RLS + hàm `private.has_perm`).
- Tài xế chỉ đọc được chuyến được phân công cho mình (RLS + RPC `driver_list_my_shipments`).
- Không ai tự cấp vai trò/quyền cho mình; chỉ Super Admin quản lý vai trò Super Admin và quyền của vai trò Admin.
- Nhật ký hệ thống chỉ thêm, không sửa, không xóa (trigger chặn mọi người dùng). Thông tin CCCD/ngân hàng của tài xế được che trong nhật ký.
- Không xóa cứng chuyến/chứng từ đã có phát sinh tài chính; dùng hủy có lý do.
- Bucket chứng từ là riêng tư, chỉ xem bằng signed URL ngắn hạn. Không lưu thông tin đăng nhập ngân hàng.
