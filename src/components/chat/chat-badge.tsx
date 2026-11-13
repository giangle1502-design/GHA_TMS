"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { CHAT_READ_EVENT } from "@/lib/chat";

/** Biểu tượng Trò chuyện trên đầu trang: số tin chưa đọc, tự cập nhật khi có tin mới */
export function ChatBadge({ initial, userId }: { initial: number; userId: string }) {
  const [count, setCount] = useState(initial);

  const refresh = useCallback(async () => {
    const { data } = await createClient().rpc("chat_unread_total");
    if (typeof data === "number") setCount(data);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    };
    const channel = supabase
      .channel(`chat-badge-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, later)
      .subscribe();
    const onVisible = () => document.visibilityState === "visible" && later();
    window.addEventListener(CHAT_READ_EVENT, later);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(CHAT_READ_EVENT, later);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  return (
    <Link href="/tro-chuyen" className="relative rounded-md p-2 hover:bg-accent" aria-label={`Trò chuyện (${count} tin chưa đọc)`} title="Trò chuyện">
      <MessageCircle className="size-5" />
      {count ? (
        <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
