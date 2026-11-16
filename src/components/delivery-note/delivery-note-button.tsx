"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Printer, Stamp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NOTE_BATCH_MAX } from "@/lib/delivery-note";

/**
 * Mở trang in phiếu giao hàng: một chuyến (/phieu-giao-hang/[id]) hoặc nhiều chuyến (/phieu-giao-hang/in).
 * Nút Quay lại trên trang in trở về đúng danh sách đang xem (giữ bộ lọc).
 */
export function DeliveryNoteButton({
  ids,
  compact = false,
  label,
  variant = "outline",
  confirm = false,
}: {
  ids: string[];
  compact?: boolean;
  /** compact: mã chuyến (cho chú thích); nút thường: chữ trên nút */
  label?: string;
  variant?: "outline" | "ghost";
  /** Bản xác nhận đã nhận hàng (hàng giao về Bãi xe GHA): in kèm dấu ĐÃ NHẬN HÀNG */
  confirm?: boolean;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const qs = sp.toString();
  const ve = qs ? `${pathname}?${qs}` : pathname;
  const list = ids.slice(0, NOTE_BATCH_MAX);
  const mau: Record<string, string> = confirm ? { mau: "xac-nhan" } : {};
  const href =
    list.length === 1
      ? `/phieu-giao-hang/${list[0]}?${new URLSearchParams({ ve, ...mau }).toString()}`
      : `/phieu-giao-hang/in?${new URLSearchParams({ ids: list.join(","), ve, ...mau }).toString()}`;
  const Icon = confirm ? Stamp : Printer;
  const what = confirm ? "phiếu xác nhận đã nhận hàng (Bãi xe GHA)" : "phiếu giao hàng";

  if (compact)
    return (
      <Button asChild variant="ghost" size="icon" className={confirm ? "size-7 text-[#c8102e]" : "size-7"} title={`In / tải PDF ${what}${label ? ` chuyến ${label}` : ""}`}>
        <Link href={href} aria-label={`${confirm ? "Phiếu xác nhận đã nhận hàng" : "Phiếu giao hàng"}${label ? ` chuyến ${label}` : ""}`} data-delivery-note-link>
          <Icon />
        </Link>
      </Button>
    );
  if (list.length === 0)
    return (
      <Button variant={variant} disabled title="Không có chuyến đã phân công xe trong danh sách đang xem">
        <Icon /> {label ?? "In phiếu giao hàng"}
      </Button>
    );
  return (
    <Button asChild variant={variant} title={ids.length > NOTE_BATCH_MAX ? `Chỉ in ${NOTE_BATCH_MAX} chuyến đầu tiên; lọc hẹp hơn để in phần còn lại` : `In hoặc tải PDF ${what} các chuyến đang xem (bỏ chọn chuyến không cần in ở trang sau)`}>
      <Link href={href} data-delivery-note-link className={confirm ? "text-[#c8102e]" : undefined}>
        <Icon /> {label ?? (confirm ? `Xác nhận nhận hàng Bãi xe GHA (${list.length})` : `In phiếu giao hàng (${list.length})`)}
      </Link>
    </Button>
  );
}
