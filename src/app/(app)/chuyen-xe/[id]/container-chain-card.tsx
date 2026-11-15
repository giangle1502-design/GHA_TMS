import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/server";
import { formatVND } from "@/lib/format";
import { shipmentStatus } from "@/lib/status";
import { ContainerLinker, type ContainerCandidate } from "./container-linker";

type ChainRow = { id: string; code: string; status: string; container_no: string | null; plate: string | null; state: "returned" | "kept" | null };
type Chain = {
  uses_container: boolean;
  state: "returned" | "kept" | null;
  prev_id: string | null;
  root_id: string;
  fees: { empty_amount: number | null; empty_ref: string | null; deposit_amount: number | null; deposit_ref: string | null };
  chain: ChainRow[];
  candidates: ContainerCandidate[];
};

const STATE: Record<string, { label: string; variant: "success" | "warning" }> = {
  returned: { label: "Đã trả rỗng", variant: "success" },
  kept: { label: "Giữ vỏ", variant: "warning" },
};

/** Khung "Vỏ container": chuỗi vỏ (chuyến trước / sau), trả rỗng và cược cont gộp ở chuyến đầu, nối vỏ từ chuyến trước */
export async function ContainerChainCard({ shipmentId, code, canEdit }: { shipmentId: string; code: string; canEdit: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("shipment_container_chain", { p_shipment_id: shipmentId });
  // CSDL chưa nâng cấp 9008: không hiện khung
  if (error || !data) return null;
  const c = data as Chain;
  // Chuyến không chở container: chỉ hiện khi người sửa được có vỏ đang giữ để nối
  if (!c.uses_container && c.chain.length < 2 && !(canEdit && c.candidates.length)) return null;
  const root = c.chain[0];
  const isRoot = root?.id === shipmentId;
  const money = (v: number | null, ref: string | null) =>
    v === null ? <span className="text-muted-foreground">chưa nhập</span> : (
      <>
        {formatVND(v)}
        {ref ? <span className="text-muted-foreground"> · HĐ {ref}</span> : null}
      </>
    );

  return (
    <Card data-container-chain>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          Vỏ container
          {c.state ? <Badge variant={STATE[c.state].variant}>{STATE[c.state].label}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {c.chain.length > 1 ? (
          <div>
            <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Chuỗi vỏ</div>
            <ol className="flex flex-wrap items-center gap-1">
              {c.chain.map((r, i) => (
                <li key={r.id} className="flex items-center gap-1">
                  {i > 0 ? <ArrowRight className="size-3.5 text-muted-foreground" /> : null}
                  {r.id === shipmentId ? (
                    <span className="font-mono font-semibold">{r.code}</span>
                  ) : (
                    <Link href={`/chuyen-xe/${r.id}`} className="font-mono text-primary hover:underline" title={`${shipmentStatus(r.status).label}${r.plate ? ` · ${r.plate}` : ""}`}>
                      {r.code}
                    </Link>
                  )}
                  {r.state === "returned" ? <span className="text-xs text-success">(trả rỗng)</span> : null}
                </li>
              ))}
            </ol>
            {root?.container_no ? <div className="mt-1 text-muted-foreground">Số cont: <span className="font-mono">{root.container_no}</span></div> : null}
          </div>
        ) : null}
        <dl className="space-y-1">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Trả rỗng</dt>
            <dd className="text-right tabular-nums">{money(c.fees.empty_amount, c.fees.empty_ref)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Cược cont</dt>
            <dd className="text-right tabular-nums">{money(c.fees.deposit_amount, c.fees.deposit_ref)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          {isRoot
            ? "Tài xế nhập 4 ô trên app. Phí của cả chuỗi vỏ ghi vào chuyến này (dòng chi hộ Phí hạ, Phí cược cont), sửa ở Phí chi hộ."
            : (
              <>
                Phí trả rỗng, cược cont của chuỗi gộp ở chuyến đầu{" "}
                <Link href={`/chuyen-xe/${root.id}`} className="font-mono text-primary hover:underline">{root.code}</Link>.
              </>
            )}
        </p>
        {canEdit ? <ContainerLinker shipmentId={shipmentId} code={code} prevId={c.prev_id} candidates={c.candidates} /> : null}
      </CardContent>
    </Card>
  );
}
