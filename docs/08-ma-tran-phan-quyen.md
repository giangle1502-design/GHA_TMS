# 8. Ma trận phân quyền

Bảng sinh trực tiếp từ dữ liệu tham chiếu trong `supabase/migrations/20261016000002_rbac.sql`. **Super Admin có toàn quyền** (không cần gán). Quản trị viên sửa ma trận tại màn hình *Người dùng và phân quyền* (trừ vai trò Admin/Super Admin, chỉ Super Admin sửa được).

Ký hiệu: X = Xem · T = Tạo · S = Sửa · H = Xóa/Hủy · D = Duyệt · TT = Thanh toán · XK = Xuất dữ liệu · CH = Cấu hình · NC = Xem trường nhạy cảm · SD = Sử dụng

| Module | Admin | Giám đốc | Điều phối | Kế toán | QL vận hành | Tài xế | Chỉ xem báo cáo |
|---|---|---|---|---|---|---|---|
| Tổng quan (`dashboard`) | X | X | X | X | X | – | X |
| Điều phối (`dispatch`) | X T S H | X | X T S H | – | X T S H | – | – |
| Chuyến xe (`shipments`) | X T S H XK | X XK | X T S H XK | X S XK | X T S H XK | – | – |
| Tài xế (`drivers`) | X T S H XK NC | X XK NC | X | X NC | X T S XK | – | – |
| Phương tiện (`vehicles`) | X T S H XK NC | X XK NC | X | X NC | X T S XK | – | – |
| Khách hàng, nhà cung cấp (`customers`) | X T S H XK | X XK | X T S | X T S XK | X | – | – |
| Địa điểm, tuyến (`locations`) | X T S H XK | X XK | X T S | X | X T S | – | – |
| Bảng giá, hỗ trợ dầu (`price_lists`) | X T S H XK | X XK | X | X T S H XK | X | – | – |
| Chi phí chuyến (`expenses`) | X T S H D XK | X D XK | X T | X T S H D XK | X T D | – | – |
| Ứng tiền (`advances`) | X T S H D TT XK | X D XK | X | X T S D TT XK | X D | – | – |
| Quyết toán (`settlements`) | X S D XK | X D XK | – | X S D XK | – | – | – |
| Công nợ (`receivables`) | X T S H TT XK | X XK | – | X T S H TT XK | – | – | – |
| Thanh toán (`payments`) | X T H XK | X XK | – | X T H XK | – | – | – |
| Phê duyệt (`approvals`) | X D CH | X D | X | X D | X D | – | – |
| Báo cáo (`reports`) | X XK | X XK | X | X XK | X XK | – | X XK |
| Danh mục hệ thống (`catalogs`) | X T S H | X | X | X T S | X | – | – |
| Trường dữ liệu (`fields`) | X CH | X | – | – | – | – | – |
| Biểu mẫu (`forms`) | X CH | X | – | – | – | – | – |
| Quy trình (`workflows`) | X CH | X | – | – | – | – | – |
| Người dùng và phân quyền (`users`) | X T S CH | X | – | – | – | – | – |
| Nhật ký hệ thống (`audit_logs`) | X XK | X XK | – | – | – | – | – |
| Cấu hình (`settings`) | X CH | X | – | – | – | – | – |
| Chứng từ (`documents`) | X T H NC | X NC | X T | X T NC | X T | T | – |
| Ứng dụng tài xế (`driver_app`) | – | – | – | – | – | SD | – |

## 8.1 Phạm vi dữ liệu (RLS) ngoài quyền module

| Đối tượng | Quy tắc |
|---|---|
| Tài xế | Chỉ thấy `shipments` và `shipment_assignments` có `driver_id` là mình; hồ sơ `drivers` của mình; CCCD và tài khoản ngân hàng của mình; yêu cầu ứng/chi phí do mình tạo; chứng từ không nhạy cảm của chuyến mình. Không đọc danh mục khách hàng, xe, giá. Thông tin địa điểm của chuyến lấy qua hàm `driver_list_my_shipments()` (GĐ 5). |
| Tài xế ghi dữ liệu | Không ghi trực tiếp vào bảng; chỉ qua hàm nghiệp vụ (nhận chuyến, hoàn thành, ứng tiền, chi phí) kiểm tra đúng chuyến của mình. |
| Tài khoản chờ duyệt / bị khóa | Không có quyền nào; chỉ thấy hồ sơ của chính mình. |
| Khách ẩn danh | Bị thu hồi mọi quyền trên bảng `public`. |
| Dữ liệu nhạy cảm | `driver_sensitive`, tài khoản ngân hàng tài xế: `drivers.view_sensitive`. `vehicle_financials`, `loan_schedules`: `vehicles.view_sensitive`. Chứng từ `is_sensitive`: `documents.view_sensitive`. |
| Nhật ký | Chỉ đọc với `audit_logs.view`; không ai sửa/xóa (trigger chặn cả chủ CSDL). |
| Thông báo | Chỉ người nhận đọc và đánh dấu đã đọc. |
| Cấu hình bảng | Cấu hình cá nhân: chỉ chủ sở hữu. Cấu hình hệ thống/vai trò: `settings.configure`. |

## 8.2 Chống leo thang đặc quyền (đã kiểm thử)

- Không ai tự thêm/bớt vai trò, quyền riêng, hay đổi trạng thái tài khoản của chính mình.
- Chỉ Super Admin cấp/thu hồi vai trò Super Admin, đổi trạng thái hoặc vai trò của Super Admin, và sửa quyền của vai trò Admin.
- Quyền chặn riêng (`deny`) thắng quyền theo vai trò.
- Kiểm tra quyền ở ba lớp: giao diện, server action (`requirePermission`), RLS.
