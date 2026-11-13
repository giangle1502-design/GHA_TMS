"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Paperclip, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { DocumentsButton } from "@/components/finance/documents-button";
import { uploadStaffDocuments } from "@/components/finance/upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { createClient } from "@/lib/supabase/client";
import { parseNumberVN } from "@/lib/entities/record";
import { formatNumber, formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";

export type FeeKind = "revenue" | "pass_through";
export type FeeGroupRole = "freight" | "pass_through" | "declaration" | "loading" | "other";
export type FeeLine = {
  key: number;
  fee_type_id: string;
  label: string;
  kind: FeeKind | null;
  amount: string;
  note: string;
  declaration_type_id: string;
  declaration_label: string;
  /** Số hóa đơn (chi hộ) hoặc số chứng từ (tờ khai) */
  ref_no: string;
  /** Số lượng × đơn giá (tùy chọn, dùng cho bốc xếp) */
  quantity: string;
  unit_price: string;
};

/** Tệp PDF / ảnh hóa đơn chờ tải lên theo loại phí chi hộ (tải sau khi lưu chuyến) */
export type FeeFiles = Record<string, File[]>;

/** Tải các tệp hóa đơn chờ của phí chi hộ lên chuyến vừa lưu; trả về câu báo lỗi (nếu có) */
export async function uploadFeeFiles(shipmentId: string, files: FeeFiles | undefined): Promise<string | null> {
  let failed = 0;
  for (const [feeTypeId, list] of Object.entries(files ?? {})) {
    if (!list.length) continue;
    const r = await uploadStaffDocuments("shipment_fee", shipmentId, list.map((file) => ({ file, docType: "invoice" as const })), feeTypeId);
    if (!r.ok) failed += list.length;
  }
  return failed ? `${failed} tệp hóa đơn chi hộ chưa tải lên được. Mở chi tiết chuyến để đính kèm lại.` : null;
}
export const countFeeFiles = (files: FeeFiles | undefined) => Object.values(files ?? {}).reduce((a, l) => a + l.length, 0);

export type FeeGroup = { id: string; name: string; report_role: FeeGroupRole; description: string | null };
export type FeeTypeRow = { id: string; name: string; fee_kind: FeeKind; fee_group_id: string | null; description: string | null };
export type FeeCatalog = { groups: FeeGroup[]; types: FeeTypeRow[] };

let seq = 0;
export const newFee = (from?: Partial<FeeLine>): FeeLine => ({
  key: ++seq,
  fee_type_id: from?.fee_type_id ?? "",
  label: from?.label ?? "",
  kind: from?.kind ?? null,
  amount: from?.amount ?? "",
  note: from?.note ?? "",
  declaration_type_id: from?.declaration_type_id ?? "",
  declaration_label: from?.declaration_label ?? "",
  ref_no: from?.ref_no ?? "",
  quantity: from?.quantity ?? "",
  unit_price: from?.unit_price ?? "",
});

const blank = (l: FeeLine) =>
  !l.amount.trim() && !l.note.trim() && !l.declaration_type_id && !l.ref_no.trim() && !l.quantity.trim() && !l.unit_price.trim();

/** Số từ CSDL (numeric) sang chuỗi hiển thị có dấu phẩy ngăn cách nghìn */
export const numText = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? "" : formatNumber(Number(v)));

/** Dữ liệu gửi lên máy chủ: dòng chưa nhập gì bị bỏ qua */
export const feesPayload = (lines: FeeLine[]) =>
  lines
    .filter((l) => !(blank(l) && !l.fee_type_id))
    .map((l) => ({
      fee_type_id: l.fee_type_id,
      amount: l.amount,
      note: l.note,
      declaration_type_id: l.declaration_type_id,
      ref_no: l.ref_no,
      quantity: l.quantity,
      unit_price: l.unit_price,
    }));

// Danh mục nhóm phí + loại phí: tải một lần, tải lại khi vừa thêm loại phí mới
let catalogPromise: Promise<FeeCatalog> | null = null;
export function loadFeeCatalog(force = false): Promise<FeeCatalog> {
  if (!catalogPromise || force) {
    const sb = createClient();
    catalogPromise = Promise.all([
      sb.from("fee_groups").select("id, name, report_role, description").eq("is_active", true).order("sort_order").order("name"),
      sb.from("fee_types").select("id, name, fee_kind, fee_group_id, description").eq("is_active", true).order("sort_order").order("name"),
    ]).then(([g, t]) => ({ groups: (g.data ?? []) as FeeGroup[], types: (t.data ?? []) as FeeTypeRow[] }));
  }
  return catalogPromise;
}
export function useFeeCatalog(): [FeeCatalog | null, () => void] {
  const [cat, setCat] = useState<FeeCatalog | null>(null);
  useEffect(() => {
    let alive = true;
    loadFeeCatalog().then((c) => alive && setCat(c));
    return () => {
      alive = false;
    };
  }, []);
  return [cat, () => void loadFeeCatalog(true).then(setCat)];
}

/**
 * Tổng phí: tính doanh thu, chi hộ (không tính doanh thu), và phần thuộc nhóm Cước vận chuyển
 * (cộng vào Tổng cước cùng cước, phụ phí, hỗ trợ dầu).
 */
export function feeTotals(lines: FeeLine[], catalog?: FeeCatalog | null) {
  let revenue = 0;
  let passThrough = 0;
  const byRole: Record<FeeGroupRole, number> = { freight: 0, pass_through: 0, declaration: 0, loading: 0, other: 0 };
  const typeOf = new Map(catalog?.types.map((t) => [t.id, t]) ?? []);
  const roleOf = new Map(catalog?.groups.map((g) => [g.id, g.report_role]) ?? []);
  for (const l of lines) {
    const v = parseNumberVN(l.amount, true) ?? 0;
    const t = typeOf.get(l.fee_type_id);
    const kind = l.kind ?? t?.fee_kind ?? "revenue";
    if (kind === "pass_through") passThrough += v;
    else revenue += v;
    byRole[(t?.fee_group_id && roleOf.get(t.fee_group_id)) || "other"] += v;
  }
  return { revenue, passThrough, freight: byRole.freight, byRole };
}

// Cột của một dòng phí theo vai trò nhóm (màn hình từ sm trở lên)
const ROW_COLS: Record<FeeGroupRole, string> = {
  freight: "sm:grid-cols-[minmax(0,12rem)_9rem_minmax(0,1fr)]",
  other: "sm:grid-cols-[minmax(0,12rem)_9rem_minmax(0,1fr)]",
  pass_through: "sm:grid-cols-[minmax(0,10rem)_8.5rem_8.5rem_minmax(0,1fr)]",
  declaration: "sm:grid-cols-[minmax(0,9rem)_7rem_8.5rem_8rem_minmax(0,1fr)]",
  loading: "sm:grid-cols-[minmax(0,10rem)_4.5rem_7rem_8.5rem_minmax(0,1fr)]",
};
const ROW_HEAD: Record<FeeGroupRole, string[]> = {
  freight: ["Loại phí", "Số tiền (đ)", "Ghi chú"],
  other: ["Loại phí", "Số tiền (đ)", "Ghi chú"],
  pass_through: ["Loại phí", "Số tiền (đ)", "Số hóa đơn", "Ghi chú"],
  declaration: ["Loại phí", "Loại tờ khai", "Số tiền (đ)", "Số chứng từ", "Ghi chú"],
  loading: ["Loại phí", "Số lượng", "Đơn giá (đ)", "Số tiền (đ)", "Ghi chú"],
};

// Phí chi hộ có nút đính kèm hóa đơn PDF / ảnh ngay sau ô Số hóa đơn
const PASS_COLS_ATTACH = "sm:grid-cols-[minmax(0,10rem)_8.5rem_8.5rem_auto_minmax(0,1fr)]";
const PASS_HEAD_ATTACH = ["Loại phí", "Số tiền (đ)", "Số hóa đơn", "Hóa đơn PDF", "Ghi chú"];
const MAX_FILES = 10;
const MAX_SIZE = 10 * 1024 * 1024;

/** Nút đính kèm PDF / ảnh hóa đơn của một phí chi hộ: tệp chọn xong chờ, tải lên khi bấm Lưu */
function FeeAttach({
  name,
  pending,
  onPending,
  shipmentId,
  feeTypeId,
  saved,
}: {
  name: string;
  pending: File[];
  onPending: (files: File[]) => void;
  shipmentId?: string;
  feeTypeId: string;
  saved: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 px-2"
        title="Đính kèm hóa đơn PDF hoặc ảnh (không bắt buộc, tối đa 10 tệp, 10 MB mỗi tệp). Tệp được tải lên khi bấm Lưu."
        aria-label={`${name}: đính kèm hóa đơn PDF`}
        onClick={() => input.current?.click()}
      >
        <Paperclip className="size-3.5" />
        {pending.length ? <span className="tabular-nums">+{pending.length}</span> : <span className="sm:hidden">Đính kèm</span>}
      </Button>
      {pending.length ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          title={`Bỏ tệp chờ tải: ${pending.map((f) => f.name).join(", ")}`}
          aria-label={`${name}: bỏ ${pending.length} tệp chờ tải`}
          onClick={() => onPending([])}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
      {shipmentId && saved ? (
        <DocumentsButton entityType="shipment_fee" entityId={shipmentId} feeTypeId={feeTypeId} count={saved} title={`Hóa đơn ${name}`} label={`${saved}`} canUpload />
      ) : null}
      <input
        ref={input}
        type="file"
        multiple
        accept="application/pdf,image/*"
        className="hidden"
        aria-label={`${name}: chọn tệp hóa đơn`}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!picked.length) return;
          if (picked.some((f) => f.size > MAX_SIZE)) return void toast.error("Mỗi tệp tối đa 10 MB");
          if (picked.some((f) => f.type !== "application/pdf" && !f.type.startsWith("image/"))) return void toast.error("Chỉ nhận PDF hoặc ảnh");
          const all = [...pending, ...picked];
          if (all.length > MAX_FILES) toast.warning(`Mỗi loại phí tối đa ${MAX_FILES} tệp mỗi lần lưu`);
          onPending(all.slice(0, MAX_FILES));
        }}
      />
    </div>
  );
}

export const FEE_KIND_LABEL: Record<FeeKind, string> = { revenue: "Tính doanh thu", pass_through: "Chi hộ" };

/**
 * Phí thu khách theo nhóm: mỗi nhóm (Cước vận chuyển, Phí chi hộ, Phí tờ khai, Phí bốc xếp…) liệt kê sẵn các loại phí
 * của nhóm, chỉ cần gõ số tiền. Nhóm Tờ khai có thêm ô Loại tờ khai. Loại phí chưa có thì thêm ở "Phí khác".
 */
export function FeesEditor({
  value,
  onChange,
  idPrefix,
  freightBase,
  freightHead,
  freightLabel,
  files,
  onFilesChange,
  shipmentId,
  savedFiles,
}: {
  value: FeeLine[];
  onChange: (lines: FeeLine[]) => void;
  idPrefix: string;
  /** Cước + phụ phí + hỗ trợ dầu của chuyến (để hiện Tổng cước ngay trong nhóm Cước vận chuyển) */
  freightBase?: number | null;
  /** Ô Đơn giá, % hỗ trợ dầu… đặt ở đầu nhóm Phí vận chuyển */
  freightHead?: ReactNode;
  /** Diễn giải phần cước (vd. "Đơn giá × (1 + 39%)") hiện ở dòng tổng nhóm Phí vận chuyển */
  freightLabel?: string;
  /** Tệp hóa đơn chờ tải lên của các phí chi hộ; có onFilesChange thì hiện nút đính kèm cạnh Số hóa đơn */
  files?: FeeFiles;
  onFilesChange?: (files: FeeFiles) => void;
  /** Chuyến đã lưu: số tệp đã đính kèm theo loại phí (xem lại được ngay) */
  shipmentId?: string;
  savedFiles?: Record<string, number>;
}) {
  const [catalog, reload] = useFeeCatalog();
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const emit = (next: FeeLine[]) => {
    latest.current = next;
    onChange(next);
  };
  const patch = (key: number, p: Partial<FeeLine>) => emit(latest.current.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const types = catalog?.types ?? [];
  const groups = catalog?.groups ?? [];
  const groupIds = new Set(groups.map((g) => g.id));
  const typeById = new Map(types.map((t) => [t.id, t]));
  // Dòng gắn với ô cố định của từng loại phí (dòng đầu tiên của loại phí đó); các dòng còn lại là "Phí khác"
  const fixedLine = new Map<string, FeeLine>();
  for (const l of value) {
    const t = typeById.get(l.fee_type_id);
    if (t?.fee_group_id && groupIds.has(t.fee_group_id) && !fixedLine.has(t.id)) fixedLine.set(t.id, l);
  }
  const fixedKeys = new Set([...fixedLine.values()].map((l) => l.key));
  const freeLines = value.filter((l) => !fixedKeys.has(l.key));

  function setFixed(t: FeeTypeRow, p: Partial<FeeLine>) {
    const cur = latest.current.find((l) => l.key === fixedLine.get(t.id)?.key);
    if (cur) {
      const next = { ...cur, ...p };
      // Ô để trống hết thì bỏ dòng
      emit(blank(next) ? latest.current.filter((l) => l.key !== cur.key) : latest.current.map((l) => (l.key === cur.key ? next : l)));
    } else {
      const next = newFee({ fee_type_id: t.id, label: t.name, kind: t.fee_kind, ...p });
      if (!blank(next)) emit([...latest.current, next]);
    }
  }

  async function pickFreeType(line: FeeLine, id: string, label: string) {
    patch(line.key, { fee_type_id: id, label, kind: null });
    if (!id) return;
    // Loại phí vừa thêm nhanh: tải lại danh mục để biết nhóm và cách tính
    const known = typeById.get(id);
    if (known) return patch(line.key, { kind: known.fee_kind });
    const c = await loadFeeCatalog(true);
    reload();
    const t = c.types.find((x) => x.id === id);
    emit(latest.current.map((l) => (l.key === line.key && l.fee_type_id === id ? { ...l, kind: t?.fee_kind ?? "revenue" } : l)));
  }

  const groupSum = (g: FeeGroup) =>
    value.reduce((a, l) => (typeById.get(l.fee_type_id)?.fee_group_id === g.id ? a + (parseNumberVN(l.amount, true) ?? 0) : a), 0);
  const firstFreight = groups.find((g) => g.report_role === "freight")?.id;

  const num = (v: string) => parseNumberVN(v, true);
  const tidy = (t: FeeTypeRow, field: "amount" | "quantity" | "unit_price", v: string) => {
    const n = num(v);
    if (fixedLine.get(t.id) && n !== null && !Number.isNaN(n)) setFixed(t, { [field]: formatNumber(n) });
  };
  // Bốc xếp: gõ số lượng và đơn giá thì số tiền = số lượng × đơn giá
  function setQtyPrice(t: FeeTypeRow, p: { quantity?: string; unit_price?: string }) {
    const cur = fixedLine.get(t.id);
    const q = num(p.quantity ?? cur?.quantity ?? "");
    const u = num(p.unit_price ?? cur?.unit_price ?? "");
    const amount = q !== null && u !== null && !Number.isNaN(q) && !Number.isNaN(u) ? formatNumber(Math.round(q * u)) : undefined;
    setFixed(t, amount === undefined ? p : { ...p, amount });
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">
        Phí thu khách theo nhóm{" "}
        <span className="font-normal text-muted-foreground">· chỉ gõ vào loại phí có phát sinh, ô để trống không lưu. Nhóm phí, loại phí sửa ở Danh mục.</span>
      </div>
      {!catalog ? <p className="text-xs text-muted-foreground">Đang tải danh mục phí…</p> : null}
      <div className="grid gap-3 xl:grid-cols-2">
        {groups.map((g) => {
          const gTypes = types.filter((t) => t.fee_group_id === g.id);
          const isFreight = g.id === firstFreight;
          const role = g.report_role;
          const attach = role === "pass_through" && Boolean(onFilesChange);
          const cols = attach ? PASS_COLS_ATTACH : ROW_COLS[role];
          const head = attach ? PASS_HEAD_ATTACH : ROW_HEAD[role];
          const sum = groupSum(g);
          return (
            <fieldset key={g.id} className={cn("rounded-lg border p-2.5", isFreight && "border-primary/40")}>
              <legend className="px-1 text-xs font-semibold text-foreground">{g.name}</legend>
              {isFreight && freightHead ? <div className="mb-1.5 space-y-1.5">{freightHead}</div> : null}
              {gTypes.length ? (
                <div className={cn("mb-1 hidden gap-1.5 text-[11px] text-muted-foreground sm:grid", cols)}>
                  {head.map((h, i) => (
                    <span key={i} className={i > 0 && h !== "Ghi chú" && h !== "Loại tờ khai" && h !== "Hóa đơn PDF" && !h.startsWith("Số ") ? "text-right" : undefined}>
                      {h}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="space-y-1.5">
                {gTypes.map((t) => {
                  const l = fixedLine.get(t.id);
                  const fid = `${idPrefix}${t.id.slice(0, 8)}`;
                  const moneyInput = (
                    <Input
                      id={fid}
                      inputMode="numeric"
                      placeholder="Số tiền"
                      className="h-8 text-right tabular-nums"
                      value={l?.amount ?? ""}
                      onChange={(e) => setFixed(t, { amount: e.target.value })}
                      onBlur={(e) => tidy(t, "amount", e.target.value)}
                      aria-label={`${t.name}: số tiền`}
                    />
                  );
                  const refInput = (placeholder: string) => (
                    <Input
                      className="h-8"
                      placeholder={placeholder}
                      maxLength={100}
                      value={l?.ref_no ?? ""}
                      onChange={(e) => setFixed(t, { ref_no: e.target.value })}
                      aria-label={`${t.name}: ${placeholder.toLowerCase()}`}
                    />
                  );
                  const noteInput = (
                    <Input
                      className="h-8"
                      placeholder="Ghi chú"
                      maxLength={500}
                      value={l?.note ?? ""}
                      onChange={(e) => setFixed(t, { note: e.target.value })}
                      aria-label={`${t.name}: ghi chú`}
                    />
                  );
                  return (
                    <div key={t.id} className={cn("grid grid-cols-2 items-center gap-1.5", cols)}>
                      <label htmlFor={fid} className="col-span-full truncate text-sm sm:col-span-1" title={t.description ?? t.name}>
                        {t.name}
                      </label>
                      {role === "declaration" ? (
                        <>
                          <ReferenceSelect
                            id={`${fid}-tk`}
                            refKey="declaration_types"
                            value={l?.declaration_type_id ?? ""}
                            initialLabel={l?.declaration_label}
                            onChange={(id, label) => setFixed(t, { declaration_type_id: id, declaration_label: label })}
                          />
                          {moneyInput}
                          {refInput("Số chứng từ")}
                          {noteInput}
                        </>
                      ) : role === "pass_through" ? (
                        <>
                          {moneyInput}
                          {refInput("Số hóa đơn")}
                          {attach ? (
                            <FeeAttach
                              name={t.name}
                              pending={files?.[t.id] ?? []}
                              onPending={(list) => {
                                const next = { ...(files ?? {}) };
                                if (list.length) next[t.id] = list;
                                else delete next[t.id];
                                onFilesChange!(next);
                              }}
                              shipmentId={shipmentId}
                              feeTypeId={t.id}
                              saved={savedFiles?.[t.id] ?? 0}
                            />
                          ) : null}
                          {noteInput}
                        </>
                      ) : role === "loading" ? (
                        <>
                          <Input
                            inputMode="decimal"
                            placeholder="SL"
                            className="h-8 text-right tabular-nums"
                            value={l?.quantity ?? ""}
                            onChange={(e) => setQtyPrice(t, { quantity: e.target.value })}
                            onBlur={(e) => tidy(t, "quantity", e.target.value)}
                            aria-label={`${t.name}: số lượng`}
                          />
                          <Input
                            inputMode="numeric"
                            placeholder="Đơn giá"
                            className="h-8 text-right tabular-nums"
                            value={l?.unit_price ?? ""}
                            onChange={(e) => setQtyPrice(t, { unit_price: e.target.value })}
                            onBlur={(e) => tidy(t, "unit_price", e.target.value)}
                            aria-label={`${t.name}: đơn giá`}
                          />
                          {moneyInput}
                          {noteInput}
                        </>
                      ) : (
                        <>
                          {moneyInput}
                          {noteInput}
                        </>
                      )}
                    </div>
                  );
                })}
                {!gTypes.length ? <p className="text-xs text-muted-foreground">Nhóm chưa có phí. Thêm ở Danh mục → Danh mục phí → Thu khách.</p> : null}
                {role === "loading" && gTypes.length ? (
                  <p className="text-xs text-muted-foreground">Có Số lượng và Đơn giá thì Số tiền tự tính = SL × Đơn giá; không dùng thì gõ thẳng Số tiền.</p>
                ) : null}
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-2 border-t pt-1.5 text-sm">
                <span>
                  <b>{isFreight ? "Tổng phí vận chuyển" : `Tổng ${g.name.charAt(0).toLowerCase()}${g.name.slice(1)}`}</b>
                  {isFreight && freightLabel ? <span className="ml-1 text-xs text-muted-foreground">= {freightLabel} + các phụ thu trên</span> : null}
                </span>
                <b className="tabular-nums">
                  {isFreight ? (freightBase === null ? "Tính khi lưu" : formatVND((freightBase ?? 0) + sum)) : formatVND(sum)}
                </b>
              </div>
            </fieldset>
          );
        })}
        <fieldset className="rounded-lg border border-dashed p-2.5">
          <legend className="px-1 text-xs font-semibold text-foreground">Phí khác</legend>
          <div className="space-y-1.5">
            {freeLines.map((l, i) => {
              const t = typeById.get(l.fee_type_id);
              const grp = t?.fee_group_id ? groups.find((g) => g.id === t.fee_group_id) : null;
              return (
                <div key={l.key} className="grid gap-1.5 sm:grid-cols-[minmax(0,12rem)_8rem_minmax(0,1fr)_auto] sm:items-start">
                  <div>
                    <label htmlFor={`${idPrefix}type-${i + 1}`} className="sr-only">
                      Loại phí khác dòng {i + 1}
                    </label>
                    <ReferenceSelect
                      id={`${idPrefix}type-${i + 1}`}
                      refKey="fee_types"
                      value={l.fee_type_id}
                      initialLabel={l.label}
                      onChange={(id, label) => void pickFreeType(l, id, label)}
                    />
                    {l.kind || grp ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {l.kind ? <Badge variant={l.kind === "pass_through" ? "warning" : "info"}>{FEE_KIND_LABEL[l.kind]}</Badge> : null}
                        {grp ? <Badge variant="outline">{grp.name}</Badge> : null}
                      </div>
                    ) : null}
                  </div>
                  <Input
                    aria-label={`Số tiền phí khác dòng ${i + 1}`}
                    inputMode="numeric"
                    placeholder="Số tiền (đ)"
                    className="h-8 text-right tabular-nums"
                    value={l.amount}
                    onChange={(e) => patch(l.key, { amount: e.target.value })}
                  />
                  <Input
                    aria-label={`Ghi chú phí khác dòng ${i + 1}`}
                    placeholder="Ghi chú"
                    className="h-8"
                    maxLength={500}
                    value={l.note}
                    onChange={(e) => patch(l.key, { note: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-destructive"
                    aria-label={`Xóa phí khác dòng ${i + 1}`}
                    onClick={() => emit(latest.current.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => emit([...latest.current, newFee()])}>
              <Plus /> Thêm phí khác
            </Button>
            <p className="text-xs text-muted-foreground">Loại phí chưa có thì gõ tên rồi bấm Thêm mới ngay trong ô chọn, chọn nhóm để lần sau hiện sẵn trong nhóm.</p>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
