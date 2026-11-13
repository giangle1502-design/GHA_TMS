"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { revokeInvitation, setUserStatus } from "./actions";

export function UserStatusButton({ userId, status }: { userId: string; status: "active" | "disabled" }) {
  const [pending, start] = useTransition();
  const next = status === "active" ? "disabled" : "active";
  return (
    <Button
      size="sm"
      variant={next === "disabled" ? "outline" : "secondary"}
      disabled={pending}
      onClick={() => {
        if (next === "disabled" && !confirm("Khóa tài khoản này? Người dùng sẽ không truy cập được dữ liệu.")) return;
        start(async () => {
          const res = await setUserStatus(userId, next);
          if (res.ok) toast.success(res.message);
          else toast.error(res.error);
        });
      }}
    >
      {next === "disabled" ? "Khóa" : "Mở khóa"}
    </Button>
  );
}

export function RevokeInvitationButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await revokeInvitation(id);
          if (res.ok) toast.success(res.message);
          else toast.error(res.error);
        })
      }
    >
      Thu hồi
    </Button>
  );
}
