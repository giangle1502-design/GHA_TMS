import type { Metadata } from "next";
import { requireActiveUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ACTION_LABELS, MODULE_LABELS, type ModuleKey } from "@/lib/permissions";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Tài khoản của tôi" };

export default async function AccountPage() {
  const user = await requireActiveUser();
  const byModule = new Map<string, string[]>();
  [...user.permissions].sort().forEach((p) => {
    const [m, a] = p.split(".");
    byModule.set(m, [...(byModule.get(m) ?? []), a]);
  });
  return (
    <>
      <PageHeader title="Tài khoản của tôi" description={user.email} />
      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Hồ sơ</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm fullName={user.fullName ?? ""} phone={user.phone ?? ""} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Vai trò và quyền</CardTitle>
            <CardDescription>
              {user.roles.map((r) => r.name).join(", ") || "Chưa có vai trò"} · {user.permissions.size} quyền hiệu lực
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
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
          </CardContent>
        </Card>
      </div>
    </>
  );
}
