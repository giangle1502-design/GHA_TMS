/** Dữ liệu phiếu giao hàng (hàm CSDL delivery_note / driver_link_delivery_note). Không có cước, không có nhà xe 3PL. */
export type DeliveryNoteItem = {
  line_no: number;
  item_code: string | null;
  item_name: string | null;
  unit: string | null;
  quantity: number | string | null;
  note: string | null;
};

export type DeliveryNoteData = {
  shipment_code: string;
  order_code: string | null;
  voucher_no: string | null;
  ref_no: string | null;
  note_date: string | null;
  company: { name: string | null; tax_code: string | null; address: string | null; phone: string | null } | null;
  shipper_name: string | null;
  pickup_name: string | null;
  pickup_address: string | null;
  pickup_phone: string | null;
  delivery_name: string | null;
  delivery_company: string | null;
  delivery_address: string | null;
  delivery_phone: string | null;
  plate_number: string | null;
  trailer_plate: string | null;
  container_no: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  quantity: number | string | null;
  items: DeliveryNoteItem[];
};

/** Thông tin công ty in trên phiếu khi Danh mục công ty còn trống (LE chốt 15/11/2026). */
export const GHA_COMPANY = {
  name: "CÔNG TY TNHH GHA LOGISTICS & SERVICE",
  tax_code: "3703489735",
  address: "Số nhà 67N2 KDC PTĐT Tân Bình, Tân Phước, Tân Đông Hiệp, TP. Hồ Chí Minh",
  phone: null as string | null,
};

export function noteCompany(d: DeliveryNoteData) {
  const c = d.company;
  return {
    name: c?.name?.trim() || GHA_COMPANY.name,
    tax_code: c?.tax_code?.trim() || GHA_COMPANY.tax_code,
    address: c?.address?.trim() || GHA_COMPANY.address,
    phone: c?.phone?.trim() || GHA_COMPANY.phone,
  };
}

/** "2026-11-15" -> "Ngày 15 tháng 11 năm 2026" */
export function noteDateText(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return "Ngày ...... tháng ...... năm 20......";
  return `Ngày ${m[3]} tháng ${m[2]} năm ${m[1]}`;
}

export function noteFileName(code: string) {
  return `Phieu-giao-hang-${code.replace(/[^A-Za-z0-9_-]+/g, "-")}.pdf`;
}
