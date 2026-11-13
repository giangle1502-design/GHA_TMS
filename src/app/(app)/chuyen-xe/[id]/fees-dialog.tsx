"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FeesEditor, countFeeFiles, feesPayload, newFee, numText, uploadFeeFiles, type FeeFiles, type FeeKind, type FeeLine } from "@/app/(app)/dieu-phoi/tao-don/fees-editor";
import { saveShipmentFees } from "@/app/(app)/dieu-phoi/actions";
import { formatNumber } from "@/lib/format";

export type ShipmentFee = {
  line_no: number;
  fee_type_id: string;
  fee_kind: FeeKind;
  amount: number;
  note: string | null;
  declaration_type_id: string | null;
  ref_no: string | null;
  quantity: number | null;
  unit_price: number | null;
  declaration: { name: string } | null;
  fee_type: { name: string; sort_order: number; fee_group: { id: string; name: string; report_role: string; sort_order: number } | null } | null;
};

/** Nhập, sửa các khoản phí thu khách của chuyến (bốc xếp, chi hộ…) */
export function FeesDialog({ shipmentId, code, fees, feeDocs }: { shipmentId: string; code: string; fees: ShipmentFee[]; feeDocs?: Record<string, number> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<FeeLine[]>([]);
  const [files, setFiles] = useState<FeeFiles>({});
  const [pending, start] = useTransition();

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setLines(
            fees.map((f) =>
              newFee({
                fee_type_id: f.fee_type_id,
                label: f.fee_type?.name ?? "",
                kind: f.fee_kind,
                amount: formatNumber(Number(f.amount)),
                note: f.note ?? "",
                declaration_type_id: f.declaration_type_id ?? "",
                declaration_label: f.declaration?.name ?? "",
                ref_no: f.ref_no ?? "",
                quantity: numText(f.quantity),
                unit_price: numText(f.unit_price),
              }),
            ),
          );
          setFiles({});
          setOpen(true);
        }}
      >
        <Receipt /> {fees.length ? "Sửa phí thu khách" : "Thêm phí thu khách"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Phí thu khách của chuyến {code}</DialogTitle>
            <DialogDescription>Phí theo nhóm: Phí vận chuyển (cộng vào Tổng cước), Chi hộ, Tờ khai, Bốc xếp. Phí chi hộ có trong số khách phải trả nhưng không tính doanh thu. Chuyến đã lập công nợ thì không sửa được phí.</DialogDescription>
          </DialogHeader>
          <FeesEditor value={lines} onChange={setLines} idPrefix="ct-fee-" files={files} onFilesChange={setFiles} shipmentId={shipmentId} savedFiles={feeDocs} />
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Đóng
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await saveShipmentFees({ shipmentId, fees: feesPayload(lines) });
                  if (!r.ok) return void toast.error(r.error);
                  if (countFeeFiles(files)) {
                    const err = await uploadFeeFiles(shipmentId, files);
                    if (err) toast.warning(err, { duration: 15000 });
                  }
                  toast.success(r.message);
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : null} Lưu phí
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
