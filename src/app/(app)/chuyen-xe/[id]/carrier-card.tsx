import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber, formatVND } from "@/lib/format";
import { CarrierCostsDialog, type CarrierCost, type CustomerPassThrough } from "@/components/finance/carrier-dialogs";
import { CARRIER_KIND_LABEL, type CarrierKind } from "@/lib/finance/carrier-kind";

export type CarrierPayable = {
  id: string;
  code: string;
  amount: number;
  paid_amount: number;
  status: string;
  due_date: string;
  invoice_no: string | null;
};

const PAY: Record<string, { label: string; variant: "warning" | "info" | "success" | "outline" }> = {
  open: { label: "Chưa trả", variant: "warning" },
  partial: { label: "Trả một phần", variant: "info" },
  paid: { label: "Đã trả đủ", variant: "success" },
};

/** Khung "Chi phí trả 3PL": cước, chi hộ, chi phí khác phải trả nhà xe và tình trạng thanh toán */
export function CarrierCard(props: {
  shipmentId: string;
  code: string;
  outsourced: boolean;
  supplierId: string | null;
  supplierName: string | null;
  costs: CarrierCost[];
  payable: CarrierPayable | null;
  canSeePayable: boolean;
  customerPassThrough: CustomerPassThrough[];
  canEdit: boolean;
}) {
  const total = props.costs.reduce((a, c) => a + Number(c.amount), 0);
  const sum = (k: CarrierKind) => props.costs.filter((c) => c.cost_kind === k).reduce((a, c) => a + Number(c.amount), 0);
  const p = props.payable;
  const pay = p ? (PAY[p.status] ?? null) : null;
  return (
    <Card className="lg:col-span-3" id="chi-phi-3pl">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="text-base">Chi phí trả 3PL (xe thuê ngoài)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Nhà xe: <b className="text-foreground">{props.supplierName ?? "chưa chọn"}</b>
            {!props.outsourced ? " · xe của chuyến không đánh dấu Thuê ngoài 3PL" : ""}
          </p>
        </div>
        {props.canEdit ? (
          <CarrierCostsDialog
            shipmentId={props.shipmentId}
            code={props.code}
            supplierId={props.supplierId}
            supplierLabel={props.supplierName}
            invoiceNo={p?.invoice_no ?? null}
            dueDate={p?.due_date ?? null}
            costs={props.costs}
            customerPassThrough={props.customerPassThrough}
            paidAmount={Number(p?.paid_amount ?? 0)}
          />
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4 text-sm md:grid-cols-2">
        <div className="space-y-1">
          {props.costs.length === 0 ? (
            <p className="text-muted-foreground">
              Chưa nhập chi phí 3PL. Bấm <b>Nhập chi phí 3PL</b> để nhập cước phải trả nhà xe và các phí chi hộ nhà xe đã trả thay (nâng, hạ, cược…).
            </p>
          ) : (
            props.costs.map((c) => (
              <Line
                key={c.line_no}
                label={`${CARRIER_KIND_LABEL[c.cost_kind]} · ${c.description}${c.quantity != null && c.unit_price != null ? ` · ${formatNumber(c.quantity)} × ${formatNumber(c.unit_price)}` : ""}${c.ref_no ? ` · số ${c.ref_no}` : ""}${c.note ? ` (${c.note})` : ""}`}
                value={formatVND(c.amount)}
              />
            ))
          )}
          {props.costs.length ? (
            <div className="space-y-1 border-t pt-2">
              <Line label="Cước trả 3PL" value={formatVND(sum("freight"))} />
              <Line label="Chi hộ trả 3PL (không trừ lời/lỗ)" value={formatVND(sum("pass_through"))} />
              {sum("other") ? <Line label="Chi phí khác trả 3PL" value={formatVND(sum("other"))} /> : null}
              <Line label="Tổng phải trả nhà xe" value={<b>{formatVND(total)}</b>} />
            </div>
          ) : null}
        </div>
        <div className="space-y-1">
          <div className="font-medium">Tình trạng thanh toán</div>
          {!props.canSeePayable ? (
            <p className="text-muted-foreground">Bạn không có quyền xem công nợ.</p>
          ) : !p ? (
            <p className="text-muted-foreground">{total ? "Chưa lập công nợ (chưa chọn nhà xe)." : "Chưa có công nợ: nhập chi phí 3PL thì tự lập."}</p>
          ) : (
            <>
              <Line label="Công nợ phải trả" value={<Link href="/cong-no?tab=payables" className="font-medium text-primary hover:underline">{p.code}</Link>} />
              <Line label="Trạng thái" value={pay ? <Badge variant={pay.variant}>{pay.label}</Badge> : p.status} />
              <Line label="Đã trả" value={formatVND(p.paid_amount)} />
              <Line label="Còn phải trả" value={<b>{formatVND(Number(p.amount) - Number(p.paid_amount))}</b>} />
              <Line label="Hạn trả" value={formatDate(p.due_date)} />
              {p.invoice_no ? <Line label="Số hóa đơn nhà xe" value={p.invoice_no} /> : null}
            </>
          )}
          <p className="pt-1 text-xs text-muted-foreground">
            Trả tiền ở{" "}
            <Link href="/thue-ngoai" className="text-primary hover:underline">
              Xe thuê ngoài 3PL
            </Link>{" "}
            (trả từng chuyến hoặc gộp nhiều chuyến của một nhà xe) hoặc Công nợ → Phải trả nhà cung cấp.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Line({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="shrink-0 whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}
