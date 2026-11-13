"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateExpenseDialog } from "@/components/finance/create-dialogs";
import type { CustomFieldRow } from "@/lib/entities/types";

/** Nhập chi phí ngay trên trang chi tiết chuyến (điền sẵn chuyến và tài xế) */
export function ShipmentExpenseButton(props: {
  shipment: { id: string; label: string; driverId: string | null; driverLabel: string | null };
  customRows: CustomFieldRow[];
  canAddField: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus /> Nhập chi phí
      </Button>
      {open ? (
        <CreateExpenseDialog
          open={open}
          onOpenChange={setOpen}
          customRows={props.customRows}
          canAddField={props.canAddField}
          shipment={props.shipment}
          onDone={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
