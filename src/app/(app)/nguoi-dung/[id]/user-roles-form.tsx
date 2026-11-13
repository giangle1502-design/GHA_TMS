"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setUserRoles } from "../actions";
import { RoleSummary } from "../role-summary";

export function UserRolesForm({
  userId,
  roles,
  selected,
  canConfigure,
}: {
  userId: string;
  roles: { id: string; code: string; name: string; disabled: boolean; perms: string[] }[];
  selected: string[];
  canConfigure: boolean;
}) {
  const [value, setValue] = useState(new Set(selected));
  const [pending, start] = useTransition();
  const dirty = value.size !== selected.length || selected.some((s) => !value.has(s));
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {roles.map((r) => (
          <div key={r.id} className="space-y-1 rounded-md border p-2 text-sm">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={value.has(r.id)}
                disabled={r.disabled}
                onChange={(e) => {
                  const next = new Set(value);
                  if (e.target.checked) next.add(r.id);
                  else next.delete(r.id);
                  setValue(next);
                }}
              />
              {r.name}
            </label>
            <div className="pl-6">
              <RoleSummary perms={r.perms} all={r.code === "super_admin"} />
            </div>
          </div>
        ))}
      </div>
      {canConfigure ? (
        <Button
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              const res = await setUserRoles(userId, [...value]);
              if (res.ok) toast.success(res.data?.activated ? "Đã cấp vai trò và kích hoạt tài khoản. Người dùng tải lại trang là dùng được." : res.message);
              else toast.error(res.error);
            })
          }
        >
          {pending ? "Đang lưu..." : "Lưu vai trò"}
        </Button>
      ) : null}
    </div>
  );
}
