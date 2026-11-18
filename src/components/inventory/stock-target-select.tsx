"use client";
import { NativeSelect } from "@/components/ui/input";

/** Ô "Kho GHA" trên đơn / chuyến: nhập vào / xuất từ vị trí GHA1, GHA2 (giá trị: "", "none", "receipt:<id>", "issue:<id>") */
export function StockTargetSelect({
  id,
  bins,
  value,
  onChange,
  emptyLabel = "Chưa chọn (theo địa điểm gắn với kho)",
  allowPending = true,
  className,
  disabled,
}: {
  disabled?: boolean;
  id?: string;
  bins: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  emptyLabel?: string;
  /** Cho chọn "Nhập / Xuất, chọn vị trí khi hoàn thành" */
  allowPending?: boolean;
  className?: string;
}) {
  return (
    <NativeSelect id={id} className={className ?? "h-9"} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      <option value="none">Không qua kho GHA</option>
      <optgroup label="Nhập kho GHA (hàng về bãi)">
        {bins.map((b) => (
          <option key={`r${b.id}`} value={`receipt:${b.id}`}>
            Nhập vào {b.label}
          </option>
        ))}
        {allowPending || value === "receipt:" ? <option value="receipt:">Nhập kho, chọn vị trí khi hoàn thành</option> : null}
      </optgroup>
      <optgroup label="Xuất kho GHA (lấy hàng ở bãi)">
        {bins.map((b) => (
          <option key={`i${b.id}`} value={`issue:${b.id}`}>
            Xuất từ {b.label}
          </option>
        ))}
        {allowPending || value === "issue:" ? <option value="issue:">Xuất kho, chọn vị trí khi hoàn thành</option> : null}
      </optgroup>
    </NativeSelect>
  );
}
