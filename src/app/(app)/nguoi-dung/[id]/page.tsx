import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { ClosePageButton } from "@/components/layout/close-page-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ALL_PERMISSIONS, MODULE_LABELS, ACTION_LABELS, type ModuleKey, permissionLabel } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import { UserRolesForm } from "./user-roles-form";
import { OverrideForm, RemoveOverrideButton } from "./override-form";
import { UserCustomersForm } from "./user-customers-form";
import { UserSuppliersForm } from "./user-suppliers-form";

export const metadata: Metadata = { title: "Phân quyền người dùng" };

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePagePermission("users.view");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const supabase = await createClient();

  const [{ data: profile }, { data: roles }, { data: userRoles }, { data: overrides }, { data: rolePerms }, { data: links }, { data: customers }, supLinksRes, suppliersRes] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, phone, status, created_at").eq("id", id).maybeSingle(),
    supabase.from("roles").select("id, code, name").order("sort_order"),
    supabase.from("user_roles").select("role_id, granted_at").eq("user_id", id),
    supabase.from("user_permission_overrides").select("permission_code, effect, reason, created_at").eq("user_id", id).order("permission_code"),
    supabase.from("role_permissions").select("role_id, permission_code"),
    supabase.from("user_customers").select("customer_id").eq("user_id", id),
    supabase.from("customers").select("id, code, name").eq("status", "active").order("code").limit(3000),
    // Bảng user_suppliers có từ SQL 9030 (hoặc 9025): chưa chạy thì bỏ qua
    supabase.from("user_suppliers").select("supplier_id").eq("user_id", id),
    supabase.from("suppliers").select("id, code, name, custom_fields").eq("status", "active").order("name").limit(2000),
  ]);
  if (!profile) notFound();

  const roleIds = new Set((userRoles ?? []).map((r) => r.role_id as string));
  const isTargetSuper = (roles ?? []).some((r) => r.code === "super_admin" && roleIds.has(r.id));
  const isTargetCustomer = (roles ?? []).some((r) => (r.code === "customer_statement" || r.code === "customer_admin") && roleIds.has(r.id));
  const linkedIds = (links ?? []).map((l) => l.customer_id as string);
  const isTarget3pl = (roles ?? []).some((r) => r.code === "carrier_3pl" && roleIds.has(r.id));
  const supplierIds = supLinksRes.error ? [] : (supLinksRes.data ?? []).map((l) => l.supplier_id as string);
  const supplierOptions = ((suppliersRes.data ?? []) as { id: string; code: string; name: string; custom_fields: Record<string, unknown> | null }[]).map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    is3pl: ["3pl", "carrier"].includes(String(s.custom_fields?.supplier_kind ?? "")),
  }));
  const meSuper = me.roles.some((r) => r.code === "super_admin");
  const isSelf = me.id === profile.id;
  const canConfigure = me.permissions.has("users.configure") && !isSelf && (!isTargetSuper || meSuper);

  // Quyền hiệu lực = quyền theo vai trò + cấp riêng − chặn riêng (Super Admin: toàn quyền)
  const effective = new Set<string>();
  if (isTargetSuper) ALL_PERMISSIONS.forEach((p) => effective.add(p));
  else {
    (rolePerms ?? []).forEach((rp) => roleIds.has(rp.role_id) && effective.add(rp.permission_code));
    (overrides ?? []).forEach((o) => (o.effect === "grant" ? effective.add(o.permission_code) : effective.delete(o.permission_code)));
  }
  const byModule = new Map<string, string[]>();
  [...effective].sort().forEach((p) => {
    const [m, a] = p.split(".");
    byModule.set(m, [...(byModule.get(m) ?? []), a]);
  });

  return (
    <>
      <Link href="/nguoi-dung" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Người dùng
      </Link>
      <ClosePageButton fallbackHref="/nguoi-dung" />
      <PageHeader
        title={profile.full_name || profile.email}
        description={
          <>
            {profile.email} · Tạo lúc {formatDateTime(profile.created_at)} ·{" "}
            <Badge variant={profile.status === "active" ? "success" : profile.status === "pending" ? "warning" : "destructive"}>
              {profile.status === "active" ? "Hoạt động" : profile.status === "pending" ? "Chờ cấp quyền" : "Đã khóa"}
            </Badge>
          </>
        }
      />
      {profile.status === "pending" && !isSelf ? (
        <p className="mb-4 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          Tài khoản này đã đăng nhập nhưng chưa được cấp quyền. Tích vai trò bên dưới (ví dụ Kế toán) rồi bấm <b>Lưu vai trò</b>: tài khoản được kích hoạt ngay.
        </p>
      ) : null}
      {isSelf ? (
        <p className="mb-4 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">Bạn không thể tự thay đổi vai trò hoặc quyền của chính mình.</p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Vai trò</CardTitle>
            <CardDescription>
              Tích vai trò theo bộ phận rồi bấm Lưu vai trò; mỗi vai trò đã có sẵn bộ quyền (bấm “Xem quyền có sẵn”). Chỉ dùng Quyền riêng khi cần ngoại lệ.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UserRolesForm
              userId={profile.id}
              roles={(roles ?? []).map((r) => ({
                ...r,
                disabled: !canConfigure || (r.code === "super_admin" && !meSuper),
                perms: (rolePerms ?? []).filter((rp) => rp.role_id === r.id).map((rp) => rp.permission_code as string),
              }))}
              selected={[...roleIds]}
              canConfigure={canConfigure}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Quyền riêng</CardTitle>
            <CardDescription>Cấp thêm hoặc chặn một quyền cho riêng người này. Quyền bị chặn luôn thắng quyền theo vai trò.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(overrides ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Chưa có quyền riêng.</p> : null}
            <ul className="space-y-2">
              {(overrides ?? []).map((o) => (
                <li key={o.permission_code} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <span>
                    <Badge variant={o.effect === "grant" ? "success" : "destructive"}>{o.effect === "grant" ? "Cấp" : "Chặn"}</Badge>{" "}
                    {permissionLabel(o.permission_code)} <code className="text-xs text-muted-foreground">{o.permission_code}</code>
                    {o.reason ? <span className="block text-xs text-muted-foreground">{o.reason}</span> : null}
                  </span>
                  {canConfigure ? <RemoveOverrideButton userId={profile.id} permission={o.permission_code} /> : null}
                </li>
              ))}
            </ul>
            {canConfigure ? <OverrideForm userId={profile.id} permissions={ALL_PERMISSIONS} /> : null}
          </CardContent>
        </Card>
        {isTargetCustomer || linkedIds.length ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Khách hàng được xem</CardTitle>
              <CardDescription>
                Tài khoản bên khách hàng chỉ thấy dữ liệu (bảng kê, đơn, chuyến) của các khách hàng được tích. Chủ chung nhiều công ty (VD VAP, PLA, DAM) thì tích cả các công ty đó: khi lập bảng kê họ chọn được Tất cả hoặc từng công ty.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UserCustomersForm
                userId={profile.id}
                customers={(customers ?? []) as { id: string; code: string; name: string }[]}
                selected={linkedIds}
                canConfigure={canConfigure && !isTargetSuper}
              />
            </CardContent>
          </Card>
        ) : null}
        {isTarget3pl || supplierIds.length ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Nhà xe 3PL được gắn</CardTitle>
              <CardDescription>
                Tài khoản nhà xe 3PL chỉ thấy các chuyến GHA chỉ định cho nhà xe được tích (trang Nhà xe 3PL đăng ký xe), không thấy cước, đơn giá, chuyến của nhà xe khác.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {supLinksRes.error ? (
                <p className="text-sm text-warning">Cơ sở dữ liệu chưa nâng cấp Cổng nhà xe 3PL. Chạy file SQL 9030 rồi tải lại trang.</p>
              ) : (
                <UserSuppliersForm userId={profile.id} suppliers={supplierOptions} selected={supplierIds} canConfigure={canConfigure && !isTargetSuper} />
              )}
            </CardContent>
          </Card>
        ) : null}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Quyền hiệu lực</CardTitle>
            <CardDescription>{isTargetSuper ? "Super Admin có toàn quyền." : `${effective.size} quyền`}</CardDescription>
          </CardHeader>
          <CardContent>
            {effective.size === 0 ? (
              <p className="text-sm text-muted-foreground">Người dùng chưa có quyền nào.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {[...byModule.entries()].map(([m, acts]) => (
                  <div key={m} className="rounded-md border p-2 text-sm">
                    <div className="font-medium">{MODULE_LABELS[m as ModuleKey] ?? m}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {acts.map((a) => (
                        <Badge key={a} variant="secondary">{ACTION_LABELS[a] ?? a}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
