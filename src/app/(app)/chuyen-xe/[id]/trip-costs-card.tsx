"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Paperclip, Plus, Save, Search, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { MoneyField } from "@/components/finance/create-dialogs";
import { DocumentsButton } from "@/components/finance/documents-button";
import { uploadStaffDocuments } from "@/components/finance/upload";
import { ApprovalRowActions } from "@/components/finance/row-actions";
import { cancelExpense, createExpense } from "@/lib/finance/actions";
import { saveCarrierCosts } from "@/lib/finance/carrier-actions";
import type { CarrierCost } from "@/components/finance/carrier-dialogs";
import { MONEY_STATUS, PAID_BY } from "@/lib/entities/definitions";
import { TONE_BADGE } from "@/lib/tones";
import { formatDateTime, formatVND } from "@/lib/format";

export type TripCost = {
  id: string;
  code: string;
  category_name: string;
  group_name: string | null;
  group_sort: number | null;
  amount: number;
  status: string;
  paid_by: string;
  incurred_at: string;
  file_count: number;
  note: string | null;
  ref_no: string | null;
  approval_request_id: string | null;
  payroll_id: string | null;
};

type Draft = { key: number; categoryId: string; catLabel?: string; amount: number | null; paidBy: "company" | "driver"; refNo: string; note: string; files: File[]; rid: string };
let seq = 0;
const newDraft = (paidBy: Draft["paidBy"] = "company", cat?: { id: string; label: string } | null): Draft => ({
  key: ++seq,
  categoryId: cat?.id ?? "",
  catLabel: cat?.label,
  amount: null,
  paidBy,
  refNo: "",
  note: "",
  files: [],
  rid: crypto.randomUUID(),
});
const isBlank = (d: Draft) => !d.amount && !d.refNo.trim() && !d.note.trim() && !d.files.length;
const GRID = "md:grid-cols-[2rem_minmax(11rem,1.3fr)_8.5rem_9.5rem_minmax(9rem,1fr)_minmax(9rem,1fr)_8.5rem_auto]";

/**
 * Chi phí đầu ra của chuyến: mỗi khoản một dòng (chi phí lấy từ Danh mục hệ thống, số tiền, nguồn chi, chứng từ, ghi chú),
 * "Thêm chi phí" thêm dòng mới, tổng hợp theo nhóm chi phí ngay bên dưới.
 */
export function TripCostsCard(props: {
  shipmentId: string;
  shipmentCode: string;
  costs: TripCost[];
  approvable: Record<string, Record<string, unknown>>;
  canCreate: boolean;
  canCancel: boolean;
  /** Người nhập chỉ hủy được khoản chờ duyệt do mình nhập */
  canCancelOwnPending: boolean;
  /** Chuyến xe thuê ngoài 3PL: tiền trả nhà xe nhập ở khung "Chi phí trả 3PL", hiện lại ở đây để đủ chi phí đầu ra */
  carrier?: {
    supplierId: string | null;
    supplierName: string | null;
    freight: number;
    other: number;
    passThrough: number;
    canEdit: boolean;
    /** Các khoản 3PL đang có (lưu thêm khoản mới thì giữ nguyên các khoản cũ) */
    lines: CarrierCost[];
    /** Hạng mục "Thuê xe ngoài (3-PL)": chuyến 3PL tự chọn sẵn, lưu thành cước 3PL trả nhà xe */
    outsource: { id: string; label: string } | null;
  } | null;
}) {
  const router = useRouter();
  const cr = props.carrier ?? null;
  // Chuyến 3PL: dòng mới tự chọn sẵn hạng mục Thuê xe ngoài (3-PL)
  const defaultCat = cr?.outsource ?? null;
  const [drafts, setDrafts] = useState<Draft[]>(() => [newDraft("company", defaultCat)]);
  const [q, setQ] = useState("");
  const [saving, startSave] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileFor, setFileFor] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState<TripCost | null>(null);
  const patch = (key: number, p: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));

  const live = props.costs.filter((c) => c.status === "approved" || c.status === "pending");
  const hidden = props.costs.length - live.length;
  const [showAll, setShowAll] = useState(false);
  const shown = useMemo(() => {
    const base = showAll ? props.costs : live;
    const t = q.trim().toLowerCase();
    if (!t) return base;
    return base.filter((c) =>
      [c.code, c.category_name, c.group_name, c.ref_no, c.note, PAID_BY.find((o) => o.value === c.paid_by)?.label].some((v) => v?.toLowerCase().includes(t)),
    );
  }, [props.costs, live, showAll, q]);

  // Tổng hợp theo nhóm chi phí (Danh mục hệ thống → Nhóm chi phí), theo thứ tự nhóm
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; sort: number; approved: number; pending: number; company: number; driver: number; count: number }>();
    for (const c of live) {
      const name = c.group_name ?? "Chưa xếp nhóm";
      const g = m.get(name) ?? { name, sort: c.group_sort ?? 9999, approved: 0, pending: 0, company: 0, driver: 0, count: 0 };
      const a = Number(c.amount);
      if (c.status === "approved") g.approved += a;
      else g.pending += a;
      if (c.paid_by === "driver") g.driver += a;
      else g.company += a;
      g.count++;
      m.set(name, g);
    }
    return [...m.values()].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "vi"));
  }, [live]);
  const total = groups.reduce(
    (t, g) => ({ approved: t.approved + g.approved, pending: t.pending + g.pending, company: t.company + g.company, driver: t.driver + g.driver, count: t.count + g.count }),
    { approved: 0, pending: 0, company: 0, driver: 0, count: 0 },
  );
  // Cước 3PL + chi phí khác trả nhà xe: chi bởi công ty, trừ vào lời/lỗ. Chi hộ 3PL thu lại của khách nên không trừ.
  const carrierRows = cr
    ? [
        { name: cr.outsource?.label ?? "Thuê xe ngoài (3-PL)", amount: cr.freight + cr.other, profit: true },
        ...(cr.passThrough ? [{ name: "Chi hộ trả 3PL (thu lại khách)", amount: cr.passThrough, profit: false }] : []),
      ]
    : [];
  const grand = {
    count: total.count + carrierRows.filter((r) => r.amount).length,
    company: total.company + carrierRows.reduce((a, r) => a + r.amount, 0),
    approved: total.approved + carrierRows.filter((r) => r.profit).reduce((a, r) => a + r.amount, 0),
  };
  const draftTotal = drafts.reduce((a, d) => a + (d.amount ?? 0), 0);
  const filled = drafts.filter((d) => !isBlank(d));

  function save() {
    startSave(async () => {
      if (!filled.length) return void toast.error("Nhập ít nhất một khoản chi phí");
      const bad = drafts.findIndex((d) => !isBlank(d) && (!d.categoryId || !d.amount));
      if (bad >= 0) return void toast.error(`Dòng mới ${bad + 1}: chọn chi phí và nhập số tiền`);
      let saved = 0;
      const done = new Set<number>();
      // Chuyến 3PL: khoản "Thuê xe ngoài (3-PL)" lưu thành cước trả nhà xe 3PL (một nơi duy nhất, tự lập công nợ phải trả, không trừ 2 lần)
      const outsourceId = cr?.outsource?.id;
      const toCarrier = outsourceId ? filled.filter((d) => d.categoryId === outsourceId) : [];
      if (toCarrier.length && cr) {
        if (!cr.canEdit) return void toast.error("Bạn không có quyền nhập chi phí 3PL");
        if (!cr.supplierId) return void toast.error("Chuyến chưa có nhà xe 3PL. Bấm \"Nhập cước 3PL\" để chọn nhà xe trước.");
        const r = await saveCarrierCosts({
          shipmentId: props.shipmentId,
          supplierId: cr.supplierId,
          lines: [
            ...cr.lines.map((l) => ({
              kind: l.cost_kind,
              feeTypeId: l.fee_type_id,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unit_price,
              amount: Number(l.amount),
              refNo: l.ref_no ?? undefined,
              note: l.note ?? undefined,
            })),
            ...toCarrier.map((d) => ({ kind: "freight" as const, description: cr.outsource!.label, amount: d.amount!, refNo: d.refNo.trim() || undefined, note: d.note.trim() || undefined })),
          ],
        });
        if (!r.ok) return void toast.error(r.error);
        for (const d of toCarrier) done.add(d.key);
        saved += toCarrier.length;
        if (toCarrier.some((d) => d.files.length)) toast.info("Cước 3PL đã lưu; chứng từ của nhà xe đính kèm ở phiếu công nợ phải trả.");
      }
      for (const d of filled) {
        if (done.has(d.key)) continue;
        const r = await createExpense({
          shipmentId: props.shipmentId,
          categoryId: d.categoryId,
          amount: d.amount!,
          paidBy: d.paidBy,
          refNo: d.refNo.trim() || undefined,
          note: d.note.trim() || undefined,
          clientRequestId: d.rid,
        });
        if (!r.ok) {
          setDrafts((ds) => {
            const left = ds.filter((x) => !done.has(x.key));
            return left.length ? left : [newDraft("company", defaultCat)];
          });
          router.refresh();
          return void toast.error(saved ? `Đã lưu ${saved} khoản; khoản tiếp theo lỗi: ${r.error}` : r.error);
        }
        saved++;
        done.add(d.key);
        if (d.files.length && r.data) {
          const u = await uploadStaffDocuments("shipment_expense", r.data, d.files.map((file) => ({ file, docType: "receipt" as const })));
          if (!u.ok) toast.error(`Đã lưu khoản ${saved} nhưng ${u.error.toLowerCase()}`);
        }
      }
      toast.success(saved > 1 ? `Đã lưu ${saved} khoản chi phí` : "Đã lưu chi phí");
      setDrafts([newDraft(filled[filled.length - 1]?.paidBy, defaultCat)]);
      router.refresh();
    });
  }

  return (
    <Card className="lg:col-span-3" id="chi-phi-dau-ra">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="text-base">Chi phí đầu ra của chuyến</CardTitle>
          <CardDescription>
            Mỗi khoản một dòng. Chi phí chọn trong Danh mục hệ thống (Danh mục phí, nguồn Chi ra); chi phí chưa có thì bấm + để thêm đầy đủ vào danh mục. Khoản cần duyệt chỉ cộng vào lời/lỗ sau khi Giám
            đốc duyệt.
          </CardDescription>
        </div>
        <div className="relative w-full sm:w-60">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input data-no-edit-lock className="h-9 pl-8" placeholder="Tìm chi phí, chứng từ, ghi chú…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm chi phí" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {cr ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet-200 bg-violet-50 p-2 dark:border-violet-900 dark:bg-violet-950/40">
            <div className="space-y-0.5">
              <div>
                <Truck className="mr-1 inline size-4 align-text-bottom" />
                Xe thuê ngoài 3PL{cr.supplierName ? <> · nhà xe <b>{cr.supplierName}</b></> : null}: cước vận chuyển trả 3PL{" "}
                <b className="tabular-nums">{formatVND(cr.freight + cr.other)}</b>
                {cr.passThrough ? <>, chi hộ trả 3PL <b className="tabular-nums">{formatVND(cr.passThrough)}</b></> : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Dòng mới tự chọn sẵn hạng mục &quot;{cr.outsource?.label ?? "Thuê xe ngoài (3-PL)"}&quot;: lưu xong thành cước trả nhà xe ở khung &quot;Chi phí trả 3PL&quot;
                (tự lập công nợ phải trả, chỉ tính một lần). Chi phí khác thì đổi hạng mục.
              </p>
            </div>
            <Button asChild size="sm" variant="outline">
              <a href="#chi-phi-3pl">
                <Truck /> {cr.canEdit ? (cr.freight + cr.other + cr.passThrough ? "Sửa cước 3PL" : "Nhập cước 3PL") : "Xem cước 3PL"}
              </a>
            </Button>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <div className={`hidden gap-1.5 border-b pb-1 text-[11px] font-medium text-muted-foreground md:grid ${GRID}`}>
            <span>#</span>
            <span>Chi phí *</span>
            <span className="text-right">Số tiền (đ) *</span>
            <span>Nguồn chi</span>
            <span>Chứng từ</span>
            <span>Ghi chú</span>
            <span>Trạng thái</span>
            <span className="sr-only">Thao tác</span>
          </div>

          {shown.map((c, i) => {
            const st = MONEY_STATUS.find((o) => o.value === c.status);
            const appr = c.approval_request_id ? props.approvable[c.approval_request_id] : undefined;
            const cancellable =
              (c.status === "approved" || c.status === "pending") && !c.payroll_id && (props.canCancel || (props.canCancelOwnPending && c.status === "pending"));
            return (
              <div key={c.id} className={`grid grid-cols-2 items-center gap-1.5 border-b border-dashed pb-1.5 md:border-0 md:pb-0 ${GRID}`}>
                <span className="hidden text-xs text-muted-foreground md:block">{i + 1}</span>
                <div className="col-span-2 min-w-0 md:col-span-1">
                  <div className="truncate font-medium">{c.category_name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {c.group_name ?? "Chưa xếp nhóm"} · {c.code} · {formatDateTime(c.incurred_at)}
                  </div>
                </div>
                <span className="text-right font-medium tabular-nums">{formatVND(c.amount)}</span>
                <span>{PAID_BY.find((o) => o.value === c.paid_by)?.label ?? c.paid_by}</span>
                <div className="flex min-w-0 items-center gap-1">
                  <span className="truncate">{c.ref_no ?? <span className="text-muted-foreground">—</span>}</span>
                  <DocumentsButton entityType="shipment_expense" entityId={c.id} count={Number(c.file_count)} title={`Chứng từ ${c.code}`} />
                </div>
                <span className="truncate text-muted-foreground" title={c.note ?? undefined}>
                  {c.note ?? "—"}
                </span>
                <span>{st ? <Badge variant={TONE_BADGE[st.tone!]}>{st.label}</Badge> : c.status}</span>
                <div className="col-span-2 flex items-center justify-end gap-1 md:col-span-1">
                  {appr ? <ApprovalRowActions row={appr} onDone={() => router.refresh()} /> : null}
                  {cancellable ? (
                    <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => setCancelling(c)} title="Hủy khoản nhập sai (giữ lịch sử)">
                      <Ban /> Hủy
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {shown.length === 0 && !props.canCreate ? <p className="text-muted-foreground">{q ? "Không có khoản nào khớp." : "Chưa có chi phí."}</p> : null}
          {hidden > 0 ? (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Ẩn khoản đã hủy / bị từ chối" : `Xem ${hidden} khoản đã hủy / bị từ chối`}
            </button>
          ) : null}

          {props.canCreate
            ? drafts.map((d, i) => (
                <div key={d.key} className={`grid grid-cols-2 items-center gap-1.5 rounded-md bg-primary/5 p-1.5 md:p-1 ${GRID}`}>
                  <span className="hidden text-xs font-medium text-primary md:block">+{i + 1}</span>
                  <div className="col-span-2 min-w-0 md:col-span-1">
                    <ReferenceSelect id={`tc-cat-${d.key}`} refKey="expense_categories" value={d.categoryId} initialLabel={d.catLabel} onChange={(v) => patch(d.key, { categoryId: v })} />
                  </div>
                  <MoneyField id={`tc-amount-${d.key}`} value={d.amount} onChange={(v) => patch(d.key, { amount: v })} />
                  <NativeSelect
                    aria-label={`Nguồn chi dòng mới ${i + 1}`}
                    className="h-9"
                    value={d.paidBy}
                    onChange={(e) => patch(d.key, { paidBy: e.target.value as Draft["paidBy"] })}
                  >
                    {PAID_BY.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <div className="flex min-w-0 items-center gap-1">
                    <Input
                      className="h-9 min-w-0"
                      aria-label={`Số chứng từ dòng mới ${i + 1}`}
                      placeholder="Số HĐ, biên lai"
                      maxLength={100}
                      value={d.refNo}
                      onChange={(e) => patch(d.key, { refNo: e.target.value })}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="relative size-9 shrink-0"
                      title={d.files.length ? d.files.map((f) => f.name).join(", ") : "Đính kèm ảnh/PDF chứng từ (không bắt buộc, tối đa 10 tệp, 10 MB mỗi tệp)"}
                      aria-label="Đính kèm chứng từ"
                      onClick={() => {
                        setFileFor(d.key);
                        fileRef.current?.click();
                      }}
                    >
                      <Paperclip />
                      {d.files.length ? (
                        <span className="absolute -top-1.5 -right-1.5 rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">{d.files.length}</span>
                      ) : null}
                    </Button>
                  </div>
                  <Input
                    className="h-9"
                    aria-label={`Ghi chú dòng mới ${i + 1}`}
                    placeholder="VD: BOT Bình Dương lượt đi"
                    maxLength={1000}
                    value={d.note}
                    onChange={(e) => patch(d.key, { note: e.target.value })}
                  />
                  <span className="text-xs text-muted-foreground">Chưa lưu</span>
                  <div className="col-span-2 flex justify-end md:col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive"
                      aria-label={`Xóa dòng mới ${i + 1}`}
                      onClick={() => setDrafts((ds) => (ds.length === 1 ? [newDraft(d.paidBy, defaultCat)] : ds.filter((x) => x.key !== d.key)))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))
            : null}
          {props.canCreate ? (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={drafts.length >= 30 || saving}
                onClick={() => setDrafts((ds) => [...ds, newDraft(ds[ds.length - 1]?.paidBy, defaultCat)])}
              >
                <Plus /> Thêm chi phí
              </Button>
              <div className="flex items-center gap-3">
                {draftTotal ? (
                  <span>
                    Đang nhập: <b className="tabular-nums">{formatVND(draftTotal)}</b>
                  </span>
                ) : null}
                <Button type="button" size="sm" onClick={save} disabled={saving || !filled.length}>
                  <Save /> {saving ? "Đang lưu…" : filled.length > 1 ? `Lưu ${filled.length} chi phí` : "Lưu chi phí"}
                </Button>
              </div>
            </div>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            aria-label="Chọn chứng từ"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []).filter((f) => f.size <= 10 * 1024 * 1024).slice(0, 10);
              if (fileFor !== null) patch(fileFor, { files: picked });
              e.target.value = "";
            }}
          />
        </div>

        <div className="space-y-1.5">
          <div className="font-medium">Tổng hợp theo nhóm chi phí</div>
          {groups.length === 0 && !cr ? (
            <p className="text-muted-foreground">Chưa có khoản chi phí nào.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[36rem] text-sm [&_td]:border-r [&_td:last-child]:border-r-0 [&_th]:border-r [&_th:last-child]:border-r-0">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5">Nhóm phí</th>
                    <th className="px-2 py-1.5 text-right">Số khoản</th>
                    <th className="px-2 py-1.5 text-right">Chi bởi công ty</th>
                    <th className="px-2 py-1.5 text-right">Chi bởi tài xế</th>
                    <th className="px-2 py-1.5 text-right">Chờ duyệt</th>
                    <th className="px-2 py-1.5 text-right">Đã duyệt (tính lời/lỗ)</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.name} className="border-t">
                      <td className="px-2 py-1.5">{g.name}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{g.count}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatVND(g.company)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatVND(g.driver)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-amber-700 dark:text-amber-400">{g.pending ? formatVND(g.pending) : "—"}</td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">{formatVND(g.approved)}</td>
                    </tr>
                  ))}
                  {carrierRows.map((r) => (
                    <tr key={r.name} className="border-t">
                      <td className="px-2 py-1.5">
                        <a href="#chi-phi-3pl" className="hover:underline" title="Nhập, sửa ở khung Chi phí trả 3PL">
                          {r.name}
                        </a>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.amount ? 1 : 0}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatVND(r.amount)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatVND(0)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">—</td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">{r.profit ? formatVND(r.amount) : "Không trừ"}</td>
                    </tr>
                  ))}
                  <tr className="border-t bg-muted/40 font-semibold">
                    <td className="px-2 py-1.5">Tổng chi phí đầu ra</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{grand.count}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatVND(grand.company)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatVND(total.driver)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{total.pending ? formatVND(total.pending) : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-primary">{formatVND(grand.approved)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Chi bởi tài xế: được cộng lại cho tài xế khi đối soát lương cuối tháng. Nhóm phí sửa ở Danh mục hệ thống → Nhóm phí → Chi ra.</p>
        </div>
      </CardContent>
      {cancelling ? (
        <CancelCostDialog
          cost={cancelling}
          shipmentId={props.shipmentId}
          onClose={(ok) => {
            setCancelling(null);
            if (ok) router.refresh();
          }}
        />
      ) : null}
    </Card>
  );
}

function CancelCostDialog({ cost, shipmentId, onClose }: { cost: TripCost; shipmentId: string; onClose: (ok: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Hủy khoản chi {cost.code}</DialogTitle>
          <DialogDescription>
            {cost.category_name}: {formatVND(cost.amount)}. Khoản bị hủy vẫn lưu lịch sử. Muốn sửa thì hủy rồi nhập lại dòng mới.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="tc-cancel-reason">Lý do hủy *</Label>
          <Textarea id="tc-cancel-reason" placeholder="VD: Nhập nhầm số tiền" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose(false)} disabled={pending}>
            Đóng
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (!reason.trim()) return void toast.error("Nhập lý do hủy");
                const r = await cancelExpense({ expenseId: cost.id, shipmentId, reason: reason.trim() });
                if (!r.ok) return void toast.error(r.error);
                toast.success("Đã hủy khoản chi");
                onClose(true);
              })
            }
          >
            {pending ? "Đang hủy…" : "Hủy khoản chi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
