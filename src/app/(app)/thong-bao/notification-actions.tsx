"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markAllNotificationsRead, markNotificationRead } from "./actions";

export function MarkAllReadButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await markAllNotificationsRead();
          if (res.ok) toast.success(res.message);
          else toast.error(res.error);
        })
      }
    >
      Đánh dấu tất cả đã đọc
    </Button>
  );
}

export function OpenNotification({ id, link, unread, children }: { id: string; link: string | null; unread: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <button
      type="button"
      className="w-full text-left"
      onClick={() =>
        start(async () => {
          if (unread) await markNotificationRead(id);
          if (link && link.startsWith("/")) router.push(link);
          else router.refresh();
        })
      }
    >
      {children}
    </button>
  );
}
