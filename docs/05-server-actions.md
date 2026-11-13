# 5. Danh sách API / Server Actions / hàm CSDL

Quy ước: mọi server action (1) lấy người dùng từ phiên, (2) gọi `requirePermission()`, (3) kiểm tra dữ liệu bằng Zod, (4) ghi qua Supabase client mang JWT người dùng (RLS áp dụng), (5) trả về `{ ok: true, data } | { ok: false, error }` bằng tiếng Việt, không ném lỗi thô ra giao diện. Hàm CSDL `security definer` tự kiểm tra quyền bên trong bằng `private.has_perm()`.

## 5.1 Đã triển khai (Giai đoạn 1–2)

| Tên | Loại | Quyền | Mô tả |
|---|---|---|---|
| `signInWithGoogle` | server action | công khai | Bắt đầu OAuth Google, chuyển về `/auth/callback` |
| `GET /auth/callback` | route handler | công khai | Đổi `code` lấy phiên, chuyển hướng theo trạng thái hồ sơ |
| `signOut` | server action | đăng nhập | Đăng xuất |
| `updateMyProfile` | server action | đăng nhập | Sửa họ tên, số điện thoại của chính mình |
| `inviteUser` | server action → RPC `invite_user` | `users.create` | Mời email + vai trò (+ gắn hồ sơ tài xế); kích hoạt ngay nếu đã đăng nhập trước |
| `revokeInvitation` | server action | `users.update` | Thu hồi lời mời chưa dùng |
| `setUserStatus` | server action | `users.update` | Khóa / mở khóa tài khoản (không tự khóa mình, không khóa Super Admin) |
| `setUserRoles` | server action | `users.configure` | Gán/thu hồi vai trò (trigger chặn tự sửa, chặn cấp Super Admin) |
| `setPermissionOverride` | server action | `users.configure` | Cấp riêng / chặn riêng một quyền cho một người |
| `toggleRolePermission` | server action | `users.configure` | Bật/tắt quyền của vai trò trong ma trận |
| `markNotificationRead` / `markAllNotificationsRead` | server action | đăng nhập | Đánh dấu đã đọc |
| `updateSystemSetting` | server action | `settings.configure` | Sửa tham số hệ thống (JSON hợp lệ) |
| `my_permissions()` | RPC | đăng nhập | Danh sách quyền hiệu lực của người gọi |
| `find_price_lists(...)` | RPC | `price_lists.view` (RLS) | Ứng viên bảng giá theo độ cụ thể + ưu tiên |
| `dashboard_shipment_stats(p_today)` | RPC (security invoker) | đăng nhập, dữ liệu theo RLS | Số liệu biểu đồ Tổng quan: theo ngày (14 ngày), theo tháng (6 tháng), theo trạng thái, top khách hàng, so với kỳ trước |

## 5.1b Đã triển khai (Giai đoạn 3)

Danh mục dùng chung một bộ action theo định nghĩa thực thể (`src/lib/entities/definitions.ts`), quyền lấy từ `perm` của từng thực thể (`vehicles.*`, `drivers.*`, `customers.*`, `locations.*`, `price_lists.*`, `catalogs.*`…). Thông tin nhạy cảm cần thêm `*.view_sensitive`. Dữ liệu được kiểm tra bằng cùng hàm `validateRecord` ở giao diện và máy chủ.

| Tên | Loại | Quyền | Mô tả |
|---|---|---|---|
| `saveRecord(entity, {id, parentId, values, expectedUpdatedAt, quick})` | server action | `*.create` / `*.update` | Thêm/sửa; khóa lạc quan theo `updated_at`; gộp `custom_fields` chỉ với trường được phép sửa; `quick` cho nút "+" |
| `deleteRecord(entity, id)` | server action | `*.delete` | Bản ghi đang được dùng (khóa ngoại) báo gợi ý ngừng sử dụng |
| `searchReferences(ref, q, ids)` | server action | `*.view` của bảng đích | Tìm cho ô chọn liên kết (30 kết quả, chỉ bản ghi đang dùng) |
| `getEntityMeta(entity)` | server action | đăng nhập | Trường động + quyền thao tác, dùng cho form tạo nhanh |
| `saveTableView` / `resetTableView` | server action → RPC `save_table_view` | đăng nhập | Lưu cấu hình bảng của chính mình |
| `exportRecords(entity, params, columns)` | server action | `*.export` (hoặc `*.view`) | Excel theo bộ lọc, tối đa 5.000 dòng |
| `importTemplate(entity)` | server action | `*.create` | File mẫu kèm sheet hướng dẫn |
| `importPreview(entity, file)` / `importCommit(entity, rows)` | server action | `*.create` | Xlsx/CSV ≤ 2 MB, ≤ 2.000 dòng; báo lỗi từng dòng; ghi trong một lệnh insert |
| `lookupPrice(params)` | server action → RPC `find_price_lists` | `price_lists.view` | Tra cứu giá, báo khi có nhiều bảng giá ngang hàng |
| `saveField`, `setFieldStatus`, `deleteField` | server action → RPC `save_field_definition` | `fields.configure` | Tạo/sửa trường động kèm ghi chú thay đổi; kiểm tra công thức trước khi lưu |
| `getFieldImpact` | server action → RPC `field_impact` | `fields.view` | Số bản ghi có dữ liệu, công thức và điều kiện hiển thị đang dùng trường |
| `listFieldVersions`, `restoreFieldVersion` | server action → RPC `restore_field_version` | `fields.configure` | Khôi phục tạo phiên bản mới với nội dung cũ |
| Trigger `fill_master_code`, `guard_field_definitions`, `snapshot_field_definition` | CSDL | – | Mã tự sinh; chặn xóa/đổi kiểu trường có dữ liệu; lưu phiên bản |

## 5.2 Kế hoạch các giai đoạn sau

| Giai đoạn | Tên | Quyền | Ghi chú |
|---|---|---|---|
| 5 | `uploadDocument`, `getDocumentUrl` (signed URL 5 phút), `archiveDocument` | `documents.*` | Dời từ GĐ3 |
| 4 | RPC `create_order_with_shipments(order, shipments[])` | `dispatch.create` | Một transaction; tính giá + hỗ trợ dầu, chụp snapshot |
| 4 | `updateShipment(id, version, patch)` | `shipments.update` | Khóa lạc quan theo `version` |
| 4 | RPC `assign_shipment(shipment_id, driver_id, vehicle_id)` | `dispatch.update` | Thay phân công cũ bằng `superseded`, thông báo tài xế |
| 4 | RPC `cancel_shipment(id, reason)` | `shipments.delete` | Hủy có lý do |
| 4 | RPC `resolve_fuel_support(shipment params)` | nội bộ | Theo thứ tự ưu tiên trong tài liệu 1 |
| 5 | RPC `driver_list_my_shipments()` | `driver_app.use` | Trả về địa điểm, SĐT liên hệ, link Maps của chuyến được phân công |
| 5 | RPC `driver_respond_assignment(assignment_id, accept, reason)` | `driver_app.use` | Chỉ phân công của chính mình; khóa dòng; thông báo điều phối |
| 5 | RPC `driver_update_progress(shipment_id, milestones)` / `driver_complete_shipment(...)` | `driver_app.use` | Kiểm tra bắt buộc trước khi chuyển `driver_completed` |
| 6 | RPC `submit_advance_request(client_request_id, ...)` | `driver_app.use` / `advances.create` | Tạo yêu cầu + approval_request trong một transaction |
| 6 | RPC `submit_shipment_expenses(client_request_id, items[])` | theo `expense_categories.allowed_role_codes` | Kiểm tra chứng từ bắt buộc |
| 6 | RPC `approval_act(request_id, action, comment, expected_version)` | theo `approval_rules` | Duyệt/từ chối/yêu cầu bổ sung; chặn tự duyệt |
| 6 | RPC `approval_revoke(request_id, reason)` | `approvals.configure` | Hủy duyệt có kiểm soát |
| 6–7 | RPC `record_payment(idempotency_key, ...)` | `*.pay` | Chống ghi nhận trùng |
| 7 | RPC `settle_shipment(shipment_id)` / `driver_reconciliation(driver_id, period)` | `settlements.*` | |
| 7 | RPC `report_*` (15 báo cáo) | `reports.view` | Tính trực tiếp từ bảng nguồn, không lưu số liệu tổng hợp trùng |
