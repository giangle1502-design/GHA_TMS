"use client";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { ACTION_LABELS, ACTION_ORDER, MODULE_ACTIONS, MODULE_LABELS, type ModuleKey } from "@/lib/permissions";
import { Card } from "@/components/ui/card";
import { toggleRolePermission } from "./actions";

type Role = { id: string; code: string; name: string };

export function RoleMatrix({
  roles,
  granted,
  canConfigure,
  lockedRoleCodes,
}: {
  roles: Role[];
  granted: Record<string, string[]>;
  canConfigure: boolean;
  lockedRoleCodes: string[];
}) {
  const [, start] = useTransition();
  const [state, apply] = useOptimistic(granted, (cur, a: { roleId: string; perm: string; on: boolean }) => {
    const set = new Set(cur[a.roleId] ?? []);
    if (a.on) set.add(a.perm);
    else set.delete(a.perm);
    return { ...cur, [a.roleId]: [...set] };
  });

  function toggle(role: Role, perm: string, on: boolean) {
    start(async () => {
      apply({ roleId: role.id, perm, on });
      const res = await toggleRolePermission(role.id, perm, on);
      if (!res.ok) toast.error(res.error);
    });
  }

  return (
    <Card className="overflow-hidden">
      <p className="border-b p-3 text-sm text-muted-foreground">
        Super Admin luôn có toàn quyền. {canConfigure ? "Bấm vào ô để bật/tắt quyền; thay đổi có hiệu lực ngay và được ghi nhật ký." : "Bạn chỉ có quyền xem ma trận."}
        {lockedRoleCodes.length ? " Quyền của vai trò Admin chỉ Super Admin sửa được." : ""}
      </p>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              <th className="sticky left-0 z-20 min-w-48 bg-muted px-3 py-2 text-left font-semibold">Module / Quyền</th>
              {roles.map((r) => (
                <th key={r.id} className="min-w-24 px-2 py-2 text-center font-semibold">
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(Object.keys(MODULE_ACTIONS) as ModuleKey[]).map((m) => (
              <ModuleRows key={m} module={m} roles={roles} state={state} canConfigure={canConfigure} locked={lockedRoleCodes} onToggle={toggle} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ModuleRows({
  module,
  roles,
  state,
  canConfigure,
  locked,
  onToggle,
}: {
  module: ModuleKey;
  roles: Role[];
  state: Record<string, string[]>;
  canConfigure: boolean;
  locked: string[];
  onToggle: (r: Role, perm: string, on: boolean) => void;
}) {
  const actions = [...MODULE_ACTIONS[module]].sort((a, b) => ACTION_ORDER.indexOf(a) - ACTION_ORDER.indexOf(b));
  return (
    <>
      <tr className="border-t bg-muted/30">
        <td colSpan={roles.length + 1} className="sticky left-0 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {MODULE_LABELS[module]}
        </td>
      </tr>
      {actions.map((a) => {
        const perm = `${module}.${a}`;
        return (
          <tr key={perm} className="border-t hover:bg-muted/20">
            <td className="sticky left-0 bg-card px-3 py-1.5">
              {ACTION_LABELS[a]} <code className="ml-1 text-[11px] text-muted-foreground">{perm}</code>
            </td>
            {roles.map((r) => {
              const on = (state[r.id] ?? []).includes(perm);
              const disabled = !canConfigure || locked.includes(r.code);
              return (
                <td key={r.id} className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    aria-label={`${r.name}: ${perm}`}
                    checked={on}
                    disabled={disabled}
                    onChange={(e) => onToggle(r, perm, e.target.checked)}
                    className="size-4 cursor-pointer disabled:cursor-not-allowed"
                  />
                </td>
              );
            })}
          </tr>
        );
      })}
    </>
  );
}
