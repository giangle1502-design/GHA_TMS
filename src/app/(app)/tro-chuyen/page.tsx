import type { Metadata } from "next";
import { Suspense } from "react";
import { requireActiveUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ChatApp } from "@/components/chat/chat-app";
import type { StaffPerson } from "@/lib/chat";

export const metadata: Metadata = { title: "Trò chuyện" };

export default async function Page() {
  const user = await requireActiveUser();
  if (!user.roles.some((r) => r.code !== "driver")) {
    return <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Trò chuyện dành cho nhân viên văn phòng. Tài khoản tài xế chưa dùng được mục này.</p>;
  }
  const supabase = await createClient();
  const { data } = await supabase.from("staff_directory").select("id, display_name, role_names, status").order("display_name").limit(1000);
  return (
    <Suspense>
      <ChatApp meId={user.id} people={(data ?? []) as StaffPerson[]} />
    </Suspense>
  );
}
