"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { ACTION_LABELS, MODULE_LABELS, type ModuleKey } from "@/lib/permissions";
import { setPermissionOverride } from "../actions";

export function OverrideForm({ userId, permissions }: { userId: string; permissions: string[] }) {
  const [permission, setPermission] = useState(permissions[0]);
  const [effect, setEffect] = useState<"grant" | "deny">("grant");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await setPermissionOverride({ userId, permission, effect, reason: reason || undefined });
          if (res.ok) {
            toast.success(res.message);
            setReason("");
          } else toast.error(res.error);
        });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <NativeSelect value={permission} onChange={(e) => setPermission(e.target.value)} aria-label="Quyền">
          {[...new Set(permissions.map((p) => p.split(".")[0]))].map((m) => (
            <optgroup key={m} label={MODULE_LABELS[m as ModuleKey] ?? m}>
              {permissions
                .filter((p) => p.startsWith(`${m}.`))
                .map((p) => (
                  <option key={p} value={p}>
                    {ACTION_LABELS[p.split(".")[1]] ?? p} – {MODULE_LABELS[m as ModuleKey] ?? m}
                  </option>
                ))}
            </optgroup>
          ))}
        </NativeSelect>
        <NativeSelect value={effect} onChange={(e) => setEffect(e.target.value as "grant" | "deny")} aria-label="Loại">
          <option value="grant">Cấp thêm</option>
          <option value="deny">Chặn</option>
        </NativeSelect>
        <Input className="sm:col-span-2" placeholder="Lý do (khuyến nghị)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        Thêm
      </Button>
    </form>
  );
}

export function RemoveOverrideButton({ userId, permission }: { userId: string; permission: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setPermissionOverride({ userId, permission, effect: "none" });
          if (res.ok) toast.success(res.message);
          else toast.error(res.error);
        })
      }
    >
      Gỡ
    </Button>
  );
}
