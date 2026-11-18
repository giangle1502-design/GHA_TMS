"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Calculator, Copy, FileDown, FileUp, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { ReferenceSelect } from "@/components/entities/reference-select";
import { NumInput } from "@/components/pricing/num-input";
import { TruckRateMatrix, type MatrixMode } from "@/components/pricing/truck-rate-matrix";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { blankCard, quoteTruck, toNum, validateCard, type TruckRateCard } from "@/lib/truck-rate";
import { downloadRateWorkbook, readRateWorkbook } from "@/lib/truck-rate-excel";
import { deleteTruckRateCard, saveTruckRateCard } from "./actions";

const clone = (c: TruckRateCard): TruckRateCard => JSON.parse(JSON.stringify(c));

export function TruckRates({
  cards,
  initialId,
  today,
  canCreate,
  canUpdate,
  canDelete,
}: {
  cards: TruckRateCard[];
  initialId: string | null;
  today: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(() => cards.find((c) => c.id === initialId)?.id ?? cards[0]?.id ?? null);
  const [draft, setDraft] = useState<TruckRateCard | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [mode, setMode] = useState<MatrixMode>("base");
  const [calc, setCalc] = useState({ km: "", tons: "", fuel: "" });
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = cards.find((c) => c.id === selectedId) ?? null;
  const card = draft ?? selected;
  const editing = draft !== null;

  const quote = useMemo(() => {
    if (!card) return null;
    const km = toNum(calc.km);
    const tons = toNum(calc.tons);
    if (km === null && tons === null) return null;
    return quoteTruck(card, { km, tons, fuelPrice: toNum(calc.fuel) });
  }, [card, calc]);
  const fuelPct = quote?.fuelPct ?? card?.default_fuel_pct ?? 0;

  const pick = (id: string) => {
    if (editing && !confirm("Bỏ các thay đổi chưa lưu?")) return;
    setDraft(null);
    setImportWarnings([]);
    setSelectedId(id);
    router.replace(`/bang-gia/xe-tai?id=${id}`, { scroll: false });
  };

  const update = (fn: (c: TruckRateCard) => void) =>
    setDraft((d) => {
      if (!d) return d;
      const n = clone(d);
      fn(n);
      return n;
    });

  const save = () => {
    if (!draft) return;
    const errs = validateCard(draft);
    if (errs.length) return void toast.error(errs[0]);
    start(async () => {
      const r = await saveTruckRateCard(draft);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Đã lưu.");
      setDraft(null);
      setImportWarnings([]);
      if (r.data?.id) {
        setSelectedId(r.data.id);
        router.replace(`/bang-gia/xe-tai?id=${r.data.id}`, { scroll: false });
      }
      router.refresh();
    });
  };

  const remove = () => {
    if (!selected?.id || !confirm(`Xóa bảng giá "${selected.name}"?`)) return;
    start(async () => {
      const r = await deleteTruckRateCard(selected.id!);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Đã xóa.");
      setSelectedId(cards.find((c) => c.id !== selected.id)?.id ?? null);
      router.refresh();
    });
  };

  const importFile = async (f: File) => {
    try {
      const parsed = await readRateWorkbook(await f.arrayBuffer(), f.name, today);
      setDraft(parsed.card);
      setImportWarnings(parsed.warnings);
      toast.success(`Đã đọc ${parsed.card.distance_bands.length} khoảng km × ${parsed.card.weight_bands.length} trọng tải. Kiểm tra rồi bấm Lưu.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Không đọc được file.");
    }
  };

  return (
    <div className="space-y-4">
      {/* Thanh chọn bảng giá + thao tác */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-72 flex-1 space-y-1.5">
          <Label>Bảng giá</Label>
          {editing && !draft?.id ? (
            <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-sm text-muted-foreground">Bảng giá mới (chưa lưu)</div>
          ) : (
            <NativeSelect value={selectedId ?? ""} onChange={(e) => pick(e.target.value)} disabled={!cards.length}>
              {!cards.length ? <option value="">Chưa có bảng giá</option> : null}
              {cards.map((c) => (
                <option key={c.id!} value={c.id!}>
                  {`${c.code} · ${c.name}${c.customer_name ? ` · ${c.customer_name}` : ""}${c.status === "inactive" ? " (ngừng)" : ""}`}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
        {editing ? (
          <>
            <Button onClick={save} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Save />} Lưu
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDraft(null);
                setImportWarnings([]);
              }}
              disabled={pending}
            >
              <X /> Hủy
            </Button>
          </>
        ) : (
          <>
            {canUpdate && selected ? (
              <Button variant="outline" onClick={() => setDraft(clone(selected))}>
                <Pencil /> Sửa
              </Button>
            ) : null}
            {canCreate ? (
              <>
                <Button variant="outline" onClick={() => setDraft(blankCard(today))}>
                  <Plus /> Thêm mới
                </Button>
                {selected ? (
                  <Button variant="outline" onClick={() => setDraft(blankCard(today, selected))} title="Tạo bảng giá mới cùng khung km, trọng tải, giá (vd cho khách hàng khác hoặc kỳ giá mới)">
                    <Copy /> Sao chép
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => fileRef.current?.click()} title="Đọc file theo mẫu BANG_GIA_NOI_BO.xlsx">
                  <FileUp /> Nhập từ Excel
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void importFile(f);
                  }}
                />
              </>
            ) : null}
            {selected ? (
              <Button variant="outline" onClick={() => void downloadRateWorkbook(selected)}>
                <FileDown /> Tải Excel
              </Button>
            ) : null}
            {canDelete && selected ? (
              <Button variant="outline" className="text-destructive" onClick={remove} disabled={pending}>
                <Trash2 /> Xóa
              </Button>
            ) : null}
          </>
        )}
      </div>

      {importWarnings.length ? (
        <Alert>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {importWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {!card ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Chưa có bảng giá xe tải. Bấm <b>Nhập từ Excel</b> để đọc file bảng giá nội bộ, hoặc <b>Thêm mới</b>.
          </CardContent>
        </Card>
      ) : (
        <>
          {editing ? <CardInfoEditor card={card} update={update} /> : <CardInfo card={card} />}

          {/* Tính cước nhanh */}
          {!editing ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Calculator className="size-4" /> Tính cước
                </CardTitle>
                <CardDescription>Nhập quãng đường và trọng lượng để tìm ô giá. Nhập giá dầu để tính % hỗ trợ dầu theo bảng hệ số; để trống thì dùng % dầu mặc định của bảng giá.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="calc-km">Quãng đường (km)</Label>
                    <Input id="calc-km" inputMode="decimal" value={calc.km} onChange={(e) => setCalc((s) => ({ ...s, km: e.target.value }))} placeholder="vd 32" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="calc-tons">Trọng lượng (tấn)</Label>
                    <Input id="calc-tons" inputMode="decimal" value={calc.tons} onChange={(e) => setCalc((s) => ({ ...s, tons: e.target.value }))} placeholder="vd 4.2" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="calc-fuel">Giá dầu (đ/lít, tùy chọn)</Label>
                    <Input id="calc-fuel" inputMode="decimal" value={calc.fuel} onChange={(e) => setCalc((s) => ({ ...s, fuel: e.target.value }))} placeholder="vd 23,500" />
                  </div>
                </div>
                {quote ? <QuoteResult quote={quote} card={card} /> : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Bảng cước */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Bảng đơn giá vận chuyển chưa hỗ trợ dầu (đ/chuyến)</CardTitle>
                {!editing ? (
                  <div className="flex flex-wrap gap-1 rounded-md border p-0.5 text-sm">
                    {(
                      [
                        ["base", "Đơn giá chưa dầu"],
                        ["fuel", `Cước theo % dầu ${formatNumber(fuelPct)}%`],
                      ] as const
                    ).map(([k, l]) => (
                      <button
                        key={k}
                        type="button"
                        className={`rounded px-3 py-1 ${mode === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                        onClick={() => setMode(k)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {editing ? (
                <MatrixEditor card={card} update={update} />
              ) : (
                <TruckRateMatrix card={card} mode={mode} fuelPct={fuelPct} highlight={quote && quote.distanceIndex >= 0 && quote.weightIndex >= 0 ? { di: quote.distanceIndex, wi: quote.weightIndex } : null} />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <LoadingFees card={card} editing={editing} update={update} highlight={quote?.weightIndex ?? -1} />
            <FuelBands card={card} editing={editing} update={update} fuelPrice={toNum(calc.fuel)} />
          </div>
        </>
      )}
    </div>
  );
}

function QuoteResult({ quote, card }: { quote: ReturnType<typeof quoteTruck>; card: TruckRateCard }) {
  const d = card.distance_bands[quote.distanceIndex];
  const w = card.weight_bands[quote.weightIndex];
  return (
    <div className="space-y-2">
      {quote.warnings.length ? (
        <Alert variant="destructive">
          <AlertDescription>{quote.warnings.join(" ")}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ô giá" value={d && w ? `${d.label} · ${w.label}` : "–"} />
        <Stat label="Đơn giá chưa dầu" value={quote.unitPrice === null ? "–" : formatVND(quote.unitPrice)} strong />
        <Stat label={`Cước = Đơn giá × (1 + ${formatNumber(quote.fuelPct)}%)`} value={quote.freight === null ? "–" : formatVND(quote.freight)} strong />
        <Stat label="Phí bốc xếp" value={quote.loadingFee === null ? "–" : formatVND(quote.loadingFee)} />
      </div>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={strong ? "text-lg font-semibold tabular-nums" : "text-base tabular-nums"}>{value}</div>
    </div>
  );
}

function CardInfo({ card }: { card: TruckRateCard }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border bg-card px-4 py-3 text-sm">
      <span className="text-base font-semibold">{card.name}</span>
      <span>
        Áp dụng: <b>{card.customer_name ?? "Nội bộ, mọi khách hàng"}</b>
      </span>
      <span>
        Giá trong bảng: <b>đơn giá chưa hỗ trợ dầu</b> · % dầu mặc định: <b>{formatNumber(card.default_fuel_pct)}%</b>
      </span>
      <span>
        Hiệu lực: <b>{formatDate(card.effective_from)}</b>
        {card.effective_to ? ` – ${formatDate(card.effective_to)}` : ""}
      </span>
      <Badge variant={card.status === "active" ? "success" : "muted"}>{card.status === "active" ? "Đang dùng" : "Ngừng dùng"}</Badge>
      {card.notes ? <span className="w-full text-muted-foreground">{card.notes}</span> : null}
    </div>
  );
}

function CardInfoEditor({ card, update }: { card: TruckRateCard; update: (fn: (c: TruckRateCard) => void) => void }) {
  return (
    <Card>
      <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="rc-name">Tên bảng giá</Label>
          <Input id="rc-name" value={card.name} onChange={(e) => update((c) => void (c.name = e.target.value))} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Khách hàng (trống = nội bộ, dùng chung)</Label>
          <ReferenceSelect
            refKey="customers"
            value={card.customer_id ?? ""}
            initialLabel={card.customer_name ?? undefined}
            allowQuickCreate={false}
            onChange={(v, l) =>
              update((c) => {
                c.customer_id = v || null;
                c.customer_name = v ? l : null;
              })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label title="Dùng khi tính cước mà không nhập giá dầu">% hỗ trợ dầu mặc định</Label>
          <NumInput value={card.default_fuel_pct} allowEmpty={false} className="h-9" onChange={(v) => update((c) => void (c.default_fuel_pct = v ?? 0))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rc-from">Hiệu lực từ</Label>
          <Input id="rc-from" type="date" value={card.effective_from} onChange={(e) => update((c) => void (c.effective_from = e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rc-to">Đến (trống = không hạn)</Label>
          <Input id="rc-to" type="date" value={card.effective_to ?? ""} onChange={(e) => update((c) => void (c.effective_to = e.target.value || null))} />
        </div>
        <div className="space-y-1.5">
          <Label>Trạng thái</Label>
          <NativeSelect value={card.status} onChange={(e) => update((c) => void (c.status = e.target.value as "active" | "inactive"))}>
            <option value="active">Đang dùng</option>
            <option value="inactive">Ngừng dùng</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
          <Label htmlFor="rc-notes">Ghi chú</Label>
          <Textarea id="rc-notes" className="min-h-12" value={card.notes ?? ""} onChange={(e) => update((c) => void (c.notes = e.target.value))} />
        </div>
      </CardContent>
    </Card>
  );
}

function MatrixEditor({ card, update }: { card: TruckRateCard; update: (fn: (c: TruckRateCard) => void) => void }) {
  const addRow = () =>
    update((c) => {
      const last = c.distance_bands.at(-1);
      const from = last ? last.to_km + 0.001 : 0;
      const to = last ? last.to_km + 10 : 15;
      c.distance_bands.push({ from_km: from, to_km: to, label: `Từ ${formatNumber(Math.floor(from))} - ${formatNumber(to)} KM` });
      c.prices.push(c.weight_bands.map(() => null));
    });
  const addCol = () =>
    update((c) => {
      const last = c.weight_bands.at(-1);
      const from = last ? last.to_ton + 0.001 : 0;
      const to = last ? last.to_ton + 5 : 2.5;
      c.weight_bands.push({ from_ton: from, to_ton: to, label: `${formatNumber(Math.floor(from))} - ${formatNumber(to)} tấn`, loading_fee: null });
      c.prices.forEach((r) => r.push(null));
    });
  return (
    <div className="space-y-2">
      <div className="overflow-auto rounded-md border">
        <table className="border-collapse text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="border-r border-b px-2 py-1.5 text-left">Từ (km)</th>
              <th className="border-r border-b px-2 py-1.5 text-left">Đến (km)</th>
              <th className="border-r border-b px-2 py-1.5 text-left">Khoảng cách</th>
              {card.weight_bands.map((w, j) => (
                <th key={j} className="min-w-36 border-r border-b px-1 py-1 align-top">
                  <Input className="h-8 text-center font-semibold" value={w.label} onChange={(e) => update((c) => void (c.weight_bands[j].label = e.target.value))} />
                  <div className="mt-1 flex items-center gap-1 text-xs font-normal">
                    <NumInput value={w.from_ton} allowEmpty={false} aria-label="Từ tấn" onChange={(v) => update((c) => void (c.weight_bands[j].from_ton = v ?? 0))} />
                    <span>–</span>
                    <NumInput value={w.to_ton} allowEmpty={false} aria-label="Đến tấn" onChange={(v) => update((c) => void (c.weight_bands[j].to_ton = v ?? 0))} />
                    <button
                      type="button"
                      className="text-destructive"
                      title="Xóa cột"
                      onClick={() =>
                        update((c) => {
                          c.weight_bands.splice(j, 1);
                          c.prices.forEach((r) => r.splice(j, 1));
                        })
                      }
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="border-b px-2" />
            </tr>
          </thead>
          <tbody>
            {card.distance_bands.map((d, i) => (
              <tr key={i} className="border-b">
                <td className="w-24 border-r p-1">
                  <NumInput value={d.from_km} allowEmpty={false} onChange={(v) => update((c) => void (c.distance_bands[i].from_km = v ?? 0))} />
                </td>
                <td className="w-24 border-r p-1">
                  <NumInput value={d.to_km} allowEmpty={false} onChange={(v) => update((c) => void (c.distance_bands[i].to_km = v ?? 0))} />
                </td>
                <td className="w-40 border-r p-1">
                  <Input className="h-8" value={d.label} onChange={(e) => update((c) => void (c.distance_bands[i].label = e.target.value))} />
                </td>
                {card.weight_bands.map((_, j) => (
                  <td key={j} className="border-r p-1">
                    <NumInput value={card.prices[i]?.[j] ?? null} onChange={(v) => update((c) => void (c.prices[i][j] = v))} />
                  </td>
                ))}
                <td className="px-1">
                  <button
                    type="button"
                    className="text-destructive"
                    title="Xóa dòng"
                    onClick={() =>
                      update((c) => {
                        c.distance_bands.splice(i, 1);
                        c.prices.splice(i, 1);
                      })
                    }
                  >
                    <X className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={addRow}>
          <Plus /> Thêm khoảng km
        </Button>
        <Button size="sm" variant="outline" onClick={addCol}>
          <Plus /> Thêm cột trọng tải
        </Button>
      </div>
    </div>
  );
}

function LoadingFees({ card, editing, update, highlight }: { card: TruckRateCard; editing: boolean; update: (fn: (c: TruckRateCard) => void) => void; highlight: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Phí bốc xếp theo trọng tải</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="border px-3 py-2 text-left">Trọng tải</th>
              <th className="border px-3 py-2 text-right">Từ (tấn)</th>
              <th className="border px-3 py-2 text-right">Đến (tấn)</th>
              <th className="border px-3 py-2 text-right">Phí bốc xếp</th>
            </tr>
          </thead>
          <tbody>
            {card.weight_bands.map((w, j) => (
              <tr key={j} className={highlight === j ? "bg-primary/10 font-semibold" : undefined}>
                <td className="border px-3 py-1.5">{w.label}</td>
                <td className="border px-3 py-1.5 text-right tabular-nums">{formatNumber(w.from_ton)}</td>
                <td className="border px-3 py-1.5 text-right tabular-nums">{formatNumber(w.to_ton)}</td>
                <td className="border px-1 py-1 text-right tabular-nums">
                  {editing ? (
                    <NumInput value={w.loading_fee} onChange={(v) => update((c) => void (c.weight_bands[j].loading_fee = v))} />
                  ) : (
                    <span className="px-2">{w.loading_fee === null ? "–" : formatNumber(w.loading_fee)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function FuelBands({ card, editing, update, fuelPrice }: { card: TruckRateCard; editing: boolean; update: (fn: (c: TruckRateCard) => void) => void; fuelPrice: number | null }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Hệ số hỗ trợ dầu theo giá dầu</CardTitle>
        <CardDescription>Hệ số 1.2 = cộng 20% hỗ trợ dầu. Giá dầu tính theo đ/lít.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="border px-3 py-2 text-right">Từ (đ)</th>
              <th className="border px-3 py-2 text-right">Đến (đ)</th>
              <th className="border px-3 py-2 text-right">Hệ số</th>
              <th className="border px-3 py-2 text-right">% hỗ trợ dầu</th>
              {editing ? <th className="border" /> : null}
            </tr>
          </thead>
          <tbody>
            {card.fuel_bands.map((b, i) => {
              const hit = fuelPrice !== null && fuelPrice >= b.from_price && fuelPrice <= b.to_price;
              const pctIncluded = Math.abs((b.factor - 1) * 100 - card.default_fuel_pct) < 0.001;
              return (
                <tr key={i} className={hit ? "bg-primary/10 font-semibold" : pctIncluded && !editing && card.default_fuel_pct ? "bg-amber-50 dark:bg-amber-950/30" : undefined}>
                  {editing ? (
                    <>
                      <td className="border p-1">
                        <NumInput value={b.from_price} allowEmpty={false} onChange={(v) => update((c) => void (c.fuel_bands[i].from_price = v ?? 0))} />
                      </td>
                      <td className="border p-1">
                        <NumInput value={b.to_price} allowEmpty={false} onChange={(v) => update((c) => void (c.fuel_bands[i].to_price = v ?? 0))} />
                      </td>
                      <td className="border p-1">
                        <NumInput value={b.factor} allowEmpty={false} onChange={(v) => update((c) => void (c.fuel_bands[i].factor = v ?? 1))} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="border px-3 py-1.5 text-right tabular-nums">{formatNumber(b.from_price)}</td>
                      <td className="border px-3 py-1.5 text-right tabular-nums">{formatNumber(b.to_price)}</td>
                      <td className="border px-3 py-1.5 text-right tabular-nums">{formatNumber(b.factor)}</td>
                    </>
                  )}
                  <td className="border px-3 py-1.5 text-right tabular-nums">
                    {formatNumber(Math.round((b.factor - 1) * 10000) / 100)}%{pctIncluded && !editing && card.default_fuel_pct ? " (mặc định)" : ""}
                  </td>
                  {editing ? (
                    <td className="border px-1">
                      <button type="button" className="text-destructive" title="Xóa dòng" onClick={() => update((c) => void c.fuel_bands.splice(i, 1))}>
                        <X className="size-4" />
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
            {!card.fuel_bands.length ? (
              <tr>
                <td colSpan={5} className="border px-3 py-3 text-center text-muted-foreground">
                  Chưa có bảng hệ số.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {editing ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              update((c) => {
                const last = c.fuel_bands.at(-1);
                c.fuel_bands.push({ from_price: last ? last.to_price + 1 : 19250, to_price: last ? last.to_price + 4000 : 21999, factor: last ? Math.round((last.factor + 0.05) * 100) / 100 : 1 });
              })
            }
          >
            <Plus /> Thêm dòng
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
