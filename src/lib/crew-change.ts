// Hằng dùng chung cho trang máy chủ và hộp thoại (không đặt trong tệp "use client":
// trang máy chủ import hằng từ tệp client sẽ nhận tham chiếu client, không phải mảng)

/** Trạng thái được "Hủy nhận xe" (tài xế đã nhận / đang chạy) */
export const UNACCEPT_STATUSES = ["accepted", "in_transit"];
/** Trạng thái được "Sửa xe, tài xế" trực tiếp (đã chạy / đã giao / đã đóng) */
export const CORRECT_CREW_STATUSES = ["in_transit", "driver_completed", "closed"];
/** Trạng thái được "Hủy nhận chuyến" (tài xế / nhà xe đã nhận mà không đi). Nháp chỉ khi đã gắn xe hoặc tài xế
 *  (chỉ mới chọn nhà xe, chưa có xe: đổi nhà xe bằng nút Phân công / Đổi) */
export const RELEASE_STATUSES = ["assigned", "accepted", "in_transit"];
export function canReleaseShipment(s: { status: string; driver_id: string | null; vehicle_id: string | null }) {
  return RELEASE_STATUSES.includes(s.status) || (s.status === "draft" && Boolean(s.driver_id || s.vehicle_id));
}
