import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Group = { id: string; name: string; report_role: string };
type FeeType = { name: string; fee_kind: string; fee_group_id: string | null };

const ROLE_HELP: Record<string, string> = {
  freight: "cộng vào Phí vận chuyển",
  pass_through: "chi hộ",
  declaration: "tờ khai (có ô Loại tờ khai)",
  loading: "bốc xếp",
  other: "khác",
};

/**
 * Công thức tính tiền của chuyến, dựng từ Danh mục (Nhóm phí + Loại phí thu khách).
 * Người dùng đổi công thức bằng cách đổi nhóm, vai trò nhóm, cách tính của loại phí.
 */
export async function FeeFormulaCard() {
  const supabase = await createClient();
  const [g, t] = await Promise.all([
    supabase.from("fee_groups").select("id, name, report_role").eq("is_active", true).order("sort_order"),
    supabase.from("fee_types").select("name, fee_kind, fee_group_id").eq("is_active", true).order("sort_order"),
  ]);
  const groups = (g.data ?? []) as Group[];
  const types = (t.data ?? []) as FeeType[];
  const roleOf = new Map(groups.map((x) => [x.id, x.report_role]));
  const inGroup = (id: string) => types.filter((x) => x.fee_group_id === id);
  const freightFees = types.filter((x) => x.fee_group_id && roleOf.get(x.fee_group_id) === "freight").map((x) => x.name);
  const revenueOthers = types.filter((x) => x.fee_kind === "revenue" && !(x.fee_group_id && roleOf.get(x.fee_group_id) === "freight")).map((x) => x.name);
  const notRevenue = types.filter((x) => x.fee_kind === "pass_through").map((x) => x.name);
  const ungrouped = types.filter((x) => !x.fee_group_id).map((x) => x.name);

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-base">Công thức tính tiền của chuyến</CardTitle>
        <CardDescription>
          Công thức lấy từ Danh mục. Muốn đổi: vào <Link className="text-primary hover:underline" href="/danh-muc?tab=fee_catalog_groups&nguon=customer">Nhóm phí</Link> (vai trò, Tính vào của nhóm) hoặc{" "}
          <Link className="text-primary hover:underline" href="/danh-muc?tab=fee_catalog_items&nguon=customer">Danh mục phí</Link> (nguồn Thu khách: nhóm, Tính vào Doanh thu / Chi hộ). Áp dụng ngay cho Điều
          phối, Quản lý chuyến, Báo cáo, Tổng quan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Formula
          name="Phí vận chuyển"
          parts={["Đơn giá × Số lượng × (1 + % hỗ trợ dầu / 100)", "Phụ phí bảng giá (nếu có)", ...freightFees]}
        />
        <Formula name="Doanh thu" parts={["Phí vận chuyển", ...revenueOthers]} note="Tổng quan, lợi nhuận tính theo số này." />
        <Formula name="Khách phải trả" parts={["Doanh thu", ...notRevenue]} note="Chi hộ, bốc xếp: khách trả lại, không tính doanh thu." />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {groups.map((x) => (
            <div key={x.id} className="rounded-md border p-2">
              <div className="font-medium">{x.name}</div>
              <div className="text-xs text-muted-foreground">Vai trò: {ROLE_HELP[x.report_role] ?? x.report_role}</div>
              <div className="mt-1 text-xs">{inGroup(x.id).map((f) => f.name).join(" + ") || "Chưa có phí"}</div>
            </div>
          ))}
        </div>
        {ungrouped.length ? (
          <p className="text-xs text-amber-700">Phí chưa xếp nhóm (hiện ở mục Phí khác): {ungrouped.join(", ")}. Chọn nhóm cho chúng ở Danh mục → Danh mục phí → Thu khách.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Formula({ name, parts, note }: { name: string; parts: string[]; note?: string }) {
  return (
    <div>
      <div>
        <b>{name}</b> = {parts.join(" + ")}
      </div>
      {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
    </div>
  );
}
