// Dùng chung cho trang máy chủ và hộp thoại client (hằng đặt trong tệp "use client" thì trang máy chủ không đọc được)
export type CarrierKind = "freight" | "pass_through" | "other";
export const CARRIER_KIND_LABEL: Record<CarrierKind, string> = {
  freight: "Cước 3PL",
  pass_through: "Chi hộ 3PL",
  other: "Chi phí khác",
};
