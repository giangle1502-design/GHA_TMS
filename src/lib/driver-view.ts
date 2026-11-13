/** Chọn chuyến hiện trên ứng dụng tài xế: mỗi lúc chỉ MỘT chuyến */
export type DriverViewTrip = { shipment_id: string; status: string; completed_at: string | null };

const ACTIVE = ["assigned", "accepted", "in_transit"];

/**
 * trips đã xếp sẵn theo ngày nhận rồi "Thứ tự xe" (driver_link_trips).
 * - Chuyến đang chạy / đã nhận được ưu tiên, không thì chuyến chờ nhận đứng đầu.
 * - doneId: chuyến vừa hoàn thành → hiện chuyến đó kèm nút "Tìm chuyến khác".
 */
export function pickDriverView<T extends DriverViewTrip>(trips: T[], doneId?: string | null) {
  const active = trips.filter((t) => ACTIVE.includes(t.status));
  const current = active.find((t) => t.status === "in_transit") ?? active.find((t) => t.status === "accepted") ?? active[0] ?? null;
  const justDone = doneId ? (trips.find((t) => t.shipment_id === doneId && t.completed_at) ?? null) : null;
  const shown = justDone ?? current;
  return {
    shown,
    justDone,
    current,
    /** Số chuyến đã được sắp sau chuyến hiện tại (tài xế chưa thấy) */
    after: active.filter((t) => t.shipment_id !== current?.shipment_id).length,
    recentDone: trips.filter((t) => t.completed_at && t.shipment_id !== shown?.shipment_id),
  };
}
