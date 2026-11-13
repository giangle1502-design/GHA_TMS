import { Badge } from "@/components/ui/badge";
import { TONE_BADGE } from "@/lib/tones";
import { documentStatus, settlementStatus, shipmentStatus, tripApprovalStatus } from "@/lib/status";

const KINDS = { shipment: shipmentStatus, document: documentStatus, settlement: settlementStatus, approval: tripApprovalStatus };

export function StatusBadge({ status, kind = "shipment" }: { status: string; kind?: keyof typeof KINDS }) {
  const s = KINDS[kind](status);
  return <Badge variant={TONE_BADGE[s.tone]}>{s.label}</Badge>;
}
