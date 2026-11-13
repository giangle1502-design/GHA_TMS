import Link from "next/link";
import { Bell } from "lucide-react";
import { requireActiveUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { NAV_GROUPS } from "@/lib/navigation";
import { hasAny } from "@/lib/permissions";
import { Brand } from "@/components/layout/brand";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { NavSearch } from "@/components/layout/nav-search";
import { UserMenu } from "@/components/layout/user-menu";
import { ChatBadge } from "@/components/chat/chat-badge";
import { OptionAddProvider } from "@/components/entities/add-option";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireActiveUser();
  const supabase = await createClient();
  const isStaff = user.roles.some((r) => r.code !== "driver");
  const [{ count: unread }, chatUnread] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    // Trước khi chạy nâng cấp CSDL Trò chuyện, hàm chưa có: coi như 0
    isStaff ? supabase.rpc("chat_unread_total").then((r) => (typeof r.data === "number" ? r.data : 0)) : Promise.resolve(0),
  ]);

  // Menu chỉ hiển thị mục người dùng có quyền (máy chủ vẫn kiểm tra quyền ở từng trang)
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => hasAny(user.permissions, i.anyOf)) })).filter(
    (g) => g.items.length > 0,
  );
  const displayName = user.fullName || user.email;
  // Nút + thêm lựa chọn ở ô chọn: người cấu hình trường hoặc người nhập liệu (có quyền Thêm/Sửa)
  const canAddOptions = [...user.permissions].some(
    (p) => p === "fields.configure" || (/\.(create|update)$/.test(p) && !p.startsWith("documents.") && !p.startsWith("driver_app.")),
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden print:!hidden h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <Brand />
        <SidebarNav groups={groups} />
        {user.isDriver ? (
          <Link href="/tx" className="m-3 rounded-md border border-white/15 px-3 py-2 text-center text-sm text-white hover:bg-sidebar-accent">
            Mở ứng dụng tài xế
          </Link>
        ) : null}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 print:hidden flex h-16 items-center gap-3 border-b bg-card/95 px-3 backdrop-blur sm:px-6">
          <MobileNav groups={groups} />
          <NavSearch groups={groups} />
          <div className="flex-1" />
          {isStaff ? <ChatBadge initial={chatUnread} userId={user.id} /> : null}
          <Link href="/thong-bao" className="relative rounded-md p-2 hover:bg-accent" aria-label={`Thông báo (${unread ?? 0} chưa đọc)`}>
            <Bell className="size-5" />
            {unread ? (
              <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </Link>
          <UserMenu name={displayName} email={user.email} avatarUrl={user.avatarUrl} roles={user.roles.map((r) => r.name)} />
        </header>
        <main className="flex-1 p-4 sm:p-6 print:p-0">
          <OptionAddProvider canAdd={canAddOptions}>{children}</OptionAddProvider>
        </main>
      </div>
    </div>
  );
}
