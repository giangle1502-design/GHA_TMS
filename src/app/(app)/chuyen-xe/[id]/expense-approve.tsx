"use client";
import { useRouter } from "next/navigation";
import { ApprovalRowActions } from "@/components/finance/row-actions";

/** Nút Duyệt / Từ chối khoản chi ngay ở chi tiết chuyến (chỉ hiện với người đúng cấp duyệt) */
export function ExpenseApproveButtons({ row }: { row: Record<string, unknown> }) {
  const router = useRouter();
  return <ApprovalRowActions row={row} onDone={() => router.refresh()} />;
}
