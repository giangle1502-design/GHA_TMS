// Danh sách kiểu dữ liệu của trường động (khớp ràng buộc field_definitions.data_type)
export const FIELD_DATA_TYPES: { value: string; label: string; numeric?: boolean }[] = [
  { value: "short_text", label: "Văn bản ngắn" },
  { value: "long_text", label: "Văn bản dài" },
  { value: "integer", label: "Số nguyên", numeric: true },
  { value: "decimal", label: "Số thập phân", numeric: true },
  { value: "currency", label: "Tiền tệ (VND)", numeric: true },
  { value: "percent", label: "Phần trăm", numeric: true },
  { value: "date", label: "Ngày" },
  { value: "datetime", label: "Ngày giờ" },
  { value: "single_select", label: "Danh sách chọn một" },
  { value: "multi_select", label: "Danh sách chọn nhiều" },
  { value: "boolean", label: "Có/Không" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Số điện thoại" },
  { value: "url", label: "Đường dẫn" },
  { value: "reference", label: "Liên kết danh mục khác" },
  { value: "formula", label: "Công thức", numeric: true },
  { value: "file", label: "Tệp đính kèm (GĐ5)" },
  { value: "image", label: "Hình ảnh (GĐ5)" },
  { value: "gps", label: "Tọa độ GPS" },
];

/** Danh mục có thể chọn làm đích cho trường liên kết */
export const REFERENCE_TARGETS = [
  "customers",
  "suppliers",
  "locations",
  "routes",
  "vehicles",
  "drivers",
  "vehicle_types",
  "banks",
  "company_entities",
  "catalog_items",
] as const;

/** Tạo mã trường từ tên hiển thị: "Số container" -> "so_container" */
export function slugifyKey(label: string): string {
  const s = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  return /^[a-z]/.test(s) ? s : `f_${s}`;
}

/** Đổi kiểu khi trường đã có dữ liệu: chỉ cho các kiểu tương thích (khớp private.field_type_compatible) */
export function fieldTypeCompatible(from: string, to: string): boolean {
  const num = ["integer", "decimal", "currency", "percent"];
  const text = ["short_text", "long_text"];
  if (from === to) return true;
  if (num.includes(from) && ["decimal", "currency", "percent"].includes(to)) return true;
  if (["short_text", "long_text", "email", "phone", "url"].includes(from) && text.includes(to)) return true;
  if ([...num, "date", "datetime", "single_select"].includes(from) && text.includes(to)) return true;
  return from === "date" && to === "datetime";
}
