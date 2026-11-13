import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/layout/empty-state";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InviteUserDialog } from "./invite-user-dialog";
import { RevokeInvitationButton, UserStatusButton } from "./row-actions";
import { RoleMatrix } from "./role-matrix";

export const metadata: Metadata = { title: "Người dùng và phân quyền" };

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "destructive" }> = {
  active: { label: "Hoạt động", variant: "success" },
  pending: { label: "Chờ cấp quyền", variant: "warning" },
  disabled: { label: "Đã khóa", variant: "destructive" },
};

type Tab = "users" | "invitations" | "roles";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const me = await requirePagePermission("users.view");
  const { tab: tabParam, q } = await searchParams;
  const tab: Tab = tabParam === "invitations" || tabParam === "roles" ? tabParam : "users";
  const supabase = await createClient();
  const canCreate = me.permissions.has("users.create");
  const canUpdate = me.permissions.has("users.update");
  const canConfigure = me.permissions.has("users.configure");

  const [{ data: roles }, { data: rolePerms }] = await Promise.all([
    supabase.from("roles").select("id, code, name, description, is_system").order("sort_order"),
    supabase.from("role_permissions").select("role_id, permission_code"),
  ]);
  const permsOf = (roleId: string) => (rolePerms ?? []).filter((rp) => rp.role_id === roleId).map((rp) => rp.permission_code as string);
  const assignableRoles = (roles ?? [])
    .filter((r) => r.code !== "super_admin" || me.roles.some((x) => x.code === "super_admin"))
    .map((r) => ({ ...r, perms: permsOf(r.id) }));

  let drivers: { id: string; code: string; full_name: string }[] = [];
  if (canCreate && me.permissions.has("drivers.view")) {
    const { data } = await supabase.from("drivers").select("id, code, full_name").is("profile_id", null).neq("status", "terminated").order("code");
    drivers = data ?? [];
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "users", label: "Người dùng" },
    { key: "invitations", label: "Lời mời" },
    { key: "roles", label: "Vai trò và quyền" },
  ];

  return (
    <>
      <PageHeader
        title="Người dùng và phân quyền"
        description="Chỉ email được cấp quyền mới truy cập được dữ liệu. Người dùng đăng nhập bằng tài khoản Google của email đó."
        actions={canCreate ? <InviteUserDialog roles={assignableRoles} drivers={drivers} /> : null}
      />
      <div className="mb-4 flex gap-1 border-b">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/nguoi-dung?tab=${t.key}`}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm",
              tab === t.key ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "users" ? <UsersTab q={q} canUpdate={canUpdate} meId={me.id} /> : null}
      {tab === "invitations" ? <InvitationsTab canUpdate={canUpdate} /> : null}
      {tab === "roles" ? <RolesTab roles={roles ?? []} canConfigure={canConfigure} isSuperAdmin={me.roles.some((r) => r.code === "super_admin")} /> : null}
    </>
  );
}

async function UsersTab({ q, canUpdate, meId }: { q?: string; canUpdate: boolean; meId: string }) {
  const supabase = await createClient();
  let query = supabase
    .from("profiles")
    .select("id, email, full_name, status, created_at, last_seen_at, user_roles!user_roles_user_id_fkey(roles(code, name))")
    .order("status", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (q) query = query.or(`email.ilike.%${q.replace(/[%,()]/g, "")}%,full_name.ilike.%${q.replace(/[%,()]/g, "")}%`);
  const { data, error } = await query;
  if (error) throw error;
  type Row = { id: string; email: string; full_name: string | null; status: string; created_at: string; user_roles: { roles: { code: string; name: string } | null }[] };
  const rows = (data ?? []) as unknown as Row[];

  return (
    <Card>
      <form className="flex gap-2 border-b p-3" action="/nguoi-dung">
        <input type="hidden" name="tab" value="users" />
        <input
          name="q"
          defaultValue={q}
          placeholder="Tìm theo email hoặc họ tên"
          className="h-9 w-full max-w-sm rounded-md border bg-card px-3 text-sm"
        />
      </form>
      {rows.length === 0 ? (
        <EmptyState title="Chưa có người dùng" description="Người dùng xuất hiện sau khi đăng nhập lần đầu bằng Google." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Họ tên / Email</TableHead>
              <TableHead>Vai trò</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead>Ngày tạo</TableHead>
              <TableHead className="text-right">Thao tác</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <Link href={`/nguoi-dung/${u.id}`} className="font-medium hover:underline">
                    {u.full_name || "(chưa có tên)"}
                  </Link>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.user_roles.map((r) => r.roles).filter(Boolean).map((r) => (
                      <Badge key={r!.code} variant="secondary">{r!.name}</Badge>
                    ))}
                    {u.user_roles.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : null}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS[u.status]?.variant ?? "outline"}>{STATUS[u.status]?.label ?? u.status}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">{formatDateTime(u.created_at)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Link href={`/nguoi-dung/${u.id}`} className={u.status === "pending" ? "text-sm font-medium text-primary underline" : "text-sm text-primary hover:underline"}>
                      {u.status === "pending" ? "Cấp quyền" : "Phân quyền"}
                    </Link>
                    {canUpdate && u.id !== meId && u.status !== "pending" ? (
                      <UserStatusButton userId={u.id} status={u.status as "active" | "disabled"} />
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

async function InvitationsTab({ canUpdate }: { canUpdate: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_invitations")
    .select("id, email, role_codes, status, note, created_at, accepted_at, drivers(code, full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  type Row = { id: string; email: string; role_codes: string[]; status: string; note: string | null; created_at: string; accepted_at: string | null; drivers: { code: string; full_name: string } | null };
  const rows = (data ?? []) as unknown as Row[];
  const label: Record<string, { t: string; v: "warning" | "success" | "secondary" }> = {
    pending: { t: "Chờ đăng nhập", v: "warning" },
    accepted: { t: "Đã kích hoạt", v: "success" },
    revoked: { t: "Đã thu hồi", v: "secondary" },
  };
  return (
    <Card>
      {rows.length === 0 ? (
        <EmptyState title="Chưa có lời mời" description="Bấm “Cấp quyền truy cập” để cho phép một email đăng nhập." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Vai trò</TableHead>
              <TableHead>Hồ sơ tài xế</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead>Thời gian</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.email}</TableCell>
                <TableCell className="text-sm">{r.role_codes.join(", ")}</TableCell>
                <TableCell className="text-sm">{r.drivers ? `${r.drivers.code} – ${r.drivers.full_name}` : "—"}</TableCell>
                <TableCell>
                  <Badge variant={label[r.status]?.v ?? "outline"}>{label[r.status]?.t ?? r.status}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">{formatDateTime(r.accepted_at ?? r.created_at)}</TableCell>
                <TableCell className="text-right">
                  {canUpdate && r.status === "pending" ? <RevokeInvitationButton id={r.id} /> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

async function RolesTab({
  roles,
  canConfigure,
  isSuperAdmin,
}: {
  roles: { id: string; code: string; name: string; description: string | null }[];
  canConfigure: boolean;
  isSuperAdmin: boolean;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("role_permissions").select("role_id, permission_code");
  if (error) throw error;
  const granted: Record<string, string[]> = {};
  for (const r of data ?? []) (granted[r.role_id] ??= []).push(r.permission_code);
  return (
    <RoleMatrix
      roles={roles.filter((r) => r.code !== "super_admin")}
      granted={granted}
      canConfigure={canConfigure}
      lockedRoleCodes={isSuperAdmin ? [] : ["admin"]}
    />
  );
}
