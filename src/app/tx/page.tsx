import { Clock, MapPin, Navigation, Phone, Receipt, Truck } from "lucide-react";
import { anonClient, driverLinkToken } from "@/lib/driver-link/server";
import { formatDate, formatDateTime, formatNumber, formatVND } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { pickDriverView } from "@/lib/driver-view";
import { parseDriverAppSettings, type DriverAppSettings } from "@/lib/driver-link/settings";
import { PlateForm } from "./plate-form";
import { AcceptButton, ChangeVehicleButton, CompleteButton, FindNextButton, StartButton } from "./trip-actions";
import { AddExpenseButton, AddSheetButton, type ExpenseCategory } from "./expense-forms";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; variant: "warning" | "success" | "secondary" | "info" }> = {
  assigned: { label: "Chờ nhận", variant: "warning" },
  accepted: { label: "Đã nhận", variant: "info" },
  in_transit: { label: "Đang chạy", variant: "info" },
  driver_completed: { label: "Đã xong", variant: "success" },
  closed: { label: "Đã đóng", variant: "secondary" },
};

type Trip = {
  shipment_id: string;
  shipment_code: string;
  status: string;
  pickup_at: string;
  expected_delivery_at: string | null;
  plate_number: string | null;
  vehicle_type_name: string | null;
  quantity: number | null;
  notes: string | null;
  pickup_name: string;
  pickup_address: string;
  pickup_contact: string | null;
  pickup_phone: string | null;
  pickup_maps_url: string | null;
  pickup_gate_instructions: string | null;
  delivery_name: string;
  delivery_address: string;
  delivery_contact: string | null;
  delivery_phone: string | null;
  delivery_maps_url: string | null;
  delivery_gate_instructions: string | null;
  driver_name: string;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  delivery_result: string | null;
  photo_count: number;
  expense_declaration: "none" | "has" | null;
  expense_count: number;
  expense_total: number;
  outsourced: boolean;
  /** Đơn yêu cầu chụp chứng từ (0054) */
  pod_photo_required?: boolean;
  /** Số ảnh phiếu chi phí đã gửi */
  sheet_count?: number;
  /** Thứ tự chuyến của xe trong ngày (điều phối nhập khi xe chạy nhiều chuyến cùng ngày) */
  vehicle_day_order?: number | null;
  /** Thứ tự chuyến dùng để nhận chuyến (thứ tự của xe trong ngày hoặc từ kế hoạch) */
  trip_rank?: number | null;
  /** Chuyến cùng ngày có thứ tự nhỏ hơn còn chờ nhận: phải nhận chuyến đó trước */
  wait_for_code?: string | null;
  wait_for_rank?: number | null;
  empty_return_name?: string | null;
  empty_return_address?: string | null;
  offroute_return_name?: string | null;
  offroute_return_address?: string | null;
};

const RESULT_LABEL: Record<string, string> = { full: "Giao đủ", partial: "Giao thiếu", failed: "Không giao được" };

export default async function DriverHome({ searchParams }: { searchParams: Promise<{ xong?: string }> }) {
  const { xong } = await searchParams;
  const token = await driverLinkToken();
  const supabase = anonClient();
  const me = token ? ((await supabase.rpc("driver_link_me", { p_token: token })).data as { plate: string; driver_name: string | null } | null) : null;
  if (!me) return <PlateForm />;

  const [{ data, error }, fin, cfg, flagRes] = await Promise.all([
    supabase.rpc("driver_link_trips", { p_token: token }),
    supabase.rpc("driver_link_categories", { p_token: token }),
    supabase.rpc("driver_app_settings"),
    supabase.rpc("driver_link_trip_flags", { p_token: token }),
  ]);
  if (error) throw error;
  // Cờ từng chuyến (CSDL chưa nâng cấp 0054 thì như trước: bắt buộc ảnh)
  const flags = new Map(((flagRes.data ?? []) as { shipment_id: string; pod_photo_required: boolean; sheet_count: number }[]).map((f) => [f.shipment_id, f]));
  const trips = ((data ?? []) as Trip[]).map((t) => ({
    ...t,
    pod_photo_required: flags.get(t.shipment_id)?.pod_photo_required ?? true,
    sheet_count: Number(flags.get(t.shipment_id)?.sheet_count ?? 0),
  }));
  const settings = parseDriverAppSettings(cfg.data);
  const categories = ((fin.data as { categories?: ExpenseCategory[] } | null)?.categories ?? []) as ExpenseCategory[];

  // Tài xế chỉ thấy MỘT chuyến; xong chuyến bấm "Tìm chuyến khác" mới thấy chuyến tiếp theo
  const { shown, justDone, current, after, recentDone } = pickDriverView(trips, xong);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Truck className="size-6" />
          </div>
          <div>
            <div className="font-mono text-lg font-semibold">{me.plate}</div>
            <div className="text-sm text-muted-foreground">
              {justDone ? "Đã hoàn thành chuyến" : current ? (after > 0 ? `Còn ${after} chuyến được sắp sau chuyến này` : "Chuyến đang làm") : "Chưa có chuyến"}
            </div>
          </div>
        </div>
        <ChangeVehicleButton />
      </div>

      {shown ? (
        <TripCard t={shown} categories={categories} settings={settings} />
      ) : (
        <div data-no-trip className="rounded-2xl border bg-card p-8 text-center font-medium text-muted-foreground">
          Chưa có chuyến, chờ điều phối sắp xếp
        </div>
      )}
      {justDone || !shown ? <FindNextButton /> : null}

      {recentDone.length ? (
        <details className="rounded-2xl border bg-card p-3">
          <summary className="cursor-pointer text-sm font-medium">Chuyến đã xong gần đây ({recentDone.length}){settings.expense_enabled ? ": xem, bổ sung chi phí" : ""}</summary>
          <div className="mt-3 space-y-3">
            {recentDone.map((t) => (
              <TripCard key={t.shipment_id} t={t} categories={categories} settings={settings} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function TripCard({ t, categories, settings }: { t: Trip; categories: ExpenseCategory[]; settings: DriverAppSettings }) {
  const st = STATUS[t.status] ?? { label: t.status, variant: "secondary" as const };
  return (
    <div data-trip={t.shipment_code} className={`rounded-2xl border-2 bg-card p-4 shadow-sm ${t.status === "assigned" ? "border-warning" : "border-transparent"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-base font-semibold">{t.shipment_code}</div>
          {t.trip_rank ? <div className="text-sm font-semibold text-primary">Chuyến thứ {t.trip_rank} trong ngày</div> : null}
          <div className="text-sm text-muted-foreground">Tài xế: {t.driver_name}</div>
        </div>
        <Badge variant={st.variant}>{st.label}</Badge>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
        <Clock className="size-4 shrink-0 text-primary" />
        <span>
          Nhận hàng ngày <strong>{formatDate(t.pickup_at)}</strong>
          {t.expected_delivery_at ? <> · Giao trong ngày {formatDate(t.expected_delivery_at)}</> : null}
        </span>
      </div>

      <Place label="Điểm nhận" name={t.pickup_name} address={t.pickup_address} contact={t.pickup_contact} phone={t.pickup_phone} maps={t.pickup_maps_url} gate={t.pickup_gate_instructions} />
      <Place label="Điểm giao" name={t.delivery_name} address={t.delivery_address} contact={t.delivery_contact} phone={t.delivery_phone} maps={t.delivery_maps_url} gate={t.delivery_gate_instructions} />

      {t.empty_return_name || t.offroute_return_name ? (
        <div className="mt-3 space-y-1 rounded-xl bg-muted px-3 py-2 text-sm">
          {t.empty_return_name ? (
            <div>
              Hạ rỗng: <strong>{t.empty_return_name}</strong>
              {t.empty_return_address ? <span className="text-muted-foreground"> · {t.empty_return_address}</span> : null}
            </div>
          ) : null}
          {t.offroute_return_name ? (
            <div className="text-amber-700 dark:text-amber-400">
              Hạ rỗng trái tuyến: <strong>{t.offroute_return_name}</strong>
              {t.offroute_return_address ? <span> · {t.offroute_return_address}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {t.vehicle_type_name ? <span>Loại xe: {t.vehicle_type_name}</span> : null}
        {t.quantity ? <span>Số lượng: {formatNumber(t.quantity)}</span> : null}
      </div>
      {t.notes ? <p className="mt-2 rounded-lg bg-warning/10 p-2 text-sm">Ghi chú: {t.notes}</p> : null}

      {t.status === "assigned" && t.wait_for_code ? (
        <p data-wait-for={t.wait_for_code} className="mt-4 rounded-xl border border-warning bg-warning/10 p-3 text-center text-sm font-medium">
          Nhận chuyến thứ {t.wait_for_rank} ({t.wait_for_code}) trước, rồi mới nhận được chuyến này.
        </p>
      ) : t.status === "assigned" ? (
        <AcceptButton shipmentId={t.shipment_id} code={t.shipment_code} />
      ) : t.status === "accepted" ? (
        <>
          {t.accepted_at ? <p className="mt-3 text-center text-sm text-success">Đã nhận lúc {formatDateTime(t.accepted_at)}</p> : null}
          <StartButton shipmentId={t.shipment_id} code={t.shipment_code} />
        </>
      ) : t.status === "in_transit" ? (
        <>
          {t.started_at ? <p className="mt-3 text-center text-sm text-primary">Bắt đầu chạy lúc {formatDateTime(t.started_at)}</p> : null}
          {t.pod_photo_required && settings.photos_enabled ? (
            <p className="mt-2 rounded-lg bg-warning/10 p-2 text-center text-sm font-medium">Đơn này yêu cầu chụp chứng từ giao hàng</p>
          ) : null}
          <CompleteButton
            shipmentId={t.shipment_id}
            code={t.shipment_code}
            categories={categories}
            outsourced={t.outsourced}
            settings={settings}
            podPhotoRequired={t.pod_photo_required ?? true}
          />
        </>
      ) : t.completed_at ? (
        <>
          <p className="mt-3 text-center text-sm text-success">
            Hoàn thành lúc {formatDateTime(t.completed_at)}
            {t.delivery_result ? ` · ${RESULT_LABEL[t.delivery_result] ?? ""}` : ""}
            {settings.photos_enabled || Number(t.photo_count) > 0 ? ` · ${t.photo_count} ảnh` : ""}
          </p>
          {t.outsourced ? (
            <p className="mt-2 text-center text-sm text-muted-foreground">Xe thuê ngoài 3PL: không nhập chi phí tài xế</p>
          ) : !settings.expense_enabled && Number(t.expense_count) === 0 ? null : (
            <p data-expense-summary className="mt-2 flex items-center justify-center gap-1.5 text-sm">
              <Receipt className="size-4 text-muted-foreground" />
              {Number(t.expense_count) > 0
                ? `Chi phí: ${t.expense_count} khoản · ${formatVND(Number(t.expense_total))}`
                : Number(t.sheet_count) > 0
                  ? `Đã gửi ${t.sheet_count} ảnh phiếu chi phí, văn phòng sẽ nhập`
                  : t.expense_declaration === "none"
                  ? "Đã xác nhận không phát sinh chi phí"
                  : "Chưa có chi phí"}
            </p>
          )}
          {t.status === "driver_completed" && !t.outsourced && settings.expense_enabled ? (
            settings.expense_sheet_photo ? (
              <AddSheetButton shipmentId={t.shipment_id} code={t.shipment_code} />
            ) : (
              <AddExpenseButton shipmentId={t.shipment_id} code={t.shipment_code} categories={categories} photos={settings.photos_enabled} />
            )
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Place(p: { label: string; name: string; address: string; contact: string | null; phone: string | null; maps: string | null; gate: string | null }) {
  const mapsUrl = p.maps ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`;
  return (
    <div className="mt-3 flex gap-3">
      <MapPin className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase text-muted-foreground">{p.label}</div>
        <div className="font-semibold">{p.name}</div>
        <div className="text-sm text-muted-foreground">{p.address}</div>
        <div className="text-sm">
          SĐT {p.label.toLowerCase()}:{" "}
          {p.phone ? (
            <a href={`tel:${p.phone.replace(/[^0-9+]/g, "")}`} className="font-semibold text-primary">
              {p.phone}
            </a>
          ) : (
            <span className="text-muted-foreground">chưa có</span>
          )}
          {p.contact ? <span className="text-muted-foreground"> · {p.contact}</span> : null}
        </div>
        {p.gate ? <div className="text-sm">Cổng: {p.gate}</div> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium text-primary">
            <Navigation className="size-4" /> Chỉ đường
          </a>
          {p.phone ? (
            <a href={`tel:${p.phone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium">
              <Phone className="size-4" /> Gọi {p.label.toLowerCase()}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
