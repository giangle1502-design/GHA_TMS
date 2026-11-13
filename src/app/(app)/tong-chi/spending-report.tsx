"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ReportGrid, type ReportColumn } from "@/components/grid/report-grid";
import { PeriodBar } from "@/app/(app)/bao-cao/nhom-phi/cost-group-report";
import { bucketOf, type Period } from "@/lib/report-period";
import { formatDate, formatVND } from "@/lib/format";
import { downloadXlsx } from "@/lib/xlsx-client";
import {
  LINE_STATE_LABEL,
  SPENDING_SOURCES,
  lineState,
  sourceLabel,
  summarizeByGroup,
  type LineState,
  type SpendingLine,
  type SpendingSource,
} from "@/lib/spending-report";
import type { TableViewConfig } from "@/lib/entities/types";
import { cn } from "@/lib/utils";

type Row = Record<string, string | number | null> & { id: string };
type TabKey = "groups" | "items" | "period" | "lines";
const TABS: { key: TabKey; label: string }[] = [
  { key: "groups", label: "Tổng theo nhóm" },
  { key: "items", label: "Theo khoản chi" },
  { key: "period", label: "Theo kỳ" },
  { key: "lines", label: "Chi tiết chi" },
];
const TOTAL_ID = "__total";
type ShowMode = LineState | "all";
const SHOW_OPTIONS: { value: ShowMode; label: string }[] = [
  { value: "counted", label: "Khoản tính vào tổng chi" },
  { value: "pending", label: "Khoản chờ duyệt (chưa tính)" },
  { value: "pass_through", label: "Khoản chi hộ (không tính)" },
  { value: "all", label: "Tất cả" },
];

const zero = <span className="text-muted-foreground">0</span>;
const money = (key: string, label: string, width = 130): ReportColumn<Row> => ({
  key,
  label,
  width,
  align: "right",
  kind: "number",
  value: (r) => (r[key] as number | null) ?? 0,
  render: (r) =>
    Number(r[key] ?? 0) ? (
      <span className={cn(r.id === TOTAL_ID && "font-bold")}>
        {formatVND(r[key] as number)}
      </span>
    ) : (
      zero
    ),
});
const text = (key: string, label: string, width = 140): ReportColumn<Row> => ({
  key,
  label,
  width,
  value: (r) => r[key] as string | null,
});

export function SpendingReport({
  period,
  lines,
  groupOrder,
  views,
}: {
  period: Period;
  lines: SpendingLine[];
  /** Tên Nhóm phí chi ra theo thứ tự trong Danh mục */
  groupOrder: string[];
  views: Record<TabKey, TableViewConfig | null>;
}) {
  const [tab, setTab] = useState<TabKey>("groups");
  const [sources, setSources] = useState<SpendingSource[]>(
    SPENDING_SOURCES.map((s) => s.value),
  );
  const [drill, setDrill] = useState<{ group?: string; item?: string }>({});
  const [show, setShow] = useState<ShowMode>("counted");

  const inSource = useMemo(
    () => lines.filter((l) => sources.includes(l.source)),
    [lines, sources],
  );
  const summary = useMemo(
    () => summarizeByGroup(inSource, groupOrder),
    [inSource, groupOrder],
  );
  const total = summary.reduce((a, g) => a + g.total, 0);
  const pendingTotal = summary.reduce((a, g) => a + g.pending, 0);
  const passTotal = summary.reduce((a, g) => a + g.passThrough, 0);
  const bySource = (s: SpendingSource) =>
    summary.reduce((a, g) => a + g.bySource[s], 0);
  const groupNames = summary.map((g) => g.group);

  function openDetail(group: string, item?: string) {
    setDrill({ group, item });
    setShow("counted");
    setTab("lines");
  }
  const drillLink = (label: string, group: string, item?: string) => (
    <button
      type="button"
      className="max-w-full truncate text-left font-medium text-primary hover:underline"
      title="Bấm để xem chi tiết các khoản chi"
      onClick={() => openDetail(group, item)}
    >
      {label}
    </button>
  );
  const pct = (v: number) => (total ? Math.round((v / total) * 1000) / 10 : 0);
  const pctCol: ReportColumn<Row> = {
    key: "pct",
    label: "Tỷ lệ %",
    width: 140,
    align: "right",
    kind: "number",
    value: (r) => r.pct as number,
    render: (r) => (
      <div className="flex items-center justify-end gap-1.5">
        {r.id !== TOTAL_ID ? (
          <div className="h-2 w-14 overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.min(100, Number(r.pct))}%` }}
            />
          </div>
        ) : null}
        <span className="tabular-nums">{String(r.pct)}%</span>
      </div>
    ),
  };

  // ---- Tổng theo nhóm
  const groupRows = (() => {
    const rows: Row[] = summary.map((g) => ({
      id: g.group,
      group: g.group,
      count: g.count,
      trip: g.bySource.trip,
      vehicle: g.bySource.vehicle,
      carrier: g.bySource.carrier,
      purchase: g.bySource.purchase,
      total: g.total,
      pct: pct(g.total),
      pending: g.pending,
      pass: g.passThrough,
    }));
    if (rows.length)
      rows.push({
        id: TOTAL_ID,
        group: "TỔNG CỘNG",
        count: summary.reduce((a, g) => a + g.count, 0),
        trip: bySource("trip"),
        vehicle: bySource("vehicle"),
        carrier: bySource("carrier"),
        purchase: bySource("purchase"),
        total,
        pct: total ? 100 : 0,
        pending: pendingTotal,
        pass: passTotal,
      });
    return rows;
  })();
  const groupCols: ReportColumn<Row>[] = [
    {
      ...text("group", "Nhóm phí", 200),
      render: (r) =>
        r.id === TOTAL_ID ? (
          <b>{r.group}</b>
        ) : (
          drillLink(String(r.group), String(r.group))
        ),
    },
    {
      key: "count",
      label: "Số khoản",
      width: 85,
      align: "right",
      kind: "number",
      value: (r) => r.count as number,
    },
    ...SPENDING_SOURCES.filter((s) => sources.includes(s.value)).map((s) =>
      money(s.value, s.label, 140),
    ),
    money("total", "Tổng chi", 150),
    pctCol,
    money("pending", "Chờ duyệt (chưa tính)", 150),
    money("pass", "Chi hộ (không tính)", 150),
  ];

  // ---- Theo khoản chi
  const itemRows: Row[] = summary.flatMap((g) =>
    g.items.map((it) => ({
      id: `${g.group}|${it.item}`,
      group: g.group,
      item: it.item,
      count: it.count,
      total: it.total,
      pct: pct(it.total),
      pending: it.pending,
      pass: it.passThrough,
    })),
  );
  const itemCols: ReportColumn<Row>[] = [
    {
      ...text("group", "Nhóm phí", 180),
      render: (r) => drillLink(String(r.group), String(r.group)),
    },
    {
      ...text("item", "Khoản chi", 220),
      render: (r) => drillLink(String(r.item), String(r.group), String(r.item)),
    },
    {
      key: "count",
      label: "Số khoản",
      width: 85,
      align: "right",
      kind: "number",
      value: (r) => r.count as number,
    },
    money("total", "Tổng chi", 150),
    pctCol,
    money("pending", "Chờ duyệt (chưa tính)", 150),
    money("pass", "Chi hộ (không tính)", 150),
  ];

  // ---- Theo kỳ: mỗi dòng một ngày / tuần / tháng, mỗi nhóm một cột
  const periodRows = useMemo<Row[]>(() => {
    const map = new Map<string, Row>();
    for (const l of inSource) {
      if (lineState(l) !== "counted") continue;
      const b = bucketOf(l.report_date, period.by);
      let r = map.get(b.key);
      if (!r) {
        r = { id: b.key, ky: b.label, total: 0 };
        map.set(b.key, r);
      }
      r[`g:${l.group_name}`] = Number(r[`g:${l.group_name}`] ?? 0) + l.amount;
      r.total = Number(r.total) + l.amount;
    }
    return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [inSource, period.by]);
  const periodCols: ReportColumn<Row>[] = [
    text(
      "ky",
      period.by === "ngay" ? "Ngày" : period.by === "tuan" ? "Tuần" : "Tháng",
      170,
    ),
    ...groupNames.map((g) => money(`g:${g}`, g, 140)),
    money("total", "Tổng chi", 150),
  ];

  // ---- Chi tiết chi
  const lineRows = useMemo<Row[]>(
    () =>
      inSource
        .filter(
          (l) =>
            (show === "all" || lineState(l) === show) &&
            (!drill.group || l.group_name === drill.group) &&
            (!drill.item || l.item_name === drill.item),
        )
        .map((l) => ({
          id: l.id,
          report_date: l.report_date,
          group: l.group_name,
          item: l.item_name,
          amount: l.amount,
          source: sourceLabel(l.source),
          state: LINE_STATE_LABEL[lineState(l)],
          shipment_code: l.shipment_code,
          plate_number: l.plate_number,
          driver_name: l.driver_name,
          customer_name: l.customer_name,
          supplier_name: l.supplier_name,
          paid_by:
            l.paid_by === "driver"
              ? "Chi bởi tài xế"
              : l.paid_by === "company"
                ? "Chi bởi công ty"
                : null,
          code: l.code,
          ref_no: l.ref_no,
          note: l.note,
        })),
    [inSource, show, drill],
  );
  const lineCols = useMemo<ReportColumn<Row>[]>(
    () => [
      {
        key: "report_date",
        label: "Ngày",
        width: 100,
        kind: "date",
        value: (r) => r.report_date as string,
        render: (r) => formatDate(r.report_date as string),
      },
      text("group", "Nhóm phí", 170),
      text("item", "Khoản chi", 190),
      money("amount", "Số tiền", 130),
      text("source", "Nguồn", 150),
      text("state", "Tính vào tổng", 150),
      text("shipment_code", "Chuyến", 120),
      text("plate_number", "Biển số", 100),
      text("driver_name", "Tài xế", 140),
      text("customer_name", "Khách hàng", 160),
      text("supplier_name", "Nhà cung cấp / người nhận", 170),
      text("paid_by", "Người chi", 120),
      text("code", "Số phiếu", 110),
      text("ref_no", "Số chứng từ", 120),
      text("note", "Ghi chú / nội dung", 240),
    ],
    [],
  );

  const tables: Record<
    TabKey,
    {
      cols: ReportColumn<Row>[];
      rows: Row[];
      key: string;
      empty: string;
      sheet: string;
    }
  > = {
    groups: {
      cols: groupCols,
      rows: groupRows,
      key: "spending_groups",
      empty: "Không có khoản chi nào trong kỳ.",
      sheet: "Tổng theo nhóm",
    },
    items: {
      cols: itemCols,
      rows: itemRows,
      key: "spending_items",
      empty: "Không có khoản chi nào trong kỳ.",
      sheet: "Theo khoản chi",
    },
    period: {
      cols: periodCols,
      rows: periodRows,
      key: "spending_period",
      empty: "Không có khoản chi nào trong kỳ.",
      sheet: "Theo kỳ",
    },
    lines: {
      cols: lineCols,
      rows: lineRows,
      key: "spending_lines",
      empty: "Không có khoản chi nào phù hợp.",
      sheet: "Chi tiết chi",
    },
  };
  const t = tables[tab];

  async function exportExcel(cols: ReportColumn<Row>[], rows: Row[]) {
    const numeric = (c: ReportColumn<Row>) => c.kind === "number";
    const body = rows.filter((r) => r.id !== TOTAL_ID);
    const sums = cols.map((c, i) =>
      i === 0
        ? "TỔNG CỘNG"
        : numeric(c) && c.key !== "pct"
          ? body.reduce((a, r) => a + Number(c.value(r) ?? 0), 0)
          : null,
    );
    const filter =
      tab === "lines" && (drill.group || drill.item)
        ? ` · ${[drill.group, drill.item].filter(Boolean).join(" → ")}`
        : "";
    await downloadXlsx({
      filename: `tong-chi-${t.key.replace("spending_", "")}-${period.from}-${period.to}`,
      sheet: t.sheet,
      title: `TỔNG CHI THEO NHÓM PHÍ (KHÔNG GỒM CHI HỘ) · ${t.sheet.toUpperCase()}`,
      subtitle: `${period.label}${filter} · Nguồn: ${sources.map(sourceLabel).join(", ")}`,
      columns: cols.map((c) => ({
        label: c.label,
        width: c.width,
        numeric: numeric(c),
      })),
      rows: body.map((r) => cols.map((c) => c.value(r) ?? null)),
      footer:
        tab === "period" || tab === "lines" || tab === "items"
          ? sums
          : undefined,
    });
  }

  const sel = "h-8 rounded-md border bg-background px-2 text-sm";
  return (
    <>
      <PeriodBar period={period} />
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm">
        <span className="text-xs font-semibold text-muted-foreground uppercase">
          Nguồn chi
        </span>
        {SPENDING_SOURCES.map((s) => (
          <label
            key={s.value}
            className="flex items-center gap-1.5"
            title={s.hint}
          >
            <input
              type="checkbox"
              checked={sources.includes(s.value)}
              onChange={(e) =>
                setSources((cur) =>
                  e.target.checked
                    ? [...cur, s.value]
                    : cur.filter((x) => x !== s.value),
                )
              }
            />
            {s.label}
          </label>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7 [&>*]:min-w-0">
        <Kpi
          label="Tổng chi (trừ chi hộ)"
          value={total}
          strong
          note={period.label}
        />
        {SPENDING_SOURCES.filter((s) => sources.includes(s.value)).map((s) => (
          <Kpi
            key={s.value}
            label={s.label}
            value={bySource(s.value)}
            note={total ? `${pct(bySource(s.value))}% tổng chi` : undefined}
          />
        ))}
        <Kpi
          label="Chi hộ (không tính)"
          value={passTotal}
          note="Trả thay khách, thu lại khách"
        />
        {pendingTotal ? (
          <Kpi
            label="Chờ duyệt (chưa tính)"
            value={pendingTotal}
            note="Duyệt ở menu Phê duyệt"
          />
        ) : null}
      </div>
      <Card className="mt-4 gap-0 py-0">
        <div className="flex flex-wrap items-center gap-1 border-b px-3 pt-2">
          {TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => setTab(x.key)}
              className={cn(
                "-mb-px border-b-2 px-3 py-1.5 text-sm",
                tab === x.key
                  ? "border-primary font-medium text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
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
          onExport={exportExcel}
          toolbar={
            tab === "lines" ? (
              <>
                <select
                  className={sel}
                  value={show}
                  onChange={(e) => setShow(e.target.value as ShowMode)}
                  aria-label="Hiện khoản"
                >
                  {SHOW_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  className={sel}
                  value={drill.group ?? ""}
                  onChange={(e) =>
                    setDrill(e.target.value ? { group: e.target.value } : {})
                  }
                  aria-label="Nhóm phí"
                  title="Lọc theo nhóm phí"
                >
                  <option value="">Mọi nhóm phí</option>
                  {groupNames.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
                {drill.item ? (
                  <button
                    type="button"
                    className="flex h-8 items-center gap-1 rounded-md border bg-primary/5 px-2 text-sm"
                    onClick={() => setDrill({ group: drill.group })}
                    title="Bỏ lọc khoản chi"
                  >
                    Khoản: {drill.item} <X className="size-3.5" />
                  </button>
                ) : null}
              </>
            ) : tab === "groups" || tab === "items" ? (
              <span className="text-xs text-muted-foreground">
                Bấm tên nhóm / khoản để xem chi tiết
              </span>
            ) : null
          }
        />
      </Card>
      <p className="mt-2 text-xs text-muted-foreground">
        Nhóm phí của chi phí chuyến lấy theo{" "}
        <Link
          href="/danh-muc?tab=fee_catalog_items&nguon=expense"
          className="text-primary underline"
        >
          Danh mục hệ thống → Danh mục phí → Chi ra
        </Link>
        . Phí nào là tiền trả thay khách (nâng hạ, cược cont…) thì đánh dấu
        &quot;Chi hộ khách&quot; ở đó để báo cáo không cộng. Chi hộ trả nhà xe
        3PL tự loại ra. Ứng tiền tài xế không phải chi phí (trừ vào lương) nên
        không có ở đây. Chi phí chuyến tính theo ngày phát sinh, khoản trả 3PL
        theo ngày chuyến hoàn thành, đề nghị chi theo ngày chi tiền.
      </p>
    </>
  );
}

function Kpi({
  label,
  value,
  note,
  strong,
}: {
  label: string;
  value: number;
  note?: string;
  strong?: boolean;
}) {
  return (
    <Card
      className={cn("gap-1 py-3", strong && "border-primary/40 bg-primary/5")}
    >
      <CardContent className="px-3">
        <div className="truncate text-xs text-muted-foreground" title={label}>
          {label}
        </div>
        <div
          className={cn(
            "text-base font-bold tabular-nums sm:text-lg",
            strong && "text-primary",
          )}
        >
          {formatVND(value)}
        </div>
        {note ? (
          <div className="truncate text-[11px] text-muted-foreground">
            {note}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
