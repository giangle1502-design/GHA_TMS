# 9. Kế hoạch triển khai theo giai đoạn

Nguyên tắc: không chuyển giai đoạn khi chức năng cốt lõi của giai đoạn hiện tại chưa được kiểm thử. Mỗi giai đoạn kết thúc bằng: migration + mã + kiểm thử tự động + cập nhật `docs/trang-thai-tinh-nang.md`.

| GĐ | Nội dung | Kết quả nghiệm thu | Trạng thái |
|---|---|---|---|
| 1 | Phân tích nghiệp vụ, kiến trúc, thiết kế CSDL | 10 tài liệu + danh sách điểm cần xác nhận; 10 migration (54 bảng, RLS mọi bảng); 68 kiểm thử bảo mật CSDL đạt | ✅ Xong |
| 2 | Khởi tạo dự án, giao diện, xác thực, phân quyền | Đăng nhập Google; chỉ email được mời mới vào; layout sidebar/header/thông báo; menu theo quyền; quản lý người dùng, vai trò, ma trận quyền, quyền riêng; nhật ký; cấu hình; ứng dụng tài xế (khung); build + lint + 20 kiểm thử đơn vị + 26 kiểm thử giao diện E2E đạt | ✅ Xong (chờ chạy thử trên Supabase thật) |
| 3 | Danh mục và trường dữ liệu động | CRUD xe/tài xế/khách hàng/địa điểm/tuyến/bảng giá/chi phí/ngân hàng; DataTable cấu hình được và lưu theo người dùng; nút "+"; trường động 19 kiểu + bộ phân tích công thức an toàn + phân tích ảnh hưởng + phiên bản; nhập/xuất Excel-CSV. Tải chứng từ dời sang GĐ5 (cùng ảnh hoàn thành chuyến). Nghiệm thu: 97 kiểm thử CSDL, 36 kiểm thử đơn vị, 26 + 54 kiểm thử giao diện E2E đạt. Ngày 21/10/2026 làm lại giao diện theo mẫu người dùng chọn (Tổng quan có biểu đồ) | ✅ Xong (18/10/2026) |
| 4 | Điều phối và Shipment | Tạo đơn nhiều chuyến trong một transaction; tìm bảng giá; tính hỗ trợ dầu theo ưu tiên + snapshot; phân công; bảng tổng hợp dạng Excel; chi tiết chuyến + lịch sử; khóa lạc quan. Bỏ trạng thái "tài xế từ chối" theo yêu cầu. Nghiệm thu: 146 kiểm thử CSDL, 36 kiểm thử đơn vị, 26 + 64 + 42 kiểm thử giao diện E2E | ✅ Xong (21/10/2026) |
| 5 | Ứng dụng tài xế, chứng từ | Tải chứng từ/ảnh (signed URL); nhận chuyến, thông báo điều phối, cập nhật tiến độ, hoàn thành chuyến kèm ảnh; không báo "đã gửi" khi chưa lưu máy chủ | |
| 6 | Ứng tiền, chi phí, phê duyệt | Gửi ứng/chi phí; duyệt nhiều cấp theo hạn mức; chặn tự duyệt; yêu cầu bổ sung; hủy duyệt có kiểm soát; thông báo | |
| 7 | Quyết toán, công nợ, báo cáo | Đối soát tài xế; quyết toán chuyến; phải thu/phải trả, thanh toán nhiều lần; 15 báo cáo khớp dữ liệu nguồn; dashboard đầy đủ | |
| 8 | Bảo mật, kiểm thử, triển khai | Rà soát RLS, kiểm thử E2E (Playwright), kiểm thử tải nhẹ, sao lưu/khôi phục thử, triển khai production, hướng dẫn vận hành | |

## 9.1 Việc cần người dùng làm để chạy thật Giai đoạn 1–2

1. Tạo tài khoản email mới làm chủ sở hữu (đang thực hiện), dùng email đó tạo: GitHub, Supabase, Vercel (hoặc Cloudflare), Google Cloud (OAuth).
2. Tạo repo GitHub trống, Claude đẩy mã lên.
3. Tạo dự án Supabase (region Singapore), chạy migration, bật Google provider.
4. Tạo OAuth Client trong Google Cloud Console, dán Client ID/Secret vào Supabase.
5. Mời email Super Admin đầu tiên bằng một câu SQL (hướng dẫn trong `README.md`).
6. Kết nối repo với Vercel, khai báo biến môi trường, triển khai.

## 9.2 Rủi ro và cách giảm

| Rủi ro | Giảm thiểu |
|---|---|
| Gói miễn phí không đủ hoặc không hợp lệ cho thương mại | Tài liệu 10; thiết kế không phụ thuộc chặt nhà cung cấp |
| Yêu cầu cấu hình động quá rộng làm chậm tiến độ | Giai đoạn 3 làm trường động trên `custom_fields` cho các module chính trước, mở rộng dần |
| Tài xế mạng yếu | Gửi có `client_request_id`, chỉ báo thành công khi máy chủ xác nhận; ảnh nén phía trình duyệt trước khi tải |
| Sai lệch số liệu báo cáo | Mỗi khoản tiền chỉ ở một bảng nguồn; báo cáo tính từ nguồn; kiểm thử đối chiếu tổng |
