"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { vehicleTripsOnDay, type VehicleDayTrip } from "@/app/(app)/dieu-phoi/actions";
import { StatusBadge } from "./status-badge";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const NEW = "new";

/** Kết quả kiểm tra lịch xe gửi lên biểu mẫu cha */
export type VehicleDayState = {
  /** Còn trùng ngày mà chưa xác nhận hoặc thứ tự chưa hợp lệ */
  blocked: boolean;
  /** Thứ tự chuyến đang giao trong ngày của xe (null khi xe không có chuyến nào khác cùng ngày) */
  order: number | null;
  /** Thứ tự mới của các chuyến đã có của xe trong ngày (chỉ những chuyến được đổi) */
  others: { shipmentId: string; order: number }[];
};

const FREE: VehicleDayState = { blocked: false, order: null, others: [] };

/**
 * Cảnh báo khi xe đã có chuyến trong cùng ngày (ví dụ giao xong điểm A rồi sang điểm B nhận hàng).
 * Người dùng tích xác nhận và nhập thứ tự chuyến của xe trong ngày (1, 2, 3…) thì mới giao được.
 */
export function VehicleDayConflict({
  vehicleId,
  day,
  excludeShipmentId,
  sameForm = [],
  onStateChange,
}: {
  vehicleId: string;
  /** Ngày nhận hàng YYYY-MM-DD (giờ VN) */
  day: string;
  /** Chuyến đang sửa: không tính là trùng */
  excludeShipmentId?: string;
  /**
   * Các chuyến khác trên cùng biểu mẫu chọn cùng xe, cùng ngày (ví dụ "Chuyến 2") và thứ tự đã nhập.
   * before = chuyến đứng trước trên biểu mẫu: chỉ những chuyến này dùng để gợi ý số (tránh hai chuyến gợi ý vòng qua lại).
   */
  sameForm?: { label: string; order: number | null; before?: boolean }[];
  onStateChange: (s: VehicleDayState) => void;
}) {
  const key = vehicleId && YMD.test(day) ? `${vehicleId}|${day}` : "";
  const [result, setResult] = useState<{ key: string; trips: VehicleDayTrip[] } | null>(null);
  const [confirmed, setConfirmed] = useState("");
  const [typed, setTyped] = useState<{ key: string; values: Record<string, string> }>({ key: "", values: {} });

  useEffect(() => {
    if (!key) return;
    let alive = true;
    vehicleTripsOnDay({ vehicleId, day, excludeShipmentId }).then((r) => {
      if (alive) setResult({ key, trips: r.ok ? (r.data ?? []) : [] });
    });
    return () => {
      alive = false;
    };
  }, [key, vehicleId, day, excludeShipmentId]);

  const trips = useMemo(() => (result?.key === key ? result.trips : []), [result, key]);
  const loading = Boolean(key) && result?.key !== key;
  const count = trips.length + sameForm.length;
  // Xác nhận gắn với xe + ngày + số chuyến trùng: đổi xe/ngày hoặc phát sinh thêm chuyến thì phải xác nhận lại
  const confirmKey = `${key}|${count}`;
  const isConfirmed = confirmed === confirmKey;

  // Gợi ý thứ tự: giữ thứ tự đã có, chuyến chưa có thứ tự lấy số trống tiếp theo theo giờ nhận; chuyến đang giao xếp cuối
  const defaults = useMemo(() => {
    const used = new Set<number>([...trips.map((t) => t.vehicle_day_order), ...sameForm.filter((s) => s.before).map((s) => s.order)].filter((n): n is number => n !== null));
    const next = () => {
      let n = 1;
      while (used.has(n)) n++;
      used.add(n);
      return n;
    };
    const out: Record<string, number> = {};
    for (const t of trips) if (t.vehicle_day_order !== null) out[t.id] = t.vehicle_day_order;
    for (const t of trips) if (t.vehicle_day_order === null) out[t.id] = next();
    out[NEW] = next();
    return out;
  }, [trips, sameForm]);
  const values = typed.key === key ? typed.values : {};
  const value = (id: string) => values[id] ?? String(defaults[id] ?? "");
  const setValue = (id: string, v: string) => setTyped({ key, values: { ...values, [id]: v.replace(/\D/g, "").slice(0, 2) } });

  const parsed = [NEW, ...trips.map((t) => t.id)].map((id) => ({ id, n: Number(value(id)) }));
  const invalid = parsed.filter((p) => !Number.isInteger(p.n) || p.n < 1 || p.n > 99).map((p) => p.id);
  const all = [...parsed.map((p) => p.n), ...sameForm.map((s) => s.order).filter((n): n is number => n !== null)];
  const duplicate = all.length !== new Set(all).size;

  const state: VehicleDayState =
    !key || count === 0
      ? FREE
      : {
          blocked: loading || !isConfirmed || invalid.length > 0 || duplicate,
          order: Number(value(NEW)) || null,
          others: trips.filter((t) => Number(value(t.id)) && Number(value(t.id)) !== t.vehicle_day_order).map((t) => ({ shipmentId: t.id, order: Number(value(t.id)) })),
        };

  // Chỉ báo lên khi kết quả đổi (hàm callback của cha có thể tạo mới mỗi lần render)
  const notify = useRef(onStateChange);
  useEffect(() => {
    notify.current = onStateChange;
  });
  const signature = JSON.stringify(state);
  useEffect(() => {
    notify.current(JSON.parse(signature) as VehicleDayState);
  }, [signature]);

  if (!key) return null;
  if (loading && !sameForm.length) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Đang kiểm tra lịch xe…
      </p>
    );
  }
  if (!count) return null;
  const orderInput = (id: string, label: string) => (
    <Input
      aria-label={label}
      inputMode="numeric"
      value={value(id)}
      onChange={(e) => setValue(id, e.target.value)}
      className={`h-7 w-12 px-1.5 text-center ${invalid.includes(id) ? "border-destructive" : ""}`}
    />
  );
  return (
    <Alert variant="warning" className="mt-1">
      <AlertTriangle className="text-warning" />
      <AlertTitle>
        Xe đã có {count} chuyến khác ngày {formatDate(day)}
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <ul className="space-y-1.5">
          {trips.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
              {isConfirmed ? orderInput(t.id, `Thứ tự chuyến ${t.shipment_code}`) : t.vehicle_day_order ? <b>#{t.vehicle_day_order}</b> : null}
              <a href={`/chuyen-xe/${t.id}`} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                {t.shipment_code}
              </a>
              <span>
                {formatDate(t.pickup_at)}
                {t.expected_delivery_at && formatDate(t.expected_delivery_at) !== formatDate(t.pickup_at) ? ` → ${formatDate(t.expected_delivery_at)}` : ""}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
                {t.pickup_name} <ArrowRight className="size-3 shrink-0" /> {t.delivery_name}
              </span>
              {t.driver_name ? <span className="text-muted-foreground">· {t.driver_name}</span> : null}
              <StatusBadge status={t.status} />
            </li>
          ))}
          {sameForm.map((s) => (
            <li key={s.label} className="text-xs">
              {s.order ? <b>#{s.order} </b> : null}
              {s.label} trên biểu mẫu này cũng chọn xe này cùng ngày.
            </li>
          ))}
        </ul>
        <label className="flex cursor-pointer items-start gap-2 text-sm font-medium">
          <input type="checkbox" className="mt-0.5" checked={isConfirmed} onChange={(e) => setConfirmed(e.target.checked ? confirmKey : "")} />
          <span>
            Vẫn giao cho xe này
            <span className="block text-xs font-normal text-muted-foreground">Ví dụ xe giao xong điểm A rồi sang điểm B nhận hàng. Kiểm tra giờ để không chồng chéo.</span>
          </span>
        </label>
        {isConfirmed ? (
          <div className="space-y-1 rounded-md border bg-card p-2">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
              Thứ tự chuyến này của xe trong ngày * {orderInput(NEW, "Thứ tự chuyến này của xe trong ngày")}
            </div>
            <p className="text-xs text-muted-foreground">
              Nhập 1, 2, 3… theo thứ tự xe chạy trong ngày (có thể sửa thứ tự các chuyến đã có ở danh sách trên). Ứng dụng tài xế xếp chuyến theo thứ tự này.
            </p>
            {duplicate ? <p className="text-xs font-medium text-destructive">Thứ tự bị trùng, mỗi chuyến một số khác nhau.</p> : null}
            {invalid.length ? <p className="text-xs font-medium text-destructive">Thứ tự phải là số từ 1 đến 99.</p> : null}
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
