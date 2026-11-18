"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BellRing, CircleDollarSign, ClipboardList, Loader2, Lock, Receipt, Tags, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FeesEditor, countFeeFiles, feeTotals, feesPayload, newFee, numText, uploadFeeFiles, useFeeCatalog, type FeeFiles, type FeeLine } from "@/app/(app)/dieu-phoi/tao-don/fees-editor";
import { saveShipmentFees } from "@/app/(app)/dieu-phoi/actions";
import { CarrierCostsDialog } from "@/components/finance/carrier-dialogs";
import { PricePanel } from "@/components/pricing/price-panel";
import { loadQuickFreight, saveQuickFreightPrice, type QuickFreight } from "@/lib/finance/quick-freight-actions";
import { createClient } from "@/lib/supabase/client";
import { parseNumberVN } from "@/lib/entities/record";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { PRICING_UNITS } from "@/lib/status";
import type { ShipmentListRow } from "@/lib/shipments";
import { cn } from "@/lib/utils";

type Price = { unitPrice: string; fuelRate: string; surcharge: string };
type Tab = "customer" | "price" | "carrier";
type LockInfo = { mine: boolean; holder_name?: string | null; holder_since?: string | null; stale?: boolean; saved_by_name?: string | null; saved_by_me?: boolean };

const num = (s: string) => {
  const v = parseNumberVN(s, true);
  return v === null || Number.isNaN(v) ? null : v;
};
const pct = (s: string) => {
  const v = parseNumberVN(s);
  return v === null || Number.isNaN(v) ? null : v;
};
const hm = (t?: string | null) => (t ? new Date(t).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : "");
const FUEL_CALC = ["freight_revenue", "unit_price", "total_revenue"];

/**
 * Nút "Nhập cước" (làm theo app Khánh Hà): một khung nhập đủ phần thu khách (Đơn giá, % hỗ trợ dầu, phí vận chuyển, chi hộ kèm hóa đơn,
 * tờ khai, bốc xếp…), bảng giá để lấy giá, và với chuyến 3PL là chi phí trả nhà xe. Dùng ở chi tiết chuyến, Điều phối, Quản lý chuyến xe.
 */
export function QuickFreightButton({
  shipmentId,
  code,
  compact,
  className,
  onSaved,
}: {
  shipmentId: string;
  code: string;
  compact?: boolean;
  className?: string;
  onSaved?: (r: ShipmentListRow) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={compact ? "ghost" : "outline"}
        size="sm"
        className={cn(compact ? "h-7 px-2" : undefined, className)}
        title={`Nhập cước, phí thu khách và chi phí 3PL chuyến ${code}`}
        onClick={() => setOpen(true)}
      >
        <CircleDollarSign /> {compact ? "Cước" : "Nhập cước"}
      </Button>
      {open ? <QuickFreightDialog shipmentId={shipmentId} code={code} onClose={() => setOpen(false)} onSaved={onSaved} /> : null}
    </>
  );
}

/** Nút bảng giá nhỏ cạnh ô Đơn giá: mở khung Nhập cước ở tab Bảng giá */
export function PricePickButton({ row, onSaved, className }: { row: ShipmentListRow; onSaved?: (r: ShipmentListRow) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title="Nhập cước: xem bảng giá để lấy đơn giá"
        aria-label={`Bảng giá cho chuyến ${row.shipment_code}`}
        className={cn("shrink-0 rounded p-1 text-primary hover:bg-primary/10", className)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <ClipboardList className="size-4" />
      </button>
      {open ? <QuickFreightDialog shipmentId={row.id} code={row.shipment_code} initialTab="price" onClose={() => setOpen(false)} onSaved={onSaved} /> : null}
    </>
  );
}

/** Ô Đơn giá cước trên bảng Điều phối: số (· % dầu) + nút bảng giá */
export function FreightPriceCell({ row, editable }: { row: ShipmentListRow; editable: boolean }) {
  // Giá vừa lưu ở khung Nhập cước: dùng tới khi trang tải lại dữ liệu mới hơn
  const [saved, setSaved] = useState<ShipmentListRow | null>(null);
  const cur = saved && saved.id === row.id && saved.version >= row.version ? { ...row, ...saved } : row;
  const price = Number(cur.unit_price);
  const text = price ? (
    <span className="tabular-nums">
      {formatNumber(price)}
      {cur.fuel_support_rate !== null ? <span className="text-muted-foreground"> · {formatNumber(cur.fuel_support_rate)}%</span> : null}
    </span>
  ) : (
    <span className="text-amber-700">Chưa có giá</span>
  );
  if (!editable || cur.status === "cancelled") return <div className="truncate text-right">{text}</div>;
  return (
    <div className="flex items-center justify-end gap-1">
      <div className="truncate">{text}</div>
      <PricePickButton row={cur} onSaved={setSaved} />
    </div>
  );
}

/** Khung Nhập cước: chỉ dựng khi mở (bảng nhiều dòng không tải gì trước) */
export function QuickFreightDialog({
  shipmentId,
  code,
  onClose,
  onSaved,
  initialTab = "customer",
}: {
  shipmentId: string;
  code: string;
  onClose: () => void;
  onSaved?: (r: ShipmentListRow) => void;
  initialTab?: Tab;
}) {
  const router = useRouter();
  const [data, setData] = useState<QuickFreight | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [price, setPrice] = useState<Price>({ unitPrice: "", fuelRate: "", surcharge: "" });
  const [picked, setPicked] = useState<string | null>(null);
  const [fees, setFees] = useState<FeeLine[]>([]);
  const [files, setFiles] = useState<FeeFiles>({});
  const [dirty, setDirty] = useState({ price: false, fees: false });
  const [lock, setLock] = useState<LockInfo | null>(null);
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [catalog] = useFeeCatalog();
  const holding = useRef(false);

  function apply(r: Awaited<ReturnType<typeof loadQuickFreight>>) {
    setLoading(false);
    if (!r.ok || !r.data) {
      onClose();
      return void toast.error(r.ok ? "Không tải được chuyến." : r.error);
    }
    const d = r.data;
    setData(d);
    setPrice({
      unitPrice: d.unitPrice ? formatNumber(d.unitPrice) : "",
      fuelRate: d.fuelRate === null ? "" : String(d.fuelRate),
      surcharge: d.surcharge ? formatNumber(d.surcharge) : "",
    });
    setFees(
      d.fees.map((f) =>
        newFee({
          fee_type_id: f.fee_type_id,
          label: f.fee_type?.name ?? "",
          kind: f.fee_kind,
          amount: formatNumber(Number(f.amount)),
          note: f.note ?? "",
          declaration_type_id: f.declaration_type_id ?? "",
          declaration_label: f.declaration?.name ?? "",
          ref_no: f.ref_no ?? "",
          quantity: numText(f.quantity),
          unit_price: numText(f.unit_price),
        }),
      ),
    );
    setFiles({});
    setDirty({ price: false, fees: false });
    if (initialTab === "price" && (!d.canSeePrices || !d.canEditFees)) setTab("customer");
  }

  useEffect(() => {
    let alive = true;
    void loadQuickFreight(shipmentId).then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipmentId]);

  // Khóa sửa chuyến: nhận khi mở khung, báo "còn sửa" mỗi 30 giây, nhả khi đóng
  const rev = data?.rev ?? null;
  useEffect(() => {
    if (rev === null || data?.status === "cancelled") return;
    const supabase = createClient();
    let stop = false;
    const ping = async () => {
      const { data: s, error } = await supabase.rpc("shipment_edit_lock", { p_shipment_id: shipmentId, p_rev: rev });
      if (stop || error) return;
      const st = s as LockInfo;
      holding.current = Boolean(st.mine);
      setLock(st);
    };
    void ping();
    const iv = window.setInterval(() => void ping(), 30_000);
    return () => {
      stop = true;
      window.clearInterval(iv);
      if (holding.current) {
        holding.current = false;
        void supabase.rpc("shipment_edit_unlock", { p_shipment_id: shipmentId });
      }
    };
  }, [rev, shipmentId, data?.status]);

  async function ask() {
    setAsking(true);
    const { data: r, error } = await createClient().rpc("shipment_edit_ask", { p_shipment_id: shipmentId });
    setAsking(false);
    if (error) return void toast.error("Chưa gửi được, thử lại sau.");
    const x = r as { sent: boolean; holder_name?: string };
    toast[x.sent ? "success" : "info"](x.sent ? `Đã báo ${x.holder_name ?? "người đang sửa"} lưu và thoát ra.` : "Người kia đã thoát ra, đóng khung rồi mở lại để sửa.");
  }

  const blocked = Boolean(lock?.holder_name);
  const stale = Boolean(lock?.mine && lock.stale && !lock.saved_by_me);
  const canPrice = Boolean(data?.canEditFees);

  // Tính lại tiền cước, tiền dầu như CSDL (để xem trước Tổng phí vận chuyển)
  const qty = data?.quantity ?? 1;
  const unitPrice = num(price.unitPrice) ?? 0;
  const surcharge = num(price.surcharge) ?? 0;
  const rate = price.fuelRate.trim() === "" ? null : pct(price.fuelRate);
  const freight = Math.round(unitPrice * qty);
  const base = data?.fuelBase ?? (rate !== null ? "freight_revenue" : null);
  const fuel =
    rate === null
      ? 0
      : base && FUEL_CALC.includes(base)
        ? Math.round(((base === "unit_price" ? unitPrice : base === "total_revenue" ? freight + surcharge : freight) * rate) / 100)
        : (data?.fuelAmount ?? 0);
  const totals = feeTotals(fees, catalog);
  const transport = freight + surcharge + fuel + totals.byRole.freight;
  const unit = data ? (PRICING_UNITS[data.pricingUnit] ?? data.pricingUnit) : "";
  const freightLabel = `Đơn giá${qty !== 1 ? ` × ${formatNumber(qty)}` : ""}${rate ? ` × (1 + ${formatNumber(rate)}%)` : ""}${surcharge ? " + phụ phí" : ""}`;
  const customerPass = fees
    .filter((l) => l.fee_type_id && (l.kind ?? catalog?.types.find((t) => t.id === l.fee_type_id)?.fee_kind) === "pass_through" && (num(l.amount) ?? 0) > 0)
    .map((l) => ({ fee_type_id: l.fee_type_id, name: l.label || "Chi hộ", amount: num(l.amount) ?? 0, ref_no: l.ref_no || null, note: l.note || null }));
  const carrierTotal = (data?.carrier?.costs ?? []).reduce((a, c) => a + Number(c.amount), 0);

  function choosePrice(u: number, f: number | null, label: string) {
    setPrice((p) => ({ ...p, unitPrice: formatNumber(Math.round(u)), fuelRate: f === null ? p.fuelRate : String(f) }));
    setDirty((d) => ({ ...d, price: true }));
    setPicked(label);
    setTab("customer");
    toast.success(`Đã lấy giá ${formatNumber(Math.round(u))}${f !== null ? `, dầu ${formatNumber(f)}%` : ""}. Bấm Lưu cước để ghi vào chuyến.`);
  }

  function save() {
    if (!data) return;
    start(async () => {
      const done: string[] = [];
      let savedRow: ShipmentListRow | undefined;
      if (dirty.price && canPrice) {
        if ([price.unitPrice, price.surcharge].some((s) => s.trim() && num(s) === null) || (price.fuelRate.trim() && rate === null))
          return void toast.error("Đơn giá, phụ phí hoặc % hỗ trợ dầu không phải là số.");
        const r = await saveQuickFreightPrice({ id: data.id, version: data.version, unitPrice, surchargeAmount: surcharge, fuelSupportRate: rate });
        if (!r.ok) return void toast.error(r.error);
        savedRow = r.data;
        done.push("giá");
        setDirty((d) => ({ ...d, price: false }));
      }
      if ((dirty.fees || countFeeFiles(files)) && data.canEditFees) {
        const r = await saveShipmentFees({ shipmentId: data.id, fees: feesPayload(fees) });
        if (!r.ok) return void toast.error(done.length ? `Đã lưu ${done.join(", ")} nhưng phí thu khách chưa lưu: ${r.error}` : r.error);
        if (countFeeFiles(files)) {
          const err = await uploadFeeFiles(data.id, files);
          if (err) toast.warning(err, { duration: 15000 });
        }
        done.push("phí thu khách");
        setDirty((d) => ({ ...d, fees: false }));
      }
      toast.success(done.length ? `Chuyến ${data.code}: đã lưu ${done.join(", ")}.` : "Không có gì thay đổi.");
      if (savedRow) onSaved?.(savedRow);
      onClose();
      router.refresh();
    });
  }

  const readOnly = blocked || stale;
  const tabs: [Tab, React.ReactNode, string, string][] = data
    ? [
        ["customer", <Receipt key="i" className="size-4" />, "Cước & phí thu khách", formatVND(transport + totals.revenue - totals.byRole.freight + totals.passThrough)],
        ...(data.canSeePrices && data.canEditFees ? ([["price", <Tags key="i" className="size-4" />, "Bảng giá", ""]] as [Tab, React.ReactNode, string, string][]) : []),
        ...(data.carrier ? ([["carrier", <Truck key="i" className="size-4" />, "Chi phí trả 3PL", formatVND(carrierTotal)]] as [Tab, React.ReactNode, string, string][]) : []),
      ]
    : [];
  return (
    <Dialog open onOpenChange={(o) => !pending && !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nhập cước chuyến {code}</DialogTitle>
          <DialogDescription>
            {data ? (
              <>
                {data.customerName ?? "—"} · {data.routeLabel ?? "—"} · nhận {formatDate(data.pickupAt)}
                <br />
              </>
            ) : null}
            Nhập đơn giá (chưa dầu), % hỗ trợ dầu và các phí thu khách theo nhóm. Tab Bảng giá để lấy giá xe cont, xe tải, theo tuyến
            {data?.carrier ? "; chi phí trả nhà xe 3PL ở tab cuối" : ""}. Ô để trống không lưu.
          </DialogDescription>
        </DialogHeader>

        {loading || !data ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Đang tải chuyến…
          </div>
        ) : (
          <>
            {blocked ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100" role="status">
                <Lock className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <b>{lock?.holder_name}</b> đang sửa chuyến này (từ {hm(lock?.holder_since)}). Bạn chỉ xem được, chưa lưu được cho tới khi người đó thoát ra.
                </span>
                <Button size="sm" variant="outline" disabled={asking} onClick={ask}>
                  <BellRing /> Báo người đang sửa thoát ra
                </Button>
              </div>
            ) : stale ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" role="status">
                {lock?.saved_by_name ?? "Người khác"} vừa lưu chuyến này. Đóng khung rồi bấm Nhập cước lại để lấy bản mới.
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2">
              <span className="text-sm text-muted-foreground">Trọng lượng chuyến</span>
              <span className="text-2xl font-semibold tabular-nums text-primary">{data.tons === null ? "Chưa rõ" : `${formatNumber(data.tons)} tấn`}</span>
              <span className="text-sm text-muted-foreground">
                {data.itemCount
                  ? `${formatNumber(data.itemCount)} dòng hàng${data.itemsNoWeight ? `, ${formatNumber(data.itemsNoWeight)} dòng chưa quy ra kg (thiếu kg/đơn vị ở mã hàng)` : ""}`
                  : "Chuyến chưa có mã hàng"}
              </span>
            </div>
            {!data.canEditFees ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                {data.status === "cancelled" ? "Chuyến đã hủy." : data.billed ? "Chuyến đã lập công nợ phải thu nên không sửa được giá và phí thu khách." : "Bạn chỉ được xem giá và phí thu khách."}
              </div>
            ) : null}

            {tabs.length > 1 ? (
              <div className="flex flex-wrap gap-1 border-b" role="tablist">
                {tabs.map(([k, icon, label, sum]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    onClick={() => setTab(k)}
                    className={cn(
                      "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
                      tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {icon} {label}
                    {sum ? <span className="rounded bg-muted px-1.5 text-xs tabular-nums">{sum}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}

            <fieldset disabled={readOnly || !data.canEditFees} className={cn("space-y-3", tab !== "customer" && "hidden")}>
              {picked ? <div className="rounded-md bg-primary/10 px-3 py-1.5 text-sm text-primary">Giá lấy từ {picked} (chưa lưu)</div> : null}
              <FeesEditor
                value={fees}
                onChange={(l) => {
                  setFees(l);
                  setDirty((d) => ({ ...d, fees: true }));
                }}
                idPrefix="qf-fee-"
                files={files}
                onFilesChange={setFiles}
                shipmentId={data.id}
                savedFiles={data.feeDocs}
                freightBase={freight + surcharge + fuel}
                freightLabel={freightLabel}
                freightHead={
                  <>
                    <Row label="Đơn giá chưa dầu (đ)" htmlFor="qf-price">
                      <Input
                        id="qf-price"
                        inputMode="numeric"
                        className="h-8 text-right tabular-nums"
                        placeholder="Chưa có giá"
                        value={price.unitPrice}
                        onChange={(e) => {
                          setPrice((p) => ({ ...p, unitPrice: e.target.value }));
                          setDirty((d) => ({ ...d, price: true }));
                          setPicked(null);
                        }}
                        onBlur={(e) => {
                          const v = num(e.target.value);
                          if (v !== null) setPrice((p) => ({ ...p, unitPrice: formatNumber(v) }));
                        }}
                      />
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        /{unit}
                        {qty !== 1 ? ` × ${formatNumber(qty)} = ${formatVND(freight)}` : ""}
                        {data.canSeePrices ? (
                          <button type="button" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline" onClick={() => setTab("price")}>
                            <Tags className="size-3.5" /> Lấy từ bảng giá
                          </button>
                        ) : null}
                      </span>
                    </Row>
                    <Row label="Tỷ lệ hỗ trợ dầu (%)" htmlFor="qf-fuel">
                      <Input
                        id="qf-fuel"
                        inputMode="decimal"
                        className="h-8 text-right tabular-nums"
                        placeholder="Nhập % khách cho"
                        value={price.fuelRate}
                        onChange={(e) => {
                          setPrice((p) => ({ ...p, fuelRate: e.target.value }));
                          setDirty((d) => ({ ...d, price: true }));
                        }}
                      />
                      <span className="text-xs text-muted-foreground">Tiền dầu {formatVND(fuel)} · Cước = Đơn giá × (1 + % dầu) · để trống nếu khách không hỗ trợ dầu</span>
                    </Row>
                    {data.surcharge || num(price.surcharge) ? (
                      <Row label="Phụ phí cố định (bảng giá)" htmlFor="qf-surcharge">
                        <Input
                          id="qf-surcharge"
                          inputMode="numeric"
                          className="h-8 text-right tabular-nums"
                          placeholder="0"
                          value={price.surcharge}
                          onChange={(e) => {
                            setPrice((p) => ({ ...p, surcharge: e.target.value }));
                            setDirty((d) => ({ ...d, price: true }));
                          }}
                        />
                        <span className="text-xs text-muted-foreground">Khoản cộng thêm cố định ghi trong bảng giá; gõ 0 để bỏ.</span>
                      </Row>
                    ) : null}
                  </>
                }
              />
              <dl className="grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-2 text-sm sm:grid-cols-5">
                <Money label="Tổng phí vận chuyển" value={transport} strong />
                <Money label="Tổng phí chi hộ" value={totals.byRole.pass_through} />
                <Money label="Tổng phí tờ khai" value={totals.byRole.declaration} />
                <Money label="Tổng phí bốc xếp" value={totals.byRole.loading} />
                <Money label="Khách phải trả" value={transport - totals.byRole.freight + totals.revenue + totals.passThrough} strong />
              </dl>
            </fieldset>

            {tab === "price" && data.canSeePrices && data.canEditFees ? (
              <PricePanel shipmentId={data.id} fuel={rate} onChoose={choosePrice} />
            ) : null}

            {data.carrier ? (
              <div className={cn("space-y-3", tab !== "carrier" && "hidden")}>
                <p className="text-sm text-muted-foreground">
                  Cước và chi phí khác trả 3PL trừ vào lời/lỗ chuyến. Chi hộ 3PL (nâng, hạ, cược… nhà xe trả thay) không trừ lời/lỗ vì đã thu lại khách. Lưu xong tự lập công nợ phải trả nhà
                  xe.
                </p>
                <div className="rounded-md border">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
                    <span>
                      Nhà xe: <b>{data.carrier.supplierName ?? "chưa chọn"}</b>
                      {data.carrier.invoiceNo ? ` · HĐ ${data.carrier.invoiceNo}` : ""}
                      {data.carrier.paidAmount ? ` · đã trả ${formatVND(data.carrier.paidAmount)}` : ""}
                    </span>
                    {data.carrier.canEdit ? (
                      <CarrierCostsDialog
                        shipmentId={data.id}
                        code={data.code}
                        supplierId={data.carrier.supplierId}
                        supplierLabel={data.carrier.supplierName}
                        invoiceNo={data.carrier.invoiceNo}
                        dueDate={data.carrier.dueDate}
                        costs={data.carrier.costs}
                        customerPassThrough={customerPass}
                        paidAmount={data.carrier.paidAmount}
                        loadingFeeTypes={data.carrier.loadingFeeTypes}
                        loadingUnitPrice={data.carrier.loadingUnitPrice}
                        tripTons={data.carrier.tripTons}
                      />
                    ) : null}
                  </div>
                  {data.carrier.costs.length ? (
                    <table className="w-full text-sm">
                      <tbody>
                        {data.carrier.costs.map((c) => (
                          <tr key={c.line_no} className="border-b last:border-0">
                            <td className="px-3 py-1.5">{c.description}</td>
                            <td className="px-3 py-1.5 text-muted-foreground">{c.cost_kind === "freight" ? "Cước" : c.cost_kind === "pass_through" ? "Chi hộ" : "Khác"}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatVND(Number(c.amount))}</td>
                          </tr>
                        ))}
                        <tr className="bg-muted/30 font-semibold">
                          <td className="px-3 py-1.5" colSpan={2}>
                            Tổng chi phí trả 3PL
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{formatVND(carrierTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <p className="px-3 py-4 text-center text-sm text-muted-foreground">Chưa nhập chi phí 3PL.</p>
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Đóng
          </Button>
          <Button disabled={pending || loading || !data || readOnly || !data.canEditFees} onClick={save}>
            {pending ? <Loader2 className="animate-spin" /> : null} Lưu cước
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 items-center gap-1.5 sm:grid-cols-[minmax(0,12rem)_9rem_minmax(0,1fr)]">
      <label htmlFor={htmlFor} className="col-span-full truncate text-sm font-medium sm:col-span-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function Money({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-md bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-semibold text-primary" : "font-medium"}>{formatVND(value)}</dd>
    </div>
  );
}
