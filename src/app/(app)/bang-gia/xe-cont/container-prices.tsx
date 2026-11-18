"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileDown, History, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { NumInput } from "@/components/pricing/num-input";
import { formatDate, formatNumber, todayVN } from "@/lib/format";
import { looseKey } from "@/lib/import-trips";
import { downloadXlsx } from "@/lib/xlsx-client";
import { monthRange } from "@/lib/freight-statement";
import { applyContainerPrices, deleteContainerPrices, loadPricesFromTrips, updateContainerPrice, type TripPriceRow } from "./actions";

export type ContainerPriceRow = {
  id: string;
  customer_id: string;
  customer_code: string | null;
  customer_name: string;
  pickup_location_id: string;
  pickup_name: string;
  delivery_location_id: string;
  delivery_name: string;
  empty_return_location_id: string | null;
  empty_return_name: string | null;
  container_size: string | null;
  unit_price: number;
  fuel_support_rate: number | null;
  carrier_unit_price: number | null;
  source: string;
  trip_count: number;
  price_min: number | null;
  price_max: number | null;
  last_trip_date: string | null;
  last_shipment_code: string | null;
  effective_from: string;
  status: string;
  notes: string | null;
};

const withFuel = (price: number, pct: number | null) => Math.round(price * (1 + (pct ?? 0) / 100));
const sizeLabel = (s: string | null) => (s ? `${s}'` : "–");

export function ContainerPrices({
  rows,
  defaultRange,
  canWrite,
  canUpdate,
  canDelete,
  show3pl,
}: {
  rows: ContainerPriceRow[];
  defaultRange: { tu: string; den: string };
  canWrite: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  show3pl: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [customer, setCustomer] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<ContainerPriceRow | null>(null);
  const [fromTrips, setFromTrips] = useState(false);
  const [pending, start] = useTransition();

  const customers = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.customer_id, r.customer_name);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "vi"));
  }, [rows]);

  const shown = useMemo(() => {
    const k = looseKey(q);
    return rows.filter(
      (r) =>
        (!customer || r.customer_id === customer) &&
        (!onlyActive || r.status === "active") &&
        (!k || looseKey([r.customer_code, r.customer_name, r.pickup_name, r.delivery_name, r.empty_return_name, r.last_shipment_code, r.notes].join(" ")).includes(k)),
    );
  }, [rows, q, customer, onlyActive]);

  const exportXlsx = () =>
    downloadXlsx({
      filename: `Bang-gia-xe-cont_${todayVN()}.xlsx`,
      sheet: "Bảng giá xe cont",
      title: "BẢNG GIÁ XE CONT (ĐƠN GIÁ CHƯA HỖ TRỢ DẦU)",
      subtitle: `Xuất ngày ${formatDate(todayVN())}`,
      columns: [
        { label: "Khách hàng", width: 180 },
        { label: "Điểm nhận", width: 180 },
        { label: "Điểm giao", width: 180 },
        { label: "Điểm hạ rỗng", width: 160 },
        { label: "Cont", width: 50 },
        { label: "Đơn giá chưa dầu", width: 110, numeric: true },
        { label: "% dầu", width: 60, numeric: true },
        { label: "Cước gồm dầu", width: 110, numeric: true },
        ...(show3pl ? [{ label: "Đơn giá 3PL chưa dầu", width: 110, numeric: true }] : []),
        { label: "Số chuyến", width: 70, numeric: true },
        { label: "Chuyến gần nhất", width: 120 },
        { label: "Áp dụng từ", width: 90 },
        { label: "Ghi chú", width: 200 },
      ],
      rows: shown.map((r) => [
        r.customer_name,
        r.pickup_name,
        r.delivery_name,
        r.empty_return_name,
        r.container_size,
        r.unit_price,
        r.fuel_support_rate,
        withFuel(r.unit_price, r.fuel_support_rate),
        ...(show3pl ? [r.carrier_unit_price] : []),
        r.trip_count,
        r.last_shipment_code ? `${r.last_shipment_code} (${formatDate(r.last_trip_date)})` : "",
        formatDate(r.effective_from),
        r.notes,
      ]),
    });

  const removeSelected = () => {
    if (!sel.size || !confirm(`Xóa ${sel.size} dòng giá đã chọn?`)) return;
    start(async () => {
      const r = await deleteContainerPrices([...sel]);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Đã xóa.");
      setSel(new Set());
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-64 space-y-1.5">
          <Label htmlFor="cp-q">Tìm kiếm</Label>
          <Input id="cp-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Khách hàng, điểm nhận, điểm giao…" />
        </div>
        <div className="w-64 space-y-1.5">
          <Label>Khách hàng</Label>
          <NativeSelect value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">Tất cả khách hàng</option>
            {customers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Chỉ giá đang dùng
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          {canWrite ? (
            <Button onClick={() => setFromTrips(true)}>
              <History /> Lấy giá từ chuyến đã chạy
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => void exportXlsx()} disabled={!shown.length}>
            <FileDown /> Tải Excel
          </Button>
          {canDelete && sel.size ? (
            <Button variant="outline" className="text-destructive" onClick={removeSelected} disabled={pending}>
              <Trash2 /> Xóa {sel.size} dòng
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr className="[&>th]:border-r [&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold [&>th]:whitespace-nowrap">
                  {canDelete ? (
                    <th className="w-8">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả"
                        checked={shown.length > 0 && shown.every((r) => sel.has(r.id))}
                        onChange={(e) => setSel(e.target.checked ? new Set(shown.map((r) => r.id)) : new Set())}
                      />
                    </th>
                  ) : null}
                  <th>Khách hàng</th>
                  <th>Điểm nhận</th>
                  <th>Điểm giao</th>
                  <th>Điểm hạ rỗng</th>
                  <th>Cont</th>
                  <th className="!text-right">Đơn giá chưa dầu</th>
                  <th className="!text-right">% dầu</th>
                  <th className="!text-right">Cước gồm dầu</th>
                  {show3pl ? <th className="!text-right">Đơn giá 3PL</th> : null}
                  <th className="!text-right">Số chuyến</th>
                  <th>Chuyến gần nhất</th>
                  <th>Áp dụng từ</th>
                  <th>Ghi chú</th>
                  {canUpdate ? <th className="sticky right-0 bg-muted" /> : null}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-b hover:bg-muted/40 [&>td]:border-r [&>td]:px-3 [&>td]:py-2">
                    {canDelete ? (
                      <td>
                        <input
                          type="checkbox"
                          aria-label="Chọn dòng"
                          checked={sel.has(r.id)}
                          onChange={(e) =>
                            setSel((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.add(r.id);
                              else n.delete(r.id);
                              return n;
                            })
                          }
                        />
                      </td>
                    ) : null}
                    <td className="font-medium">{r.customer_name}</td>
                    <td>{r.pickup_name}</td>
                    <td>{r.delivery_name}</td>
                    <td>{r.empty_return_name ?? <span className="text-muted-foreground">–</span>}</td>
                    <td>{sizeLabel(r.container_size)}</td>
                    <td className="text-right font-semibold tabular-nums">{formatNumber(r.unit_price)}</td>
                    <td className="text-right tabular-nums">{r.fuel_support_rate === null ? "–" : `${formatNumber(r.fuel_support_rate)}%`}</td>
                    <td className="text-right tabular-nums">{formatNumber(withFuel(r.unit_price, r.fuel_support_rate))}</td>
                    {show3pl ? <td className="text-right tabular-nums">{r.carrier_unit_price === null ? "–" : formatNumber(r.carrier_unit_price)}</td> : null}
                    <td className="text-right tabular-nums" title={r.price_min !== null && r.price_max !== null && r.price_min !== r.price_max ? `Thấp nhất ${formatNumber(r.price_min)}, cao nhất ${formatNumber(r.price_max)}` : undefined}>
                      {formatNumber(r.trip_count)}
                      {r.price_min !== null && r.price_max !== null && r.price_min !== r.price_max ? <span className="ml-1 text-amber-700">*</span> : null}
                    </td>
                    <td className="whitespace-nowrap">{r.last_shipment_code ? `${r.last_shipment_code} · ${formatDate(r.last_trip_date)}` : ""}</td>
                    <td className="whitespace-nowrap">
                      {formatDate(r.effective_from)} {r.status !== "active" ? <Badge variant="muted">Ngừng</Badge> : null}
                    </td>
                    <td className="max-w-60 truncate" title={r.notes ?? undefined}>
                      {r.source === "manual" ? <Badge variant="info" className="mr-1">Sửa tay</Badge> : null}
                      {r.notes}
                    </td>
                    {canUpdate ? (
                      <td className="sticky right-0 bg-card">
                        <Button size="sm" variant="ghost" onClick={() => setEdit(r)} title="Sửa giá">
                          <Pencil />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
                {!shown.length ? (
                  <tr>
                    <td colSpan={16} className="px-3 py-10 text-center text-muted-foreground">
                      {rows.length ? "Không có dòng giá phù hợp bộ lọc." : "Chưa có bảng giá xe cont. Bấm Lấy giá từ chuyến đã chạy để tạo."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">* Số chuyến có dấu sao: các chuyến cùng tuyến có nhiều mức giá khác nhau (rê chuột để xem thấp nhất, cao nhất).</p>

      {edit ? <EditDialog row={edit} show3pl={show3pl} onClose={() => setEdit(null)} /> : null}
      {fromTrips ? <FromTripsDialog defaultRange={defaultRange} show3pl={show3pl} onClose={() => setFromTrips(false)} /> : null}
    </div>
  );
}

function EditDialog({ row, show3pl, onClose }: { row: ContainerPriceRow; show3pl: boolean; onClose: () => void }) {
  const router = useRouter();
  const [v, setV] = useState({
    unit_price: row.unit_price as number | null,
    fuel_support_rate: row.fuel_support_rate,
    carrier_unit_price: row.carrier_unit_price,
    effective_from: row.effective_from,
    status: row.status as "active" | "inactive",
    notes: row.notes ?? "",
  });
  const [pending, start] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Sửa giá xe cont</DialogTitle>
          <DialogDescription>
            {row.customer_name}: {row.pickup_name} → {row.delivery_name}
            {row.empty_return_name ? ` → ${row.empty_return_name}` : ""} · Cont {sizeLabel(row.container_size)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Đơn giá chưa dầu</Label>
            <NumInput className="h-9" value={v.unit_price} onChange={(x) => setV((s) => ({ ...s, unit_price: x }))} />
          </div>
          <div className="space-y-1.5">
            <Label>% hỗ trợ dầu</Label>
            <NumInput className="h-9" value={v.fuel_support_rate} onChange={(x) => setV((s) => ({ ...s, fuel_support_rate: x }))} />
          </div>
          {show3pl ? (
            <div className="space-y-1.5">
              <Label>Đơn giá 3PL chưa dầu</Label>
              <NumInput className="h-9" value={v.carrier_unit_price} onChange={(x) => setV((s) => ({ ...s, carrier_unit_price: x }))} />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="ed-from">Áp dụng từ</Label>
            <Input id="ed-from" type="date" value={v.effective_from} onChange={(e) => setV((s) => ({ ...s, effective_from: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Trạng thái</Label>
            <NativeSelect value={v.status} onChange={(e) => setV((s) => ({ ...s, status: e.target.value as "active" | "inactive" }))}>
              <option value="active">Đang dùng</option>
              <option value="inactive">Ngừng dùng</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ed-notes">Ghi chú</Label>
            <Textarea id="ed-notes" className="min-h-14" value={v.notes} onChange={(e) => setV((s) => ({ ...s, notes: e.target.value }))} />
          </div>
          <p className="text-sm text-muted-foreground sm:col-span-2">
            Cước gồm dầu: <b>{v.unit_price === null ? "–" : formatNumber(withFuel(v.unit_price, v.fuel_support_rate))}</b>
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Hủy
          </Button>
          <Button
            disabled={pending || v.unit_price === null}
            onClick={() =>
              start(async () => {
                const r = await updateContainerPrice({ id: row.id, ...v, unit_price: v.unit_price ?? 0, notes: v.notes || null });
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.message ?? "Đã lưu.");
                onClose();
                router.refresh();
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : null} Lưu
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type PriceBasis = "last" | "common";

function FromTripsDialog({ defaultRange, show3pl, onClose }: { defaultRange: { tu: string; den: string }; show3pl: boolean; onClose: () => void }) {
  const router = useRouter();
  const [range, setRange] = useState({ from: defaultRange.tu, to: defaultRange.den });
  const [customerId, setCustomerId] = useState("");
  const [basis, setBasis] = useState<PriceBasis>("last");
  const [rows, setRows] = useState<TripPriceRow[] | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();

  const priceOf = (r: TripPriceRow) => (basis === "last" ? r.last_unit_price : r.common_unit_price);
  const stateOf = (r: TripPriceRow): "new" | "changed" | "same" => (r.current_id === null ? "new" : r.current_unit_price === priceOf(r) ? "same" : "changed");

  const load = () =>
    startLoad(async () => {
      const r = await loadPricesFromTrips({ ...range, customerId });
      if (!r.ok) return void toast.error(r.error);
      const list = r.data ?? [];
      setRows(list);
      setSel(new Set(list.map((x, i) => (x.current_id === null || x.current_unit_price !== x.last_unit_price ? i : -1)).filter((i) => i >= 0)));
    });

  /** n tháng gần nhất, tính cả tháng này */
  const quick = (n: number) => setRange({ from: monthRange(todayVN(), -(n - 1)).tu, to: monthRange(todayVN()).den });

  const counts = useMemo(() => {
    const c = { new: 0, changed: 0, same: 0 };
    for (const r of rows ?? []) c[stateOf(r)]++;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, basis]);

  const apply = () => {
    if (!rows) return;
    const chosen = rows.filter((_, i) => sel.has(i));
    if (!chosen.length) return void toast.error("Chưa chọn dòng nào.");
    startSave(async () => {
      const r = await applyContainerPrices(
        chosen.map((x) => ({
          customer_id: x.customer_id,
          pickup_location_id: x.pickup_location_id,
          delivery_location_id: x.delivery_location_id,
          empty_return_location_id: x.empty_return_location_id,
          container_size: (x.container_size as "20" | "40" | "45" | null) ?? null,
          unit_price: priceOf(x),
          fuel_support_rate: x.last_fuel_rate,
          carrier_unit_price: x.last_carrier_unit_price,
          trip_count: x.trip_count,
          price_min: x.price_min,
          price_max: x.price_max,
          last_trip_date: x.last_trip_date,
          last_shipment_code: x.last_shipment_code,
        })),
      );
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Đã cập nhật bảng giá: thêm ${formatNumber(r.data?.inserted ?? 0)} dòng, sửa ${formatNumber(r.data?.updated ?? 0)} dòng.`);
      onClose();
      router.refresh();
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(1400px,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>Lấy giá xe cont từ chuyến đã chạy</DialogTitle>
          <DialogDescription>
            Lấy đơn giá cước GHA <b>chưa hỗ trợ dầu</b> trên các chuyến cont (có số cont hoặc xe đầu kéo) đang chạy hoặc đã hoàn thành, gom theo Khách hàng + Điểm nhận + Điểm giao + Điểm hạ rỗng + cỡ cont.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="ft-from">Từ ngày</Label>
            <Input id="ft-from" type="date" value={range.from} onChange={(e) => setRange((s) => ({ ...s, from: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ft-to">Đến ngày</Label>
            <Input id="ft-to" type="date" value={range.to} onChange={(e) => setRange((s) => ({ ...s, to: e.target.value }))} />
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => quick(1)}>
              Tháng này
            </Button>
            <Button size="sm" variant="outline" onClick={() => quick(3)}>
              3 tháng
            </Button>
            <Button size="sm" variant="outline" onClick={() => quick(6)}>
              6 tháng
            </Button>
          </div>
          <div className="w-64 space-y-1.5">
            <Label>Khách hàng (trống = tất cả)</Label>
            <ReferenceSelect refKey="customers" value={customerId} onChange={(v) => setCustomerId(v)} allowQuickCreate={false} />
          </div>
          <div className="w-56 space-y-1.5">
            <Label>Lấy đơn giá theo</Label>
            <NativeSelect value={basis} onChange={(e) => setBasis(e.target.value as PriceBasis)}>
              <option value="last">Chuyến gần nhất</option>
              <option value="common">Giá chạy nhiều nhất</option>
            </NativeSelect>
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <History />} Lấy giá
          </Button>
        </div>

        {rows ? (
          rows.length === 0 ? (
            <Alert>
              <AlertDescription>Không có chuyến cont nào có đơn giá trong khoảng ngày này.</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="success">Mới {formatNumber(counts.new)}</Badge>
                <Badge variant="warning">Đổi giá {formatNumber(counts.changed)}</Badge>
                <Badge variant="muted">Giữ nguyên {formatNumber(counts.same)}</Badge>
                <span className="text-muted-foreground">Đã chọn {formatNumber(sel.size)} / {formatNumber(rows.length)} dòng</span>
              </div>
              <div className="max-h-[55vh] overflow-auto rounded-md border">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr className="[&>th]:border-r [&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold [&>th]:whitespace-nowrap">
                      <th className="w-8">
                        <input
                          type="checkbox"
                          aria-label="Chọn tất cả"
                          checked={sel.size === rows.length}
                          onChange={(e) => setSel(e.target.checked ? new Set(rows.map((_, i) => i)) : new Set())}
                        />
                      </th>
                      <th>Khách hàng</th>
                      <th>Điểm nhận</th>
                      <th>Điểm giao</th>
                      <th>Điểm hạ rỗng</th>
                      <th>Cont</th>
                      <th className="!text-right">Số chuyến</th>
                      <th className="!text-right">Thấp – cao</th>
                      <th className="!text-right">Đơn giá lấy</th>
                      <th className="!text-right">% dầu</th>
                      {show3pl ? <th className="!text-right">Đơn giá 3PL</th> : null}
                      <th className="!text-right">Giá đang có</th>
                      <th>Chuyến gần nhất</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const st = stateOf(r);
                      return (
                        <tr key={i} className="border-b hover:bg-muted/40 [&>td]:border-r [&>td]:px-3 [&>td]:py-2">
                          <td>
                            <input
                              type="checkbox"
                              aria-label="Chọn dòng"
                              checked={sel.has(i)}
                              onChange={(e) =>
                                setSel((s) => {
                                  const n = new Set(s);
                                  if (e.target.checked) n.add(i);
                                  else n.delete(i);
                                  return n;
                                })
                              }
                            />
                          </td>
                          <td className="font-medium">{r.customer_name}</td>
                          <td>{r.pickup_name}</td>
                          <td>{r.delivery_name}</td>
                          <td>{r.empty_return_name ?? <span className="text-muted-foreground">–</span>}</td>
                          <td>{sizeLabel(r.container_size)}</td>
                          <td className="text-right tabular-nums">{formatNumber(r.trip_count)}</td>
                          <td className={`text-right tabular-nums ${r.price_min !== r.price_max ? "text-amber-700" : "text-muted-foreground"}`}>
                            {r.price_min === r.price_max ? "–" : `${formatNumber(r.price_min)} – ${formatNumber(r.price_max)}`}
                          </td>
                          <td className="text-right font-semibold tabular-nums">{formatNumber(priceOf(r))}</td>
                          <td className="text-right tabular-nums">{r.last_fuel_rate === null ? "–" : `${formatNumber(r.last_fuel_rate)}%`}</td>
                          {show3pl ? <td className="text-right tabular-nums">{r.last_carrier_unit_price === null ? "–" : formatNumber(r.last_carrier_unit_price)}</td> : null}
                          <td className="text-right tabular-nums">
                            {st === "new" ? (
                              <Badge variant="success">Mới</Badge>
                            ) : st === "changed" ? (
                              <span className="text-amber-700">{formatNumber(r.current_unit_price)} → đổi</span>
                            ) : (
                              <span className="text-muted-foreground">{formatNumber(r.current_unit_price)} (giữ)</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap">
                            {r.last_shipment_code} · {formatDate(r.last_trip_date)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onClose}>
                  Đóng
                </Button>
                <Button onClick={apply} disabled={saving || !sel.size}>
                  {saving ? <Loader2 className="animate-spin" /> : null} Cập nhật {formatNumber(sel.size)} dòng vào bảng giá
                </Button>
              </div>
            </>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
