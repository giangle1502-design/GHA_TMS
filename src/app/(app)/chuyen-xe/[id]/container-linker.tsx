"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { setContainerPrev } from "../container-actions";

export type ContainerCandidate = { id: string; code: string; container_no: string | null; plate: string | null; days_kept: number };

/** Chọn "Dùng vỏ từ chuyến…" (chuyến giữ vỏ chưa trả rỗng) hoặc gỡ nối */
export function ContainerLinker({ shipmentId, code, prevId, candidates }: { shipmentId: string; code: string; prevId: string | null; candidates: ContainerCandidate[] }) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [pending, start] = useTransition();

  const run = (prev: string | null) =>
    start(async () => {
      const r = await setContainerPrev(shipmentId, prev);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setPick("");
      router.refresh();
    });

  if (prevId) {
    return (
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => run(null)} aria-label={`Gỡ nối vỏ ${code}`}>
        Gỡ nối vỏ khỏi chuyến trước
      </Button>
    );
  }
  if (!candidates.length) {
    return <p className="text-xs text-muted-foreground">Chưa có vỏ nào đang giữ (tài xế chọn &quot;Giữ vỏ cho chuyến sau&quot; khi hoàn thành chuyến).</p>;
  }
  return (
    <div className="space-y-2 border-t pt-3">
      <label htmlFor={`cont-prev-${shipmentId}`} className="block text-sm font-medium">
        Dùng vỏ từ chuyến…
      </label>
      <div className="flex gap-2">
        <NativeSelect id={`cont-prev-${shipmentId}`} value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1">
          <option value="">Chọn chuyến đang giữ vỏ…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code}
              {c.container_no ? ` · ${c.container_no}` : ""}
              {c.plate ? ` · ${c.plate}` : ""}
              {` · giữ ${c.days_kept} ngày`}
            </option>
          ))}
        </NativeSelect>
        <Button type="button" size="sm" disabled={!pick || pending} onClick={() => run(pick)}>
          Nối vỏ
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Chuyến này nhận số cont của chuyến trước; trả rỗng, cược cont ghi về chuyến đầu của vỏ.</p>
    </div>
  );
}
