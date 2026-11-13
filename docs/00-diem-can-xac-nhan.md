# Các điểm nghiệp vụ cần Khánh Hà xác nhận

Mỗi điểm dưới đây đã có **giá trị mặc định đang dùng** trong thiết kế để không chặn tiến độ. Khi có xác nhận, chỉ cần sửa cấu hình hoặc một migration nhỏ, không phải làm lại.

| # | Câu hỏi | Mặc định đang dùng | Ảnh hưởng |
|---|---------|--------------------|-----------|
| 1 | **Vercel Hobby không cho phép dùng thương mại.** Phần mềm nội bộ của doanh nghiệp được Vercel tính là thương mại. Chọn: Vercel Pro (20 USD/tháng/thành viên phát triển) hay Cloudflare Workers (gói miễn phí cho phép thương mại, cần thêm adapter OpenNext)? | Viết mã chạy được trên cả hai; tài liệu triển khai hướng dẫn Vercel | Chi phí hàng tháng, cách triển khai |
| 2 | **Supabase Free tạm dừng dự án sau 7 ngày ít hoạt động và không có bản sao lưu tải về được.** Có dùng Supabase Pro (25 USD/tháng) khi chạy thật không? | Free cho phát triển và chạy thử; khuyến nghị Pro khi có dữ liệu thật | Sao lưu, tính sẵn sàng |
| 3 | Tỷ lệ hỗ trợ dầu **39% tính trên cơ sở nào**: doanh thu cước, đơn giá chuyến hay tổng doanh thu (cước + phụ thu)? | 39% × doanh thu cước (đơn giá × số lượng) | Doanh thu, hỗ trợ dầu từng chuyến |
| 4 | Khoản hỗ trợ dầu là **khách hàng trả thêm cho công ty** hay **công ty trả cho tài xế**? | Khách hàng trả thêm (một khoản doanh thu), tách biệt với chi phí dầu thực tế | Cách ghi nhận doanh thu/chi phí |
| 5 | Cấp duyệt mặc định: cấp 1 Kế toán, cấp 2 Giám đốc khi **từ 5.000.000 đ**. Ngưỡng và người duyệt có đúng không? | Như bên trái, cho mọi hạng mục | Quy trình phê duyệt |
| 6 | Tài xế nhập chi phí **có cần duyệt từng khoản** hay chỉ duyệt khi quyết toán chuyến? | Mọi loại chi phí đều cần duyệt (có thể tắt theo từng loại) | Khối lượng duyệt của kế toán |
| 7 | Lương tài xế tính theo cách nào (theo chuyến, theo km, % doanh thu, công thức)? Có phụ cấp cố định không? | Hỗ trợ cả 5 cách; chưa chọn mặc định | Báo cáo chi phí tài xế (Giai đoạn 7) |
| 8 | Có bao nhiêu **pháp nhân / công ty xuất hóa đơn** (ví dụ GHA và Khánh Hà là một hay hai công ty)? | Hỗ trợ nhiều đơn vị nội bộ (`company_entities`) | Bảng giá, công nợ, báo cáo |
| 9 | ~~Khi tài xế từ chối chuyến…~~ **Đã xác nhận 21/10/2026: không có khái niệm từ chối chuyến.** | Đã bỏ trạng thái từ chối | Màn hình điều phối |
| 10 | Chứng từ bắt buộc để hoàn thành chuyến: ảnh giao hàng, phiếu giao hàng có ký nhận? | Bắt buộc ít nhất 1 ảnh giao hàng (cấu hình được) | Điều kiện hoàn thành chuyến |
| 11 | Chi phí quản lý phân bổ (văn phòng, lương gián tiếp) phân bổ theo tiêu chí nào: số chuyến, doanh thu hay km? | Chưa phân bổ; báo cáo lợi nhuận trước phân bổ | Báo cáo lợi nhuận sau phân bổ |
| 12 | Khấu hao và lãi vay có phân bổ vào **từng chuyến** không, hay chỉ tính theo xe/tháng? | Theo xe/tháng; phân bổ theo số chuyến của xe trong tháng khi báo cáo | Lợi nhuận từng chuyến |
| 13 | Danh mục tỉnh/thành: dùng danh mục hành chính sau sáp nhập 2025 hay danh mục cũ (địa chỉ trên hóa đơn của khách)? | Danh mục để trống, quản trị viên tự nhập; địa chỉ đầy đủ vẫn là văn bản tự do | Lọc báo cáo theo tỉnh |
| 14 | Số lượng người dùng dự kiến (văn phòng, tài xế) và số chuyến/tháng? | ~10 người văn phòng, ~30 tài xế, ~1.500 chuyến/tháng (giả định để ước tính chi phí) | Ước tính dung lượng, chi phí |
| 15 | Tài xế ứng tiền: có hạn mức ứng tối đa mỗi chuyến / mỗi tài xế không? | Chưa giới hạn; duyệt theo cấp | Kiểm soát tạm ứng |
| 16 | Chuyến "giao trễ" được xác định so với mốc nào: ngày giao dự kiến hay giờ giao dự kiến? | So với `expected_delivery_at` (ngày giờ) | Báo cáo giao trễ |
| 17 | Có cần xuất dữ liệu sang phần mềm kế toán đang dùng (MISA, Fast...) không? Định dạng nào? | Chỉ xuất Excel/CSV | Giai đoạn 7 |

**Không làm trong phạm vi hiện tại** (theo đặc tả, cần đồng ý riêng nếu muốn): SMS, GPS thời gian thực, bản đồ trả phí, chữ ký số, hóa đơn điện tử. Báo cáo nội bộ của hệ thống **không phải hóa đơn hợp pháp**.
