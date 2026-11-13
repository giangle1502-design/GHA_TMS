"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, Copy, X, Loader2, Plus, RefreshCw, Save, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { EntityFormDialog } from "@/components/entities/entity-form-dialog";
import { VehicleDayConflict, type VehicleDayState } from "@/components/dispatch/vehicle-day-conflict";
import { MonthTripHint } from "@/components/dispatch/month-trip-hint";
import { CustomFieldsEditor } from "@/components/entities/custom-fields-editor";
import { AddFieldButton } from "@/components/entities/add-field-button";
import type { CustomFieldRow, FieldDef, SystemFieldSettings } from "@/lib/entities/types";
import { FORM_SYSTEM_FIELDS, PRICE_SYSTEM_KEYS } from "@/lib/entities/definitions";
import { ItemsEditor, itemsPayload, newItem, type ItemLine } from "./items-editor";
import { FeesEditor, countFeeFiles, feeTotals, feesPayload, newFee, uploadFeeFiles, useFeeCatalog, type FeeFiles, type FeeLine } from "./fees-editor";
import { formatNumber, formatVND, todayVN } from "@/lib/format";
import { parseNumberVN, systemLabel, systemSettingsOf } from "@/lib/entities/record";
import { PRICING_UNITS } from "@/lib/status";
import { VehicleSourcePicker, type VehicleSource } from "@/components/dispatch/vehicle-source-picker";
import { createOrder, customerDefaultPayer, quoteShipment, updateOrderFull, vehicleDefaultDriver, type QuoteResult } from "../actions";
import { shipmentStatus } from "@/lib/status";

type Row = {
  key: number;
  pickupAt: string; // ngày nhận hàng YYYY-MM-DD (giờ không biết trước nên không nhập)
  expectedDeliveryAt: string;
  pickupLocationId: string;
  deliveryLocationId: string;
  /** Điểm hạ rỗng, điểm hạ rỗng trái tuyến (không bắt buộc) */
  emptyReturnLocationId: string;
  offrouteReturnLocationId: string;
  /** Thứ tự chuyến: tài xế phải nhận đúng thứ tự trong ngày */
  tripOrder: string;
  vehicleTypeId: string;
  vehicleId: string;
  driverId: string;
  driverKey: number;
  quantity: string;
  priceListId: string;
  unitPrice: string;
  pricingUnit: "trip" | "km" | "ton" | "other";
  surchargeAmount: string;
  fuelSupportRate: string;
  notes: string;
  /** Khách yêu cầu chụp chứng từ: tài xế bắt buộc chụp ảnh giao hàng */
  podPhotoRequired: boolean;
  custom: Record<string, unknown>;
  /** Trường bổ sung kiểu tiền, %, số, công thức: nhập trong khung Giá */
  customPrice: Record<string, unknown>;
  /** Hàng hóa (mã hàng) của chuyến */
  items: ItemLine[];
  /** Phí khác thu khách (bốc xếp, chi hộ…) */
  fees: FeeLine[];
  /** Tệp hóa đơn PDF / ảnh của phí chi hộ chờ tải lên khi lưu (theo loại phí) */
  feeFiles?: FeeFiles;
  /** Chuyến đã có: số tệp hóa đơn đã đính kèm theo loại phí */
  feeDocs?: Record<string, number>;
  /** Kiểm tra xe đã có chuyến cùng ngày: xác nhận vẫn giao và thứ tự chuyến của xe trong ngày */
  vehicleDay?: VehicleDayState;
  /** Đang chọn Xe nội bộ hay Xe 3-PL (xe 3PL không cảnh báo trùng xe, không đếm chuyến) */
  vehicleSource?: VehicleSource;
  /** keep = chuyến đã có, giữ giá đang lưu (sửa tay được); quote = tìm giá theo bảng giá như lúc tạo */
  priceMode: "keep" | "quote";
  /** Các thông tin dưới chỉ có ở chuyến đã có khi sửa đơn */
  id?: string;
  code?: string;
  version?: number;
  status?: string;
  /** Đã lập công nợ: khóa giá, phí, số lượng */
  billed?: boolean;
  fuelBase?: string | null;
  fuelAmount?: number;
  priceListCode?: string | null;
  /** Xe, tài xế, ngày lúc mở form: chỉ kiểm tra trùng lịch xe khi có thay đổi */
  orig?: { vehicleId: string; driverId: string; day: string };
  /** Có giá trị = hủy chuyến này khi lưu (lý do hủy) */
  cancel?: string;
};

/** Chuyến đã có khi mở form sửa đơn (trang /dieu-phoi/don-hang/[id]/sua nạp sẵn) */
export type EditShipmentInit = {
  id: string;
  code: string;
  version: number;
  status: string;
  billed: boolean;
  pickupDate: string;
  expectedDeliveryDate: string;
  pickupLocationId: string;
  deliveryLocationId: string;
  emptyReturnLocationId: string;
  offrouteReturnLocationId: string;
  tripOrder: number | null;
  vehicleTypeId: string;
  vehicleId: string;
  driverId: string;
  quantity: number;
  priceListId: string;
  priceListCode: string | null;
  unitPrice: number;
  pricingUnit: string;
  surchargeAmount: number;
  fuelSupportRate: number | null;
  fuelBase: string | null;
  fuelAmount: number;
  notes: string;
  podPhotoRequired: boolean;
  custom: Record<string, unknown>;
  items: Omit<ItemLine, "key">[];
  fees: Omit<FeeLine, "key">[];
  /** Số tệp hóa đơn chi hộ đã đính kèm theo loại phí */
  feeDocs?: Record<string, number>;
};

export type EditOrderInit = {
  id: string;
  code: string;
  status: string;
  /** Có chuyến đã lập công nợ: không đổi khách hàng, khách thanh toán, đơn vị nội bộ */
  billed: boolean;
  customer: { id: string; label: string };
  payer: { id: string; label: string };
  company: { id: string; label: string };
  orderDate: string;
  notes: string;
  custom: Record<string, unknown>;
  shipments: EditShipmentInit[];
};

/** Chuyến được đổi xe, tài xế hoặc ngày thì kiểm tra lại lịch xe; chuyến mới luôn kiểm tra */
const needsDayCheck = (r: Row) => !r.orig || r.vehicleId !== r.orig.vehicleId || r.pickupAt.slice(0, 10) !== r.orig.day;
const ASSIGNABLE = ["draft", "assigned", "accepted"];
const CANCELLABLE = ["draft", "assigned", "accepted", "in_transit"];
const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k)));

/** Trường bổ sung kiểu tiền, %, số và công thức nằm trong khung Giá của chuyến */
const PRICE_FIELD_TYPES: FieldDef["type"][] = ["currency", "percent", "number", "formula"];

let seq = 0;
/** pod = mặc định ô "Khách yêu cầu chụp chứng từ" cho chuyến mới (Cấu hình) */
const newRow = (from?: Row, pod = true): Row => ({
  key: ++seq,
  pickupAt: from?.pickupAt ?? todayVN(),
  expectedDeliveryAt: from?.expectedDeliveryAt ?? "",
  pickupLocationId: from?.pickupLocationId ?? "",
  deliveryLocationId: from?.deliveryLocationId ?? "",
  emptyReturnLocationId: from?.emptyReturnLocationId ?? "",
  offrouteReturnLocationId: from?.offrouteReturnLocationId ?? "",
  tripOrder: "",
  vehicleTypeId: from?.vehicleTypeId ?? "",
  vehicleId: "",
  driverId: "",
  driverKey: 0,
  quantity: from?.quantity ?? "1",
  priceListId: from?.priceListId ?? "",
  unitPrice: from?.unitPrice ?? "",
  pricingUnit: from?.pricingUnit ?? "trip",
  surchargeAmount: from?.surchargeAmount ?? "",
  fuelSupportRate: from?.fuelSupportRate ?? "",
  notes: from?.notes ?? "",
  podPhotoRequired: from?.podPhotoRequired ?? pod,
  custom: from?.custom ?? {},
  customPrice: from?.customPrice ?? {},
  items: (from?.items ?? []).map((l) => newItem(l)),
  fees: (from?.fees ?? []).map((l) => newFee(l)),
  priceMode: "quote",
});

/** Dòng chuyến của form từ chuyến đã có (giá giữ nguyên tới khi người dùng đổi tuyến, loại xe hoặc bấm tính lại) */
const rowFromShipment = (s: EditShipmentInit, generalKeys: string[], priceKeys: string[]): Row => ({
  key: ++seq,
  pickupAt: s.pickupDate,
  expectedDeliveryAt: s.expectedDeliveryDate,
  pickupLocationId: s.pickupLocationId,
  deliveryLocationId: s.deliveryLocationId,
  emptyReturnLocationId: s.emptyReturnLocationId,
  offrouteReturnLocationId: s.offrouteReturnLocationId,
  tripOrder: s.tripOrder === null ? "" : String(s.tripOrder),
  vehicleTypeId: s.vehicleTypeId,
  vehicleId: s.vehicleId,
  driverId: s.driverId,
  driverKey: 0,
  quantity: String(s.quantity),
  priceListId: s.priceListId,
  unitPrice: String(s.unitPrice),
  pricingUnit: (["trip", "km", "ton", "other"].includes(s.pricingUnit) ? s.pricingUnit : "trip") as Row["pricingUnit"],
  surchargeAmount: String(s.surchargeAmount),
  fuelSupportRate: s.fuelSupportRate === null ? "" : String(s.fuelSupportRate),
  notes: s.notes,
  podPhotoRequired: s.podPhotoRequired,
  custom: pick(s.custom, generalKeys),
  customPrice: pick(s.custom, priceKeys),
  items: s.items.map((l) => newItem(l)),
  fees: s.fees.map((l) => newFee(l)),
  feeDocs: s.feeDocs,
  priceMode: "keep",
  id: s.id,
  code: s.code,
  version: s.version,
  status: s.status,
  billed: s.billed,
  fuelBase: s.fuelBase,
  fuelAmount: s.fuelAmount,
  priceListCode: s.priceListCode,
  orig: { vehicleId: s.vehicleId, driverId: s.driverId, day: s.pickupDate },
});

/** "2026-10-21T08:00" (giờ VN) -> ISO có múi giờ */
// Chỉ nhập ngày: nhận hàng tính từ đầu ngày, giao dự kiến tính tới cuối ngày (giao trong ngày đó là đúng hạn)
const startIso = (v: string) => (v ? `${v.slice(0, 10)}T00:00:00+07:00` : "");
const endIso = (v: string) => (v ? `${v.slice(0, 10)}T23:59:59+07:00` : "");
const num = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(",", ".")));
/** Số tiền gõ kiểu "1,500,000" (phẩy ngăn cách nghìn); sai định dạng thì NaN để máy chủ báo lỗi */
/** Gửi máy chủ: số hợp lệ gửi số, gõ sai gửi nguyên chuỗi để máy chủ báo "không hợp lệ" */
const moneyOut = (v: string) => {
  const n = money(v);
  return n !== undefined && Number.isNaN(n) ? v : n;
};
const GENERAL_SYSTEM_KEYS = FORM_SYSTEM_FIELDS.shipments.map((f) => f.key).filter((k) => !PRICE_SYSTEM_KEYS.includes(k));
const money = (v: string) => {
  const n = parseNumberVN(v, true);
  return n === null ? undefined : n;
};

export function OrderForm({
  order,
  canCreatePriceList,
  orderFields,
  shipmentFields,
  orderLayout,
  shipmentLayout,
  canAddField,
  orderFieldRows,
  shipmentFieldRows,
  itemFields,
  itemLayout,
  itemFieldRows,
  edit,
  canCreate = true,
  canCancelTrips = false,
  closeHref,
  podPhotoDefault = true,
}: {
  /** Đơn mới mặc định tích "Khách yêu cầu chụp chứng từ" */
  podPhotoDefault?: boolean;
  order?: {
    id: string;
    code: string;
    customerId: string;
    customerName: string;
  };
  /** Sửa toàn bộ đơn hàng: form nạp sẵn mọi thứ đã nhập */
  edit?: EditOrderInit;
  /** Được thêm chuyến (quyền tạo đơn) */
  canCreate?: boolean;
  /** Được hủy chuyến ngay trong form sửa */
  canCancelTrips?: boolean;
  /** Nút Đóng: quay lại trang trước (không lưu) */
  closeHref?: string;
  canCreatePriceList: boolean;
  /** Trường bổ sung do người dùng tự thêm cho đơn hàng / chuyến */
  orderFields: FieldDef[];
  shipmentFields: FieldDef[];
  /** Thứ tự trường trên biểu mẫu (Quản lý trường dữ liệu → Thứ tự trên biểu mẫu) */
  orderLayout: string[];
  shipmentLayout: string[];
  canAddField: boolean;
  orderFieldRows: CustomFieldRow[];
  shipmentFieldRows: CustomFieldRow[];
  itemFields: FieldDef[];
  itemLayout: string[];
  itemFieldRows: CustomFieldRow[];
}) {
  const [customer, setCustomer] = useState(edit ? edit.customer : { id: order?.customerId ?? "", label: order?.customerName ?? "" });
  const [payer, setPayer] = useState(edit && edit.payer.id !== edit.customer.id ? { ...edit.payer, auto: false } : { id: "", label: "", auto: false });
  const [company, setCompany] = useState(edit?.company ?? { id: "", label: "" });
  // Chọn khách hàng: tự điền khách thanh toán mặc định (thiết lập trong hồ sơ khách hàng); chọn tay thì không ghi đè
  const pickCustomer = (id: string, label: string) => {
    setCustomer({ id, label });
    if (payer.id && !payer.auto) return;
    if (!id) return setPayer({ id: "", label: "", auto: false });
    customerDefaultPayer(id).then((r) => {
      if (r.ok) setPayer(r.data ? { ...r.data, auto: true } : { id: "", label: "", auto: false });
    });
  };
  const [orderDate, setOrderDate] = useState(edit?.orderDate ?? todayVN());
  const [notes, setNotes] = useState(edit?.notes ?? "");
  const [orderCustom, setOrderCustom] = useState<Record<string, unknown>>(() =>
    edit
      ? pick(
          edit.custom,
          orderFields.map((f) => f.key),
        )
      : {},
  );
  const [rows, setRows] = useState<Row[]>(() => {
    if (!edit) return [{ ...newRow(undefined, podPhotoDefault), key: 0 }]; // khóa cố định để máy chủ và trình duyệt sinh cùng id
    const priceKeys = shipmentFields.filter((f) => PRICE_FIELD_TYPES.includes(f.type)).map((f) => f.key);
    const generalKeys = shipmentFields.filter((f) => !PRICE_FIELD_TYPES.includes(f.type)).map((f) => f.key);
    // Khóa theo thứ tự để máy chủ và trình duyệt sinh cùng id
    return edit.shipments.map((s, i) => ({
      ...rowFromShipment(s, generalKeys, priceKeys),
      key: -(i + 1),
    }));
  });
  const lockedHeader = Boolean(edit?.billed);
  const oSys = systemSettingsOf("transport_orders", orderFieldRows);
  const [pending, start] = useTransition();
  const router = useRouter();

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const shipmentPayload = (s: Row) => ({
    pickupAt: startIso(s.pickupAt),
    expectedDeliveryAt: endIso(s.expectedDeliveryAt),
    pickupLocationId: s.pickupLocationId,
    deliveryLocationId: s.deliveryLocationId,
    emptyReturnLocationId: s.emptyReturnLocationId,
    offrouteReturnLocationId: s.offrouteReturnLocationId,
    tripOrder: s.tripOrder.trim() === "" ? null : Number(s.tripOrder),
    vehicleTypeId: s.vehicleTypeId,
    vehicleId: s.vehicleId,
    driverId: s.driverId,
    priceListId: s.priceListId,
    unitPrice: moneyOut(s.unitPrice),
    pricingUnit: s.pricingUnit,
    quantity: num(s.quantity),
    surchargeAmount: moneyOut(s.surchargeAmount),
    fuelSupportRate: num(s.fuelSupportRate),
    notes: s.notes,
    podPhotoRequired: s.podPhotoRequired,
    custom: { ...s.custom, ...s.customPrice },
    items: itemsPayload(s.items),
    fees: feesPayload(s.fees),
  });

  function submitEdit(e: EditOrderInit) {
    if (!customer.id) return void toast.error("Vui lòng chọn khách hàng.");
    const busy = rows.findIndex((r) => r.cancel === undefined && needsDayCheck(r) && r.vehicleDay?.blocked);
    if (busy >= 0) return void toast.error(`Chuyến ${busy + 1}: xe đã có chuyến cùng ngày, tích "Vẫn giao cho xe này" và nhập thứ tự chuyến của xe.`);
    const noReason = rows.findIndex((r) => r.cancel !== undefined && r.cancel.trim().length < 3);
    if (noReason >= 0) return void toast.error(`Chuyến ${noReason + 1}: nhập lý do hủy (ít nhất 3 ký tự).`);
    start(async () => {
      const r = await updateOrderFull({
        orderId: e.id,
        customerId: customer.id,
        payerCustomerId: payer.id,
        companyEntityId: company.id,
        orderDate,
        notes,
        custom: orderCustom,
        shipments: rows.map((s) => ({
          ...shipmentPayload(s),
          id: s.id,
          version: s.version,
          priceMode: s.priceMode,
          cancelReason: s.cancel?.trim() || undefined,
          vehicleDayOrder: needsDayCheck(s) ? (s.vehicleId ? (s.vehicleDay?.order ?? null) : null) : undefined,
        })),
        otherOrders: rows.flatMap((s) => (s.cancel === undefined && s.vehicleId && needsDayCheck(s) ? (s.vehicleDay?.others ?? []) : [])),
      });
      if (!r.ok || !r.data)
        return void toast.error(r.ok ? "Không lưu được đơn hàng" : r.error, {
          duration: 12000,
        });
      // Tệp hóa đơn chi hộ: chuyến đã có tải theo id sẵn có, chuyến mới thêm theo id vừa tạo
      const newIds = new Map(r.data.newShipments.map((x) => [x.index, x.id]));
      const fileErrors: string[] = [];
      for (const [i, s] of rows.entries()) {
        const sid = s.id ?? newIds.get(i);
        if (!sid || s.cancel !== undefined || !countFeeFiles(s.feeFiles)) continue;
        const err = await uploadFeeFiles(sid, s.feeFiles);
        if (err) fileErrors.push(`Chuyến ${i + 1}: ${err}`);
      }
      if (fileErrors.length) toast.warning(fileErrors.join(" "), { duration: 15000 });
      const extra = [r.data.created ? `thêm ${r.data.created} chuyến` : "", r.data.cancelled ? `hủy ${r.data.cancelled} chuyến` : ""].filter(Boolean).join(", ");
      toast.success(`Đã lưu đơn ${e.code}${extra ? ` (${extra})` : ""}.`);
      if (r.data.warning) toast.warning(r.data.warning, { duration: 15000 });
      router.push(`/dieu-phoi/don-hang/${e.id}`);
      router.refresh();
    });
  }

  function submit() {
    if (edit) return submitEdit(edit);
    if (!order && !customer.id) return void toast.error("Vui lòng chọn khách hàng.");
    const busy = rows.findIndex((r) => r.vehicleDay?.blocked);
    if (busy >= 0) return void toast.error(`Chuyến ${busy + 1}: xe đã có chuyến cùng ngày, tích "Vẫn giao cho xe này" và nhập thứ tự chuyến của xe.`);
    start(async () => {
      const r = await createOrder({
        orderId: order?.id,
        customerId: order ? undefined : customer.id,
        payerCustomerId: payer.id,
        orderDate,
        notes,
        custom: orderCustom,
        shipments: rows.map((s) => ({
          ...shipmentPayload(s),
          pricingUnit: s.pricingUnit === "other" ? undefined : s.pricingUnit,
          vehicleDayOrder: s.vehicleId ? (s.vehicleDay?.order ?? null) : null,
        })),
        otherOrders: rows.flatMap((s) => (s.vehicleId ? (s.vehicleDay?.others ?? []) : [])),
      });
      if (!r.ok || !r.data) return void toast.error(r.ok ? "Không lưu được đơn hàng" : r.error);
      const fileErrors: string[] = [];
      for (const [i, s] of rows.entries()) {
        const sid = r.data.shipments[i]?.id;
        if (!sid || !countFeeFiles(s.feeFiles)) continue;
        const err = await uploadFeeFiles(sid, s.feeFiles);
        if (err) fileErrors.push(`${r.data.shipments[i].shipment_code}: ${err}`);
      }
      toast.success(`Đã lưu ${r.data.shipments.length} chuyến vào đơn ${r.data.order_code}.`);
      if (fileErrors.length) toast.warning(fileErrors.join(" "), { duration: 15000 });
      if (r.data.itemsError) toast.warning(r.data.itemsError, { duration: 15000 });
      router.push(`/dieu-phoi/don-hang/${r.data.order_id}`);
    });
  }

  return (
    <div className="space-y-4">
      {order ? null : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Thông tin đơn hàng</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lockedHeader ? (
              <p className="text-sm text-amber-700">
                Đơn đã có chuyến lập công nợ: không đổi được khách hàng, khách thanh toán, đơn vị nội bộ (hủy phiếu công nợ trước). Các ô khác vẫn sửa được.
              </p>
            ) : edit ? (
              <p className="text-xs text-muted-foreground">Đổi khách hàng không tự đổi giá các chuyến: bấm “Tính lại theo bảng giá” ở từng chuyến nếu cần.</p>
            ) : null}
            <CustomFieldsEditor
              fields={orderFields}
              idPrefix="order-cf-"
              initial={edit ? orderCustom : undefined}
              onChange={setOrderCustom}
              order={orderLayout}
              slots={{
                customer_id: (
                  <div className="space-y-1.5 lg:col-span-2">
                    <SysLabel s={oSys} k="customer_id" htmlFor="order-customer" suffix=" *">Khách hàng</SysLabel>
                    <ReferenceSelect id="order-customer" refKey="customers" value={customer.id} initialLabel={customer.label} onChange={pickCustomer} disabled={lockedHeader} />
                  </div>
                ),
                payer_customer_id: (
                  <div className="space-y-1.5">
                    <SysLabel s={oSys} k="payer_customer_id" htmlFor="order-payer">Khách thanh toán</SysLabel>
                    <ReferenceSelect
                      key={payer.auto ? `auto-${payer.id}` : "manual"}
                      id="order-payer"
                      refKey="customers"
                      value={payer.id}
                      initialLabel={payer.label}
                      onChange={(id, label) => setPayer({ id, label, auto: false })}
                      allowQuickCreate={false}
                      disabled={lockedHeader}
                    />
                    <p className="text-xs text-muted-foreground">
                      {payer.auto ? "Tự điền theo hồ sơ khách hàng, đổi được." : "Bỏ trống nếu chính khách hàng thanh toán. Đặt sẵn trong hồ sơ khách hàng để tự điền."}
                    </p>
                  </div>
                ),
                ...(edit
                  ? {
                      company_entity_id: (
                        <div className="space-y-1.5">
                          <Label htmlFor="order-company">Đơn vị nội bộ (công ty xuất hóa đơn)</Label>
                          <ReferenceSelect
                            id="order-company"
                            refKey="company_entities"
                            value={company.id}
                            initialLabel={company.label}
                            disabled={lockedHeader}
                            onChange={(id, label) => setCompany({ id, label })}
                          />
                        </div>
                      ),
                    }
                  : {}),
                order_date: (
                  <div className="space-y-1.5">
                    <SysLabel s={oSys} k="order_date" htmlFor="order-date">Ngày đơn hàng</SysLabel>
                    <Input id="order-date" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
                  </div>
                ),
                notes: (
                  <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
                    <SysLabel s={oSys} k="notes" htmlFor="order-notes">Ghi chú đơn hàng</SysLabel>
                    <Textarea id="order-notes" className="min-h-14" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
                  </div>
                ),
              }}
            />
            {canAddField ? <AddFieldButton module="transport_orders" customRows={orderFieldRows} label="Thêm trường cho đơn hàng" /> : null}
          </CardContent>
        </Card>
      )}

      {rows.map((row, i) => (
        <ShipmentEditor
          key={row.key}
          index={i}
          row={row}
          customerId={customer.id}
          canCreatePriceList={canCreatePriceList}
          shipmentFields={shipmentFields}
          shipmentLayout={shipmentLayout}
          canAddField={canAddField}
          shipmentFieldRows={shipmentFieldRows}
          itemFields={itemFields}
          itemLayout={itemLayout}
          itemFieldRows={itemFieldRows}
          canRemove={!row.id && rows.filter((r) => !r.id || r.cancel === undefined).length > 1}
          canCancel={Boolean(row.id) && canCancelTrips && !row.billed && CANCELLABLE.includes(row.status ?? "")}
          canDuplicate={canCreate}
          edit={Boolean(edit)}
          sameVehicle={rows
            .map((o, j) =>
              j !== i &&
              (!o.id || needsDayCheck(o)) &&
              o.cancel === undefined &&
              o.vehicleId &&
              o.vehicleId === row.vehicleId &&
              o.pickupAt.slice(0, 10) === row.pickupAt.slice(0, 10)
                ? {
                    label: `Chuyến ${j + 1}`,
                    order: o.vehicleDay?.order ?? null,
                    before: j < i,
                  }
                : null,
            )
            .filter((x) => x !== null)}
          onChange={(patch) => update(row.key, patch)}
          onRemove={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
          onDuplicate={() => setRows((rs) => [...rs.slice(0, i + 1), newRow(row), ...rs.slice(i + 1)])}
        />
      ))}

      {/* Thanh lưu/đóng luôn nổi ở đáy màn hình khi cuộn đơn dài */}
      <div className="sticky bottom-0 z-20 -mx-4 flex flex-col-reverse gap-2 border-t bg-background/95 px-4 py-3 sm:-mx-6 sm:px-6 backdrop-blur sm:flex-row sm:justify-between">
        {canCreate ? (
          <Button variant="outline" onClick={() => setRows((rs) => [...rs, newRow(undefined, podPhotoDefault)])} disabled={rows.length >= (edit ? 200 : 100)}>
            <Plus /> Thêm chuyến
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {closeHref ? (
            <Button asChild variant="outline">
              <Link href={closeHref}>
                <X /> Đóng
              </Link>
            </Button>
          ) : null}
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />}{" "}
            {edit ? `Lưu thay đổi đơn ${edit.code}` : order ? `Lưu ${rows.length} chuyến vào đơn ${order.code}` : `Lưu đơn hàng (${rows.length} chuyến)`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ShipmentEditor({
  index,
  row,
  customerId,
  canCreatePriceList,
  shipmentFields,
  shipmentLayout,
  canAddField,
  shipmentFieldRows,
  itemFields,
  itemLayout,
  itemFieldRows,
  canRemove,
  canCancel,
  canDuplicate,
  edit,
  sameVehicle,
  onChange,
  onRemove,
  onDuplicate,
}: {
  index: number;
  row: Row;
  customerId: string;
  canCreatePriceList: boolean;
  shipmentFields: FieldDef[];
  shipmentLayout: string[];
  canAddField: boolean;
  shipmentFieldRows: CustomFieldRow[];
  itemFields: FieldDef[];
  itemLayout: string[];
  itemFieldRows: CustomFieldRow[];
  canRemove: boolean;
  canCancel: boolean;
  canDuplicate: boolean;
  /** Đang ở form sửa đơn */
  edit: boolean;
  /** Chuyến khác trên biểu mẫu chọn cùng xe, cùng ngày */
  sameVehicle: { label: string; order: number | null; before: boolean }[];
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const sSys = systemSettingsOf("shipments", shipmentFieldRows);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [loading, startQuote] = useTransition();
  const [priceDialog, setPriceDialog] = useState(false);
  const [quoteNonce, setQuoteNonce] = useState(0);
  const day = row.pickupAt.slice(0, 10);
  const keep = row.priceMode === "keep";
  const canQuote = !keep && Boolean(row.pickupLocationId && row.deliveryLocationId && /^\d{4}-\d{2}-\d{2}$/.test(day));
  const canAssign = !row.id || ASSIGNABLE.includes(row.status ?? "");
  // Đổi tuyến hoặc loại xe của chuyến đã có: tìm lại bảng giá như lúc tạo (chuyến đã lập công nợ giữ nguyên giá)
  const routeChange = (patch: Partial<Row>) =>
    onChange({
      ...patch,
      ...(keep && !row.billed ? { priceMode: "quote" as const } : {}),
    });

  useEffect(() => {
    if (!canQuote) return;
    const t = setTimeout(() => {
      startQuote(async () => {
        const r = await quoteShipment({
          customerId,
          pickupId: row.pickupLocationId,
          deliveryId: row.deliveryLocationId,
          vehicleTypeId: row.vehicleTypeId,
          onDate: day,
        });
        if (r.ok && r.data) {
          setQuote(r.data);
          setQuoteError("");
        } else if (!r.ok) setQuoteError(r.error);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [canQuote, customerId, row.pickupLocationId, row.deliveryLocationId, row.vehicleTypeId, day, quoteNonce]);

  const shownQuote = canQuote ? quote : null;
  const candidates = shownQuote?.candidates ?? [];
  const top = candidates[0];
  const tied = top ? candidates.filter((c) => c.specificity === top.specificity && c.priority === top.priority) : [];
  const ambiguous = tied.length > 1;
  const chosen = candidates.find((c) => c.id === row.priceListId) ?? (ambiguous ? undefined : top);
  const manual = Boolean(shownQuote) && candidates.length === 0;

  // Xem trước số tiền (máy chủ tính lại khi lưu)
  const qty = num(row.quantity) ?? 1;
  const unitPrice = chosen ? chosen.unit_price : (money(row.unitPrice) || 0);
  const unit = chosen ? chosen.pricing_unit : row.pricingUnit;
  const surcharge = money(row.surchargeAmount) ?? (chosen ? chosen.surcharge_amount : 0);
  const freight = Math.round(unitPrice * qty);
  const rule = shownQuote?.fuel_rule;
  const manualRate = num(row.fuelSupportRate);
  const rate = keep ? (manualRate ?? null) : (manualRate ?? chosen?.fuel_support_rate ?? rule?.rate_percent ?? null);
  const base = keep
    ? rate === null
      ? null
      : (row.fuelBase ?? "freight_revenue")
    : manualRate !== undefined || chosen?.fuel_support_rate != null
      ? "freight_revenue"
      : (rule?.calculation_base ?? null);
  const rateSource = manualRate !== undefined ? "nhập tay" : chosen?.fuel_support_rate != null ? `bảng giá ${chosen.code}` : rule ? "quy tắc hỗ trợ dầu" : null;
  const fuel =
    rate === null || base === null
      ? 0
      : keep && !["freight_revenue", "unit_price", "total_revenue"].includes(base)
        ? (row.fuelAmount ?? 0)
        : base === "freight_revenue"
          ? Math.round((freight * rate) / 100)
          : base === "unit_price"
            ? Math.round((unitPrice * rate) / 100)
            : base === "total_revenue"
              ? Math.round(((freight + surcharge) * rate) / 100)
              : null;
  const [feeCatalog] = useFeeCatalog();
  const fees = feeTotals(row.fees, feeCatalog);
  const id = (k: string) => `s${row.key}-${k}`;
  const generalFields = shipmentFields.filter((f) => !PRICE_FIELD_TYPES.includes(f.type));
  const priceFields = shipmentFields.filter((f) => PRICE_FIELD_TYPES.includes(f.type));
  const quoteReady = keep || (canQuote && !(loading && !quote) && !quoteError);
  const priceReady = keep || (quoteReady && Boolean(chosen || manual));
  const manualInputs = keep || manual;
  // Ô hệ thống của khung Giá chưa có trong thứ tự đã lưu thì đứng trước trường bổ sung
  const priceOrder = shipmentLayout.filter((k) => !PRICE_SYSTEM_KEYS.includes(k));
  // "Tính theo" nằm cạnh trường "Loại hình vận chuyển" (nếu có), không thì theo thứ tự đã sắp
  const serviceKind = generalFields.find((f) => /lo[aạ]i\s*h[iì]nh/i.test(f.label))?.key;
  const generalOrder = (() => {
    const base = (shipmentLayout.length ? shipmentLayout : [...GENERAL_SYSTEM_KEYS, ...generalFields.map((f) => f.key)]).filter((k) => k !== "pricing_unit");
    // "Tính theo" đứng ngay sau "Loại hình vận chuyển"; chưa có trường đó thì đứng sau Số lượng
    const at = base.indexOf(serviceKind && base.includes(serviceKind) ? serviceKind : "quantity");
    base.splice(at < 0 ? base.length : at + 1, 0, "pricing_unit");
    return base;
  })();
  const fuelLabel = rate !== null ? `${formatNumber(rate)}%` : "% dầu";
  const freightFormula = `Đơn giá${qty !== 1 ? ` × ${formatNumber(qty)}` : ""} × (1 + ${fuelLabel})${surcharge ? " + phụ phí bảng giá" : ""}`;
  const transportTotal = !priceReady ? 0 : fuel === null ? null : freight + surcharge + fuel + fees.byRole.freight;
  const priceContext = {
    unit_price: unitPrice,
    quantity: qty,
    freight_amount: freight,
    surcharge_amount: surcharge,
    fuel_support_rate: rate,
    fuel_support_amount: fuel,
    total_revenue: fuel === null ? null : freight + surcharge + fuel,
  };

  const anchor = row.code ? `chuyen-${row.code}` : undefined;
  const title = (
    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
      Chuyến {index + 1}
      {row.code ? (
        <span className="font-mono text-sm text-muted-foreground">{row.code}</span>
      ) : row.orig ? null : edit ? (
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-normal text-primary">Chuyến mới</span>
      ) : null}
      {row.status ? <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal">{shipmentStatus(row.status).label}</span> : null}
    </CardTitle>
  );

  if (row.cancel !== undefined) {
    return (
      <Card id={anchor} className="border-destructive/50 bg-destructive/5">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          {title}
          <Button variant="ghost" size="sm" onClick={() => onChange({ cancel: undefined })}>
            <Undo2 /> Không hủy nữa
          </Button>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Label htmlFor={`s${row.key}-cancel`}>Chuyến này sẽ bị hủy khi bấm Lưu. Lý do hủy *</Label>
          <Input
            id={`s${row.key}-cancel`}
            value={row.cancel}
            maxLength={500}
            placeholder="VD: Khách báo hủy, nhập trùng chuyến"
            onChange={(e) => onChange({ cancel: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Chuyến hủy không bị xóa, vẫn xem được trong lịch sử của đơn.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id={anchor}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        {title}
        <div className="flex gap-1">
          {canDuplicate ? (
            <Button variant="ghost" size="sm" onClick={onDuplicate} title="Tạo chuyến mới giống chuyến này">
              <Copy /> Nhân bản
            </Button>
          ) : null}
          {canRemove ? (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={onRemove}>
              <Trash2 /> Bỏ
            </Button>
          ) : null}
          {canCancel ? (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onChange({ cancel: "" })}>
              <Ban /> Hủy chuyến
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <CustomFieldsEditor
          fields={generalFields}
          idPrefix={`s${row.key}-cf-`}
          initial={row.custom}
          onChange={(custom) => onChange({ custom })}
          order={generalOrder}
          className="gap-x-2 gap-y-2 sm:grid-cols-3 lg:grid-cols-6 [&_label]:text-xs [&>div]:space-y-1"
          context={{
            ...row.customPrice,
            unit_price: unitPrice,
            quantity: qty,
            freight_amount: freight,
            surcharge_amount: surcharge,
            fuel_support_rate: rate,
            fuel_support_amount: fuel,
            total_revenue: fuel === null ? null : freight + surcharge + fuel,
          }}
          slots={{
            pickup_at: (
              <div className="space-y-1.5">
                <SysLabel s={sSys} k="pickup_at" htmlFor={id("pickup-at")} suffix=" *">Ngày nhận hàng</SysLabel>
                <Input id={id("pickup-at")} type="date" value={row.pickupAt.slice(0, 10)} onChange={(e) => onChange({ pickupAt: e.target.value })} />
              </div>
            ),
            expected_delivery_at: (
              <div className="space-y-1.5">
                <SysLabel s={sSys} k="expected_delivery_at" htmlFor={id("delivery-at")}>Ngày giao dự kiến</SysLabel>
                <Input
                  id={id("delivery-at")}
                  type="date"
                  min={row.pickupAt.slice(0, 10)}
                  value={row.expectedDeliveryAt.slice(0, 10)}
                  onChange={(e) => onChange({ expectedDeliveryAt: e.target.value })}
                />
              </div>
            ),
            vehicle_type_id: (
              <div className="space-y-1.5">
                <SysLabel s={sSys} k="vehicle_type_id" htmlFor={id("vtype")}>Loại xe</SysLabel>
                <ReferenceSelect id={id("vtype")} refKey="vehicle_types" value={row.vehicleTypeId} onChange={(v) => routeChange({ vehicleTypeId: v, priceListId: "" })} />
              </div>
            ),
            quantity: (
              <div className="space-y-1.5">
                <SysLabel s={sSys} k="quantity" htmlFor={id("qty")} suffix={` (${PRICING_UNITS[unit] ?? unit})`}>Số lượng</SysLabel>
                <Input id={id("qty")} type="number" min="0.001" step="any" value={row.quantity} disabled={row.billed} onChange={(e) => onChange({ quantity: e.target.value })} />
              </div>
            ),
            pickup_location_id: (
              <div className="space-y-1 lg:col-span-2">
                <SysLabel s={sSys} k="pickup_location_id" htmlFor={id("pickup")} suffix=" *">Điểm nhận</SysLabel>
                <ReferenceSelect id={id("pickup")} refKey="locations" value={row.pickupLocationId} onChange={(v) => routeChange({ pickupLocationId: v, priceListId: "" })} />
              </div>
            ),
            delivery_location_id: (
              <div className="space-y-1 lg:col-span-2">
                <SysLabel s={sSys} k="delivery_location_id" htmlFor={id("delivery")} suffix=" *">Điểm giao</SysLabel>
                <ReferenceSelect id={id("delivery")} refKey="locations" value={row.deliveryLocationId} onChange={(v) => routeChange({ deliveryLocationId: v, priceListId: "" })} />
              </div>
            ),
            empty_return_location_id: (
              <div className="space-y-1 lg:col-span-2">
                <SysLabel s={sSys} k="empty_return_location_id" htmlFor={id("empty-return")}>Điểm hạ rỗng</SysLabel>
                <ReferenceSelect id={id("empty-return")} refKey="locations" value={row.emptyReturnLocationId} onChange={(v) => onChange({ emptyReturnLocationId: v })} />
              </div>
            ),
            offroute_return_location_id: (
              <div className="space-y-1 lg:col-span-2">
                <SysLabel s={sSys} k="offroute_return_location_id" htmlFor={id("offroute-return")}>Điểm hạ rỗng trái tuyến</SysLabel>
                <ReferenceSelect id={id("offroute-return")} refKey="locations" value={row.offrouteReturnLocationId} onChange={(v) => onChange({ offrouteReturnLocationId: v })} />
              </div>
            ),
            trip_order: (
              <div className="space-y-1">
                <SysLabel s={sSys} k="trip_order" htmlFor={id("trip-order")}>Thứ tự chuyến</SysLabel>
                <Input
                  id={id("trip-order")}
                  inputMode="numeric"
                  placeholder="1, 2…"
                  title="Tài xế phải nhận chuyến đúng thứ tự trong ngày"
                  value={row.tripOrder}
                  onChange={(e) => onChange({ tripOrder: e.target.value.replace(/\D/g, "").slice(0, 2) })}
                />
              </div>
            ),
            vehicle_id: (
              <div className="space-y-1 lg:col-span-2">
                <SysLabel s={sSys} k="vehicle_id" htmlFor={id("vehicle")} suffix=" (có thể chọn sau)">Xe</SysLabel>
                <VehicleSourcePicker
                  id={id("vehicle")}
                  shipmentId={row.id}
                  value={row.vehicleId}
                  disabled={!canAssign}
                  onSourceChange={(src) => onChange(src === "3pl" ? { vehicleSource: src, vehicleDay: undefined } : { vehicleSource: src })}
                  onChange={(v) => {
                    onChange({ vehicleId: v });
                    if (v) {
                      vehicleDefaultDriver(v).then((r) => {
                        if (!r.ok || !r.data) return;
                        const patch: Partial<Row> = {};
                        if (r.data.driverId && (!row.driverId || r.data.outsourced) && r.data.driverId !== row.driverId)
                          Object.assign(patch, {
                            driverId: r.data.driverId,
                            driverKey: row.driverKey + 1,
                          });
                        if (r.data.vehicleTypeId && !row.vehicleTypeId)
                          Object.assign(patch, {
                            vehicleTypeId: r.data.vehicleTypeId,
                            priceListId: "",
                          });
                        if (Object.keys(patch).length) onChange(patch);
                      });
                    }
                  }}
                />
                {canAssign && row.vehicleSource !== "3pl" ? <MonthTripHint kind="vehicle" id={row.vehicleId} day={day} excludeShipmentId={row.id} /> : null}
                {needsDayCheck(row) && row.vehicleSource !== "3pl" ? (
                  <VehicleDayConflict vehicleId={row.vehicleId} day={day} excludeShipmentId={row.id} sameForm={sameVehicle} onStateChange={(st) => onChange({ vehicleDay: st })} />
                ) : null}
                {!canAssign ? <p className="text-xs text-muted-foreground">Chuyến đang chạy hoặc đã xong: không đổi xe, tài xế.</p> : null}
              </div>
            ),
            driver_id: (
              <div className="space-y-1 lg:col-span-2">
                <SysLabel s={sSys} k="driver_id" htmlFor={id("driver")} suffix=" (có thể phân công sau)">Tài xế</SysLabel>
                <ReferenceSelect key={`${row.driverKey}-${row.vehicleSource ?? "internal"}`} id={id("driver")} refKey={row.vehicleSource === "3pl" ? "drivers" : "drivers_internal"} value={row.driverId} disabled={!canAssign} onChange={(v) => onChange({ driverId: v })} />
                {canAssign && row.vehicleSource !== "3pl" ? <MonthTripHint kind="driver" id={row.driverId} day={day} excludeShipmentId={row.id} /> : null}
                {row.orig && row.driverId !== row.orig.driverId && row.driverId ? (
                  <p className="text-xs text-amber-700">Đổi tài xế: chuyến sẽ chờ Giám đốc duyệt lại trước khi tài xế mới thấy chuyến.</p>
                ) : null}
              </div>
            ),
            pricing_unit: (
              <div className="space-y-1">
                <SysLabel s={sSys} k="pricing_unit" htmlFor={id("unit")}>Tính theo</SysLabel>
                {manualInputs ? (
                  <NativeSelect
                    id={id("unit")}
                    value={row.pricingUnit}
                    disabled={row.billed}
                    onChange={(e) =>
                      onChange({
                        pricingUnit: e.target.value as Row["pricingUnit"],
                      })
                    }
                  >
                    <option value="trip">Chuyến</option>
                    <option value="km">Km</option>
                    <option value="ton">Tấn</option>
                    {row.pricingUnit === "other" ? <option value="other">Khác</option> : null}
                  </NativeSelect>
                ) : (
                  <div id={id("unit")} className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm" title="Theo bảng giá">
                    {PRICING_UNITS[unit] ?? chosen?.pricing_unit_label ?? unit}
                  </div>
                )}
              </div>
            ),
            notes: (
              <div className="space-y-1 lg:col-span-2">
                <SysLabel s={sSys} k="notes" htmlFor={id("notes")}>Ghi chú cho tài xế</SysLabel>
                <Input id={id("notes")} value={row.notes} onChange={(e) => onChange({ notes: e.target.value })} maxLength={1000} />
                <label htmlFor={id("pod")} className="flex items-center gap-2 pt-1 text-sm">
                  <input id={id("pod")} type="checkbox" className="size-4" checked={row.podPhotoRequired} onChange={(e) => onChange({ podPhotoRequired: e.target.checked })} />
                  Khách yêu cầu chụp chứng từ <span className="text-muted-foreground">(tài xế bắt buộc chụp ảnh giao hàng; không tích thì app tài xế bỏ qua bước chụp)</span>
                </label>
              </div>
            ),
          }}
        />
        {canAddField ? <AddFieldButton module="shipments" customRows={shipmentFieldRows} label="Thêm trường cho chuyến" /> : null}

        <fieldset disabled={row.status === "closed"} className="min-w-0 space-y-1">
          {row.status === "closed" ? <p className="text-xs text-muted-foreground">Chuyến đã đóng: không sửa hàng hóa.</p> : null}
          <ItemsEditor
            value={row.items}
            onChange={(items) => onChange({ items })}
            fields={itemFields}
            layout={itemLayout}
            canAddField={canAddField}
            fieldRows={itemFieldRows}
            idPrefix={`s${row.key}-it-`}
          />
        </fieldset>

        <fieldset disabled={row.billed} className="min-w-0 space-y-3 rounded-lg border bg-muted/30 p-3">
          {row.billed ? (
            <p className="text-sm text-amber-700">Chuyến đã lập công nợ: không sửa được giá, phí, số lượng (hủy phiếu công nợ trước).</p>
          ) : keep ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                Giá đang lưu trên chuyến
                {row.priceListCode ? (
                  <>
                    {" "}
                    (bảng giá <b>{row.priceListCode}</b>)
                  </>
                ) : null}
                , sửa trực tiếp được. Đổi điểm nhận, điểm giao hoặc loại xe thì hệ thống tự tìm lại bảng giá.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onChange({
                    priceMode: "quote",
                    surchargeAmount: "",
                    fuelSupportRate: "",
                  })
                }
              >
                <RefreshCw /> Tính lại theo bảng giá
              </Button>
            </div>
          ) : !canQuote ? (
            <p className="text-sm text-muted-foreground">Chọn điểm nhận, điểm giao và ngày nhận hàng để hệ thống tìm bảng giá.</p>
          ) : loading && !quote ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Đang tìm bảng giá…
            </p>
          ) : quoteError ? (
            <Alert variant="destructive">
              <AlertDescription>{quoteError}</AlertDescription>
            </Alert>
          ) : ambiguous ? (
            <div className="space-y-1.5">
              <Label htmlFor={id("pl")}>Có {tied.length} bảng giá ngang nhau, vui lòng chọn *</Label>
              <NativeSelect id={id("pl")} value={row.priceListId} onChange={(e) => onChange({ priceListId: e.target.value })} aria-invalid={!row.priceListId}>
                <option value="">Chọn bảng giá…</option>
                {tied.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code}: {formatVND(c.unit_price)}/{c.pricing_unit === "other" ? c.pricing_unit_label : PRICING_UNITS[c.pricing_unit]}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : chosen ? (
            <p className="text-sm">
              Bảng giá áp dụng <b>{chosen.code}</b>: {formatVND(chosen.unit_price)}/{PRICING_UNITS[chosen.pricing_unit] ?? chosen.pricing_unit_label}
              {shownQuote?.route ? <span className="text-muted-foreground"> · tuyến {shownQuote.route.name}</span> : null}
            </p>
          ) : manual ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-amber-700">Không có bảng giá phù hợp: nhập đơn giá thủ công, hoặc để trống và nhập sau ở Quản lý chuyến xe.</p>
              {canCreatePriceList ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setPriceDialog(true)}>
                  <Plus /> Tạo bảng giá cho tuyến này
                </Button>
              ) : null}
            </div>
          ) : null}
          {priceFields.length ? (
            <CustomFieldsEditor
              fields={priceFields}
              idPrefix={`s${row.key}-pf-`}
              initial={row.customPrice}
              onChange={(customPrice) => onChange({ customPrice })}
              order={priceOrder}
              context={{ ...row.custom, ...priceContext }}
            />
          ) : null}
          <FeesEditor
            value={row.fees}
            onChange={(fees) => onChange({ fees })}
            idPrefix={`s${row.key}-fee-`}
            files={row.feeFiles}
            onFilesChange={(feeFiles) => onChange({ feeFiles })}
            shipmentId={row.id}
            savedFiles={row.feeDocs}
            freightBase={priceReady ? (fuel === null ? null : freight + surcharge + fuel) : 0}
            freightLabel={freightFormula}
            freightHead={
              <>
                <FreightRow label={`${systemLabel(sSys, "unit_price", "Đơn giá")} (đ)`} help={sSys.unit_price?.help} htmlFor={id("price")}>
                  {manualInputs ? (
                    <Input
                      id={id("price")}
                      inputMode="numeric"
                      className="h-8 text-right tabular-nums"
                      placeholder="Chưa có giá"
                      value={row.unitPrice}
                      onChange={(e) => onChange({ unitPrice: e.target.value })}
                      onBlur={(e) => {
                        const n = money(e.target.value);
                        if (n !== null && !Number.isNaN(n)) onChange({ unitPrice: formatNumber(n) });
                      }}
                    />
                  ) : (
                    <div id={id("price")} className="flex h-8 items-center justify-end rounded-md border bg-muted/40 px-2 text-sm tabular-nums">
                      {chosen ? formatNumber(chosen.unit_price) : "—"}
                    </div>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {!priceReady
                      ? "Chọn tuyến, ngày nhận để tìm bảng giá"
                      : `/${PRICING_UNITS[unit] ?? unit}${qty !== 1 ? ` × ${formatNumber(qty)} = ${formatVND(freight)}` : ""}${manualInputs && !row.unitPrice ? " · để trống: chuyến ghi “Chưa có giá”, nhập sau" : ""}`}
                  </span>
                </FreightRow>
                <FreightRow label={`${systemLabel(sSys, "fuel_support_rate", "Tỷ lệ hỗ trợ dầu")} (%)`} help={sSys.fuel_support_rate?.help} htmlFor={id("fuel")}>
                  <Input
                    id={id("fuel")}
                    inputMode="decimal"
                    className="h-8 text-right tabular-nums"
                    disabled={!quoteReady}
                    placeholder={chosen?.fuel_support_rate != null ? String(chosen.fuel_support_rate) : rule?.rate_percent != null ? String(rule.rate_percent) : "Nhập % khách cho"}
                    value={row.fuelSupportRate}
                    onChange={(e) => onChange({ fuelSupportRate: e.target.value })}
                  />
                  <span className="text-xs text-muted-foreground">
                    {fuel === null ? "Tính theo định mức khi lưu" : `Tiền dầu ${formatVND(fuel)}`}
                    {rateSource && manualRate === undefined ? ` · tự động (${rateSource}), gõ số để đổi` : ""}
                    {!rateSource && !keep ? " · khách này chưa có % dầu (khai báo ở Bảng giá → Quy tắc hỗ trợ dầu)" : ""}
                  </span>
                </FreightRow>
                {surcharge || money(row.surchargeAmount) ? (
                  <FreightRow label={systemLabel(sSys, "surcharge_amount", "Phụ phí cố định (bảng giá)")} help={sSys.surcharge_amount?.help} htmlFor={id("surcharge")}>
                    <Input
                      id={id("surcharge")}
                      inputMode="numeric"
                      className="h-8 text-right tabular-nums"
                      placeholder={chosen?.surcharge_amount ? formatNumber(chosen.surcharge_amount) : "0"}
                      value={row.surchargeAmount}
                      onChange={(e) => onChange({ surchargeAmount: e.target.value })}
                    />
                    <span className="text-xs text-muted-foreground">Khoản cộng thêm cố định ghi trong bảng giá của tuyến; gõ 0 để bỏ.</span>
                  </FreightRow>
                ) : null}
              </>
            }
          />
          {priceReady ? (
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
              <Money label="Tổng phí vận chuyển" value={transportTotal} note="Tính khi lưu" strong />
              <Money label="Tổng phí chi hộ" value={fees.byRole.pass_through} />
              <Money label="Tổng phí tờ khai" value={fees.byRole.declaration} />
              <Money label="Tổng phí bốc xếp" value={fees.byRole.loading} />
              {fees.byRole.other ? <Money label="Phí khác" value={fees.byRole.other} /> : null}
              <Money label="Khách phải trả" value={transportTotal === null ? null : transportTotal - fees.byRole.freight + fees.revenue + fees.passThrough} note="Tính khi lưu" strong />
            </dl>
          ) : null}
          {canAddField ? <AddFieldButton module="shipments" customRows={shipmentFieldRows} label="Thêm trường giá (tiền, %, công thức)" /> : null}
        </fieldset>
      </CardContent>
      {canCreatePriceList ? (
        <EntityFormDialog
          entityKey="price_lists"
          customRows={[]}
          open={priceDialog}
          onOpenChange={setPriceDialog}
          initialValues={{
            customer_id: customerId || null,
            pickup_location_id: row.pickupLocationId || null,
            delivery_location_id: row.deliveryLocationId || null,
            vehicle_type_id: row.vehicleTypeId || null,
            unit_price: money(row.unitPrice) ?? null,
            pricing_unit: row.pricingUnit,
            effective_from: day,
          }}
          onSaved={() => {
            onChange({ priceListId: "", unitPrice: "" });
            setQuoteNonce((n) => n + 1);
          }}
        />
      ) : null}
    </Card>
  );
}

/** Nhãn ô hệ thống: dùng tên hiển thị + gợi ý đã sửa ở Quản lý trường dữ liệu (nếu có) */
function SysLabel({ s, k, htmlFor, suffix, children }: { s: SystemFieldSettings; k: string; htmlFor: string; suffix?: string; children: string }) {
  const help = s[k]?.help;
  return (
    <>
      <Label htmlFor={htmlFor} title={help || undefined}>
        {systemLabel(s, k, children)}
        {suffix}
      </Label>
      {help ? <p className="-mt-1 text-xs text-muted-foreground">{help}</p> : null}
    </>
  );
}

function FreightRow({ label, help, htmlFor, children }: { label: string; help?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 items-center gap-1.5 sm:grid-cols-[minmax(0,12rem)_9rem_minmax(0,1fr)]">
      <label htmlFor={htmlFor} title={help || label} className="col-span-full truncate text-sm font-medium sm:col-span-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function Money({ label, value, note, strong }: { label: string; value: number | null; note?: string; strong?: boolean }) {
  return (
    <div className="rounded-md bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-semibold text-primary" : "font-medium"}>{value === null ? note : formatVND(value)}</dd>
    </div>
  );
}
