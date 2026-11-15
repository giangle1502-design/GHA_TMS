import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatVND } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Vỏ chưa trả rỗng" };

type Row = {
  shipment_id: string;
  shipment_code: string;
  container_no: string | null;
  plate_number: string | null;
  driver_name: string | null;
  customer_name: string | null;
  pickup_at: string;
  kept_at: string | null;
  days_kept: number;
  root_id: string;
  root_code: string;
  deposit_amount: number | null;
};

/** Chuyến tài xế chọn "Giữ vỏ cho chuyến sau" mà chưa có chuyến sau dùng vỏ đó */
export default async function Page() {
  await requirePagePermission("dispatch.view");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("container_kept_list");
  if (error) throw error;
  const rows = (data ?? []) as Row[];

  return (
    <>
      <PageHeader
        title="Vỏ chưa trả rỗng"
        description={`${rows.length} vỏ container đang giữ, chưa trả rỗng và chưa có chuyến sau. Mở chuyến kế tiếp của xe, chọn "Dùng vỏ từ chuyến…" để nối; trả rỗng, cược cont gộp về chuyến đầu.`}
      />
      <Card className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Chuyến giữ vỏ</TableHead>
              <TableHead>Số cont</TableHead>
              <TableHead>Xe</TableHead>
              <TableHead>Tài xế</TableHead>
              <TableHead>Khách hàng</TableHead>
              <TableHead>Ngày nhận hàng</TableHead>
              <TableHead className="text-right">Số ngày giữ</TableHead>
              <TableHead>Chuyến đầu (gộp phí)</TableHead>
              <TableHead className="text-right">Cược cont</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((r) => (
                <TableRow key={r.shipment_id}>
                  <TableCell>
                    <Link href={`/chuyen-xe/${r.shipment_id}`} className="font-mono text-primary hover:underline">{r.shipment_code}</Link>
                  </TableCell>
                  <TableCell className="font-mono">{r.container_no ?? "–"}</TableCell>
                  <TableCell className="font-mono">{r.plate_number ?? "–"}</TableCell>
                  <TableCell>{r.driver_name ?? "–"}</TableCell>
                  <TableCell>{r.customer_name ?? "–"}</TableCell>
                  <TableCell>{formatDate(r.pickup_at)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${r.days_kept >= 3 ? "font-semibold text-destructive" : ""}`}>{r.days_kept}</TableCell>
                  <TableCell>
                    {r.root_id === r.shipment_id ? (
                      <span className="text-muted-foreground">chính chuyến này</span>
                    ) : (
                      <Link href={`/chuyen-xe/${r.root_id}`} className="font-mono text-primary hover:underline">{r.root_code}</Link>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.deposit_amount === null ? "–" : formatVND(r.deposit_amount)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">Không có vỏ nào đang giữ.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
