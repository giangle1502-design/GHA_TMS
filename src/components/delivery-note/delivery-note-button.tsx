"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
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
}: {
  ids: string[];
  compact?: boolean;
  /** compact: mã chuyến (cho chú thích); nút thường: chữ trên nút */
  label?: string;
  variant?: "outline" | "ghost";
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const qs = sp.toString();
  const ve = qs ? `${pathname}?${qs}` : pathname;
  const list = ids.slice(0, NOTE_BATCH_MAX);
  const href =
    list.length === 1
      ? `/phieu-giao-hang/${list[0]}?${new URLSearchParams({ ve }).toString()}`
      : `/phieu-giao-hang/in?${new URLSearchParams({ ids: list.join(","), ve }).toString()}`;

  if (compact)
    return (
      <Button asChild variant="ghost" size="icon" className="size-7" title={`In / tải PDF phiếu giao hàng${label ? ` chuyến ${label}` : ""}`}>
        <Link href={href} aria-label={`Phiếu giao hàng${label ? ` chuyến ${label}` : ""}`} data-delivery-note-link>
          <Printer />
        </Link>
      </Button>
    );
  if (list.length === 0)
    return (
      <Button variant={variant} disabled title="Không có chuyến đã phân công xe trong danh sách đang xem">
        <Printer /> {label ?? "In phiếu giao hàng"}
      </Button>
    );
  return (
    <Button asChild variant={variant} title={ids.length > NOTE_BATCH_MAX ? `Chỉ in ${NOTE_BATCH_MAX} chuyến đầu tiên; lọc hẹp hơn để in phần còn lại` : "In hoặc tải PDF phiếu giao hàng các chuyến đang xem (bỏ chọn chuyến không cần in ở trang sau)"}>
      <Link href={href} data-delivery-note-link>
        <Printer /> {label ?? `In phiếu giao hàng (${list.length})`}
      </Link>
    </Button>
  );
}
