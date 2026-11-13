// Hằng dùng chung cho trang máy chủ và hộp thoại (không đặt trong tệp "use client":
// trang máy chủ import hằng từ tệp client sẽ nhận tham chiếu client, không phải mảng)

/** Trạng thái được "Hủy nhận xe" (tài xế đã nhận / đang chạy) */
export const UNACCEPT_STATUSES = ["accepted", "in_transit"];
/** Trạng thái được "Sửa xe, tài xế" trực tiếp (đã chạy / đã giao / đã đóng) */
export const CORRECT_CREW_STATUSES = ["in_transit", "driver_completed", "closed"];
