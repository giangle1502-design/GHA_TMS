# 10. Dự kiến chi phí và giới hạn gói miễn phí

Số liệu tra cứu ngày 16/10/2026 từ trang chính thức/tổng hợp công khai; **cần kiểm tra lại trên trang giá của từng nhà cung cấp khi đăng ký** vì giá có thể thay đổi.

## 10.1 Giới hạn gói miễn phí

| Dịch vụ | Gói miễn phí | Giới hạn quan trọng | Phù hợp KHÁNH HÀ TMS? |
|---|---|---|---|
| **Vercel Hobby** | 0 đ | 100 GB truyền dữ liệu, 1 triệu lượt gọi function, 4 giờ Active CPU/tháng. **Chỉ dùng cá nhân, phi thương mại.** | ⚠️ Không hợp lệ cho phần mềm của doanh nghiệp. Chỉ dùng để thử nghiệm cá nhân. |
| Vercel Pro | 20 USD/tháng/thành viên phát triển (có 20 USD tín dụng sử dụng) | Người xem không tính phí | ✅ Hợp lệ thương mại |
| **Cloudflare Workers Free** (phương án thay thế) | 0 đ | 100.000 request/ngày, giới hạn CPU mỗi request; chạy Next.js qua adapter OpenNext | ✅ Cho phép thương mại; cần kiểm thử tương thích Next.js 16 ở Giai đoạn 8 |
| **Supabase Free** | 0 đ | 2 dự án; CSDL 500 MB; Storage 1 GB; 5 GB egress; 50.000 người dùng hoạt động/tháng; tệp tối đa 50 MB; **tạm dừng sau 7 ngày ít hoạt động**; **không có bản sao lưu tải về**; log 1 ngày | ✅ Cho phát triển/chạy thử. ⚠️ Rủi ro khi chạy thật (tạm dừng, không sao lưu) |
| Supabase Pro | 25 USD/tháng (gồm 10 USD tín dụng compute) | CSDL 8 GB, 250 GB egress, 100.000 MAU, không tạm dừng, sao lưu hằng ngày | ✅ Khuyến nghị khi có dữ liệu thật |
| Supabase Auth – Google | 0 đ | Trong hạn mức MAU | ✅ |
| Google Cloud OAuth Client | 0 đ | Màn hình đồng ý OAuth chế độ "Internal" cần Google Workspace; nếu dùng Gmail thường thì chọn "External" và xuất bản ứng dụng (chỉ xin quyền email/hồ sơ cơ bản nên không cần thẩm định) | ✅ |
| GitHub | 0 đ | Repo riêng tư không giới hạn | ✅ |
| Google Maps | 0 đ | Chỉ dùng **link** mở Google Maps, không gọi API | ✅ |

## 10.2 Ước tính sử dụng (giả định ~10 người văn phòng, ~30 tài xế, 1.500 chuyến/tháng)

| Hạng mục | Ước tính/tháng | So với Free |
|---|---|---|
| Dữ liệu bảng | ~3–5 MB tăng thêm | 500 MB đủ nhiều năm |
| Ảnh chứng từ | 1.500 chuyến × ~4 ảnh × 300 KB (đã nén) ≈ **1,8 GB** | ❌ Vượt 1 GB Storage Free ngay tháng đầu |
| Egress (tải ảnh, API) | ~3–6 GB | ⚠️ Sát ngưỡng 5 GB |
| Người dùng hoạt động | ~40 | Rất xa ngưỡng 50.000 |
| Lượt gọi function (Vercel) | ~200.000–400.000 | Trong ngưỡng 1 triệu |

## 10.3 Kịch bản chi phí

| Kịch bản | Thành phần | Chi phí/tháng |
|---|---|---|
| A. Phát triển & chạy thử | Vercel Hobby (cá nhân người phát triển) + Supabase Free | 0 USD |
| B. Chạy thật tối thiểu | Cloudflare Workers Free + Supabase Pro | ~25 USD (≈ 650.000 đ) |
| C. Chạy thật khuyến nghị | Vercel Pro (1 thành viên) + Supabase Pro | ~45 USD (≈ 1,2 triệu đ) |
| Phát sinh có thể có | Storage vượt mức gồm trong Supabase Pro (khoảng 100 GB, cần kiểm tra lại trên trang giá), phần vượt tính theo GB | Theo dung lượng ảnh |

## 10.4 Phân loại chức năng theo chi phí

| Miễn phí hoàn toàn | Có hạn mức (theo gói) | Có thể phát sinh phí (không tích hợp mặc định) |
|---|---|---|
| Đăng nhập Google, RBAC, RLS, điều phối thủ công, link Google Maps, thông báo trong ứng dụng, xuất/nhập Excel-CSV, báo cáo nội bộ | Lưu trữ chứng từ, băng thông, số request, dung lượng CSDL, thời gian CPU | SMS, GPS thời gian thực, API bản đồ, chữ ký số, hóa đơn điện tử, email giao dịch số lượng lớn |

## 10.5 Biện pháp tiết kiệm đã áp dụng trong thiết kế

- Nén ảnh phía trình duyệt (tối đa ~1600 px, JPEG/WebP) trước khi tải lên (Giai đoạn 3).
- Không dùng Next.js Image Optimization cho chứng từ (tránh tính phí transformations); xem ảnh bằng signed URL.
- Phân trang phía máy chủ; báo cáo tính bằng SQL, không tải toàn bộ dữ liệu về trình duyệt.
- Không dùng Realtime ở giai đoạn đầu (thông báo đọc khi tải trang và định kỳ).
