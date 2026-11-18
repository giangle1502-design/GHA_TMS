"use client";
import { useEffect, useRef, useState } from "react";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { shipmentCarrierHint, vehicleDefaultDriver, type CarrierHint } from "@/app/(app)/dieu-phoi/actions";
import { cn } from "@/lib/utils";

export type VehicleSource = "internal" | "3pl";

/**
 * Chọn xe theo nguồn: "Xe nội bộ" chỉ hiện xe công ty.
 * "Xe 3-PL": chọn Nhà thầu 3PL trước, rồi mới chọn xe của nhà thầu đó (thêm nhanh xe mới gắn sẵn nhà thầu).
 * Xe đang gắn với chuyến tự chọn đúng nguồn và nhà thầu. Chuyến đã có nhà xe 3PL (ghi ở chuyến,
 * hoặc NCC của kế hoạch tạo ra chuyến) thì tự mở Xe 3-PL với nhà thầu đó.
 */
export function VehicleSourcePicker({
  id,
  shipmentId,
  value,
  initialLabel,
  onChange,
  onSourceChange,
  onSupplierChange,
  disabled,
  invalid,
  multiCarrier,
  onSupplierValue,
}: {
  id?: string;
  /** Chuyến đang phân công (để lấy nhà xe 3PL của chuyến / kế hoạch) */
  shipmentId?: string | null;
  value: string;
  initialLabel?: string;
  onChange: (id: string, label: string) => void;
  /** Báo nguồn đang chọn (để ẩn cảnh báo trùng xe, số chuyến khi là xe 3PL) */
  onSourceChange?: (source: VehicleSource) => void;
  /** Báo nhà thầu 3PL người dùng chọn (để lưu chỉ định 3PL khi chưa chọn xe); "" = bỏ chọn / chuyển sang xe nội bộ */
  onSupplierChange?: (supplierId: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  /**
   * Đầu kéo / tài xế chạy cho nhiều 3PL (VD sửa chuyến đã hoàn thành): đổi nhà thầu KHÔNG bỏ xe đã chọn,
   * mặc định hiện xe 3PL của mọi nhà thầu, và nhà thầu ghi ở chuyến được ưu tiên hơn nhà thầu mặc định của xe.
   */
  multiCarrier?: boolean;
  /** Báo nhà thầu đang hiện ở bước 1 mỗi khi đổi (cả khi tự điền theo chuyến / theo xe) */
  onSupplierValue?: (supplierId: string) => void;
}) {
  const [source, setSource] = useState<VehicleSource>("internal");
  const [carrier, setCarrier] = useState<CarrierHint | null>(null);
  /** Nhà thầu 3PL đang chọn (bước 1 trước khi chọn xe 3-PL) */
  const [supplier, setSupplier] = useState<{ id: string; label: string }>({ id: "", label: "" });
  /** Hiện xe 3PL của mọi nhà thầu (xe chạy cho nhiều 3PL) */
  const [allVehicles, setAllVehicles] = useState(!!multiCarrier);
  /** Đã lấy được nhà thầu ghi ở chuyến (ưu tiên hơn nhà thầu mặc định của xe) */
  const fromShipment = useRef(false);
  const checked = useRef<string>("");
  const notify = useRef(onSourceChange);
  const notifySupplier = useRef(onSupplierValue);
  useEffect(() => {
    notify.current = onSourceChange;
    notifySupplier.current = onSupplierValue;
  });
  useEffect(() => {
    notifySupplier.current?.(supplier.id);
  }, [supplier.id]);

  // Nhà xe 3PL của chuyến: chưa chọn xe thì mở sẵn Xe 3-PL
  useEffect(() => {
    if (!shipmentId) return;
    let alive = true;
    shipmentCarrierHint(shipmentId).then((r) => {
      if (!alive || !r.ok || !r.data) return;
      setCarrier(r.data);
      // Nhà thầu ghi ở chuyến (không phải gợi ý từ kế hoạch) là nhà thầu đúng của chuyến
      const exact = multiCarrier && !r.data.planCode;
      if (exact) fromShipment.current = true;
      setSupplier((cur) => (cur.id && !exact ? cur : { id: r.data!.supplierId, label: r.data!.supplierName }));
      if (!checked.current) {
        setSource("3pl");
        notify.current?.("3pl");
      }
    });
    return () => {
      alive = false;
    };
  }, [shipmentId, multiCarrier]);

  // Xe có sẵn (sửa chuyến, chuyến đã phân công): mở đúng tab theo xe đó
  useEffect(() => {
    if (!value || checked.current === value) return;
    checked.current = value;
    vehicleDefaultDriver(value).then((r) => {
      if (r.ok && r.data) {
        const s: VehicleSource = r.data.outsourced ? "3pl" : "internal";
        setSource(s);
        if (r.data.supplierId && !fromShipment.current) {
          const sid = r.data.supplierId;
          // Xe chạy cho nhiều 3PL: chỉ dùng nhà thầu mặc định của xe khi chưa chọn nhà thầu
          setSupplier((cur) => (cur.id === sid || (multiCarrier && cur.id) ? cur : { id: sid, label: "" }));
        }
        notify.current?.(s);
      }
    });
  }, [value, multiCarrier]);

  function pick(s: VehicleSource) {
    if (s === source) return;
    setSource(s);
    notify.current?.(s);
    onSupplierChange?.(s === "3pl" ? supplier.id : "");
    // Đổi nguồn thì bỏ xe đã chọn ở nguồn kia
    if (value) {
      checked.current = "";
      onChange("", "");
    }
  }

  function pickSupplier(id: string, label: string) {
    if (id === supplier.id) return;
    setSupplier({ id, label });
    onSupplierChange?.(id);
    // Đổi nhà thầu thì bỏ xe của nhà thầu cũ (trừ khi xe chạy cho nhiều 3PL)
    if (value && !multiCarrier) {
      checked.current = "";
      onChange("", "");
    }
  }

  const is3pl = source === "3pl";
  return (
    <div className="space-y-1.5">
      <div className="inline-flex rounded-md border bg-muted/40 p-0.5 text-xs" role="tablist" aria-label="Nguồn xe">
        {(
          [
            ["internal", "Xe nội bộ"],
            ["3pl", "Xe 3-PL"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={source === k}
            disabled={disabled}
            onClick={() => pick(k)}
            className={cn(
              "rounded px-2.5 py-1 font-medium transition-colors",
              source === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {is3pl ? (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">1. Nhà thầu 3PL</div>
          <ReferenceSelect
            key={`ncc-${supplier.id}`}
            id={id ? `${id}-ncc` : undefined}
            refKey="suppliers"
            value={supplier.id}
            initialLabel={supplier.label}
            onChange={pickSupplier}
            disabled={disabled}
            invalid={invalid && !supplier.id}
          />
          {carrier?.planCode && carrier.supplierId === supplier.id ? <p className="text-xs text-violet-700">NCC của kế hoạch {carrier.planCode}</p> : null}
          <div className="pt-1 text-xs font-medium text-muted-foreground">2. Xe của nhà thầu</div>
        </div>
      ) : null}
      <ReferenceSelect
        key={`${source}-${is3pl ? supplier.id : "all"}-${allVehicles ? "moi-nha-thau" : "nha-thau"}`}
        id={id}
        refKey={is3pl ? "vehicles_3pl" : "vehicles_internal"}
        value={value}
        initialLabel={initialLabel}
        onChange={onChange}
        disabled={disabled || (is3pl && !supplier.id && !allVehicles)}
        invalid={invalid}
        where={is3pl && supplier.id && !allVehicles ? { supplier_id: supplier.id } : undefined}
        quickDefaults={is3pl && supplier.id ? { supplier_id: supplier.id } : undefined}
      />
      {is3pl ? (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" className="size-3.5" checked={allVehicles} disabled={disabled} onChange={(e) => setAllVehicles(e.target.checked)} />
          Hiện xe của mọi nhà thầu (đầu kéo chạy cho nhiều 3PL)
        </label>
      ) : null}
      {source === "3pl" ? (
        <p className="text-xs text-muted-foreground">
          {supplier.id
            ? `${allVehicles ? "Đang hiện xe 3PL của mọi nhà thầu." : "Chỉ hiện xe của nhà thầu đã chọn."} Chưa biết số xe thì để trống: chuyến vẫn lưu nhà thầu, số xe nhập sau. Chưa có xe trong danh mục thì gõ số xe rồi bấm Thêm mới (xe tự gắn nhà thầu này).`
            : "Chọn nhà thầu 3PL trước, sau đó chọn xe (có thể chọn xe sau)."} Xe 3PL không tính số chuyến, thứ tự xe, tạm ứng, chi phí tài xế.
        </p>
      ) : null}
    </div>
  );
}
