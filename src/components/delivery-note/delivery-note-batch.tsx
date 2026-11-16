"use client";

import { useEffect, useState } from "react";
import { GHA_YARD_RECEIVER, noteBatchBaseName, type DeliveryNoteData } from "@/lib/delivery-note";
import { DeliveryNoteSheet } from "./delivery-note-sheet";
import { DeliveryNoteToolbar } from "./delivery-note-toolbar";

const RECEIVER_KEY = "gha.phieu.nguoi-nhan-bai-xe";

/**
 * Xem trước và in nhiều phiếu giao hàng: bỏ chọn chuyến không cần in, mỗi phiếu ra một trang A4.
 * confirm: bản xác nhận đã nhận hàng (hàng về Bãi xe GHA), mã chuyến -> giờ nhận đã định dạng.
 */
export function DeliveryNoteBatch({
  notes,
  backHref,
  confirm,
}: {
  notes: { id: string; d: DeliveryNoteData }[];
  backHref: string;
  confirm?: Record<string, string>;
}) {
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const [receiver, setReceiver] = useState(GHA_YARD_RECEIVER);
  useEffect(() => {
    try {
      const v = localStorage.getItem(RECEIVER_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- đọc tên đã lưu sau khi dựng trang (không có ở máy chủ)
      if (v) setReceiver(v);
    } catch {}
  }, []);
  const saveReceiver = (v: string) => {
    setReceiver(v);
    try {
      localStorage.setItem(RECEIVER_KEY, v);
    } catch {}
  };
  const picked = notes.filter((n) => !off.has(n.id));
  const toggle = (id: string) =>
    setOff((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="min-h-screen bg-muted/50 p-4 print:bg-white print:p-0">
      <DeliveryNoteToolbar backHref={backHref} name={noteBatchBaseName(picked.map((n) => n.d))} count={picked.length} />
      {confirm && notes.length > 0 ? (
        <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center gap-2 rounded-lg border border-[#c8102e]/40 bg-card p-3 text-sm print:hidden">
          <b className="text-[#c8102e]">Bản xác nhận đã nhận hàng tại Bãi xe GHA</b>
          <label className="ml-auto flex items-center gap-2">
            Người nhận
            <input
              className="h-8 w-48 rounded-md border bg-background px-2"
              value={receiver}
              maxLength={60}
              onChange={(e) => saveReceiver(e.target.value)}
              aria-label="Người nhận in trên dấu xác nhận"
            />
          </label>
          <span className="w-full text-xs text-muted-foreground">Ngày giờ nhận lấy theo lúc tài xế báo giao xong; chuyến chưa có giờ thì để chấm để ghi tay. Ô ký để trống để người nhận ký tay.</span>
        </div>
      ) : null}
      {notes.length === 0 ? (
        <p className="mx-auto max-w-[210mm] rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">Không có chuyến nào để in phiếu giao hàng.</p>
      ) : (
        <div className={`mx-auto mb-4 max-w-[210mm] rounded-lg border bg-card p-3 text-sm print:hidden ${notes.length === 1 ? "hidden" : ""}`}>
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <b>
              Đã chọn {picked.length}/{notes.length} phiếu
            </b>
            <button type="button" className="text-primary hover:underline" onClick={() => setOff(new Set())}>
              Chọn tất cả
            </button>
            <button type="button" className="text-primary hover:underline" onClick={() => setOff(new Set(notes.map((n) => n.id)))}>
              Bỏ chọn tất cả
            </button>
            <span className="text-muted-foreground">Bỏ dấu chuyến không cần in. Mỗi phiếu in ra một trang A4.</span>
          </div>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">
            {notes.map((n) => (
              <label
                key={n.id}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 hover:bg-muted has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5"
                title={[n.d.plate_number, n.d.driver_name, n.d.delivery_company || n.d.delivery_name].filter(Boolean).join(" · ")}
              >
                <input type="checkbox" className="size-4 accent-primary" checked={!off.has(n.id)} onChange={() => toggle(n.id)} />
                <span className="font-medium">{n.d.shipment_code}</span>
                {n.d.plate_number ? <span className="text-xs text-muted-foreground">{n.d.plate_number}</span> : null}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="dn-batch">
        {picked.map((n) => (
          <DeliveryNoteSheet key={n.id} d={n.d} confirm={confirm && n.id in confirm ? { receiver, receivedAt: confirm[n.id] } : undefined} />
        ))}
      </div>
    </div>
  );
}
