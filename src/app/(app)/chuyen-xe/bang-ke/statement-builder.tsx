"use client";
import { useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowLeft, ArrowUp, Columns3, Download, GripVertical, Loader2, PenLine, Printer, Save, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  STATEMENT_STATUS_OPTIONS,
  defaultStatementConfig,
  formatStatementCell,
  isSummed,
  monthRange,
  resolveColumns,
  paymentSummary,
  statementHeading,
  statementTotals,
  sumsInTable,
  isPayable,
  vndInWords,
  type StatementConfig,
  type StatementStatusFilter,
} from "@/lib/freight-statement";
import type { StatementData } from "@/lib/freight-statement-data";
import { deleteStatementTemplate, exportStatementExcel, saveStatementTemplate } from "./actions";

export type StatementTemplate = { id: string; name: string; shared: boolean; config: StatementConfig };

type Filters = { kh: string; tu: string; den: string; tt: StatementStatusFilter };

/** Bỏ dấu, viết thường để tìm "ha noi" ra "Hà Nội" */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();

/** 1 ký tự Excel ≈ 7.5px trên màn hình */
const PX = 7.5;

export function StatementBuilder({
  filters,
  customers,
  data,
  templates,
  initialTemplateId,
  canExport,
  canShare,
  maxRows,
  today,
}: {
  filters: Filters;
  customers: { id: string; code: string; name: string }[];
  data: StatementData;
  templates: StatementTemplate[];
  initialTemplateId: string;
  canExport: boolean;
  canShare: boolean;
  maxRows: number;
  today: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [navPending, startNav] = useTransition();
  const [busy, startBusy] = useTransition();

  const pickTemplate = (kh: string, wanted?: string) =>
    templates.find((t) => t.id === wanted) ?? templates.find((t) => t.config.customerId && t.config.customerId === kh) ?? null;
  const first = pickTemplate(filters.kh, initialTemplateId);
  const [templateId, setTemplateId] = useState<string>(first?.id ?? "");
  const [config, setConfig] = useState<StatementConfig>(() => first?.config ?? defaultStatementConfig(data.catalog));
  const [dirty, setDirty] = useState(false);
  const [panel, setPanel] = useState<"" | "cot" | "dau-trang" | "luu">("");
  const [q, setQ] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  // Đổi khách hàng: tự chọn mẫu gắn với khách đó (nếu chưa sửa dở mẫu đang dùng)
  const [prevKh, setPrevKh] = useState(filters.kh);
  if (prevKh !== filters.kh) {
    setPrevKh(filters.kh);
    setExcluded(new Set());
    const t = templates.find((x) => x.config.customerId && x.config.customerId === filters.kh);
    if (t && !dirty) {
      setTemplateId(t.id);
      setConfig(t.config);
    }
  }
  // Dữ liệu mới (đổi ngày, trạng thái): bỏ các dòng đã bỏ tích
  const [prevRows, setPrevRows] = useState(data.rows);
  if (prevRows !== data.rows) {
    setPrevRows(data.rows);
    setExcluded(new Set());
  }

  const update = (p: Partial<StatementConfig>) => {
    setConfig((c) => ({ ...c, ...p }));
    setDirty(true);
  };
  const cols = useMemo(() => resolveColumns(data.catalog, config), [data.catalog, config]);
  const term = norm(q.trim());
  const shownRows = useMemo(() => {
    if (!term) return data.rows;
    return data.rows.filter((r) => norm(Object.values(r.cells).filter((v) => v !== null).join(" ")).includes(term));
  }, [data.rows, term]);
  // Dòng đưa vào bảng kê: đang hiện theo ô tìm kiếm và không bị bỏ tích; STT đánh lại liên tục
  const included = useMemo(
    () => shownRows.filter((r) => !excluded.has(r.id)).map((r, i) => ({ ...r, cells: { ...r.cells, stt: i + 1 } })),
    [shownRows, excluded],
  );
  const sttOf = useMemo(() => new Map(included.map((r) => [r.id, r.cells.stt])), [included]);
  const totals = useMemo(() => statementTotals(cols, included, config.noSum), [cols, included, config.noSum]);
  const pay = useMemo(() => paymentSummary(data.catalog, config, included), [data.catalog, config, included]);
  const heading = statementHeading(config.title, filters.tu, filters.den);
  const customer = data.customer;

  function go(p: Partial<Filters>) {
    const m = { ...filters, ...p };
    const s = new URLSearchParams();
    if (m.kh) s.set("kh", m.kh);
    s.set("tu", m.tu);
    s.set("den", m.den);
    if (m.tt !== "giao") s.set("tt", m.tt);
    if (templateId) s.set("mau", templateId);
    startNav(() => router.push(`${pathname}?${s.toString()}`, { scroll: false }));
  }

  function chooseTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    setTemplateId(id);
    setConfig(t ? t.config : defaultStatementConfig(data.catalog));
    setDirty(false);
  }

  function exportExcel() {
    if (!customer) return void toast.error("Chọn khách hàng trước.");
    const includedIds = new Set(included.map((r) => r.id));
    startBusy(async () => {
      const r = await exportStatementExcel({ ...filters, config, excludeIds: data.rows.filter((x) => !includedIds.has(x.id)).map((x) => x.id) });
      if (!r.ok || !r.data) return void toast.error(r.ok ? "Không tạo được tệp" : r.error);
      const bytes = Uint8Array.from(atob(r.data.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.data.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Đã xuất bảng kê ${r.data.count} chuyến.`);
    });
  }

  function printPdf() {
    if (!customer) return void toast.error("Chọn khách hàng trước.");
    // Tên tệp PDF gợi ý khi chọn "Lưu dưới dạng PDF" lấy từ tiêu đề trang
    const old = document.title;
    document.title = `Bang ke cuoc ${customer.code} ${filters.tu.slice(5, 7)}-${filters.tu.slice(0, 4)}`;
    window.print();
    setTimeout(() => (document.title = old), 500);
  }

  // Kéo giãn cột ngay trên bảng xem trước (lưu vào mẫu, dùng cho cả Excel)
  const drag = useRef<{ key: string; x: number; w: number } | null>(null);
  function startResize(e: ReactPointerEvent, key: string, w: number) {
    e.preventDefault();
    drag.current = { key, x: e.clientX, w };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const nw = Math.round(Math.min(80, Math.max(4, d.w + (ev.clientX - d.x) / PX)));
      setConfig((c) => ({ ...c, widths: { ...c.widths, [d.key]: nw } }));
      setDirty(true);
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const current = templates.find((t) => t.id === templateId) ?? null;
  const thisMonth = monthRange(today);
  const lastMonth = monthRange(today, -1);
  const totalW = cols.reduce((a, c) => a + c.w, 0) || 1;
  const firstSum = cols.findIndex((c) => sumsInTable(c, config.noSum));
  const labelSpan = firstSum > 0 ? firstSum : 1;

  return (
    <>
      {/* Khổ giấy khi in / lưu PDF */}
      <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } html, body { background: #fff !important; } .statement { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        .statement thead th { background-color: #000; color: #fff; border-top-color: #000; border-bottom-color: #000; border-left-color: #fff; border-right-color: #fff; border-right-width: 1px; vertical-align: middle; }
        .statement thead th:first-child { border-left-color: #000; }
        .statement thead th:last-child { border-right-color: #000; border-right-width: 1px; }
        .statement tbody td:last-child { border-right-width: 1px; }
        .statement table.pay td { border: 0; }
        .statement table.pay tr.sum td { border-top: 1px solid #000; }`}</style>
      <div className="print:hidden">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href="/chuyen-xe" className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
              <ArrowLeft className="size-4" /> Quản lý chuyến xe
            </Link>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Bảng kê cước phí vận chuyển</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Chọn khách hàng và khoảng ngày (theo ngày nhận hàng), chọn mẫu cột phù hợp rồi xuất Excel hoặc In / Lưu PDF để khách ký nhận.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canExport ? (
              <Button variant="outline" onClick={exportExcel} disabled={busy || !customer || !included.length}>
                {busy ? <Loader2 className="animate-spin" /> : <Download />} Xuất Excel
              </Button>
            ) : null}
            <Button onClick={printPdf} disabled={!customer || !included.length} title="Mở hộp In của trình duyệt: chọn máy in, hoặc chọn Lưu dưới dạng PDF">
              <Printer /> In / Lưu PDF
            </Button>
          </div>
        </div>

        {/* Bộ lọc */}
        <Card className="mb-3 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(240px,2fr)_1fr_1fr_minmax(200px,1.3fr)_auto]">
          <div>
            <Label className="mb-1 block text-xs">Khách hàng</Label>
            <NativeSelect value={filters.kh} onChange={(e) => go({ kh: e.target.value })}>
              <option value="">— Chọn khách hàng —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} – {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <Label className="mb-1 block text-xs">Từ ngày</Label>
            <Input type="date" value={filters.tu} onChange={(e) => e.target.value && go({ tu: e.target.value })} />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Đến ngày</Label>
            <Input type="date" value={filters.den} onChange={(e) => e.target.value && go({ den: e.target.value })} />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Chuyến đưa vào bảng kê</Label>
            <NativeSelect value={filters.tt} onChange={(e) => go({ tt: e.target.value as StatementStatusFilter })}>
              {STATEMENT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex items-end gap-1">
            <Button variant="outline" size="sm" onClick={() => go(thisMonth)} className={cn(filters.tu === thisMonth.tu && filters.den === thisMonth.den && "border-primary text-primary")}>
              Tháng này
            </Button>
            <Button variant="outline" size="sm" onClick={() => go(lastMonth)} className={cn(filters.tu === lastMonth.tu && filters.den === lastMonth.den && "border-primary text-primary")}>
              Tháng trước
            </Button>
            {navPending ? <Loader2 className="mb-2 size-4 animate-spin text-muted-foreground" /> : null}
          </div>
        </Card>

        {/* Mẫu bảng kê */}
        <Card className="mb-3 flex flex-wrap items-end gap-2 p-3">
          <div className="min-w-56 flex-1 sm:flex-none">
            <Label className="mb-1 block text-xs">Mẫu bảng kê (bộ cột hiển thị)</Label>
            <NativeSelect value={templateId} onChange={(e) => chooseTemplate(e.target.value)}>
              <option value="">Mẫu mặc định</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.shared ? " (dùng chung)" : " (riêng tôi)"}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button variant={panel === "cot" ? "default" : "outline"} onClick={() => setPanel(panel === "cot" ? "" : "cot")}>
            <Columns3 /> Chọn cột ({cols.length})
          </Button>
          <Button variant={panel === "dau-trang" ? "default" : "outline"} onClick={() => setPanel(panel === "dau-trang" ? "" : "dau-trang")}>
            <PenLine /> Tiêu đề, công ty, chữ ký
          </Button>
          <Button variant={panel === "luu" ? "default" : "outline"} onClick={() => setPanel(panel === "luu" ? "" : "luu")}>
            <Save /> Lưu mẫu{dirty ? " *" : ""}
          </Button>
          {dirty ? <span className="pb-2 text-xs text-amber-700 dark:text-amber-400">Mẫu đang có thay đổi chưa lưu</span> : null}
        </Card>

        {panel === "cot" ? <ColumnsPanel catalog={data.catalog} config={config} update={update} /> : null}
        {panel === "dau-trang" ? <HeaderPanel config={config} update={update} /> : null}
        {panel === "luu" ? (
          <SavePanel
            key={templateId}
            current={current}
            config={config}
            customer={customer}
            canShare={canShare}
            onSaved={(id) => {
              setTemplateId(id);
              setDirty(false);
              setPanel("");
              router.refresh();
            }}
            onDeleted={() => {
              setTemplateId("");
              setConfig(defaultStatementConfig(data.catalog));
              setDirty(false);
              setPanel("");
              router.refresh();
            }}
          />
        ) : null}

        {customer ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm trong bảng kê: số xe, số cont, tuyến…" className="pl-8" />
            </div>
            <span className="text-sm text-muted-foreground">
              {included.length} / {data.rows.length} chuyến được đưa vào bảng kê
              {excluded.size ? ` · đã bỏ tích ${excluded.size} chuyến` : ""}
              {term ? " · đang lọc theo ô tìm kiếm (chỉ dòng đang hiện được in và xuất)" : ""}
            </span>
            {excluded.size ? (
              <Button variant="ghost" size="sm" onClick={() => setExcluded(new Set())}>
                Chọn lại tất cả
              </Button>
            ) : null}
          </div>
        ) : null}
        {data.truncated ? <p className="mb-2 text-sm text-amber-700">Kỳ này có hơn {maxRows.toLocaleString("en-US")} chuyến: bảng kê chỉ lấy {maxRows.toLocaleString("en-US")} chuyến đầu. Hãy chia nhỏ khoảng ngày.</p> : null}
        {customer && data.notDelivered ? (
          <p className="mb-2 text-sm text-muted-foreground">
            Còn {data.notDelivered} chuyến trong kỳ chưa giao nên chưa có trong bảng kê.{" "}
            <button type="button" className="text-primary underline" onClick={() => go({ tt: "tat-ca" })}>
              Đưa cả chuyến chưa giao vào
            </button>
          </p>
        ) : null}
      </div>

      {!customer ? (
        <Card className="p-8 text-center text-sm text-muted-foreground print:hidden">Chọn khách hàng để lập bảng kê cước.</Card>
      ) : (
        <Card className="overflow-x-auto p-4 print:overflow-visible print:border-0 print:p-0 print:shadow-none">
          <div className="statement mx-auto min-w-fit bg-white print:min-w-0 text-[12px] leading-snug text-black print:text-[10px]" style={{ fontFamily: '"Times New Roman", Times, serif' }}>
            {/* Đầu trang: khách hàng | tiêu đề | Khánh Hà */}
            <div className="mb-3 grid grid-cols-[1fr_1.3fr_1fr] items-start gap-4">
              <div>
                <div className="font-bold uppercase">{customer.name}</div>
                <div>MST: {customer.tax_code ?? ""}</div>
                <div>Địa chỉ: {customer.billing_address ?? ""}</div>
              </div>
              <div className="text-center">
                <div className="text-[17px] font-bold print:text-[15px]">{heading.title}</div>
                <div className="italic">{heading.range}</div>
              </div>
              <div>
                <div className="font-bold">{config.companyName}</div>
                <div>Địa chỉ: {config.companyAddress}</div>
                <div>Mã số thuế: {config.companyTaxCode}</div>
              </div>
            </div>

            <table className="w-full border-collapse print:!min-w-0" style={{ minWidth: totalW * PX }}>
              <thead className="sticky top-0 print:static">
                <tr>
                  <th className="w-7 border border-black bg-black px-1 print:hidden" title="Bỏ tích để không đưa chuyến vào bảng kê">
                    <input
                      type="checkbox"
                      aria-label="Chọn tất cả"
                      checked={shownRows.length > 0 && shownRows.every((r) => !excluded.has(r.id))}
                      onChange={(e) => setExcluded(e.target.checked ? new Set() : new Set(shownRows.map((r) => r.id)))}
                    />
                  </th>
                  {cols.map((c) => (
                    <th key={c.key} className="relative border border-x-white border-y-black bg-black px-1 py-1.5 text-center align-middle font-bold text-white first:border-l-black last:border-r-black" style={{ width: `${((c.w / totalW) * 100).toFixed(2)}%` }}>
                      {c.title}
                      <span
                        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-primary/40 print:hidden"
                        onPointerDown={(e) => startResize(e, c.key, c.w)}
                        title="Kéo để giãn cột"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownRows.map((r) => {
                  const off = excluded.has(r.id);
                  return (
                    <tr key={r.id} className={cn(off && "text-muted-foreground line-through opacity-50 print:hidden")}>
                      <td className="border border-black px-1 text-center align-middle print:hidden">
                        <input
                          type="checkbox"
                          aria-label="Đưa vào bảng kê"
                          checked={!off}
                          onChange={() =>
                            setExcluded((s) => {
                              const n = new Set(s);
                              if (n.has(r.id)) n.delete(r.id);
                              else n.add(r.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      {cols.map((c) => (
                        <td
                          key={c.key}
                          className={cn("border border-black px-1 py-1 align-middle", c.kind === "index" ? "text-center" : c.kind === "text" ? "" : "text-right whitespace-nowrap")}
                        >
                          {c.key === "stt" ? (sttOf.get(r.id) ?? "") : formatStatementCell(c.kind, r.cells[c.key])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {!shownRows.length ? (
                  <tr>
                    <td colSpan={cols.length + 1} className="border border-black p-4 text-center text-muted-foreground">
                      Không có chuyến nào trong kỳ này.
                    </td>
                  </tr>
                ) : null}
                <tr className="bg-[#f2f2f2] font-bold">
                  <td className="border border-black print:hidden" />
                  <td colSpan={labelSpan} className="border border-black px-1 py-1 text-center align-middle">
                    TỔNG CỘNG
                  </td>
                  {cols.slice(labelSpan).map((c) => (
                    <td key={c.key} className="border border-black px-1 py-1 text-right align-middle whitespace-nowrap">
                      {sumsInTable(c, config.noSum) ? formatStatementCell(c.kind, totals[c.key]) : ""}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>

            <div className="mt-3 break-inside-avoid">
              {config.showWords ? (
                <div className="max-w-xl">
                  <div className="font-bold">TỔNG TIỀN THANH TOÁN</div>
                  <table className="pay w-full">
                    <tbody>
                      {pay.lines.map((l) => (
                        <tr key={l.key}>
                          <td className="py-0.5 pl-4">– {l.label}</td>
                          <td className="py-0.5 text-right whitespace-nowrap">{formatStatementCell("money", l.amount)} đồng</td>
                        </tr>
                      ))}
                      <tr className="sum font-bold">
                        <td className="py-0.5">Tổng số tiền thanh toán</td>
                        <td className="py-0.5 text-right whitespace-nowrap">{formatStatementCell("money", pay.total)} đồng</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="italic">Bằng chữ: {vndInWords(pay.total)}.</div>
                </div>
              ) : null}
              {config.note.trim() ? <div className="mt-1 whitespace-pre-line">{config.note}</div> : null}
              <div className="mt-4 grid grid-cols-2 text-center">
                <div />
                <div className="italic">
                  {config.signPlace}, ngày ..... tháng ..... năm {filters.den.slice(0, 4)}
                </div>
                <div className="mt-1 font-bold">{config.leftSign}</div>
                <div className="mt-1 font-bold">{config.rightSign}</div>
                <div className="italic">(Ký, ghi rõ họ tên, đóng dấu)</div>
                <div className="italic">(Ký, ghi rõ họ tên, đóng dấu)</div>
                <div className="h-24" />
              </div>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

/** Chọn cột, đổi thứ tự, đổi tên cột, độ rộng */
function ColumnsPanel({ catalog, config, update }: { catalog: StatementData["catalog"]; config: StatementConfig; update: (p: Partial<StatementConfig>) => void }) {
  const [q, setQ] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const visible = resolveColumns(catalog, config);
  const visibleKeys = visible.map((c) => c.key);
  const term = norm(q.trim());
  const hidden = catalog.filter((c) => !visibleKeys.includes(c.key) && (!term || norm(`${c.label} ${c.group}`).includes(term)));
  const groups = [...new Set(hidden.map((c) => c.group))];
  const setCols = (keys: string[]) => update({ columns: keys });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= visibleKeys.length) return;
    const k = [...visibleKeys];
    [k[i], k[j]] = [k[j], k[i]];
    setCols(k);
  };
  const drop = (target: string) => {
    if (!dragKey || dragKey === target) return;
    const k = visibleKeys.filter((x) => x !== dragKey);
    k.splice(k.indexOf(target), 0, dragKey);
    setCols(k);
    setDragKey(null);
  };
  return (
    <Card className="mb-3 grid gap-4 p-3 lg:grid-cols-2">
      <div>
        <div className="mb-1 text-sm font-medium">Cột đang hiện ({visible.length}) – kéo hoặc bấm mũi tên để đổi thứ tự, gõ để đổi tên cột trên bảng kê</div>
        <ul className="max-h-96 space-y-1 overflow-y-auto pr-1">
          {visible.map((c, i) => (
            <li
              key={c.key}
              draggable
              onDragStart={() => setDragKey(c.key)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => drop(c.key)}
              className={cn("flex items-center gap-1 rounded border bg-card px-1 py-0.5", dragKey === c.key && "opacity-50")}
            >
              <GripVertical className="size-4 shrink-0 cursor-grab text-muted-foreground" />
              <Input
                className="h-7 flex-1"
                value={config.labels[c.key] ?? c.label}
                title={`Cột gốc: ${c.label} (${c.group})`}
                onChange={(e) => update({ labels: { ...config.labels, [c.key]: e.target.value } })}
              />
              <Input
                className="h-7 w-16"
                type="number"
                min={4}
                max={80}
                value={c.w}
                title="Độ rộng cột (ký tự Excel)"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v >= 4 && v <= 80) update({ widths: { ...config.widths, [c.key]: v } });
                }}
              />
              {isSummed(c) ? (
                <label className="flex shrink-0 items-center gap-1 px-1 text-xs" title="Hiện số tổng của cột này ở dòng TỔNG CỘNG">
                  <input
                    type="checkbox"
                    checked={!config.noSum.includes(c.key)}
                    onChange={(e) => update({ noSum: e.target.checked ? config.noSum.filter((k) => k !== c.key) : [...config.noSum, c.key] })}
                  />
                  Cộng tổng
                </label>
              ) : (
                <span className="w-[5.6rem] shrink-0" />
              )}
              <Button variant="ghost" size="icon" className="size-7" onClick={() => move(i, -1)} aria-label="Lên">
                <ArrowUp className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => move(i, 1)} aria-label="Xuống">
                <ArrowDown className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => visible.length > 1 && setCols(visibleKeys.filter((k) => k !== c.key))} aria-label="Ẩn cột" title="Ẩn cột">
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="mb-1 text-sm font-medium">Thêm cột</div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm cột: số cont, phí nâng, tài xế…" className="mb-2" />
        <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {groups.map((g) => (
            <div key={g}>
              <div className="text-xs font-semibold text-muted-foreground uppercase">{g}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {hidden
                  .filter((c) => c.group === g)
                  .map((c) => (
                    <Button key={c.key} variant="outline" size="sm" className="h-7" onClick={() => setCols([...visibleKeys, c.key])}>
                      + {c.label}
                    </Button>
                  ))}
              </div>
            </div>
          ))}
          {!groups.length ? <p className="text-sm text-muted-foreground">Không còn cột nào phù hợp.</p> : null}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Cột tiền và số lượng có ô &quot;Cộng tổng&quot; để chọn có hiện số tổng ở dòng TỔNG CỘNG hay không. Trường bổ sung (ví dụ Số cont, Số booking) thêm ở Trường dữ liệu sẽ tự có ở đây; từng loại phí (phí nâng, phí hạ…) lấy từ Danh mục phí.
        </p>
      </div>
      <PaySection catalog={catalog} config={config} update={update} />
    </Card>
  );
}

/** Các khoản ghi rõ trong phần Tổng tiền thanh toán */
function PaySection({ catalog, config, update }: { catalog: StatementData["catalog"]; config: StatementConfig; update: (p: Partial<StatementConfig>) => void }) {
  const payable = catalog.filter((c) => isPayable(c));
  const label = (k: string) => config.labels[k]?.trim() || catalog.find((c) => c.key === k)?.label || k;
  const chosen = config.payColumns.filter((k) => payable.some((c) => c.key === k));
  const overlap = chosen.includes("amount_due") && chosen.length > 1;
  return (
    <div className="border-t pt-3 lg:col-span-2">
      <div className="mb-1 text-sm font-medium">Các khoản ghi rõ trong phần &quot;Tổng tiền thanh toán&quot; (tổng thanh toán = cộng các khoản được chọn; khoản bằng 0 tự ẩn)</div>
      <div className="flex flex-wrap gap-1">
        {payable.map((c) => {
          const on = chosen.includes(c.key);
          return (
            <Button
              key={c.key}
              variant={on ? "default" : "outline"}
              size="sm"
              className="h-7"
              onClick={() => update({ payColumns: on ? chosen.filter((k) => k !== c.key) : [...chosen, c.key] })}
            >
              {on ? "✓ " : "+ "}
              {label(c.key)}
            </Button>
          );
        })}
      </div>
      {overlap ? (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          &quot;{label("amount_due")}&quot; đã gồm mọi khoản phí: chọn cùng các khoản khác sẽ bị cộng trùng. Chỉ chọn &quot;{label("amount_due")}&quot; hoặc chỉ chọn các khoản lẻ.
        </p>
      ) : null}
    </div>
  );
}

function HeaderPanel({ config, update }: { config: StatementConfig; update: (p: Partial<StatementConfig>) => void }) {
  const field = (k: "title" | "companyName" | "companyAddress" | "companyTaxCode" | "leftSign" | "rightSign" | "signPlace", label: string, hint: string) => (
    <div>
      <Label className="mb-1 block text-xs">{label}</Label>
      <Input value={config[k]} onChange={(e) => update({ [k]: e.target.value })} placeholder={hint} />
    </div>
  );
  return (
    <Card className="mb-3 grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
      {field("title", "Tiêu đề (tự thêm tháng-năm phía sau)", "BẢNG KÊ CƯỚC PHÍ VẬN CHUYỂN")}
      {field("companyName", "Tên công ty (góc phải)", "CÔNG TY TNHH ...")}
      {field("companyTaxCode", "Mã số thuế công ty", "0313167085")}
      <div className="sm:col-span-2 lg:col-span-3">{field("companyAddress", "Địa chỉ công ty", "650/5c Vườn Lài, ...")}</div>
      {field("leftSign", "Chữ ký bên trái (khách hàng)", "ĐẠI DIỆN KHÁCH HÀNG")}
      {field("rightSign", "Chữ ký bên phải (Khánh Hà)", "ĐẠI DIỆN CÔNG TY KHÁNH HÀ")}
      {field("signPlace", "Nơi ký", "TP. Hồ Chí Minh")}
      <div className="sm:col-span-2">
        <Label className="mb-1 block text-xs">Ghi chú cuối bảng kê (ví dụ số tài khoản nhận tiền, hạn thanh toán)</Label>
        <Textarea rows={3} value={config.note} onChange={(e) => update({ note: e.target.value })} placeholder="Ví dụ: Quý khách vui lòng thanh toán vào tài khoản số ... tại Ngân hàng ..." />
      </div>
      <label className="flex items-center gap-2 self-center text-sm">
        <input type="checkbox" checked={config.showWords} onChange={(e) => update({ showWords: e.target.checked })} />
        Hiện phần Tổng tiền thanh toán (từng khoản, tổng, bằng chữ)
      </label>
      <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-3">Tên, MST, địa chỉ khách hàng (góc trái) lấy từ Danh mục khách hàng: sửa ở đó để bảng kê tự cập nhật.</p>
    </Card>
  );
}

function SavePanel({
  current,
  config,
  customer,
  canShare,
  onSaved,
  onDeleted,
}: {
  current: StatementTemplate | null;
  config: StatementConfig;
  customer: StatementData["customer"];
  canShare: boolean;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(current?.name ?? (customer ? `Bảng kê ${customer.code}` : ""));
  const [shared, setShared] = useState(current?.shared ?? canShare);
  const [forCustomer, setForCustomer] = useState(Boolean(current?.config.customerId && current.config.customerId === customer?.id));
  const [pending, start] = useTransition();
  const save = (asNew: boolean) =>
    start(async () => {
      const keepCustomer = current?.config.customerId && current.config.customerId !== customer?.id ? current.config.customerId : null;
      const r = await saveStatementTemplate({
        id: asNew ? null : (current?.id ?? null),
        name,
        shared,
        config: { ...config, customerId: forCustomer && customer ? customer.id : keepCustomer },
      });
      if (!r.ok || !r.data) return void toast.error(r.ok ? "Không lưu được" : r.error);
      toast.success(r.message ?? "Đã lưu mẫu.");
      onSaved(r.data.id);
    });
  return (
    <Card className="mb-3 flex flex-wrap items-end gap-3 p-3">
      <div className="min-w-60 flex-1">
        <Label className="mb-1 block text-xs">Tên mẫu</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Bảng kê cont nhập – có phí nâng hạ" />
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm" title={canShare ? "" : "Cần quyền Cấu hình hệ thống"}>
        <input type="checkbox" checked={shared} disabled={!canShare} onChange={(e) => setShared(e.target.checked)} />
        Dùng chung cho mọi người
      </label>
      {customer ? (
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={forCustomer} onChange={(e) => setForCustomer(e.target.checked)} />
          Tự chọn mẫu này khi lập bảng kê cho {customer.code}
        </label>
      ) : null}
      <div className="flex gap-2">
        {current ? (
          <Button onClick={() => save(false)} disabled={pending || !name.trim()}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />} Lưu đè mẫu “{current.name}”
          </Button>
        ) : null}
        <Button variant={current ? "outline" : "default"} onClick={() => save(true)} disabled={pending || !name.trim()}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Lưu thành mẫu mới
        </Button>
        {current ? (
          <Button
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() =>
              confirm(`Xóa mẫu “${current.name}”?`) &&
              start(async () => {
                const r = await deleteStatementTemplate(current.id);
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.message ?? "Đã xóa mẫu.");
                onDeleted();
              })
            }
          >
            <Trash2 /> Xóa mẫu
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
