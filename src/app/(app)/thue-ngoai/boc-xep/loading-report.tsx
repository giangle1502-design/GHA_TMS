"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, FileSpreadsheet, HandCoins, Loader2, Printer, ReceiptText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber, formatVND, todayVN } from "@/lib/format";
import { downloadXlsx } from "@/lib/xlsx-client";
import { payCarrierPayables } from "@/lib/finance/carrier-actions";
import { saveLoadingUnitPrice } from "./actions";
import { ReportGrid, type ReportColumn } from "@/components/grid/report-grid";
import type { TableViewConfig } from "@/lib/entities/types";
import { LoadingRowActions } from "@/components/finance/loading-row-actions";

export type LoadingLine = {
  id: string;
  shipment_id: string;
  shipment_code: string;
  report_date: string;
  customer_code: string | null;
  customer_name: string | null;
  plate_number: string | null;
  pickup_name: string | null;
  delivery_name: string | null;
  tons: number;
  supplier_id: string | null;
  vendor_name: string;
  is_trip_carrier: boolean;
  fee_name: string;
  quantity: number | null;
  unit_price: number | null;
  amount: number;
  ref_no: string | null;
  note: string | null;
  payable_id: string | null;
  payable_code: string | null;
  pay_status: string;
  paid: boolean;
  last_paid_at: string | null;
};

export type LoadingTrip = {
  id: string;
  shipment_code: string;
  report_date: string;
  customer_code: string | null;
  customer_name: string | null;
  plate_number: string | null;
  pickup_name: string | null;
  delivery_name: string | null;
  tons: number;
  loading_revenue: number;
  loading_cost: number;
  loading_unpaid: number;
  loading_lines: number;
  vendors: string | null;
  /** 9033: tick "Có chi phí bốc xếp" ở Điều phối; tuyến Điểm nhận → Điểm giao → Điểm hạ rỗng */
  requires_loading?: boolean;
  route_label?: string | null;
};

const PAY: Record<string, { label: string; variant: "warning" | "info" | "success" | "outline" }> = {
  unpaid: { label: "Chưa TT", variant: "warning" },
  partial: { label: "TT một phần", variant: "info" },
  paid: { label: "Đã TT", variant: "success" },
  no_payable: { label: "Chưa lập công nợ", variant: "outline" },
};

const route = (r: { pickup_name: string | null; delivery_name: string | null; route_label?: string | null }) =>
  r.route_label || `${r.pickup_name ?? "-"} → ${r.delivery_name ?? "-"}`;
const tons = (v: number | null | undefined) => formatNumber(Math.round(Number(v ?? 0) * 1000) / 1000);
/** Trọng lượng của khoản: SL nhập (tấn) nếu tính theo đơn giá, không thì trọng lượng chuyến */
const lineTons = (l: LoadingLine) => (l.quantity != null && l.unit_price != null ? Number(l.quantity) : Number(l.tons));

export function LoadingReport(props: {
  tu: string;
  den: string;
  lines: LoadingLine[];
  trips: LoadingTrip[];
  company: { name: string; taxCode: string; address: string };
  defaultPrice: number;
  canPay: boolean;
  missing: LoadingTrip[];
  missingView: TableViewConfig | null;
  tripsView: TableViewConfig | null;
  /** Được nhập thu / chi bốc xếp ngay trên dòng */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [tu, setTu] = useState(props.tu);
  const [den, setDen] = useState(props.den);
  const [vendor, setVendor] = useState("");
  const [customer, setCustomer] = useState("");
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [price, setPrice] = useState(formatNumber(props.defaultPrice));
  const [stmt, setStmt] = useState(false);
  const [saving, startSave] = useTransition();
  const [paying, startPay] = useTransition();

  const customers = useMemo(
    () => Array.from(new Set([...props.trips, ...props.lines].map((r) => r.customer_code ?? r.customer_name ?? "").filter(Boolean))).sort(),
    [props.trips, props.lines],
  );
  const custOf = (r: { customer_code: string | null; customer_name: string | null }) => r.customer_code ?? r.customer_name ?? "";
  const lines = useMemo(() => props.lines.filter((l) => !customer || custOf(l) === customer), [props.lines, customer]);
  const vendors = useMemo(() => Array.from(new Set(lines.map((l) => l.vendor_name))).sort((a, b) => a.localeCompare(b, "vi")), [lines]);
  const shown = vendor ? lines.filter((l) => l.vendor_name === vendor) : lines;
  const byVendor = useMemo(() => {
    const m = new Map<string, { vendor: string; trips: Set<string>; amount: number; unpaid: number; tons: number }>();
    for (const l of lines) {
      const g = m.get(l.vendor_name) ?? { vendor: l.vendor_name, trips: new Set<string>(), amount: 0, unpaid: 0, tons: 0 };
      g.trips.add(l.shipment_id);
      g.amount += Number(l.amount);
      g.tons += lineTons(l);
      if (!l.paid) g.unpaid += Number(l.amount);
      m.set(l.vendor_name, g);
    }
    return Array.from(m.values()).sort((a, b) => b.amount - a.amount);
  }, [lines]);
  const trips = props.trips.filter(
    (t) =>
      (!customer || custOf(t) === customer) &&
      (!vendor || (t.vendors ?? "").split(", ").includes(vendor)) &&
      (!onlyMissing || Number(t.loading_lines) === 0) &&
      (!onlyUnpaid || Number(t.loading_unpaid) > 0),
  );
  const tripsAll = props.trips.filter((t) => !customer || custOf(t) === customer);
  const revTotal = tripsAll.reduce((a, t) => a + Number(t.loading_revenue), 0);
  const payTotal = lines.reduce((a, l) => a + Number(l.amount), 0);
  const unpaidTotal = lines.reduce((a, l) => a + (l.paid ? 0 : Number(l.amount)), 0);
  const missing = tripsAll.filter((t) => Number(t.loading_lines) === 0).length;

  const applyDates = () => router.push(`/thue-ngoai/boc-xep?tu=${tu}&den=${den}`);

  const savePrice = () =>
    startSave(async () => {
      const v = Number(price.replace(/,/g, ""));
      const r = await saveLoadingUnitPrice(v);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      router.refresh();
    });

  // Thanh toán: chỉ công nợ bốc xếp riêng của đơn vị (công nợ nhà xe gồm cả cước, trả ở Xe thuê ngoài 3PL)
  const payable = vendor
    ? Array.from(new Set(shown.filter((l) => !l.paid && !l.is_trip_carrier && l.payable_id && l.pay_status !== "paid").map((l) => l.payable_id as string)))
    : [];
  const payAmount = shown.filter((l) => l.payable_id && payable.includes(l.payable_id)).reduce((a, l) => a + Number(l.amount), 0);
  const payVendor = () => {
    if (!payable.length) return;
    if (!window.confirm(`Ghi đã thanh toán ${formatVND(payAmount)} cho ${vendor} (${payable.length} chuyến), ngày ${formatDate(todayVN())}?`)) return;
    startPay(async () => {
      const r = await payCarrierPayables({ payableIds: payable, note: `Thanh toán bốc xếp ${vendor} kỳ ${formatDate(props.tu)} - ${formatDate(props.den)}` });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Đã ghi thanh toán ${r.data?.count} chuyến, ${formatVND(r.data?.total ?? 0)}.`);
      router.refresh();
    });
  };

  const exportExcel = () =>
    downloadXlsx({
      filename: `Bao_cao_boc_xep_${props.tu}_${props.den}.xlsx`,
      sheet: "BocXep",
      title: "BÁO CÁO BỐC XẾP 3PL",
      subtitle: `Từ ${formatDate(props.tu)} đến ${formatDate(props.den)}${vendor ? ` · ${vendor}` : ""}${customer ? ` · ${customer}` : ""}`,
      columns: [
        { label: "Ngày", width: 12 },
        { label: "Chuyến", width: 14 },
        { label: "Số xe", width: 12 },
        { label: "Khách hàng", width: 12 },
        { label: "Nơi nhận → Nơi giao", width: 40 },
        { label: "Đơn vị bốc xếp", width: 26 },
        { label: "Trọng lượng (tấn)", width: 12, numeric: true },
        { label: "Đơn giá", width: 12, numeric: true },
        { label: "Trả bốc xếp", width: 14, numeric: true },
        { label: "Thanh toán", width: 14 },
      ],
      rows: shown.map((l) => [
        formatDate(l.report_date),
        l.shipment_code,
        l.plate_number ?? "",
        custOf(l),
        route(l),
        l.vendor_name,
        lineTons(l),
        l.unit_price ?? null,
        Number(l.amount),
        PAY[l.pay_status]?.label ?? l.pay_status,
      ]),
      footer: ["Tổng cộng", "", "", "", "", "", shown.reduce((a, l) => a + lineTons(l), 0), null, shown.reduce((a, l) => a + Number(l.amount), 0), ""],
    });

  return (
    <>
      <div className="print:hidden">
        <Link href="/thue-ngoai" className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="size-4" /> Xe thuê ngoài 3PL
        </Link>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Bốc xếp 3PL</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Nhập ngay trên từng dòng: nút <b>Thu</b> (thu bốc xếp của khách, nhóm phí Bốc xếp) và nút <b>Chi</b> (trả đơn vị bốc xếp: chọn đơn vị, SL tấn × đơn giá; một chuyến
          thêm được nhiều đơn vị bằng nút Thêm bốc xếp 3PL). Không cần mở Điều phối hay Quản lý chuyến.
        </p>

        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
          <div className="space-y-1">
            <Label htmlFor="bx-tu">Từ ngày</Label>
            <Input id="bx-tu" type="date" className="h-9 w-40" value={tu} onChange={(e) => setTu(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bx-den">Đến ngày</Label>
            <Input id="bx-den" type="date" className="h-9 w-40" value={den} onChange={(e) => setDen(e.target.value)} />
          </div>
          <Button variant="outline" onClick={applyDates} disabled={tu === props.tu && den === props.den}>
            Xem
          </Button>
          <div className="space-y-1">
            <Label htmlFor="bx-vendor">Đơn vị bốc xếp</Label>
            <NativeSelect id="bx-vendor" className="h-9 min-w-48" value={vendor} onChange={(e) => setVendor(e.target.value)}>
              <option value="">-- Tất cả --</option>
              {vendors.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="bx-cust">Khách hàng</Label>
            <NativeSelect id="bx-cust" className="h-9 min-w-32" value={customer} onChange={(e) => setCustomer(e.target.value)}>
              <option value="">-- Tất cả --</option>
              {customers.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="bx-price">Đơn giá mặc định (đ/tấn)</Label>
            <div className="flex gap-1">
              <Input id="bx-price" className="h-9 w-28 text-right tabular-nums" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
              <Button variant="outline" size="sm" className="h-9" onClick={savePrice} disabled={saving || Number(price.replace(/,/g, "")) === props.defaultPrice}>
                {saving ? <Loader2 className="animate-spin" /> : null} Lưu
              </Button>
            </div>
          </div>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyUnpaid} onChange={(e) => setOnlyUnpaid(e.target.checked)} /> Chỉ xe chưa thanh toán bốc xếp
          </label>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Chỉ xe chưa nhập phí trả
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button onClick={() => setStmt(true)}>
              <ReceiptText /> Bảng kê bốc xếp
            </Button>
            <Button variant="outline" onClick={exportExcel}>
              <FileSpreadsheet /> Xuất Excel
            </Button>
            {props.canPay && vendor ? (
              <Button variant="outline" onClick={payVendor} disabled={paying || !payable.length} title="Ghi đã thanh toán các khoản bốc xếp chưa trả của đơn vị đang chọn">
                {paying ? <Loader2 className="animate-spin" /> : <HandCoins />} Thanh toán {payable.length ? formatVND(payAmount) : ""}
              </Button>
            ) : null}
          </div>
        </div>

        <MissingLoading trips={props.missing} view={props.missingView} canEdit={props.canEdit} />

        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Thu bốc xếp từ khách" value={formatVND(revTotal)} />
          <Kpi label="Trả các đơn vị bốc xếp" value={formatVND(payTotal)} />
          <Kpi label="Chưa thanh toán cho đơn vị bốc xếp" value={formatVND(unpaidTotal)} danger />
          <Kpi label="Chênh lệch (thu − trả)" value={formatVND(revTotal - payTotal)} note={missing ? `${missing} chuyến có thu bốc xếp nhưng chưa nhập phí trả` : undefined} />
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Tổng hợp theo đơn vị bốc xếp</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3">Đơn vị bốc xếp</th>
                  <th className="py-2 pr-3 text-right">Số xe</th>
                  <th className="py-2 pr-3 text-right">Trọng lượng (tấn)</th>
                  <th className="py-2 pr-3 text-right">Tổng tiền</th>
                  <th className="py-2 text-right">Chưa thanh toán</th>
                </tr>
              </thead>
              <tbody>
                {byVendor.map((g) => (
                  <tr key={g.vendor} className="cursor-pointer border-b hover:bg-muted/50" onClick={() => setVendor(g.vendor === vendor ? "" : g.vendor)}>
                    <td className="py-2 pr-3 font-medium">{g.vendor}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(g.trips.size)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{tons(g.tons)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatVND(g.amount)}</td>
                    <td className={`py-2 text-right tabular-nums ${g.unpaid ? "text-destructive" : "text-emerald-700"}`}>{g.unpaid ? formatVND(g.unpaid) : "✓ đã TT hết"}</td>
                  </tr>
                ))}
                {byVendor.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-center text-muted-foreground">
                      Chưa có khoản bốc xếp 3PL nào trong khoảng ngày này.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Bốc xếp từng xe</CardTitle>
          </CardHeader>
          <CardContent>
            <TripsGrid trips={trips} lines={props.lines} vendor={vendor} view={props.tripsView} canEdit={props.canEdit} tu={props.tu} den={props.den} />
          </CardContent>
        </Card>
      </div>

      {stmt ? (
        <LoadingStatement lines={shown} tu={props.tu} den={props.den} vendor={vendor} customer={customer} company={props.company} onClose={() => setStmt(false)} />
      ) : null}
    </>
  );
}

/** Chuyến có tick "Có chi phí bốc xếp" ở Điều phối mà chưa nhập khoản trả bốc xếp (mọi ngày, để không quên) */
function MissingLoading({ trips, view, canEdit }: { trips: LoadingTrip[]; view: TableViewConfig | null; canEdit: boolean }) {
  const columns = useMemo<ReportColumn<LoadingTrip>[]>(
    () => [
      { key: "report_date", label: "Ngày", width: 100, kind: "date", value: (r) => r.report_date, render: (r) => formatDate(r.report_date) },
      {
        key: "shipment_code",
        label: "Mã chuyến",
        width: 130,
        value: (r) => r.shipment_code,
        render: (r) => (
          <Link href={`/chuyen-xe/${r.id}#chi-phi-3pl`} className="font-medium text-primary hover:underline">
            {r.shipment_code}
          </Link>
        ),
      },
      { key: "plate_number", label: "Số xe", width: 110, value: (r) => r.plate_number },
      { key: "customer", label: "Khách hàng", width: 110, value: (r) => r.customer_code ?? r.customer_name },
      { key: "route", label: "Tuyến đường", width: 360, value: (r) => route(r) },
      { key: "tons", label: "Tấn", width: 80, align: "right", kind: "number", value: (r) => Number(r.tons), render: (r) => tons(r.tons) },
      { key: "loading_revenue", label: "Thu bốc xếp", width: 120, align: "right", kind: "number", value: (r) => Number(r.loading_revenue), render: (r) => formatVND(r.loading_revenue) },
      {
        key: "action",
        label: "Nhập thu / chi",
        width: 190,
        value: () => "",
        render: (r) =>
          canEdit ? (
            <LoadingRowActions id={r.id} code={r.shipment_code} hasRevenue={Number(r.loading_revenue) > 0} hasCost={false} />
          ) : (
            <Link href={`/chuyen-xe/${r.id}#chi-phi-3pl`} className="text-xs font-medium text-primary hover:underline">
              Xem chuyến →
            </Link>
          ),
      },
    ],
    [canEdit],
  );
  if (!trips.length) return null;
  return (
    <Card className="mt-3 border-l-4 border-l-amber-500">
      <CardHeader>
        <CardTitle className="text-base text-amber-800 dark:text-amber-300">Chuyến cần nhập phí bốc xếp ({formatNumber(trips.length)})</CardTitle>
        <p className="text-sm text-muted-foreground">
          Chuyến đã tick &quot;Có chi phí bốc xếp&quot; khi tạo đơn ở Điều phối nhưng chưa nhập khoản trả bốc xếp. Tính mọi ngày, không theo bộ lọc Từ ngày - Đến ngày.
          Bấm <b>Nhập chi</b> trên dòng để nhập khoản trả bốc xếp; nhập xong chuyến tự rời danh sách này.
        </p>
      </CardHeader>
      <CardContent>
        <ReportGrid tableKey="loading_missing" rows={trips} columns={columns} view={view} getRowId={(r) => r.id} defaultPinned={["shipment_code"]} emptyText="Không còn chuyến nào thiếu phí bốc xếp." />
      </CardContent>
    </Card>
  );
}

type TripRow = LoadingTrip & { ls: LoadingLine[]; cost: number; unpaid: number };

/** Bốc xếp từng xe: bảng có chọn cột, lưu cấu hình; nút Thu / Chi trên dòng để nhập ngay */
function TripsGrid(props: { trips: LoadingTrip[]; lines: LoadingLine[]; vendor: string; view: TableViewConfig | null; canEdit: boolean; tu: string; den: string }) {
  const { trips, lines, vendor, canEdit } = props;
  const rows = useMemo<TripRow[]>(() => {
    const by = new Map<string, LoadingLine[]>();
    for (const l of lines) if (!vendor || l.vendor_name === vendor) by.set(l.shipment_id, [...(by.get(l.shipment_id) ?? []), l]);
    return trips.map((t) => {
      const ls = by.get(t.id) ?? [];
      return { ...t, ls, cost: ls.reduce((a, l) => a + Number(l.amount), 0), unpaid: ls.reduce((a, l) => a + (l.paid ? 0 : Number(l.amount)), 0) };
    });
  }, [trips, lines, vendor]);

  const lineText = (l: LoadingLine) =>
    `${l.vendor_name} ${l.quantity != null && l.unit_price != null ? `${tons(l.quantity)} tấn × ${formatNumber(l.unit_price)}` : l.fee_name} ${formatVND(l.amount)}`;
  const columns = useMemo<ReportColumn<TripRow>[]>(
    () => [
      { key: "report_date", label: "Ngày", width: 100, kind: "date", value: (r) => r.report_date, render: (r) => formatDate(r.report_date) },
      {
        key: "shipment_code",
        label: "Mã chuyến",
        width: 120,
        value: (r) => r.shipment_code,
        render: (r) => (
          <Link href={`/chuyen-xe/${r.id}#chi-phi-3pl`} className="font-medium text-primary hover:underline">
            {r.shipment_code}
          </Link>
        ),
      },
      { key: "plate_number", label: "Số xe", width: 100, value: (r) => r.plate_number },
      {
        key: "action",
        label: "Nhập thu / chi",
        width: 170,
        value: () => "",
        render: (r) =>
          canEdit ? (
            <LoadingRowActions id={r.id} code={r.shipment_code} hasRevenue={Number(r.loading_revenue) > 0} hasCost={Number(r.loading_lines) > 0} />
          ) : (
            <span className="text-xs text-muted-foreground">Không có quyền nhập</span>
          ),
      },
      { key: "customer", label: "Khách", width: 90, value: (r) => r.customer_code ?? r.customer_name },
      { key: "route", label: "Nơi nhận → Nơi giao", width: 380, value: (r) => route(r) },
      { key: "tons", label: "Tấn", width: 70, align: "right", kind: "number", value: (r) => Number(r.tons), render: (r) => tons(r.tons) },
      {
        key: "loading_revenue",
        label: "Thu bốc xếp",
        width: 120,
        align: "right",
        kind: "number",
        value: (r) => Number(r.loading_revenue),
        render: (r) => <span className={Number(r.loading_revenue) ? undefined : "text-amber-700 dark:text-amber-300"}>{formatVND(r.loading_revenue)}</span>,
      },
      {
        key: "vendors",
        label: "Đơn vị bốc xếp · đơn giá · phí",
        width: 440,
        value: (r) => r.ls.map(lineText).join("; "),
        render: (r) =>
          r.ls.length ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5" title={r.ls.map(lineText).join("\n")}>
              {r.ls.map((l) => (
                <span key={l.id} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="font-medium">{l.vendor_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {l.quantity != null && l.unit_price != null ? `${tons(l.quantity)} tấn × ${formatNumber(l.unit_price)}` : l.fee_name}
                  </span>
                  <span className="tabular-nums">{formatVND(l.amount)}</span>
                  {PAY[l.pay_status] ? <Badge variant={PAY[l.pay_status].variant}>{PAY[l.pay_status].label}</Badge> : null}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-amber-700 dark:text-amber-300">{r.requires_loading ? "Có bốc xếp, chưa nhập phí trả" : "Chưa nhập phí trả"}</span>
          ),
      },
      { key: "cost", label: "Phí phải trả", width: 120, align: "right", kind: "number", value: (r) => r.cost, render: (r) => formatVND(r.cost) },
      {
        key: "unpaid",
        label: "Chưa thanh toán",
        width: 120,
        align: "right",
        kind: "number",
        value: (r) => r.unpaid,
        render: (r) => <span className={r.unpaid ? "text-destructive" : undefined}>{formatVND(r.unpaid)}</span>,
      },
      {
        key: "diff",
        label: "Chênh lệch (thu − trả)",
        width: 140,
        align: "right",
        kind: "number",
        value: (r) => Number(r.loading_revenue) - r.cost,
        render: (r) => formatVND(Number(r.loading_revenue) - r.cost),
      },
    ],
    [canEdit],
  );

  return (
    <ReportGrid
      tableKey="loading_trips"
      rows={rows}
      columns={columns}
      view={props.view}
      getRowId={(r) => r.id}
      defaultPinned={["shipment_code"]}
      emptyText="Không có xe nào có bốc xếp trong bộ lọc này."
      footer={(list) => ({
        shipment_code: `${formatNumber(list.length)} xe`,
        tons: tons(list.reduce((a, r) => a + Number(r.tons), 0)),
        loading_revenue: formatVND(list.reduce((a, r) => a + Number(r.loading_revenue), 0)),
        cost: formatVND(list.reduce((a, r) => a + r.cost, 0)),
        unpaid: formatVND(list.reduce((a, r) => a + r.unpaid, 0)),
        diff: formatVND(list.reduce((a, r) => a + Number(r.loading_revenue) - r.cost, 0)),
      })}
      onExport={(cols, list) =>
        downloadXlsx({
          filename: `Boc_xep_tung_xe_${props.tu}_${props.den}.xlsx`,
          sheet: "BocXepTungXe",
          title: "BỐC XẾP TỪNG XE",
          subtitle: `Từ ${formatDate(props.tu)} đến ${formatDate(props.den)}${vendor ? ` · ${vendor}` : ""}`,
          columns: cols.filter((c) => c.key !== "action").map((c) => ({ label: c.label, width: Math.max(10, Math.round(c.width / 8)), numeric: c.kind === "number" })),
          rows: list.map((r) =>
            cols
              .filter((c) => c.key !== "action")
              .map((c) => {
                const v = c.value(r);
                if (c.kind === "date" && typeof v === "string") return formatDate(v);
                return v ?? "";
              }),
          ),
        })
      }
    />
  );
}

function Kpi({ label, value, note, danger }: { label: string; value: string; note?: string; danger?: boolean }) {
  return (
    <Card className={danger ? "border-l-4 border-l-destructive" : undefined}>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold tabular-nums">{value}</div>
        {note ? <div className="text-xs text-amber-700">{note}</div> : null}
      </CardContent>
    </Card>
  );
}

/** Bảng kê bốc xếp: mỗi đơn vị bốc xếp một bảng (sang trang riêng), in A4 hoặc xuất Excel — như app QLVT cũ */
function LoadingStatement(props: {
  lines: LoadingLine[];
  tu: string;
  den: string;
  vendor: string;
  customer: string;
  company: { name: string; taxCode: string; address: string };
  onClose: () => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, LoadingLine[]>();
    [...props.lines]
      .sort((a, b) => a.report_date.localeCompare(b.report_date) || a.shipment_code.localeCompare(b.shipment_code))
      .forEach((l) => m.set(l.vendor_name, [...(m.get(l.vendor_name) ?? []), l]));
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], "vi"));
  }, [props.lines]);
  const period = `${formatDate(props.tu)} - ${formatDate(props.den)}`;

  const print = () => {
    const old = document.title;
    document.title = `Bang ke boc xep ${props.vendor || "tat ca"} ${props.tu}_${props.den}`;
    window.print();
    setTimeout(() => (document.title = old), 500);
  };
  const excel = () =>
    downloadXlsx({
      filename: `Bang_ke_boc_xep_${props.tu}_${props.den}.xlsx`,
      sheet: "BangKeBocXep",
      title: `BẢNG KÊ PHÍ BỐC XẾP${props.vendor ? ` - ${props.vendor}` : ""}`,
      subtitle: `${props.company.name} · MST ${props.company.taxCode} · Thời gian: ${period}${props.customer ? ` · Khách hàng: ${props.customer}` : ""}`,
      columns: [
        { label: "Đơn vị bốc xếp", width: 26 },
        { label: "STT", width: 6, numeric: true },
        { label: "Ngày", width: 12 },
        { label: "Shipto (Điểm nhận → Điểm giao)", width: 44 },
        { label: "Số xe", width: 12 },
        { label: "Trọng lượng (tấn)", width: 12, numeric: true },
        { label: "Đơn giá", width: 12, numeric: true },
        { label: "Thành tiền", width: 14, numeric: true },
        { label: "Đã thanh toán", width: 12 },
      ],
      rows: groups.flatMap(([v, ls]) =>
        ls.map((l, i) => [v, i + 1, formatDate(l.report_date), route(l), l.plate_number ?? "", lineTons(l), l.unit_price ?? null, Number(l.amount), l.paid ? "Đã" : "Chưa"]),
      ),
      footer: ["Tổng cộng", null, "", "", "", props.lines.reduce((a, l) => a + lineTons(l), 0), null, props.lines.reduce((a, l) => a + Number(l.amount), 0), ""],
    });

  const cell = "border border-black px-1.5 py-1";
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 print:static print:overflow-visible print:bg-white" onClick={props.onClose}>
      <style>{`@media print { @page { size: A4 portrait; margin: 10mm; } html, body { background: #fff !important; } }`}</style>
      <div className="mx-auto my-4 w-[96%] max-w-5xl rounded-lg bg-white p-4 text-black shadow-xl print:m-0 print:w-full print:max-w-none print:rounded-none print:p-0 print:shadow-none" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
          <Button onClick={print}>
            <Printer /> In / Lưu PDF
          </Button>
          <Button variant="outline" onClick={excel}>
            <FileSpreadsheet /> Excel
          </Button>
          <Button variant="ghost" onClick={props.onClose}>
            <X /> Đóng
          </Button>
          <span className="text-xs text-muted-foreground">
            Bộ lọc: {period}
            {props.vendor ? ` · ${props.vendor}` : " · tất cả đơn vị"}
            {props.customer ? ` · ${props.customer}` : ""}. Đổi bộ lọc ở trang rồi mở lại bảng kê.
          </span>
        </div>
        <div style={{ fontFamily: '"Times New Roman", Times, serif', fontSize: "11pt", lineHeight: 1.4 }}>
          {groups.length === 0 ? <p>Không có khoản bốc xếp 3PL nào trong bộ lọc này.</p> : null}
          {groups.map(([v, ls], gi) => {
            const tonsSum = ls.reduce((a, l) => a + lineTons(l), 0);
            const money = ls.reduce((a, l) => a + Number(l.amount), 0);
            return (
              <div key={v} style={{ pageBreakAfter: gi < groups.length - 1 ? "always" : "auto", marginBottom: 24 }}>
                <div className="text-center">
                  <b>{props.company.name}</b>
                  <br />
                  MST: {props.company.taxCode}
                  {props.company.address ? (
                    <>
                      <br />
                      {props.company.address}
                    </>
                  ) : null}
                </div>
                <h3 className="mt-3 text-center text-base font-bold">BẢNG KÊ PHÍ BỐC XẾP</h3>
                <div className="text-center">
                  Đơn vị bốc xếp: <b>{v}</b>
                </div>
                <div className="mb-2 text-center">
                  Thời gian: {period}
                  {props.customer ? ` · Khách hàng: ${props.customer}` : ""}
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {["STT", "Ngày", "Shipto (Điểm nhận → Điểm giao)", "Số xe", "Trọng lượng (tấn)", "Đơn giá", "Thành tiền", "Đã TT"].map((h) => (
                        <th key={h} className={`${cell} font-bold`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ls.map((l, i) => (
                      <tr key={l.id}>
                        <td className={`${cell} text-center`}>{i + 1}</td>
                        <td className={cell}>{formatDate(l.report_date)}</td>
                        <td className={cell}>{route(l)}</td>
                        <td className={cell}>{l.plate_number ?? "-"}</td>
                        <td className={`${cell} text-right`}>{tons(lineTons(l))}</td>
                        <td className={`${cell} text-right`}>{l.unit_price == null ? "-" : formatNumber(l.unit_price)}</td>
                        <td className={`${cell} text-right`}>{formatNumber(l.amount)}</td>
                        <td className={`${cell} text-center`}>{l.paid ? "✓" : ""}</td>
                      </tr>
                    ))}
                    <tr className="font-bold">
                      <td className={cell} colSpan={4}>
                        Tổng cộng ({ls.length} xe)
                      </td>
                      <td className={`${cell} text-right`}>{tons(tonsSum)}</td>
                      <td className={cell} />
                      <td className={`${cell} text-right`}>{formatNumber(money)}</td>
                      <td className={cell} />
                    </tr>
                  </tbody>
                </table>
                <table className="mt-4 w-full">
                  <tbody>
                    <tr>
                      <td className="text-center">
                        <b>ĐƠN VỊ BỐC XẾP</b>
                        <br />
                        <i>(Ký, ghi rõ họ tên)</i>
                        <br />
                        <br />
                        <br />
                      </td>
                      <td className="text-center">
                        <b>{props.company.name}</b>
                        <br />
                        <i>(Ký, ghi rõ họ tên)</i>
                        <br />
                        <br />
                        <br />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
