"use client";
import { NativeSelect } from "@/components/ui/input";

export type CarrierOption = { id: string; name: string; count: number };

/**
 * Ô lọc theo nhà xe 3PL (Điều phối, Quản lý chuyến): gom chuyến của từng nhà xe để gửi cho 3PL.
 * Chỉ hiện với người có quyền xem 3PL. Giá trị: "" tất cả, "3pl" mọi chuyến 3PL, "noi-bo" xe nội bộ, hoặc id nhà xe.
 */
export function CarrierFilter({
  id,
  value,
  options,
  selectedName,
  onChange,
}: {
  id: string;
  value: string;
  options: CarrierOption[];
  /** Tên nhà xe đang lọc khi nhà xe này không có trong danh sách (không có chuyến trong khoảng ngày) */
  selectedName?: string;
  onChange: (v: string) => void;
}) {
  const known = !value || value === "3pl" || value === "noi-bo" || options.some((o) => o.id === value);
  const total = options.reduce((a, o) => a + o.count, 0);
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Tất cả (xe nội bộ + 3PL)</option>
      <option value="3pl">Chỉ chuyến 3PL{total ? ` (${total})` : ""}</option>
      <option value="noi-bo">Chỉ xe nội bộ</option>
      {!known ? <option value={value}>{selectedName || "Nhà xe đang lọc"}</option> : null}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name} ({o.count})
        </option>
      ))}
    </NativeSelect>
  );
}
