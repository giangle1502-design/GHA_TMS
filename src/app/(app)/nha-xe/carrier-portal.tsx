"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Combine, Loader2, Plus, Trash2, Truck, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReportGrid, type ReportColumn } from "@/components/grid/report-grid";
import type { TableViewConfig } from "@/lib/entities/types";
import { formatDate, formatNumber, monthRangeYMD } from "@/lib/format";
import { parseNumberVN } from "@/lib/entities/record";
import { registerVehicles, registerVehiclesMulti } from "./actions";

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
  /** Các chuyến (của đơn khác) đi chung xe – SQL 9032 */
  load_group_id?: string | null;
  load_with?: string[] | null;
  items: PortalItem[];
  tons: number | null;
};

/** Xe, tài xế nhà xe đã nhập trước đây: gợi ý khi gõ */
export type PortalFleet = {
  vehicles: { plate: string; driver_id: string | null }[];
  drivers: { id: string; name: string; phone: string | null; national_id: string | null; last_plate: string | null }[];
};
const plateKey = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
const nameKey = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();

const STATUS: Record<string, { label: string; variant: "secondary" | "warning" | "success" | "default" }> = {
  draft: { label: "Chờ đăng ký xe", variant: "warning" },
  assigned: { label: "Đã đăng ký xe", variant: "default" },
  accepted: { label: "Tài xế đã nhận", variant: "default" },
  in_transit: { label: "Đang chạy", variant: "secondary" },
  driver_completed: { label: "Hoàn thành", variant: "success" },
  closed: { label: "Hoàn thành", variant: "success" },
};
const EDITABLE = ["draft", "assigned", "accepted"];
const PLACEHOLDER_DRIVER = (n: string | null) => !n || n === "Tài xế & 3PL" || n.startsWith("Tài xế 3PL ");

const itemLabel = (i: PortalItem) => [i.item_code, i.item_name].filter(Boolean).join(" – ") || "Hàng";
const qtyText = (s: PortalShipment) =>
  s.items.length
    ? s.items.map((i) => `${formatNumber(i.quantity ?? 0)} ${i.unit ?? ""}`.trim()).join(" + ")
    : s.tons
      ? `${formatNumber(s.tons)} tấn`
      : "";
const qtyValue = (s: PortalShipment) => (s.items.length ? s.items.reduce((a, i) => a + Number(i.quantity ?? 0), 0) : Number(s.tons ?? 0));

export function CarrierPortal(props: {
  tu: string;
  den: string;
  all: boolean;
  supplier: string;
  suppliers: PortalSupplier[];
  staff: boolean;
  rows: PortalShipment[];
  fleet: PortalFleet;
  view: TableViewConfig | null;
}) {
  const router = useRouter();
  const [tu, setTu] = useState(props.tu);
  const [den, setDen] = useState(props.den);
  const [editing, setEditing] = useState<PortalShipment[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const go = (p: Partial<{ tu: string; den: string; nx: string; tatca: string }>) => {
    const sp = new URLSearchParams({ tu: props.tu, den: props.den });
    if (props.supplier) sp.set("nx", props.supplier);
    if (props.all) sp.set("tatca", "1");
    for (const [k, v] of Object.entries(p)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    setPicked(new Set());
    router.push(`/nha-xe?${sp.toString()}`);
  };
  const shiftMonth = (d: number) => {
    const r = monthRangeYMD(props.tu, d);
    setTu(r.tu);
    setDen(r.den);
    go(r);
  };
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const pickedRows = props.rows.filter((r) => picked.has(r.id) && EDITABLE.includes(r.status));
  const waiting = props.rows.filter((r) => r.status === "draft").length;

  const columns = useMemo<ReportColumn<PortalShipment>[]>(
    () => [
      {
        key: "pick",
        label: "Gộp",
        width: 56,
        value: (r) => (picked.has(r.id) ? "x" : ""),
        render: (r) =>
          EDITABLE.includes(r.status) ? (
            <input type="checkbox" className="size-4" aria-label={`Chọn ${r.shipment_code} để gộp`} checked={picked.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} />
          ) : null,
      },
      { key: "pickup_at", label: "Ngày nhận", width: 100, kind: "date", value: (r) => r.pickup_at?.slice(0, 10), render: (r) => formatDate(r.pickup_at) },
      {
        key: "shipment_code",
        label: "Mã chuyến",
        width: 150,
        value: (r) => r.shipment_code,
        render: (r) => (
          <div>
            <div className="font-medium">{r.shipment_code}</div>
            {r.split_from_code ? <div className="text-xs text-muted-foreground">chia từ {r.split_from_code}</div> : null}
            {r.load_with?.length ? <div className="text-xs text-primary">đi chung xe với {r.load_with.join(", ")}</div> : null}
          </div>
        ),
      },
      {
        key: "ref_no",
        label: "Số đơn / PXK",
        width: 140,
        value: (r) => [r.ref_no || r.order_code, r.voucher_no].filter(Boolean).join(" "),
        render: (r) => (
          <div>
            {r.ref_no || r.order_code}
            {r.voucher_no ? <div className="text-xs text-muted-foreground">PXK {r.voucher_no}</div> : null}
          </div>
        ),
      },
      { key: "pickup_name", label: "Điểm nhận", width: 170, value: (r) => r.pickup_name },
      {
        key: "delivery_name",
        label: "Điểm giao",
        width: 220,
        value: (r) => r.delivery_name,
        render: (r) => (
          <div>
            {r.delivery_name}
            {r.delivery_address ? <div className="text-xs text-muted-foreground">{r.delivery_address}</div> : null}
          </div>
        ),
      },
      { key: "empty_return_name", label: "Hạ rỗng", width: 140, value: (r) => r.empty_return_name },
      { key: "container_no", label: "Số cont", width: 120, value: (r) => r.container_no },
      { key: "items", label: "Mã hàng", width: 240, value: (r) => r.items.map(itemLabel).join("; "), render: (r) => r.items.map((i) => <div key={i.id}>{itemLabel(i)}</div>) },
      { key: "quantity", label: "Số lượng", width: 120, align: "right", kind: "number", value: qtyValue, render: (r) => <span className="tabular-nums">{qtyText(r)}</span> },
      { key: "plate_number", label: "Số xe", width: 110, value: (r) => r.plate_number, render: (r) => <span className="font-medium">{r.plate_number ?? "—"}</span> },
      {
        key: "driver_name",
        label: "Tài xế",
        width: 160,
        value: (r) => r.driver_name,
        render: (r) => (
          <div>
            {r.driver_name}
            {r.driver_phone ? <div className="text-xs text-muted-foreground">{r.driver_phone}</div> : null}
          </div>
        ),
      },
      {
        key: "status",
        label: "Trạng thái",
        width: 130,
        value: (r) => STATUS[r.status]?.label ?? r.status,
        render: (r) => {
          const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
          return <Badge variant={st.variant}>{st.label}</Badge>;
        },
      },
      {
        key: "action",
        label: "Thao tác",
        width: 150,
        value: () => "",
        render: (r) =>
          EDITABLE.includes(r.status) ? (
            <Button size="sm" variant={r.status === "draft" ? "default" : "outline"} onClick={() => setEditing([r])}>
              <Truck className="size-4" /> {r.status === "draft" ? "Đăng ký xe" : "Sửa / chia xe"}
            </Button>
          ) : null,
      },
    ],
    [picked],
  );

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
      </div>

      {props.staff && !props.supplier ? (
        <p className="rounded-md border p-3 text-sm text-muted-foreground">Chọn nhà xe 3PL để xem các chuyến đã chỉ định cho nhà xe đó (xem như tài khoản 3PL thấy, đăng ký xe hộ).</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {props.rows.length} chuyến
            {waiting ? (
              <>
                {" "}
                · <b className="text-warning">{waiting} chuyến chờ đăng ký xe</b>
              </>
            ) : null}
          </span>
          <span className="text-muted-foreground">Một xe chở nhiều đơn: tick ô Gộp ở các chuyến rồi bấm</span>
          <Button size="sm" disabled={pickedRows.length < 2} onClick={() => setEditing(pickedRows)}>
            <Combine className="size-4" /> Đăng ký xe chung cho {pickedRows.length || ""} chuyến đã tick
          </Button>
          {picked.size ? (
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
              Bỏ tick
            </Button>
          ) : null}
        </div>
      )}

      <ReportGrid
        tableKey="carrier_portal"
        rows={props.rows}
        columns={columns}
        view={props.view}
        getRowId={(r) => r.id}
        defaultPinned={["pick", "pickup_at", "shipment_code"]}
        searchPlaceholder="Tìm mã chuyến, điểm giao, số xe…"
        emptyText="Không có chuyến nào trong khoảng ngày này."
      />
      {editing ? (
        <RegisterDialog
          shipments={editing}
          fleet={props.fleet}
          onClose={() => setEditing(null)}
          onDone={() => {
            setPicked(new Set());
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

type Line = { plate: string; driverName: string; driverPhone: string; nationalId: string; cap: string; qty: Record<string, string> };
type Col = { id: string; shipment: string; label: string; total: number; unit: string };
const blank = (): Line => ({ plate: "", driverName: "", driverPhone: "", nationalId: "", cap: "", qty: {} });
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function RegisterDialog({ shipments, fleet, onClose, onDone }: { shipments: PortalShipment[]; fleet: PortalFleet; onClose: () => void; onDone: () => void }) {
  const multi = shipments.length > 1;
  const ordered = [...shipments].sort((a, b) => a.pickup_at.localeCompare(b.pickup_at) || a.shipment_code.localeCompare(b.shipment_code));
  // Mỗi cột = một mã hàng của một chuyến; chuyến không có mã hàng: một cột theo số tấn (khóa = mã chuyến)
  const cols: Col[] = ordered.flatMap((s) => {
    const items = s.items.filter((i) => Number(i.quantity ?? 0) > 0);
    return items.length
      ? items.map((i) => ({ id: i.id, shipment: s.id, label: multi ? `${s.shipment_code}${items.length > 1 ? ` · ${i.item_code ?? ""}` : ""}` : itemLabel(i), total: Number(i.quantity ?? 0), unit: i.unit ?? "" }))
      : [{ id: s.id, shipment: s.id, label: multi ? s.shipment_code : s.tons ? "Số tấn" : "Số xe", total: Number(s.tons ?? 1), unit: s.tons ? "tấn" : "" }];
  });
  const units = [...new Set(cols.map((c) => c.unit.toUpperCase()))];
  const capUnit = units.length === 1 ? cols[0].unit : "";
  const one = shipments[0];
  const [lines, setLines] = useState<Line[]>(() =>
    multi
      ? [blank()]
      : [
          {
            plate: one.plate_number ?? "",
            driverName: PLACEHOLDER_DRIVER(one.driver_name) ? "" : (one.driver_name ?? ""),
            driverPhone: one.driver_phone ?? "",
            nationalId: "",
            cap: "",
            qty: Object.fromEntries(cols.map((c) => [c.id, formatNumber(c.total)])),
          },
        ],
  );
  const [pending, start] = useTransition();

  const num = (s: string | undefined) => {
    const v = parseNumberVN(s ?? "");
    return v === null || Number.isNaN(v) ? 0 : v;
  };
  const used = cols.map((c) => lines.reduce((a, l) => a + num(l.qty[c.id]), 0));
  const over = cols.some((c, k) => used[k] > c.total + 0.0005);
  const lineTotal = (l: Line) => cols.reduce((a, c) => a + num(l.qty[c.id]), 0);
  const set = (k: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === k ? { ...l, ...patch } : l)));
  const setQty = (k: number, col: string, v: string) => setLines((ls) => ls.map((l, j) => (j === k ? { ...l, qty: { ...l.qty, [col]: v } } : l)));
  // Gõ / chọn số xe đã dùng: tự điền tài xế phụ trách xe (nếu dòng chưa có tài xế)
  const pickPlate = (k: number, plate: string) =>
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== k) return l;
        const v = fleet.vehicles.find((x) => plateKey(x.plate) === plateKey(plate));
        const d = v?.driver_id ? fleet.drivers.find((x) => x.id === v.driver_id) : undefined;
        if (!d || l.driverName.trim()) return { ...l, plate };
        return { ...l, plate, driverName: d.name, driverPhone: l.driverPhone || d.phone || "", nationalId: l.nationalId || d.national_id || "" };
      }),
    );
  // Gõ / chọn tài xế đã dùng: tự điền SĐT, CCCD, và số xe lần trước nếu dòng chưa có số xe
  const pickDriver = (k: number, name: string) =>
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== k) return l;
        const d = fleet.drivers.find((x) => nameKey(x.name) === nameKey(name));
        if (!d) return { ...l, driverName: name };
        return { ...l, driverName: name, driverPhone: d.phone || l.driverPhone, nationalId: d.national_id || l.nationalId, plate: l.plate || d.last_plate || "" };
      }),
    );
  const addLine = () =>
    setLines((ls) => [
      ...ls,
      multi
        ? blank()
        : { ...blank(), qty: Object.fromEntries(cols.map((c, k) => [c.id, used[k] < c.total ? formatNumber(r3(c.total - used[k])) : ""])) }, // xe mới: điền sẵn phần còn lại
    ]);
  // Chia đều cho số xe đang nhập (một chuyến)
  const splitEven = () =>
    setLines((ls) =>
      ls.map((l, j) => ({
        ...l,
        qty: Object.fromEntries(
          cols.map((c) => {
            const each = Math.floor((c.total / ls.length) * 1000) / 1000;
            return [c.id, formatNumber(j === ls.length - 1 ? r3(c.total - each * (ls.length - 1)) : each)];
          }),
        ),
      })),
    );
  // Tự xếp theo tải xe: lần lượt từng xe lấy hết chuyến trước rồi sang chuyến sau, xe cuối lấy phần còn lại nếu chưa nhập tải
  const autoFill = () =>
    setLines((ls) => {
      const left = cols.map((c) => c.total);
      return ls.map((l, j) => {
        let cap = num(l.cap);
        if (!cap && j === ls.length - 1) cap = left.reduce((a, b) => a + b, 0);
        const qty: Record<string, string> = {};
        cols.forEach((c, k) => {
          const take = r3(Math.min(cap, left[k]));
          if (take > 0) {
            qty[c.id] = formatNumber(take);
            left[k] = r3(left[k] - take);
            cap = r3(cap - take);
          }
        });
        return { ...l, qty };
      });
    });

  const submit = () =>
    start(async () => {
      const base = (l: Line) => ({ plate: l.plate, driverName: l.driverName || undefined, driverPhone: l.driverPhone || undefined, nationalId: l.nationalId || undefined });
      const qtys = (l: Line) => Object.fromEntries(cols.map((c) => [c.id, num(l.qty[c.id])]).filter(([, v]) => (v as number) > 0));
      const res = multi
        ? await registerVehiclesMulti({ shipmentIds: shipments.map((s) => s.id), lines: lines.map((l) => ({ ...base(l), quantities: qtys(l) })) })
        : await registerVehicles({
            shipmentId: one.id,
            lines: lines.map((l) => ({ ...base(l), ...(one.items.some((i) => Number(i.quantity ?? 0) > 0) ? { quantities: qtys(l) } : { quantity: num(l.qty[one.id]) }) })),
          });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const created = res.data?.created ?? [];
      toast.success(created.length ? `Đã đăng ký ${lines.length} xe, thêm ${created.length} chuyến: ${created.join(", ")}.` : `Đã lưu ${lines.length} xe.`);
      onDone();
      onClose();
    });

  const title = multi ? `Đăng ký xe chung cho ${shipments.length} chuyến` : `Đăng ký xe – chuyến ${one.shipment_code}`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {multi ? (
              <>
                Mỗi dòng là một xe, mỗi cột là số lượng xe đó lấy của từng chuyến. Nhập <b>Tải xe</b> rồi bấm <b>Tự xếp theo tải xe</b>: xe lấy hết chuyến trước rồi sang chuyến sau. Tổng
                từng chuyến không vượt số lượng của chuyến; chưa xếp hết thì phần còn lại đăng ký sau.
              </>
            ) : (
              <>
                {one.pickup_name} → {one.delivery_name} · {formatDate(one.pickup_at)} · Tổng {qtyText(one)}. Đơn lớn thì bấm <b>Thêm xe</b>, mỗi xe nhập số lượng; tổng không vượt số lượng
                chuyến. Chưa đủ thì phần còn lại để đăng ký sau.
              </>
            )}{" "}
            Không nhập tài xế thì ghi <b>Tài xế &amp; 3PL</b>. Số xe, tài xế đã nhập lần trước được gợi ý khi gõ.
          </DialogDescription>
        </DialogHeader>
        {multi ? (
          <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
            {ordered.map((s) => (
              <div key={s.id}>
                <b className="text-foreground">{s.shipment_code}</b> · {s.ref_no || s.order_code} · {s.pickup_name} → {s.delivery_name} · {qtyText(s)}
              </div>
            ))}
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-sm [&_td]:px-1 [&_td]:py-1 [&_th]:px-1 [&_th]:py-1">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th>#</th>
                <th>Số xe *</th>
                <th>Tài xế</th>
                <th>SĐT</th>
                <th>CCCD</th>
                <th className="text-right">Tải xe {capUnit ? `(${capUnit})` : ""}</th>
                {cols.map((c) => (
                  <th key={c.id} className="text-right">
                    {c.label} {c.unit && !multi ? `(${c.unit})` : ""}
                  </th>
                ))}
                {multi ? <th className="text-right">Xe chở</th> : null}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, k) => (
                <tr key={k}>
                  <td className="text-muted-foreground">{k + 1}</td>
                  <td>
                    <Input className="w-28 uppercase" list="nx-plates" value={l.plate} onChange={(e) => pickPlate(k, e.target.value)} placeholder="61K31295" />
                  </td>
                  <td>
                    <Input className="w-40" list="nx-drivers" value={l.driverName} onChange={(e) => pickDriver(k, e.target.value)} placeholder="Tài xế & 3PL" />
                  </td>
                  <td>
                    <Input className="w-28" value={l.driverPhone} onChange={(e) => set(k, { driverPhone: e.target.value })} inputMode="tel" />
                  </td>
                  <td>
                    <Input className="w-32" value={l.nationalId} onChange={(e) => set(k, { nationalId: e.target.value })} inputMode="numeric" />
                  </td>
                  <td>
                    <Input className="w-24 text-right tabular-nums" value={l.cap} onChange={(e) => set(k, { cap: e.target.value })} inputMode="decimal" placeholder="18,000" />
                  </td>
                  {cols.map((c) => (
                    <td key={c.id}>
                      <Input className="w-28 text-right tabular-nums" value={l.qty[c.id] ?? ""} onChange={(e) => setQty(k, c.id, e.target.value)} inputMode="decimal" />
                    </td>
                  ))}
                  {multi ? <td className="text-right tabular-nums">{formatNumber(lineTotal(l))}</td> : null}
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
                <td colSpan={6} className="text-right">
                  Tổng các xe / Số lượng chuyến
                </td>
                {cols.map((c, k) => (
                  <td key={c.id} className={`text-right tabular-nums ${used[k] > c.total + 0.0005 ? "text-destructive" : used[k] < c.total - 0.0005 ? "text-warning" : "text-success"}`}>
                    {formatNumber(used[k])} / {formatNumber(c.total)}
                  </td>
                ))}
                {multi ? <td></td> : null}
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        {over ? <p className="text-sm text-destructive">Tổng số lượng các xe đang vượt số lượng của chuyến (ô đỏ).</p> : null}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={addLine} disabled={lines.length >= 60}>
              <Plus className="size-4" /> Thêm xe
            </Button>
            {capUnit || !multi ? (
              <Button variant="outline" onClick={autoFill}>
                <Wand2 className="size-4" /> Tự xếp theo tải xe
              </Button>
            ) : null}
            {!multi && lines.length > 1 ? (
              <Button variant="ghost" onClick={splitEven}>
                Chia đều {lines.length} xe
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Đóng
            </Button>
            <Button onClick={submit} disabled={pending || over || lines.some((l) => l.plate.trim().length < 4 || lineTotal(l) <= 0)}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Lưu {lines.length} xe
            </Button>
          </div>
        </DialogFooter>
        <datalist id="nx-plates">
          {fleet.vehicles.map((v) => (
            <option key={v.plate} value={v.plate}>
              {fleet.drivers.find((d) => d.id === v.driver_id)?.name ?? ""}
            </option>
          ))}
        </datalist>
        <datalist id="nx-drivers">
          {fleet.drivers.map((d) => (
            <option key={d.id} value={d.name}>
              {[d.phone, d.last_plate].filter(Boolean).join(" · ")}
            </option>
          ))}
        </datalist>
      </DialogContent>
    </Dialog>
  );
}
