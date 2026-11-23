"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, ClipboardPaste, ImageUp, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { deliveryNoteSummary, parseDeliveryNoteText, type ParsedDeliveryNote } from "@/lib/delivery-note-parse";
import { matchDeliveryNote, type NoteMatch } from "./note-actions";

export type NoteFill = { note: ParsedDeliveryNote; match: NoteMatch; summary: string };

/**
 * Đọc ảnh "Biên bản giao hàng" của khách (dán Ctrl+V, kéo thả hoặc chọn ảnh) ngay trên máy, rồi điền form Tạo đơn:
 * khách hàng (công ty bán), ngày, số đơn hàng, số phiếu, điểm giao (công ty mua), hàng hóa, ghi chú xe / tài xế.
 * Ảnh không được lưu. Không thêm gì vào danh mục: điểm giao chưa chắc thì người dùng chọn.
 */
export function NoteImageFill({ onFill, onPickLocation, pickedLocationId }: { onFill: (f: NoteFill) => void; onPickLocation: (id: string, label: string) => void; pickedLocationId: string }) {
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [res, setRes] = useState<NoteFill | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const fillRef = useRef(onFill);
  useEffect(() => {
    fillRef.current = onFill;
  });

  async function run(file: Blob) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setPct(0);
    try {
      const { ocrInvoiceText } = await import("@/lib/ocr-invoice");
      const text = await ocrInvoiceText(file, (p) => setPct(Math.round(p * 100)));
      const note = parseDeliveryNoteText(text);
      if (note.found.length < 2) {
        setRes(null);
        toast.error("Không đọc được biên bản giao hàng. Hãy dán ảnh rõ hơn, chụp nguyên phiếu.");
        return;
      }
      const m = await matchDeliveryNote({
        sellerName: note.seller.name.slice(0, 300),
        sellerTax: note.seller.taxCode.slice(0, 20),
        buyerName: note.buyer.name.slice(0, 300),
        buyerAddress: note.buyer.address.slice(0, 500),
        buyerTax: note.buyer.taxCode.slice(0, 20),
        itemCodes: note.items.map((i) => i.code.slice(0, 100)).slice(0, 50),
        orderNo: note.orderNo.slice(0, 100),
        voucherNo: note.voucherNo.slice(0, 100),
      });
      if (!m.ok || !m.data) return void toast.error(m.ok ? "Không ghép được với danh mục." : m.error);
      const fill = { note, match: m.data, summary: deliveryNoteSummary(note) };
      setRes(fill);
      fillRef.current(fill);
      toast.success(`Đã điền: ${note.found.join(", ")}. Kiểm tra lại trước khi lưu.`);
    } catch (e) {
      console.error(e);
      toast.error("Không đọc được ảnh. Lần đầu cần mạng để tải bộ đọc chữ (vài MB).");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      void run(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const n = res?.note;
  const m = res?.match;
  return (
    <div
      className="rounded-md border border-dashed bg-muted/30 p-3 text-sm"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
        if (f) void run(f);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardPaste className="size-4 text-muted-foreground" />
        <span className="flex-1">
          <b>Đọc ảnh biên bản giao hàng</b>: dán ảnh (Ctrl+V), kéo thả hoặc chọn ảnh để tự điền khách hàng, ngày giao, số đơn hàng, số phiếu, điểm giao, hàng hóa.
          Ảnh đọc ngay trên máy, không lưu.
        </span>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 className="animate-spin" /> : <ImageUp />} {busy ? `Đang đọc… ${pct}%` : "Chọn ảnh phiếu"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void run(f);
          }}
        />
      </div>

      {n && m ? (
        <div className="mt-3 space-y-2 border-t pt-2">
          {m.duplicates.length ? (
            <p className="flex items-start gap-1.5 rounded bg-amber-50 p-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Có thể trùng: đã có đơn{" "}
                {m.duplicates.map((d, i) => (
                  <span key={d.orderId}>
                    {i ? ", " : ""}
                    <Link className="font-medium underline" href={`/dieu-phoi/don-hang/${d.orderId}`} target="_blank">
                      {d.orderCode}
                    </Link>
                    {d.why ? ` (${d.why})` : ""}
                  </span>
                ))}
                . Kiểm tra trước khi lưu.
              </span>
            </p>
          ) : null}
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            <Info k="Công ty bán (khách hàng)" v={n.seller.name} ok={Boolean(m.customer)} miss="chưa có trong danh mục khách hàng, chọn tay" />
            <Info k="Ngày giao" v={n.date ? n.date.split("-").reverse().join("/") : ""} />
            <Info k="Số đơn hàng" v={n.orderNo} />
            <Info k="Số phiếu" v={n.voucherNo} />
            <Info k="Vận chuyển" v={[n.carrier, n.plate && `xe ${n.plate}`, n.driver && `tài xế ${n.driver}`].filter(Boolean).join(", ")} />
            <Info
              k="Hàng hóa"
              v={n.items
                .map((i) => `${i.code} ${i.quantity !== null ? formatNumber(i.quantity) : "?"} ${i.unit}${i.bags !== null ? ` / ${formatNumber(i.bags)} bao` : ""}${m.products[i.code] ? "" : " (mã chưa có trong danh mục)"}`)
                .join("; ")}
            />
          </dl>
          <div className="space-y-1">
            <p className="text-xs">
              <b>Điểm giao trên phiếu:</b> {n.buyer.name || "?"}
              {n.buyer.address ? ` – ${n.buyer.address}` : ""}
            </p>
            {m.locations.length ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {m.autoLocationId ? "Đã chọn điểm giao khớp tên và địa chỉ. Chọn dòng khác nếu sai:" : "Chưa chắc điểm nào đúng (địa chỉ khác phiếu hoặc nhiều điểm cùng tên). Chọn một điểm, hoặc bấm + ở ô Điểm giao để thêm mới:"}
                </p>
                {m.locations.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => onPickLocation(l.id, l.label)}
                    className={`flex w-full items-start gap-2 rounded border px-2 py-1.5 text-left text-xs hover:bg-muted ${pickedLocationId === l.id ? "border-primary bg-primary/5" : ""}`}
                  >
                    {pickedLocationId === l.id ? <Check className="mt-0.5 size-3.5 shrink-0 text-primary" /> : <span className="size-3.5 shrink-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{l.label}</span>
                      <span className="block text-muted-foreground">{l.address || "(chưa có địa chỉ)"}</span>
                    </span>
                    <span className={`shrink-0 ${l.score >= 0.6 || l.how === "tax" ? "text-emerald-700" : "text-amber-700"}`}>
                      {l.how === "tax" ? "trùng MST" : l.how === "alias" ? "đã ghép trước" : l.score >= 0.6 ? "địa chỉ khớp" : "địa chỉ khác"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-amber-700">Không tìm thấy điểm giao cùng tên trong danh mục: chọn tay ở ô Điểm giao, hoặc bấm + để thêm mới.</p>
            )}
            <p className="text-xs text-muted-foreground">Điểm nhận (kho xuất) phiếu không ghi: chọn ở ô Điểm nhận.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Info({ k, v, ok = true, miss }: { k: string; v: string; ok?: boolean; miss?: string }) {
  return (
    <div className="flex gap-1">
      <dt className="shrink-0 text-muted-foreground">{k}:</dt>
      <dd className="min-w-0 break-words">
        {v || <span className="text-amber-700">không đọc được</span>}
        {v && !ok && miss ? (
          <span className="ml-1 inline-flex items-center gap-0.5 text-amber-700">
            <X className="size-3" /> {miss}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
