# 4. Danh sách màn hình

Trạng thái: ✅ đã có (Giai đoạn 1–2) · 🕐 khung đã có, chức năng ở giai đoạn ghi trong ngoặc.

## 4.1 Chung

| Đường dẫn | Màn hình | Quyền | Trạng thái |
|---|---|---|---|
| `/dang-nhap` | Đăng nhập bằng Google | công khai | ✅ |
| `/auth/callback` | Xử lý đăng nhập | công khai | ✅ |
| `/cho-cap-quyen` | Tài khoản chờ cấp quyền / bị khóa | đã đăng nhập | ✅ |
| `/tai-khoan` | Hồ sơ cá nhân, vai trò và quyền hiệu lực | đã đăng nhập | ✅ |
| `/thong-bao` | Trung tâm thông báo | đã đăng nhập | ✅ |
| `error`, `not-found` | Trang lỗi thân thiện | – | ✅ |

## 4.2 Khu quản trị (sidebar trái + header)

| Menu | Đường dẫn | Quyền xem | Nội dung | Trạng thái |
|---|---|---|---|---|
| Tổng quan | `/tong-quan` | `dashboard.view` | Thẻ KPI, chuyến hôm nay, chờ duyệt, giấy tờ xe sắp hết hạn | 🕐 (GĐ 7); hiện số liệu thật cơ bản |
| Điều phối | `/dieu-phoi` | `dispatch.view` | Xem theo ngày, tab trạng thái, chuyến trễ; tạo đơn nhiều chuyến (`/dieu-phoi/tao-don`), tìm bảng giá, phân công, hủy; chi tiết đơn (`/dieu-phoi/don-hang/[id]`); nút "+" tạo nhanh địa điểm, khách hàng | ✅ (GĐ 4) |
| Quản lý chuyến xe | `/chuyen-xe` | `shipments.view` | Bảng dạng Excel mỗi dòng một Shipment, sửa nhanh, xuất Excel, chi tiết chuyến (`/chuyen-xe/[id]`) | ✅ (GĐ 4); cột chi phí/lợi nhuận GĐ 6 |
| Tài xế | `/tai-xe` | `drivers.view` | Danh sách, hồ sơ, dữ liệu nhạy cảm theo quyền, mời đăng nhập | 🕐 (GĐ 3) |
| Phương tiện | `/phuong-tien` | `vehicles.view` | Danh sách, khấu hao, vay, lịch trả nợ, bảo dưỡng | 🕐 (GĐ 3) |
| Khách hàng và địa điểm | `/khach-hang` | `customers.view` / `locations.view` | Tab Khách hàng, Địa điểm, Tuyến, Nhà cung cấp | 🕐 (GĐ 3) |
| Bảng giá | `/bang-gia` | `price_lists.view` | Bảng giá, quy tắc hỗ trợ dầu | 🕐 (GĐ 3) |
| Chi phí và quyết toán | `/chi-phi` | `expenses.view` / `settlements.view` | Chi phí chuyến, ứng tiền, đối soát tài xế | 🕐 (GĐ 6, 7) |
| Công nợ | `/cong-no` | `receivables.view` | Phải thu, phải trả, thanh toán từng phần, quá hạn | 🕐 (GĐ 7) |
| Phê duyệt | `/phe-duyet` | `approvals.view` | Hộp chờ duyệt của tôi, lịch sử, duyệt/từ chối/yêu cầu bổ sung | 🕐 (GĐ 6) |
| Báo cáo | `/bao-cao` | `reports.view` | 15 báo cáo, lọc, xuất Excel/CSV | 🕐 (GĐ 7) |
| Danh mục hệ thống | `/danh-muc` | `catalogs.view` | Danh mục chung, loại xe, chi phí, ngân hàng, phương thức thanh toán, hạng mục phê duyệt | 🕐 (GĐ 3) |
| Quản lý trường dữ liệu | `/truong-du-lieu` | `fields.view` | Thêm/sửa trường động, công thức, phân tích ảnh hưởng, lịch sử phiên bản | 🕐 (GĐ 3) |
| Quản lý biểu mẫu | `/bieu-mau` | `forms.view` | Bố cục biểu mẫu, phiên bản | 🕐 (GĐ 3) |
| Quản lý quy trình | `/quy-trinh` | `workflows.view` | Cấp duyệt, hạn mức, người nhận thông báo | 🕐 (GĐ 6) |
| Người dùng và phân quyền | `/nguoi-dung` | `users.view` | Mời email, gán vai trò, khóa/mở tài khoản, quyền riêng, ma trận vai trò | ✅ |
| Nhật ký hệ thống | `/nhat-ky` | `audit_logs.view` | Tra cứu nhật ký, xem trước/sau | ✅ |
| Cấu hình | `/cau-hinh` | `settings.view` | Tham số hệ thống | ✅ (xem/sửa) |

## 4.3 Ứng dụng tài xế (mobile-first, thẻ lớn)

| Đường dẫn | Màn hình | Trạng thái |
|---|---|---|
| `/tx` | Trang chính: các thẻ Chuyến được phân công, Ứng tiền, Nhập chi phí, Hoàn thành chuyến | ✅ khung + danh sách chuyến thật (chỉ xem) |
| `/tx/chuyen/[id]` | Chi tiết chuyến, Nhận chuyến (không có từ chối), link Google Maps, gọi điện | 🕐 (GĐ 5) |
| `/tx/ung-tien` | Gửi yêu cầu ứng, theo dõi trạng thái | 🕐 (GĐ 6) |
| `/tx/chi-phi` | Nhập nhiều khoản chi phí kèm ảnh hóa đơn | 🕐 (GĐ 6) |
| `/tx/hoan-thanh/[id]` | Nhập mốc thời gian, km, ảnh giao hàng, hoàn thành | 🕐 (GĐ 5) |

## 4.4 Thành phần dùng chung

- **DataTable** (TanStack Table): kéo thả cột, đổi độ rộng, chiều cao dòng, ẩn/hiện, ghim cột, sắp xếp, lọc nhiều điều kiện, phân trang máy chủ, chọn nhiều dòng, thao tác hàng loạt theo quyền, xuất/nhập Excel-CSV, lưu cấu hình vào `table_view_preferences` (GĐ 3).
- **Combobox có nút "+"**: tìm kiếm, chọn nhanh, mở hộp thoại tạo mới khi có quyền `*.create` (GĐ 3).
- **DynamicForm**: dựng biểu mẫu từ `field_definitions` + React Hook Form + Zod sinh động (GĐ 3).
- **Tệp đính kèm**: tải lên qua server action, xem bằng signed URL (GĐ 3).
- **Trạng thái**: loading (skeleton), empty, error cho mọi danh sách.
