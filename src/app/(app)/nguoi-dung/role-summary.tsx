import { ACTION_LABELS, ACTION_ORDER, MODULE_LABELS, MODULE_ACTIONS, type ModuleKey } from "@/lib/permissions";

/** Tóm tắt quyền có sẵn của một vai trò, theo màn hình: "Điều phối: xem, tạo, sửa" */
export function RoleSummary({ perms, all = false }: { perms: readonly string[]; all?: boolean }) {
  if (all) return <p className="text-xs text-muted-foreground">Toàn quyền mọi màn hình.</p>;
  const set = new Set(perms);
  const lines = (Object.keys(MODULE_ACTIONS) as ModuleKey[])
    .map((m) => ({
      m,
      actions: ACTION_ORDER.filter((a) => set.has(`${m}.${a}`)).map((a) => ACTION_LABELS[a].toLowerCase()),
    }))
    .filter((l) => l.actions.length);
  if (!lines.length) return <p className="text-xs text-muted-foreground">Chưa có quyền nào.</p>;
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none text-primary">Xem quyền có sẵn ({lines.length} màn hình)</summary>
      <ul className="mt-1 space-y-0.5">
        {lines.map((l) => (
          <li key={l.m}>
            <span className="font-medium text-foreground">{MODULE_LABELS[l.m]}</span>: {l.actions.join(", ")}
          </li>
        ))}
      </ul>
    </details>
  );
}
