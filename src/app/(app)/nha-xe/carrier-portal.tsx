"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Search, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, formatNumber, monthRangeYMD } from "@/lib/format";
import { parseNumberVN } from "@/lib/entities/record";
import { registerVehicles } from "./actions";

export type PortalSupplier = { id: string; code: string; name: string };
export type PortalItem = { id: string; line_no: number; item_code: string | null; item_name: string | null; quantity: number | null; unit: string | null; weight_kg: number | null; bag_count: number | null };
export type PortalShipment = {
  id: string;
  shipment_code: string;
  order_code: string;
  ref_no: string | null;
  voucher_no: string | null;
  pickup_at: string;
  status: string;
  supplier_id: string;
  supplier_name: string;
  pickup_name: string | null;
  pickup_address: string | null;
  delivery_name: string | null;
  delivery_address: string | null;
  empty_return_name: string | null;
  vehicle_type_name: string | null;
  container_no: string | null;
  plate_number: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  delivery_method: string | null;
  notes: string | null;
  split_from_code: string | null;
  items: PortalItem[];
  tons: number | null;
};

const STATUS: Record<string, { label: string; variant: "secondary" | "warning" | "success" | "default" }> = {
  draft: { label: "Chờ đăng ký xe", variant: "warning" },
  assigned: { label: "Đã đăng ký xe", variant: "default" },
  accepted: { label: "Tài xế đã nhận", variant: "default" },
  in_transit: { label: "Đang chạy", variant: "secondary" },
  driver_completed: { label: "Hoàn thành", variant: "success" },
  closed: { label: "Hoàn thành", variant: "success" },
};
const EDITABLE = ["draft", "assigned", "accepted"];

const itemLabel = (i: PortalItem) => [i.item_code, i.item_name].filter(Boolean).join(" – ") || "Hàng";
const qtyText = (s: PortalShipment) =>
  s.items.length
    ? s.items.map((i) => `${formatNumber(i.quantity ?? 0)} ${i.unit ?? ""}`.trim()).join(" + ")
    : s.tons
      ? `${formatNumber(s.tons)} tấn`
      : "";

export function CarrierPortal(props: { tu: string; den: string; all: boolean; supplier: string; suppliers: PortalSupplier[]; staff: boolean; rows: PortalShipment[] }) {
  const router = useRouter();
  const [tu, setTu] = useState(props.tu);
  const [den, setDen] = useState(props.den);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<PortalShipment | null>(null);

  const go = (p: Partial<{ tu: string; den: string; nx: string; tatca: string }>) => {
    const sp = new URLSearchParams({ tu: props.tu, den: props.den });
    if (props.supplier) sp.set("nx", props.supplier);
    if (props.all) sp.set("tatca", "1");
    for (const [k, v] of Object.entries(p)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    router.push(`/nha-xe?${sp.toString()}`);
  };
  const shiftMonth = (d: number) => {
    const r = monthRangeYMD(props.tu, d);
    setTu(r.tu);
    setDen(r.den);
    go(r);
  };

  const term = q.trim().toLowerCase();
  const rows = useMemo(
    () =>
      props.rows.filter(
        (r) =>
          !term ||
          [r.shipment_code, r.order_code, r.ref_no, r.voucher_no, r.pickup_name, r.delivery_name, r.plate_number, r.driver_name, r.container_no, ...r.items.map(itemLabel)]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(term),
      ),
    [props.rows, term],
  );
  const waiting = props.rows.filter((r) => r.status === "draft").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        {props.staff || props.suppliers.length > 1 ? (
          <div>
            <Label className="text-xs">Nhà xe</Label>
            <NativeSelect value={props.supplier} onChange={(e) => go({ nx: e.target.value })} className="min-w-56">
              <option value="">{props.staff ? "— Chọn nhà xe 3PL —" : "Tất cả nhà xe của tôi"}</option>
              {props.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div>
          <Label className="text-xs">Ngày nhận hàng từ</Label>
          <Input type="date" value={tu} onChange={(e) => setTu(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">đến</Label>
          <Input type="date" value={den} onChange={(e) => setDen(e.target.value)} />
        </div>
        <Button variant="outline" onClick={() => go({ tu, den })}>
          Xem
        </Button>
        <Button variant="ghost" onClick={() => shiftMonth(-1)}>
          ‹ Tháng trước
        </Button>
        <Button variant="ghost" onClick={() => shiftMonth(1)}>
          Tháng sau ›
        </Button>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={props.all} onChange={(e) => go({ tatca: e.target.checked ? "1" : "" })} />
          Hiện cả chuyến đã hoàn thành
        </label>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute top-2.5 left-2 size-4 text-muted-foreground" />
          <Input className="w-64 pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã chuyến, điểm giao, số xe…" />
        </div>
      </div>

      {props.staff && !props.supplier ? (
        <p className="rounded-md border p-3 text-sm text-muted-foreground">Chọn nhà xe 3PL để xem các chuyến đã chỉ định cho nhà xe đó (xem như tài khoản 3PL thấy, đăng ký xe hộ).</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {props.rows.length} chuyến{waiting ? (
            <>
              {" "}
              · <b className="text-warning">{waiting} chuyến chờ đăng ký xe</b>
            </>
          ) : null}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm [&_td]:border-r [&_td]:px-2 [&_td]:py-1.5 [&_th]:border-r [&_th]:px-2 [&_th]:py-2">
          <thead className="sticky top-0 bg-muted text-left text-xs">
            <tr>
              <th>Ngày nhận</th>
              <th>Mã chuyến</th>
              <th>Số đơn / PXK</th>
              <th>Điểm nhận → Điểm giao</th>
              <th>Mã hàng</th>
              <th className="text-right">Số lượng</th>
              <th>Số xe</th>
              <th>Tài xế</th>
              <th>Trạng thái</th>
              <th className="sticky right-0 bg-muted"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
              return (
                <tr key={r.id} className="border-t align-top hover:bg-muted/40">
                  <td className="whitespace-nowrap">{formatDate(r.pickup_at)}</td>
                  <td className="whitespace-nowrap font-medium">
                    {r.shipment_code}
                    {r.split_from_code ? <div className="text-xs font-normal text-muted-foreground">chia từ {r.split_from_code}</div> : null}
                  </td>
                  <td className="whitespace-nowrap">
                    {r.ref_no || r.order_code}
                    {r.voucher_no ? <div className="text-xs text-muted-foreground">PXK {r.voucher_no}</div> : null}
                  </td>
                  <td className="min-w-64">
                    <div>{r.pickup_name}</div>
                    <div>→ {r.delivery_name}</div>
                    {r.delivery_address ? <div className="text-xs text-muted-foreground">{r.delivery_address}</div> : null}
                    {r.empty_return_name ? <div className="text-xs text-muted-foreground">Hạ rỗng: {r.empty_return_name}</div> : null}
                    {r.container_no ? <div className="text-xs text-muted-foreground">Cont: {r.container_no}</div> : null}
                  </td>
                  <td className="min-w-40">{r.items.map((i) => <div key={i.id}>{itemLabel(i)}</div>)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{qtyText(r)}</td>
                  <td className="whitespace-nowrap font-medium">{r.plate_number ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="whitespace-nowrap">
                    {r.driver_name}
                    {r.driver_phone ? <div className="text-xs text-muted-foreground">{r.driver_phone}</div> : null}
                  </td>
                  <td>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </td>
                  <td className="sticky right-0 bg-background">
                    {EDITABLE.includes(r.status) ? (
                      <Button size="sm" variant={r.status === "draft" ? "default" : "outline"} onClick={() => setEditing(r)}>
                        <Truck className="size-4" /> {r.status === "draft" ? "Đăng ký xe" : "Sửa / chia xe"}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={10} className="py-6 text-center text-muted-foreground">
                  Không có chuyến nào trong khoảng ngày này.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {editing ? <RegisterDialog shipment={editing} onClose={() => setEditing(null)} onDone={() => router.refresh()} /> : null}
    </div>
  );
}

type Line = { plate: string; driverName: string; driverPhone: string; nationalId: string; qty: Record<string, string> };
const NO_ITEM = "_";

function RegisterDialog({ shipment, onClose, onDone }: { shipment: PortalShipment; onClose: () => void; onDone: () => void }) {
  const items = shipment.items.filter((i) => Number(i.quantity ?? 0) > 0);
  // Chuyến không có dòng mã hàng: chia theo số tấn của chuyến
  const cols: { id: string; label: string; total: number; unit: string }[] = items.length
    ? items.map((i) => ({ id: i.id, label: itemLabel(i), total: Number(i.quantity ?? 0), unit: i.unit ?? "" }))
    : [{ id: NO_ITEM, label: shipment.tons ? "Số tấn" : "Số xe", total: Number(shipment.tons ?? 1), unit: shipment.tons ? "tấn" : "" }];
  const first: Line = {
    plate: shipment.plate_number ?? "",
    driverName: shipment.driver_name && shipment.driver_name !== "Tài xế & 3PL" && !shipment.driver_name.startsWith("Tài xế 3PL ") ? shipment.driver_name : "",
    driverPhone: shipment.driver_phone ?? "",
    nationalId: "",
    qty: Object.fromEntries(cols.map((c) => [c.id, formatNumber(c.total)])),
  };
  const [lines, setLines] = useState<Line[]>([first]);
  const [pending, start] = useTransition();

  const num = (s: string) => {
    const v = parseNumberVN(s);
    return v === null || Number.isNaN(v) ? 0 : v;
  };
  const used = cols.map((c) => lines.reduce((a, l) => a + num(l.qty[c.id] ?? ""), 0));
  const over = cols.some((c, k) => used[k] > c.total + 0.0005);
  const set = (k: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === k ? { ...l, ...patch } : l)));
  const setQty = (k: number, col: string, v: string) => setLines((ls) => ls.map((l, j) => (j === k ? { ...l, qty: { ...l.qty, [col]: v } } : l)));
  const addLine = () =>
    setLines((ls) => [
      ...ls,
      {
        plate: "",
        driverName: "",
        driverPhone: "",
        nationalId: "",
        // Xe mới: điền sẵn phần còn lại
        qty: Object.fromEntries(cols.map((c, k) => [c.id, used[k] < c.total ? formatNumber(Math.round((c.total - used[k]) * 1000) / 1000) : ""])),
      },
    ]);
  // Chia đều cho số xe đang nhập
  const splitEven = () =>
    setLines((ls) =>
      ls.map((l, j) => ({
        ...l,
        qty: Object.fromEntries(
          cols.map((c) => {
            const each = Math.floor((c.total / ls.length) * 1000) / 1000;
            const v = j === ls.length - 1 ? Math.round((c.total - each * (ls.length - 1)) * 1000) / 1000 : each;
            return [c.id, formatNumber(v)];
          }),
        ),
      })),
    );

  const submit = () =>
    start(async () => {
      const res = await registerVehicles({
        shipmentId: shipment.id,
        lines: lines.map((l) => ({
          plate: l.plate,
          driverName: l.driverName || undefined,
          driverPhone: l.driverPhone || undefined,
          nationalId: l.nationalId || undefined,
          ...(items.length ? { quantities: Object.fromEntries(cols.map((c) => [c.id, num(l.qty[c.id] ?? "")])) } : { quantity: num(l.qty[NO_ITEM] ?? "") }),
        })),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const d = res.data;
      toast.success(
        d?.created.length
          ? `Đã đăng ký ${lines.length} xe, thêm ${d.created.length} chuyến: ${d.created.join(", ")}.${d.full ? "" : ` Chuyến ${shipment.shipment_code} còn lại phần chưa có xe.`}`
          : "Đã lưu số xe, tài xế.",
      );
      onDone();
      onClose();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Đăng ký xe – chuyến {shipment.shipment_code}</DialogTitle>
          <DialogDescription>
            {shipment.pickup_name} → {shipment.delivery_name} · {formatDate(shipment.pickup_at)} · Tổng {qtyText(shipment)}. Đơn lớn thì bấm <b>Thêm xe</b>, mỗi xe nhập số lượng; tổng không
            vượt số lượng chuyến. Chưa đủ thì phần còn lại để đăng ký sau. Không nhập tài xế thì ghi <b>Tài xế &amp; 3PL</b>.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm [&_td]:px-1 [&_td]:py-1 [&_th]:px-1 [&_th]:py-1">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th>#</th>
                <th>Số xe *</th>
                <th>Tài xế</th>
                <th>SĐT</th>
                <th>CCCD</th>
                {cols.map((c) => (
                  <th key={c.id} className="text-right">
                    {c.label} {c.unit ? `(${c.unit})` : ""}
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, k) => (
                <tr key={k}>
                  <td className="text-muted-foreground">{k + 1}</td>
                  <td>
                    <Input className="w-28 uppercase" value={l.plate} onChange={(e) => set(k, { plate: e.target.value })} placeholder="61K31295" />
                  </td>
                  <td>
                    <Input className="w-40" value={l.driverName} onChange={(e) => set(k, { driverName: e.target.value })} placeholder="Tài xế & 3PL" />
                  </td>
                  <td>
                    <Input className="w-28" value={l.driverPhone} onChange={(e) => set(k, { driverPhone: e.target.value })} inputMode="tel" />
                  </td>
                  <td>
                    <Input className="w-32" value={l.nationalId} onChange={(e) => set(k, { nationalId: e.target.value })} inputMode="numeric" />
                  </td>
                  {cols.map((c) => (
                    <td key={c.id}>
                      <Input className="w-28 text-right tabular-nums" value={l.qty[c.id] ?? ""} onChange={(e) => setQty(k, c.id, e.target.value)} inputMode="decimal" />
                    </td>
                  ))}
                  <td>
                    {lines.length > 1 ? (
                      <Button size="icon" variant="ghost" onClick={() => setLines((ls) => ls.filter((_, j) => j !== k))} aria-label="Bỏ xe">
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              <tr className="border-t font-medium">
                <td colSpan={5} className="text-right">
                  Tổng các xe / Số lượng chuyến
                </td>
                {cols.map((c, k) => (
                  <td key={c.id} className={`text-right tabular-nums ${used[k] > c.total + 0.0005 ? "text-destructive" : used[k] < c.total - 0.0005 ? "text-warning" : "text-success"}`}>
                    {formatNumber(used[k])} / {formatNumber(c.total)}
                  </td>
                ))}
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        {over ? <p className="text-sm text-destructive">Tổng số lượng các xe đang vượt số lượng của chuyến.</p> : null}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={addLine} disabled={lines.length >= 60}>
              <Plus className="size-4" /> Thêm xe
            </Button>
            {lines.length > 1 ? (
              <Button variant="ghost" onClick={splitEven}>
                Chia đều {lines.length} xe
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Đóng
            </Button>
            <Button onClick={submit} disabled={pending || over || lines.some((l) => l.plate.trim().length < 4)}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Lưu {lines.length} xe
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
