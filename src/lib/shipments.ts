import type { AdvField } from "@/lib/advanced-filter";
import { DOCUMENT_STATUS, PRICING_UNITS, SETTLEMENT_STATUS, SHIPMENT_STATUS, TRIP_APPROVAL_STATUS } from "@/lib/status";

/** Một dòng của view public.shipment_list */
export type ShipmentListRow = {
  id: string;
  shipment_code: string;
  order_id: string;
  order_code: string;
  sequence_in_order: number;
  customer_id: string;
  customer_name: string | null;
  customer_code: string | null;
  pickup_at: string;
  expected_delivery_at: string | null;
  pickup_location_id: string;
  pickup_name: string | null;
  delivery_location_id: string;
  delivery_name: string | null;
  vehicle_type_id: string | null;
  vehicle_type_name: string | null;
  vehicle_id: string | null;
  plate_number: string | null;
  driver_id: string | null;
  driver_name: string | null;
  driver_code: string | null;
  price_list_id: string | null;
  unit_price: number;
  pricing_unit: string;
  quantity: number;
  freight_amount: number;
  surcharge_amount: number;
  fuel_support_rate: number | null;
  fuel_support_base: string | null;
  fuel_support_amount: number;
  total_revenue: number;
  extra_fee_amount: number;
  pass_through_amount: number;
  amount_due: number;
  status: string;
  document_status: string;
  settlement_status: string;
  notes: string | null;
  version: number;
  custom_fields?: Record<string, unknown> | null;
  /** Thứ tự chuyến của xe trong ngày (1, 2...) khi xe chạy nhiều chuyến cùng ngày */
  vehicle_day_order?: number | null;
  /** Số ngày giao điều phối nhập (trống = 1 ngày hoặc theo ngày giao dự kiến); work_days = số ngày công tính được */
  delivery_days?: number | null;
  work_days?: number | null;
  /** Lương chuyến tài xế (0073): số tiền, giá lấy từ đâu, sửa tay */
  driver_pay?: number | null;
  driver_pay_source?: string | null;
  driver_pay_override?: number | null;
  driver_pay_note?: string | null;
  can_override_pay?: boolean;
  order_custom_fields?: Record<string, unknown> | null;
  /** Giám đốc duyệt chuyến: not_required | pending | approved | rejected */
  dispatch_approval?: string;
  dispatch_approval_request_id?: string | null;
  dispatch_reject_reason?: string | null;
  /** Người đang xem duyệt được chuyến này */
  can_approve_dispatch?: boolean;
  /** Tổng theo nhóm phí (Phí vận chuyển = cước + phụ phí + hỗ trợ dầu + phụ thu nhóm vận chuyển) */
  transport_fee?: number;
  pass_through_fee?: number;
  declaration_fee?: number;
  loading_fee?: number;
  other_fee?: number;
  /** Lập kế hoạch (0045): tuyến đường "Điểm nhận → Điểm giao", thứ tự chuyến, hạ rỗng, kế hoạch gốc, SĐT */
  route_label?: string | null;
  trip_order?: number | null;
  empty_return_location_id?: string | null;
  empty_return_name?: string | null;
  offroute_return_location_id?: string | null;
  offroute_return_name?: string | null;
  plan_id?: string | null;
  plan_code?: string | null;
  pickup_phone?: string | null;
  delivery_phone?: string | null;
  /** Lời/lỗ (view shipment_profit, ghép ở trang khi người xem có quyền chi phí/báo cáo) */
  trip_cost?: number | null;
  vehicle_cost?: number | null;
  profit?: number | null;
};

/** Chuyến đang trễ: quá giờ giao dự kiến mà chưa giao xong */
export function isLate(r: Pick<ShipmentListRow, "status" | "expected_delivery_at">, now = Date.now()): boolean {
  return Boolean(r.expected_delivery_at) && ["assigned", "accepted", "in_transit"].includes(r.status) && Date.parse(r.expected_delivery_at!) < now;
}

const opts = (list: { value: string; label: string }[]) => list.map(({ value, label }) => ({ value, label }));

/** Các trường dùng được trong tìm kiếm nâng cao của bảng chuyến (cột của view shipment_list) */
export const SHIPMENT_ADV_FIELDS: AdvField[] = [
  { key: "shipment_code", label: "Mã chuyến", kind: "text" },
  { key: "order_code", label: "Mã đơn hàng", kind: "text" },
  { key: "customer_id", label: "Khách hàng", kind: "reference", ref: "customers" },
  { key: "pickup_at", label: "Ngày nhận hàng", kind: "date" },
  { key: "expected_delivery_at", label: "Ngày giao dự kiến", kind: "date" },
  { key: "pickup_location_id", label: "Điểm nhận", kind: "reference", ref: "locations" },
  { key: "delivery_location_id", label: "Điểm giao", kind: "reference", ref: "locations" },
  { key: "route_label", label: "Tuyến đường", kind: "text" },
  { key: "empty_return_location_id", label: "Điểm hạ rỗng", kind: "reference", ref: "locations" },
  { key: "offroute_return_location_id", label: "Điểm hạ rỗng trái tuyến", kind: "reference", ref: "locations" },
  { key: "trip_order", label: "Thứ tự chuyến", kind: "number" },
  { key: "plan_code", label: "Mã kế hoạch", kind: "text" },
  { key: "vehicle_type_id", label: "Loại xe", kind: "reference", ref: "vehicle_types" },
  { key: "vehicle_id", label: "Xe", kind: "reference", ref: "vehicles" },
  { key: "plate_number", label: "Biển số", kind: "text" },
  { key: "driver_id", label: "Tài xế", kind: "reference", ref: "drivers" },
  { key: "quantity", label: "Số lượng", kind: "number" },
  { key: "pricing_unit", label: "Đơn vị tính", kind: "select", options: Object.entries(PRICING_UNITS).map(([value, label]) => ({ value, label })) },
  { key: "unit_price", label: "Đơn giá", kind: "number" },
  { key: "freight_amount", label: "Cước", kind: "number" },
  { key: "surcharge_amount", label: "Phụ phí", kind: "number" },
  { key: "fuel_support_rate", label: "% hỗ trợ dầu", kind: "number" },
  { key: "fuel_support_amount", label: "Hỗ trợ dầu", kind: "number" },
  { key: "extra_fee_amount", label: "Phí khác (tính doanh thu)", kind: "number" },
  { key: "transport_fee", label: "Phí vận chuyển", kind: "number" },
  { key: "pass_through_fee", label: "Phí chi hộ", kind: "number" },
  { key: "declaration_fee", label: "Phí tờ khai", kind: "number" },
  { key: "loading_fee", label: "Phí bốc xếp", kind: "number" },
  { key: "total_revenue", label: "Doanh thu", kind: "number" },
  { key: "pass_through_amount", label: "Chi hộ", kind: "number" },
  { key: "amount_due", label: "Khách phải trả", kind: "number" },
  { key: "status", label: "Trạng thái", kind: "select", options: opts(SHIPMENT_STATUS) },
  { key: "dispatch_approval", label: "Giám đốc duyệt", kind: "select", options: opts(TRIP_APPROVAL_STATUS) },
  { key: "document_status", label: "Chứng từ", kind: "select", options: opts(DOCUMENT_STATUS) },
  { key: "settlement_status", label: "Quyết toán", kind: "select", options: opts(SETTLEMENT_STATUS) },
  { key: "notes", label: "Ghi chú", kind: "text" },
];

/** Trường bổ sung của chuyến dùng trong tìm kiếm nâng cao: khóa cf_<mã trường> */
export function shipmentCustomAdvFields(advFromDefs: AdvField[]): AdvField[] {
  return advFromDefs.map((f) => ({ ...f, key: `cf_${f.key}`, label: `${f.label} (bổ sung)` }));
}

/** Cột ngày giờ (so sánh theo ngày lịch Việt Nam) */
export const SHIPMENT_DATETIME_FIELDS = new Set(["pickup_at", "expected_delivery_at"]);

/** Dòng đã phân công (có tài xế hoặc xe, chưa hủy): tô tím nhạt trên Điều phối và Quản lý chuyến.
 * Màu nền đặc (không trong suốt) để cột cố định khi cuộn ngang không bị lộ chữ bên dưới. */
export function isAssignedRow(r: Pick<ShipmentListRow, "driver_id" | "vehicle_id" | "status">): boolean {
  return r.status !== "cancelled" && Boolean(r.driver_id || r.vehicle_id);
}
export const ASSIGNED_ROW_CELL = "bg-violet-100 group-hover:bg-violet-200 dark:bg-violet-950 dark:group-hover:bg-violet-900";

/** Nhận ra trường bổ sung "Điểm hạ hàng" (hạ cont hàng) theo tên trường: hiện thêm dòng "Hạ hàng: ..." trong ô Tuyến đường */
export const DROP_OFF_RE = /h[aạ]\s*(cont\s*)?h[aà]ng/i;
