"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HandCoins } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { cancelRequest, requestAdvance, signOutDriver } from "./actions";
import { Err, MoneyInput, bigBtn } from "../expense-forms";

type Trip = { id: string; label: string };

export function AdvanceButton({ trips }: { trips: Trip[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [trip, setTrip] = useState("");
  const [rid, setRid] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setDone(null); }} className={`${bigBtn} bg-primary text-primary-foreground`}>
        <HandCoins className="size-6" /> Xin ứng tiền
      </button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Xin ứng tiền</DialogTitle>
            <DialogDescription>Giám đốc duyệt, sau đó kế toán chuyển tiền. Cuối tháng tiền ứng được đối soát với chi phí và lương.</DialogDescription>
          </DialogHeader>
          {done ? (
            <div className="space-y-3">
              <p className="rounded-lg bg-success/10 p-3 text-sm">{done}</p>
              <button type="button" className={`${bigBtn} border bg-card`} onClick={() => setOpen(false)}>Xong</button>
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="adv-amount" className="mb-1 block text-sm font-medium">Số tiền cần ứng</label>
                <MoneyInput id="adv-amount" value={amount} onChange={setAmount} />
              </div>
              <div>
                <label htmlFor="adv-reason" className="mb-1 block text-sm font-medium">Lý do</label>
                <Textarea id="adv-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ví dụ: Ứng tiền dầu, cầu đường chuyến đi Bình Dương" />
              </div>
              <div>
                <label htmlFor="adv-trip" className="mb-1 block text-sm font-medium">Cho chuyến (không bắt buộc)</label>
                <NativeSelect id="adv-trip" value={trip} onChange={(e) => setTrip(e.target.value)} className="h-12">
                  <option value="">Không gắn chuyến</option>
                  {trips.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </NativeSelect>
              </div>
              <Err error={error} />
              <button
                type="button"
                disabled={pending}
                className={`${bigBtn} bg-primary text-primary-foreground`}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    if (!amount) return setError("Nhập số tiền cần ứng.");
                    if (!reason.trim()) return setError("Nhập lý do ứng tiền.");
                    const r = await requestAdvance({ amount, reason, shipmentId: trip || null, clientRequestId: rid });
                    if (!r.ok) return setError(r.error);
                    setDone("Đã gửi yêu cầu ứng tiền. Giám đốc sẽ duyệt, kế toán chuyển tiền sau khi duyệt.");
                    setAmount(null);
                    setReason("");
                    setTrip("");
                    setRid(crypto.randomUUID());
                    router.refresh();
                  })
                }
              >
                {pending ? "Đang gửi…" : "Gửi yêu cầu"}
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CancelRequestButton({ kind, id }: { kind: "advance" | "expense"; id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={kind === "advance" ? "mt-2" : ""}>
      <button
        type="button"
        disabled={pending}
        className="rounded-lg border px-3 py-1.5 text-sm text-destructive"
        onClick={() => {
          if (!confirm(kind === "advance" ? "Hủy yêu cầu này?" : "Hủy khoản chi phí này?")) return;
          start(async () => {
            const r = await cancelRequest(kind, id);
            if (!r.ok) setError(r.error);
            router.refresh();
          });
        }}
      >
        {pending ? "Đang hủy…" : kind === "advance" ? "Hủy yêu cầu" : "Hủy khoản"}
      </button>
      {error ? <p className="mt-1 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function SignOutDriverButton() {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(() => signOutDriver())} className="rounded-lg border px-3 py-1.5 text-sm">
      {pending ? "Đang thoát…" : "Đổi tài khoản"}
    </button>
  );
}
