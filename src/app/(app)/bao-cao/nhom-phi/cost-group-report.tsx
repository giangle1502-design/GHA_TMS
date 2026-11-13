"use client";
import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Download, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { ReportGrid, type ReportColumn } from "@/components/grid/report-grid";
import { bucketOf, isoWeek, type BucketBy, type Period, type PeriodKind } from "@/lib/report-period";
import { formatDate, formatVND, todayVN } from "@/lib/format";
import type { TableViewConfig } from "@/lib/entities/types";
import { cn } from "@/lib/utils";

export type FeeGroupLine = {
  id: string;
  shipment_id: string;
  shipment_code: string;
  order_code: string | null;
  report_date: string;
  customer_code: string | null;
  customer_name: string | null;
  plate_number: string | null;
  driver_name: string | null;
  group_id: string | null;
  group_name: string;
  group_role: string;
  group_sort: number;
  fee_name: string;
  fee_sort: number;
  fee_kind: string;
  amount: number;
  declaration_type_name: string | null;
  note: string | null;
};
export type CostLine = {
  id: string;
  cost_kind: string;
  cost_group: string;
  cost_item: string;
  report_date: string;
  code: string | null;
  driver_name: string | null;
  plate_number: string | null;
  shipment_code: string | null;
  paid_by: string | null;
  supplier_name: string | null;
  amount: number;
  status: string;
  note: string | null;
  group_sort: number | null;
  ref_no: string | null;
};
type Group = { id: string; name: string; report_role: string; sort_order: number };
type Row = Record<string, string | number | null> & { id: string };

const KIND_OPTIONS: { value: PeriodKind; label: string }[] = [
  { value: "ngay", label: "Từ ngày – đến ngày" },
  { value: "tuan", label: "Tuần" },
  { value: "thang", label: "Tháng" },
  { value: "nam", label: "Năm" },
];
const BY_OPTIONS: { value: BucketBy; label: string }[] = [
  { value: "ngay", label: "Ngày" },
  { value: "tuan", label: "Tuần" },
  { value: "thang", label: "Tháng" },
];
const TABS = [
  { key: "period", label: "Tổng theo kỳ" },
  { key: "ships", label: "Từng chuyến" },
  { key: "feeTypes", label: "Theo loại phí" },
  { key: "costs", label: "Bên chi chi tiết" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const money = <T extends Row>(key: string, label: string, width = 130): ReportColumn<T> => ({
  key,
  label,
  width,
  align: "right",
  kind: "number",
  value: (r) => (r[key] as number | null) ?? 0,
  render: (r) => (Number(r[key] ?? 0) ? formatVND(r[key] as number) : <span className="text-muted-foreground">0</span>),
});
const text = <T extends Row>(key: string, label: string, width = 140): ReportColumn<T> => ({ key, label, width, value: (r) => r[key] as string | null });

/** Tải bảng đang xem ra tệp CSV (mở bằng Excel) */
function downloadCsv(name: string, cols: ReportColumn<Row>[], rows: Row[]) {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.map((c) => esc(c.label)).join(","), ...rows.map((r) => cols.map((c) => esc(c.value(r))).join(","))];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function CostGroupReport({
  period,
  fees,
  costs,
  groups,
  expenseGroups,
  views,
}: {
  period: Period;
  fees: FeeGroupLine[];
  costs: CostLine[];
  groups: Group[];
  /** Nhóm chi phí trong Danh mục hệ thống (đang dùng), theo thứ tự */
  expenseGroups: { name: string; sort_order: number }[];
  views: Record<TabKey, TableViewConfig | null>;
}) {
  const [tab, setTab] = useState<TabKey>("period");

  // Nhóm thu: theo danh mục nhóm phí, thêm nhóm "chưa xếp nhóm" nếu có dữ liệu
  const feeGroups = useMemo(() => {
    const names = groups.map((g) => ({ name: g.name, role: g.report_role }));
    for (const f of fees) if (!names.some((n) => n.name === f.group_name)) names.push({ name: f.group_name, role: f.group_role });
    return names;
  }, [groups, fees]);
  // Khoản chờ duyệt hiện riêng, chưa cộng vào tổng chi
  const approved = useMemo(() => costs.filter((c) => c.status !== "pending"), [costs]);
  const pending = useMemo(() => costs.filter((c) => c.status === "pending"), [costs]);
  // Nhóm chi: theo Nhóm chi phí trong Danh mục hệ thống (đúng thứ tự), rồi nhóm chi phí xe; Ứng tiền đứng cuối
  const costGroups = useMemo(() => {
    const names = expenseGroups.map((g) => g.name);
    const extra = new Map<string, number>();
    for (const c of costs) if (c.cost_group !== "Ứng tiền" && !names.includes(c.cost_group)) extra.set(c.cost_group, Math.min(extra.get(c.cost_group) ?? 1e9, c.group_sort ?? 9000));
    const more = [...extra].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], "vi")).map(([n]) => n);
    return [...names, ...more, "Ứng tiền"];
  }, [costs, expenseGroups]);

  const sumFee = (name: string) => fees.reduce((a, f) => (f.group_name === name ? a + f.amount : a), 0);
  const sumCost = (name: string) => approved.reduce((a, c) => (c.cost_group === name ? a + c.amount : a), 0);
  const sumPending = (name: string) => pending.reduce((a, c) => (c.cost_group === name ? a + c.amount : a), 0);
  const totalFee = fees.reduce((a, f) => a + f.amount, 0);
  const totalCost = approved.reduce((a, c) => (c.cost_kind === "advance" ? a : a + c.amount), 0);
  const totalPending = pending.reduce((a, c) => a + c.amount, 0);
  const trips = new Set(fees.map((f) => f.shipment_id)).size;
  const feeLabel = (g: { name: string; role: string }) => (g.role === "freight" ? `${g.name} (Tổng cước)` : g.name);

  // ---- Bảng theo kỳ
  const periodRows = useMemo(() => {
    const map = new Map<string, Row>();
    const ships = new Map<string, Set<string>>();
    const get = (d: string) => {
      const b = bucketOf(d, period.by);
      if (!map.has(b.key)) {
        map.set(b.key, { id: b.key, ky: b.label });
        ships.set(b.key, new Set());
      }
      return map.get(b.key)!;
    };
    for (const f of fees) {
      const r = get(f.report_date);
      r[`g:${f.group_name}`] = Number(r[`g:${f.group_name}`] ?? 0) + f.amount;
      r.thu = Number(r.thu ?? 0) + f.amount;
      ships.get(r.id)!.add(f.shipment_id);
    }
    for (const c of approved) {
      const r = get(c.report_date);
      r[`c:${c.cost_group}`] = Number(r[`c:${c.cost_group}`] ?? 0) + c.amount;
      if (c.cost_kind !== "advance") r.chi = Number(r.chi ?? 0) + c.amount;
    }
    return [...map.values()]
      .sort((x, y) => x.id.localeCompare(y.id))
      .map((r) => ({ ...r, chuyen: ships.get(r.id)!.size, chenh: Number(r.thu ?? 0) - Number(r.chi ?? 0) }));
  }, [fees, approved, period.by]);
  const periodCols = useMemo<ReportColumn<Row>[]>(
    () => [
      text("ky", period.by === "ngay" ? "Ngày" : period.by === "tuan" ? "Tuần" : "Tháng", 170),
      { key: "chuyen", label: "Số chuyến", width: 90, align: "right", kind: "number", value: (r) => r.chuyen as number },
      ...feeGroups.map((g) => money<Row>(`g:${g.name}`, feeLabel(g), 150)),
      money("thu", "Tổng thu khách", 140),
      ...costGroups.map((g) => money<Row>(`c:${g}`, g === "Ứng tiền" ? "Ứng tiền" : `Chi: ${g}`, 140)),
      money("chi", "Tổng chi (không gồm ứng)", 150),
      money("chenh", "Thu trừ chi", 130),
    ],
    [feeGroups, costGroups, period.by],
  );

  // ---- Bảng từng chuyến
  const shipRows = useMemo(() => {
    const map = new Map<string, Row>();
    for (const f of fees) {
      let r = map.get(f.shipment_id);
      if (!r) {
        r = {
          id: f.shipment_id,
          report_date: f.report_date,
          shipment_code: f.shipment_code,
          customer_code: f.customer_code,
          customer_name: f.customer_name,
          plate_number: f.plate_number,
          driver_name: f.driver_name,
          order_code: f.order_code,
          to_khai: null,
        };
        map.set(f.shipment_id, r);
      }
      r[`g:${f.group_name}`] = Number(r[`g:${f.group_name}`] ?? 0) + f.amount;
      r.thu = Number(r.thu ?? 0) + f.amount;
      if (f.declaration_type_name) r.to_khai = r.to_khai ? `${r.to_khai}, ${f.declaration_type_name}` : f.declaration_type_name;
    }
    const byCode = new Map([...map.values()].map((r) => [r.shipment_code as string, r]));
    for (const c of approved) {
      const r = c.shipment_code ? byCode.get(c.shipment_code) : undefined;
      if (r && c.cost_kind !== "advance") r.chi = Number(r.chi ?? 0) + c.amount;
    }
    return [...map.values()].sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)));
  }, [fees, approved]);
  const shipCols = useMemo<ReportColumn<Row>[]>(
    () => [
      { key: "report_date", label: "Ngày", width: 100, kind: "date", value: (r) => r.report_date as string, render: (r) => formatDate(r.report_date as string) },
      text("shipment_code", "Mã chuyến", 130),
      text("customer_code", "Mã KH", 100),
      text("customer_name", "Khách hàng", 180),
      text("plate_number", "Biển số", 100),
      text("driver_name", "Tài xế", 140),
      ...feeGroups.map((g) => money<Row>(`g:${g.name}`, feeLabel(g), 150)),
      text("to_khai", "Loại tờ khai", 100),
      money("thu", "Tổng thu khách", 140),
      money("chi", "Chi phí chuyến đã duyệt", 150),
      text("order_code", "Đơn hàng", 120),
    ],
    [feeGroups],
  );

  // ---- Bảng theo loại phí
  const feeTypeRows = useMemo(() => {
    const map = new Map<string, { row: Row; ships: Set<string>; gs: number; fs: number }>();
    for (const f of fees) {
      const k = `${f.group_name}|${f.fee_name}|${f.declaration_type_name ?? ""}`;
      let e = map.get(k);
      if (!e) {
        e = {
          row: { id: k, group: f.group_name, fee: f.fee_name, to_khai: f.declaration_type_name, kind: f.fee_kind === "pass_through" ? "Chi hộ" : "Tính doanh thu", amount: 0 },
          ships: new Set(),
          gs: f.group_sort,
          fs: f.fee_sort,
        };
        map.set(k, e);
      }
      e.row.amount = Number(e.row.amount) + f.amount;
      e.ships.add(f.shipment_id);
    }
    return [...map.values()]
      .sort((x, y) => x.gs - y.gs || x.fs - y.fs || String(x.row.fee).localeCompare(String(y.row.fee), "vi"))
      .map((e) => ({ ...e.row, chuyen: e.ships.size }));
  }, [fees]);
  const feeTypeCols = useMemo<ReportColumn<Row>[]>(
    () => [
      text("group", "Nhóm phí", 170),
      text("fee", "Loại phí", 200),
      text("to_khai", "Loại tờ khai", 100),
      text("kind", "Cách tính", 120),
      { key: "chuyen", label: "Số chuyến", width: 90, align: "right", kind: "number", value: (r) => r.chuyen as number },
      money("amount", "Số tiền", 140),
    ],
    [],
  );

  // ---- Bên chi chi tiết
  const costRows = useMemo(
    () =>
      costs.map(
        (c) =>
          ({
            id: c.id,
            report_date: c.report_date,
            cost_group: c.cost_group,
            cost_item: c.cost_item,
            code: c.code,
            plate_number: c.plate_number,
            driver_name: c.driver_name,
            shipment_code: c.shipment_code,
            paid_by: c.paid_by === "driver" ? "Chi bởi tài xế" : c.paid_by === "company" ? "Chi bởi công ty" : null,
            supplier_name: c.supplier_name,
            amount: c.amount,
            note: c.note,
            ref_no: c.ref_no,
            status: c.status === "pending" ? "Chờ duyệt (chưa tính)" : c.cost_kind === "vehicle_cost" ? "Đã ghi nhận" : "Đã duyệt",
          }) as Row,
      ),
    [costs],
  );
  const costCols = useMemo<ReportColumn<Row>[]>(
    () => [
      { key: "report_date", label: "Ngày", width: 100, kind: "date", value: (r) => r.report_date as string, render: (r) => formatDate(r.report_date as string) },
      text("cost_group", "Nhóm chi", 170),
      text("cost_item", "Khoản chi", 170),
      money("amount", "Số tiền", 130),
      text("plate_number", "Biển số", 100),
      text("driver_name", "Tài xế", 140),
      text("shipment_code", "Chuyến", 120),
      text("paid_by", "Nguồn chi", 120),
      text("status", "Trạng thái", 150),
      text("ref_no", "Số chứng từ", 120),
      text("supplier_name", "Nhà thầu / NCC", 150),
      text("code", "Số phiếu", 110),
      text("note", "Ghi chú", 220),
    ],
    [],
  );

  const tables: Record<TabKey, { cols: ReportColumn<Row>[]; rows: Row[]; key: string; empty: string }> = {
    period: { cols: periodCols, rows: periodRows, key: "report_group_period", empty: "Không có số liệu trong kỳ." },
    ships: { cols: shipCols, rows: shipRows, key: "report_group_shipments", empty: "Không có chuyến nào trong kỳ." },
    feeTypes: { cols: feeTypeCols, rows: feeTypeRows, key: "report_group_fee_types", empty: "Không có khoản phí nào trong kỳ." },
    costs: { cols: costCols, rows: costRows, key: "report_group_costs", empty: "Không có khoản chi nào trong kỳ." },
  };
  const t = tables[tab];

  return (
    <>
      <PeriodBar period={period} />
      <div className="mb-1 text-xs font-semibold text-muted-foreground uppercase">Thu khách · {period.label} · {trips} chuyến</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 [&>*]:min-w-0">
        {feeGroups.map((g) => (
          <Kpi key={g.name} label={feeLabel(g)} value={sumFee(g.name)} />
        ))}
        <Kpi label="Tổng thu khách" value={totalFee} strong />
      </div>
      <div className="mt-3 mb-1 text-xs font-semibold text-muted-foreground uppercase">Chi</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 [&>*]:min-w-0">
        {costGroups.map((g) => (
          <Kpi
            key={g}
            label={g}
            value={sumCost(g)}
            note={g === "Ứng tiền" ? "Đã duyệt / đã chuyển; trừ vào lương" : sumPending(g) ? `+ ${formatVND(sumPending(g))} chờ duyệt` : undefined}
          />
        ))}
        <Kpi label="Tổng chi (không gồm ứng)" value={totalCost} strong note={totalPending ? `+ ${formatVND(totalPending)} chờ duyệt (chưa tính)` : "Khoản đã duyệt"} />
      </div>
      {pending.length ? (
        <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
          Có {pending.length} khoản chi đang chờ Giám đốc duyệt ({formatVND(totalPending)}), chưa cộng vào tổng chi. Xem ở tab &quot;Bên chi chi tiết&quot; hoặc duyệt ở menu{" "}
          <a href="/phe-duyet" className="font-medium text-primary underline">
            Phê duyệt
          </a>
          .
        </p>
      ) : null}
      <Card className="mt-4 gap-0 py-0">
        <div className="flex flex-wrap items-center gap-1 border-b px-3 pt-2">
          {TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => setTab(x.key)}
              className={cn(
                "-mb-px border-b-2 px-3 py-1.5 text-sm",
                tab === x.key ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <ReportGrid
          key={tab}
          tableKey={t.key}
          rows={t.rows}
          columns={t.cols}
          view={views[tab]}
          getRowId={(r) => r.id}
          defaultPinned={[t.cols[0].key]}
          emptyText={t.empty}
          toolbar={
            <Button variant="outline" size="sm" onClick={() => downloadCsv(`${t.key}-${period.from}-${period.to}`, t.cols, t.rows)} disabled={!t.rows.length}>
              <Download /> Tải Excel
            </Button>
          }
        />
      </Card>
      <p className="mt-2 text-xs text-muted-foreground">
        Bên thu: Danh mục hệ thống → Nhóm phí / Danh mục phí, nguồn Thu khách. Bên chi: chi phí chuyến theo nhóm phí của từng phí chi ra (Danh mục hệ thống → Nhóm phí / Danh mục phí, nguồn Chi ra); bảo trì, sửa chữa, kiểm định, bảo
        hiểm nhập ở Phương tiện → Bảo dưỡng, sửa chữa. Chi phí cầu đường sẽ nhập từ Excel theo số xe (đang chờ mẫu).
      </p>
    </>
  );
}

function Kpi({ label, value, note, strong }: { label: string; value: number; note?: string; strong?: boolean }) {
  return (
    <Card className={cn("gap-1 py-3", strong && "border-primary/40 bg-primary/5")}>
      <CardContent className="px-3">
        <div className="truncate text-xs text-muted-foreground" title={label}>
          {label}
        </div>
        <div className={cn("text-base font-bold tabular-nums sm:text-lg", strong && "text-primary")}>{formatVND(value)}</div>
        {note ? <div className="text-[11px] text-muted-foreground">{note}</div> : null}
      </CardContent>
    </Card>
  );
}

/** Chọn kỳ: từ ngày – đến ngày, tuần, tháng, năm; chia bảng theo ngày / tuần / tháng */
export function PeriodBar({ period }: { period: Period }) {
  const router = useRouter();
  const path = usePathname();
  const today = todayVN();
  const [kind, setKind] = useState<PeriodKind>(period.kind);
  const [from, setFrom] = useState(period.kind === "ngay" ? period.from : `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(period.kind === "ngay" ? period.to : today);
  const [week, setWeek] = useState(period.value.tuan ?? isoWeek(today));
  const [month, setMonth] = useState(period.value.thang ?? today.slice(0, 7));
  const [year, setYear] = useState(period.value.nam ?? today.slice(0, 4));
  const [by, setBy] = useState<BucketBy>(period.by);

  function apply(e?: React.FormEvent) {
    e?.preventDefault();
    const q = new URLSearchParams({ ky: kind });
    if (kind === "ngay") {
      q.set("tu", from);
      q.set("den", to);
    } else if (kind === "tuan") q.set("tuan", week);
    else if (kind === "thang") q.set("thang", month);
    else q.set("nam", year);
    q.set("chia", by);
    router.push(`${path}?${q.toString()}`);
  }
  const sel = "h-8 rounded-md border bg-background px-2 text-sm";
  return (
    <form onSubmit={apply} className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border bg-card p-2.5">
      <div className="space-y-1">
        <Label htmlFor="ky">Lọc theo</Label>
        <select id="ky" className={sel} value={kind} onChange={(e) => setKind(e.target.value as PeriodKind)}>
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {kind === "ngay" ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="tu">Từ ngày</Label>
            <Input id="tu" type="date" className="h-8 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="den">Đến ngày</Label>
            <Input id="den" type="date" className="h-8 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </>
      ) : kind === "tuan" ? (
        <div className="space-y-1">
          <Label htmlFor="tuan">Tuần</Label>
          <Input id="tuan" type="week" className="h-8 w-44" value={week} onChange={(e) => setWeek(e.target.value)} />
        </div>
      ) : kind === "thang" ? (
        <div className="space-y-1">
          <Label htmlFor="thang">Tháng</Label>
          <Input id="thang" type="month" className="h-8 w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="nam">Năm</Label>
          <Input id="nam" type="number" min="2020" max="2100" className="h-8 w-28" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="chia">Chia bảng theo</Label>
        <select id="chia" className={sel} value={by} onChange={(e) => setBy(e.target.value as BucketBy)}>
          {BY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" size="sm">
        <Search /> Xem báo cáo
      </Button>
      <span className="text-xs text-muted-foreground">Đang xem: {period.label}</span>
    </form>
  );
}
