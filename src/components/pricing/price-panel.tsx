"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { TruckRateMatrix } from "@/components/pricing/truck-rate-matrix";
import { cn } from "@/lib/utils";
import { formatDate, formatNumber } from "@/lib/format";
import { quoteTruck, toNum } from "@/lib/truck-rate";
import { getShipmentPriceOptions, type PriceOptions } from "@/lib/pricing/price-actions";

type Tab = "cont" | "truck" | "route";

/**
 * Bảng giá phù hợp với chuyến (xe cont của khách hàng, xe tải, theo tuyến): bấm "Lấy giá" để điền Đơn giá (chưa dầu) và % hỗ trợ dầu.
 * Dùng trong khung Nhập cước (Điều phối, Quản lý chuyến xe, chi tiết chuyến).
 */
export function PricePanel({ shipmentId, fuel, onChoose }: { shipmentId: string; fuel: number | null; onChoose: (unitPrice: number, fuelRate: number | null, label: string) => void }) {
  const [opts, setOpts] = useState<PriceOptions | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("cont");
  const [cardId, setCardId] = useState("");
  const [calc, setCalc] = useState({ km: "", tons: "", fuel: "" });

  useEffect(() => {
    let alive = true;
    getShipmentPriceOptions(shipmentId).then((r) => {
      if (!alive) return;
      if (!r.ok || !r.data) return setErr(r.ok ? "Không tải được bảng giá." : r.error);
      const o = r.data;
      setOpts(o);
      setCardId(o.truckCards[0]?.id ?? "");
      setCalc({ km: o.shipment.distance_km === null ? "" : String(o.shipment.distance_km), tons: o.shipment.tons === null ? "" : String(o.shipment.tons), fuel: "" });
      setTab(o.shipment.is_container ? "cont" : o.truckCards.length ? "truck" : o.cont.length ? "cont" : "route");
    });
    return () => {
      alive = false;
    };
  }, [shipmentId]);

  const card = opts?.truckCards.find((c) => c.id === cardId) ?? null;
  const quote = useMemo(() => (card ? quoteTruck(card, { km: toNum(calc.km), tons: toNum(calc.tons), fuelPrice: toNum(calc.fuel) }) : null), [card, calc]);
  const choose = onChoose;

  if (err)
    return (
      <Alert variant="destructive">
        <AlertDescription>{err}</AlertDescription>
      </Alert>
    );
  if (!opts)
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Đang tải bảng giá…
      </div>
    );
  const s = opts.shipment;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {s.customer_name} · {s.pickup_name} → {s.delivery_name}
        {s.empty_return_name ? ` → hạ rỗng ${s.empty_return_name}` : ""} · {formatDate(s.trip_date)}
        {s.container_no ? ` · Cont ${s.container_no}${s.container_size ? ` (${s.container_size}')` : ""}` : ""}
        {s.tons !== null ? ` · ${formatNumber(s.tons)} tấn` : ""}
      </p>
      {opts.missingTables ? (
        <Alert>
          <AlertDescription>Chưa có bảng giá xe tải / xe cont: cần chạy file nâng cấp SQL 9022 trong Supabase.</AlertDescription>
        </Alert>
      ) : null}
            <div className="flex flex-wrap gap-1 border-b">
        {(
          [
            ["cont", `Xe cont (${opts.cont.filter((c) => c.match > 0).length}/${opts.cont.length})`],
            ["truck", `Xe tải (${opts.truckCards.length})`],
            ["route", `Theo tuyến (${opts.routePrices.length})`],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn("-mb-px border-b-2 px-4 py-2 text-sm", tab === k ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "cont" ? (
        opts.cont.length ? (
          <div className="max-h-[45vh] overflow-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr className="[&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold [&>th]:whitespace-nowrap">
                  <th>Điểm nhận</th>
                  <th>Điểm giao</th>
                  <th>Điểm hạ rỗng</th>
                  <th>Cont</th>
                  <th className="!text-right">Đơn giá chưa dầu</th>
                  <th className="!text-right">% dầu</th>
                  <th className="!text-right">Số chuyến</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {opts.cont.map((c) => (
                  <tr key={c.id} className={cn("border-b [&>td]:px-3 [&>td]:py-2", c.match === 3 ? "bg-primary/10" : c.match > 0 ? "bg-primary/5" : undefined)}>
                    <td>{c.pickup_name}</td>
                    <td>{c.delivery_name}</td>
                    <td>{c.empty_return_name ?? "–"}</td>
                    <td>{c.container_size ? `${c.container_size}'` : "–"}</td>
                    <td className="text-right font-semibold tabular-nums">{formatNumber(c.unit_price)}</td>
                    <td className="text-right tabular-nums">{c.fuel_support_rate === null ? "–" : `${formatNumber(c.fuel_support_rate)}%`}</td>
                    <td className="text-right tabular-nums">{formatNumber(c.trip_count)}</td>
                    <td className="text-right whitespace-nowrap">
                      {c.match === 3 ? <Badge variant="success" className="mr-2">Đúng tuyến</Badge> : c.match > 0 ? <Badge variant="warning" className="mr-2">Gần đúng</Badge> : null}
                      <Button size="sm" variant={c.match === 3 ? "default" : "outline"} onClick={() => choose(c.unit_price, c.fuel_support_rate ?? fuel, `bảng giá xe cont ${c.pickup_name} → ${c.delivery_name}`)}>
                        Lấy giá
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyNote href="/bang-gia/xe-cont" text="Khách hàng này chưa có bảng giá xe cont." link="Lấy giá từ chuyến đã chạy" />
        )
      ) : null}

      {tab === "truck" ? (
        card ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-4 lg:col-span-1">
                <Label>Bảng giá</Label>
                <NativeSelect value={cardId} onChange={(e) => setCardId(e.target.value)}>
                  {opts.truckCards.map((c) => (
                    <option key={c.id!} value={c.id!}>
                      {c.name}
                      {c.customer_name ? ` · ${c.customer_name}` : ""}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fp-km">Quãng đường (km)</Label>
                <Input id="fp-km" inputMode="decimal" value={calc.km} placeholder={opts.shipment.distance_km === null ? "chưa có km của tuyến" : undefined} onChange={(e) => setCalc((x) => ({ ...x, km: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fp-tons">Trọng lượng (tấn)</Label>
                <Input id="fp-tons" inputMode="decimal" value={calc.tons} onChange={(e) => setCalc((x) => ({ ...x, tons: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fp-fuel">Giá dầu (tùy chọn)</Label>
                <Input id="fp-fuel" inputMode="decimal" value={calc.fuel} placeholder="đ/lít" onChange={(e) => setCalc((x) => ({ ...x, fuel: e.target.value }))} />
              </div>
            </div>
            {quote ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {quote.warnings.length ? <span className="text-destructive">{quote.warnings.join(" ")}</span> : null}
                {quote.unitPrice !== null ? (
                  <>
                    <span>
                      Ô đang tô: đơn giá chưa dầu <b>{formatNumber(quote.unitPrice)}</b>, dầu {formatNumber(quote.fuelPct)}%, cước <b>{formatNumber(quote.freight)}</b>
                      {quote.loadingFee !== null ? `, phí bốc xếp ${formatNumber(quote.loadingFee)}` : ""}
                    </span>
                    <Button size="sm" onClick={() => choose(quote.unitPrice!, quote.fuelPct, `${card.name}: ${card.distance_bands[quote.distanceIndex].label}, ${card.weight_bands[quote.weightIndex].label}`)}>
                      Lấy giá ô này
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">Bảng hiện đơn giá CHƯA hỗ trợ dầu. Bấm vào ô bất kỳ để lấy giá ô đó; % dầu lấy theo giá dầu nhập ở trên (để trống thì dùng % dầu mặc định của bảng giá).</p>
            <div className="max-h-[40vh] overflow-auto">
              <TruckRateMatrix
                card={card}
                mode="base"
                fuelPct={quote?.fuelPct ?? card.default_fuel_pct}
                highlight={quote && quote.distanceIndex >= 0 && quote.weightIndex >= 0 ? { di: quote.distanceIndex, wi: quote.weightIndex } : null}
                onPick={(i, j) => {
                  const raw = card.prices[i]?.[j];
                  if (raw === null || raw === undefined) return;
                  choose(raw, quote?.fuelPct ?? card.default_fuel_pct, `${card.name}: ${card.distance_bands[i].label}, ${card.weight_bands[j].label}`);
                }}
              />
            </div>
          </div>
        ) : (
          <EmptyNote href="/bang-gia/xe-tai" text="Chưa có bảng giá xe tải đang hiệu lực." link="Mở bảng giá xe tải" />
        )
      ) : null}

      {tab === "route" ? (
        opts.routePrices.length ? (
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted">
              <tr className="[&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold">
                <th>Mã</th>
                <th className="!text-right">Đơn giá</th>
                <th>Đơn vị</th>
                <th className="!text-right">% dầu</th>
                <th>Hiệu lực</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {opts.routePrices.map((p) => (
                <tr key={p.id} className="border-b [&>td]:px-3 [&>td]:py-2">
                  <td>{p.code}</td>
                  <td className="text-right font-semibold tabular-nums">{formatNumber(p.unit_price)}</td>
                  <td>{p.pricing_unit === "trip" ? "chuyến" : p.pricing_unit === "ton" ? "tấn" : p.pricing_unit}</td>
                  <td className="text-right tabular-nums">{p.fuel_support_rate === null ? "–" : `${formatNumber(p.fuel_support_rate)}%`}</td>
                  <td>
                    {formatDate(p.effective_from)}
                    {p.effective_to ? ` – ${formatDate(p.effective_to)}` : ""}
                  </td>
                  <td className="text-right">
                    <Button size="sm" variant="outline" onClick={() => choose(p.unit_price, p.fuel_support_rate ?? fuel, `bảng giá theo tuyến ${p.code}`)}>
                      Lấy giá
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyNote href="/bang-gia" text="Không có bảng giá theo tuyến khớp với chuyến này." link="Mở bảng giá theo tuyến" />
        )
      ) : null}
    </div>
  );
}

function EmptyNote({ text, href, link }: { text: string; href: string; link: string }) {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">
      {text}{" "}
      <Link href={href} target="_blank" className="text-primary underline">
        {link}
      </Link>
    </p>
  );
}
