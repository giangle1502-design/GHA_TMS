import { formatDate, formatNumber } from "@/lib/format";

/** Một dòng của mẫu "Thông tin tài xế": tên dòng hiện cho khách + trường lấy dữ liệu */
export type ShareLine = { label: string; source: string };

export type ShareSource = {
  key: string;
  label: string;
  type?: string;
  options?: ({ value: string; label: string } | string)[];
};

export type DriverShareRow = {
  shipment_id: string;
  shipment_code: string;
  driver_id: string | null;
  data: (Record<string, unknown> & { cf?: Record<string, unknown>; vcf?: Record<string, unknown> }) | null;
};

export const DEFAULT_SHARE_TEMPLATE: ShareLine[] = [
  { label: "Tên", source: "full_name" },
  { label: "Số xe", source: "plate_number" },
  { label: "Số CCCD", source: "national_id" },
  { label: "Số GPLX", source: "license_no" },
];

/** Trường có sẵn chọn được cho mẫu */
export const SHARE_BUILTIN_SOURCES: ShareSource[] = [
  { key: "full_name", label: "Họ tên tài xế" },
  { key: "driver_code", label: "Mã tài xế" },
  { key: "phone", label: "Số điện thoại tài xế" },
  { key: "email", label: "Email tài xế" },
  { key: "date_of_birth", label: "Ngày sinh", type: "date" },
  { key: "address", label: "Địa chỉ tài xế" },
  { key: "national_id", label: "Số CCCD" },
  { key: "national_id_issued_date", label: "Ngày cấp CCCD", type: "date" },
  { key: "national_id_issued_place", label: "Nơi cấp CCCD" },
  { key: "license_no", label: "Số GPLX" },
  { key: "license_class", label: "Hạng GPLX" },
  { key: "license_expiry", label: "Ngày hết hạn GPLX", type: "date" },
  { key: "plate_number", label: "Biển số xe" },
  { key: "vehicle_type", label: "Loại xe" },
  { key: "vehicle_brand", label: "Hiệu xe" },
  { key: "shipment_code", label: "Mã chuyến" },
  { key: "pickup_at", label: "Ngày nhận hàng", type: "date" },
  { key: "customer_name", label: "Khách hàng" },
];

/** Giá trị gốc của một trường trong dữ liệu chuyến */
export function rawShareValue(data: DriverShareRow["data"], source: string): unknown {
  if (!data) return null;
  if (source.startsWith("cf.")) return data.cf?.[source.slice(3)];
  if (source.startsWith("vcf.")) return data.vcf?.[source.slice(4)];
  return data[source];
}

/** Giá trị đã định dạng (ngày dd/mm/yyyy, số có dấu phẩy, danh sách theo nhãn) */
export function formatShareValue(v: unknown, src: ShareSource | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const optLabel = (x: unknown) => {
    const o = src?.options?.find((o) => (typeof o === "string" ? o : o.value) === x);
    return o ? (typeof o === "string" ? o : o.label) : String(x);
  };
  if (Array.isArray(v)) return v.map(optLabel).join(", ");
  switch (src?.type) {
    case "date":
    case "datetime":
      return formatDate(String(v));
    case "boolean":
      return v === true || v === "true" ? "Có" : "Không";
    case "integer":
    case "decimal":
    case "currency":
    case "percent":
      return formatNumber(v as number | string);
    case "single_select":
      return optLabel(v);
  }
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

/** Văn bản gửi khách: mỗi tài xế một khối "Tên dòng: giá trị", các khối cách nhau một dòng trống */
export function driverShareText(rows: DriverShareRow[], template: ShareLine[], sources: ShareSource[]): string {
  const byKey = new Map(sources.map((s) => [s.key, s]));
  return rows
    .filter((r) => r.data)
    .map((r) => template.map((l) => `${l.label}: ${formatShareValue(rawShareValue(r.data, l.source), byKey.get(l.source))}`).join("\n"))
    .join("\n\n");
}
