# 1. Tài liệu yêu cầu nghiệp vụ – KHÁNH HÀ TMS

Khách hàng: **Công ty Vận tải Khánh Hà**. Phạm vi: vận tải hàng hóa đường bộ bằng xe tải do công ty sở hữu/thuê, điều phối thủ công, tài xế dùng điện thoại.

## 1.1 Đối tượng sử dụng

| Vai trò | Nhu cầu chính |
|---|---|
| Super Admin / Admin | Cấp quyền, cấu hình danh mục, trường dữ liệu, quy trình |
| Giám đốc | Xem toàn bộ, duyệt khoản lớn, xem báo cáo lợi nhuận |
| Điều phối | Tạo đơn, tạo chuyến, phân công xe/tài xế, theo dõi chuyến |
| Quản lý vận hành | Quản lý xe, tài xế, bảo dưỡng; duyệt chi phí vận hành |
| Kế toán | Duyệt chi phí, ứng tiền, thanh toán, quyết toán, công nợ |
| Tài xế | Nhận chuyến, ứng tiền, nhập chi phí, hoàn thành chuyến |
| Người xem báo cáo | Chỉ xem dashboard và báo cáo |

## 1.2 Khái niệm cốt lõi

- **Đơn hàng (transport_order)**: một yêu cầu vận chuyển của khách hàng, có **bên thuê** (customer) và **bên thanh toán** (payer) có thể khác nhau. Một đơn hàng gồm một hoặc nhiều Shipment.
- **Shipment (chuyến)**: một lượt xe chạy từ nơi nhận đến nơi giao. Mã `SNOV-0001` (S + tháng tiếng Anh + số thứ tự trong tháng, cùng tháng năm sau đếm tiếp; đơn hàng là `ONOV-0001`) sinh tự động theo giờ Việt Nam, duy nhất, không đổi.
- **Địa điểm (location)**: danh mục dùng chung cho nơi nhận và nơi giao; chứa tên công ty giao/nhận hàng (bên giao hàng, bên nhận hàng).
- **Bảng giá**: đơn giá theo phạm vi (khách hàng, nơi nhận, nơi giao, loại xe, khoảng hiệu lực). Giá được **chụp lại vào Shipment** khi tạo chuyến.
- **Hỗ trợ dầu**: khoản tính theo tỷ lệ trên một cơ sở cấu hình được. **Không có % mặc định** (từ 0060): % tùy từng khách, khai báo ở Bảng giá (bảng giá hoặc Quy tắc hỗ trợ dầu theo khách) hoặc nhập tay khi tạo đơn. **Không phải chi phí dầu thực tế.**
- **Tạm ứng**: tiền công ty đưa trước cho tài xế. **Không phải chi phí.** Khi quyết toán, tạm ứng được đối trừ với chi phí đã duyệt.
- **Chi phí chuyến**: khoản chi thực tế gắn với Shipment, theo danh mục chi phí; chỉ được ghi nhận khi đã duyệt.
- **Phê duyệt**: module dùng chung cho mọi loại yêu cầu (ứng tiền, chi phí, thanh toán, điều chỉnh, quyết toán, sửa chữa, mua sắm...).

## 1.3 Quy tắc nghiệp vụ bắt buộc

1. Chỉ email Google đã được quản trị viên mời mới vào được hệ thống; tài khoản lạ ở trạng thái "chờ cấp quyền" và không thấy dữ liệu.
2. Tài xế chỉ thấy chuyến được phân công cho mình và dữ liệu liên quan.
3. Mỗi chuyến có tối đa **một phân công còn hiệu lực**; không thể có hai tài xế cùng nhận một chuyến.
4. Không có khái niệm tài xế từ chối chuyến (Khánh Hà xác nhận 21/10/2026). Muốn đổi tài xế thì điều phối phân công lại; phân công cũ được lưu với trạng thái "Đã thay thế".
5. Tìm bảng giá: chọn bảng giá **cụ thể nhất** (khách hàng > loại xe > nơi nhận/nơi giao), sau đó theo **độ ưu tiên**. Nếu vẫn hòa, người dùng phải chọn. Không có bảng giá phù hợp thì người dùng nhập tay và hệ thống ghi rõ "nhập tay".
6. Hai bảng giá cùng phạm vi, cùng ưu tiên không được chồng thời gian hiệu lực (ràng buộc CSDL).
7. Hỗ trợ dầu áp dụng theo thứ tự: giá trị riêng của chuyến → quy tắc khách hàng+tuyến / tuyến / khách hàng → quy tắc loại xe → mặc định hệ thống. Tham số và công thức được lưu vào `shipments.pricing_snapshot`.
8. Không xóa cứng chuyến đã qua bước nháp hoặc đã phát sinh tài chính; chỉ hủy kèm lý do.
9. Yêu cầu đã duyệt không sửa trực tiếp số tiền/nội dung; điều chỉnh bằng yêu cầu mới hoặc hủy duyệt có kiểm soát.
10. Một yêu cầu phê duyệt / một yêu cầu ứng chỉ được ghi nhận thanh toán một lần (ràng buộc CSDL).
11. Mặc định người tạo không tự duyệt yêu cầu của mình; ngoại lệ phải cấu hình bởi quản trị viên và có nhật ký.
12. Tài xế bấm "Hoàn thành" ≠ kế toán đã duyệt quyết toán. Chuyến sang `driver_completed`, sau đó kiểm tra chứng từ và quyết toán.
13. Lợi nhuận chuyến = Doanh thu được ghi nhận − Chi phí được ghi nhận. Báo cáo có lợi nhuận trước và sau phân bổ (khấu hao, lãi vay, chi phí quản lý).
14. Một khoản chi phí chỉ lưu ở **một bảng** (`shipment_expenses` hoặc `maintenance_records`), các màn hình chỉ tham chiếu, nên không cộng trùng.
15. Dư nợ vay xe chỉ tính từ lịch trả nợ đã nhập; không suy đoán.
16. Mọi thay đổi trên bảng nghiệp vụ được ghi nhật ký (trước/sau, người, thời gian); nhật ký không sửa/xóa được.
17. Không đánh dấu "đã gửi" khi dữ liệu chưa lưu lên máy chủ; mỗi lần gửi của tài xế mang `client_request_id` để chống gửi trùng.

## 1.4 Đối soát tài xế (theo chuyến hoặc theo kỳ)

| Chỉ tiêu | Công thức |
|---|---|
| Tổng tạm ứng đã chi (A) | Σ `advance_transactions` loại `disbursement` |
| Tổng chi phí tài xế được duyệt (B) | Σ `shipment_expenses` có `source = driver` và `status = approved` |
| Đã hoàn ứng / đã trả thêm (C) | Σ giao dịch `refund`, `settlement_offset`, thanh toán `driver_settlement` |
| Tài xế phải hoàn lại | max(A − B − C, 0) |
| Công ty phải trả thêm | max(B − A + C, 0) |

Quyết toán chỉ chuyển trạng thái khi đủ điều kiện cấu hình (ví dụ: chứng từ `verified`, không còn chi phí `pending`).

## 1.5 Yêu cầu phi chức năng

- Tiếng Việt, ngày `dd/MM/yyyy`, giờ 24h, tiền VND không có số lẻ, múi giờ Asia/Ho_Chi_Minh.
- Responsive: máy tính, máy tính bảng, điện thoại (ứng dụng tài xế mobile-first).
- Bảo mật: kiểm tra quyền ở máy chủ và CSDL (RLS); khóa bí mật chỉ ở máy chủ.
- Có trạng thái loading / empty / error cho mọi màn hình; trang lỗi thân thiện.
- Tính năng chưa hoàn thiện phải hiển thị rõ "Chưa triển khai – Giai đoạn N".
