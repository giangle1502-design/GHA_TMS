import type { Metadata } from "next";
import { requirePagePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { SettingValueEditor } from "./setting-row";
import { PurgeCard } from "./purge-card";
import { FeeFormulaCard } from "./fee-formula-card";

export const metadata: Metadata = { title: "Cấu hình" };

export default async function SettingsPage() {
  const me = await requirePagePermission("settings.view");
  const supabase = await createClient();
  const { data, error } = await supabase.from("system_settings").select("key, value, description, updated_at").order("key");
  if (error) throw error;
  const canEdit = me.permissions.has("settings.configure");
  // Xóa dữ liệu thử: chỉ Super Admin/Admin (CSDL kiểm tra lại vai trò và mật khẩu)
  const isAdmin = me.roles.some((r) => r.code === "super_admin" || r.code === "admin");
  // Ứng dụng tài xế: các công tắc gom vào một thẻ ở đầu trang
  const DRIVER_KEYS = ["driver.photos_enabled", "shipment.require_delivery_photo", "driver.expense_enabled", "driver.expense_sheet_photo"];
  const DRIVER_LABEL: Record<string, { title: string; hint: string }> = {
    "driver.photos_enabled": { title: "Cho tài xế chụp ảnh", hint: "Tắt: ẩn mọi ô chụp ảnh (hoàn thành chuyến, hóa đơn chi phí), không bắt buộc ảnh ở đâu." },
    "shipment.require_delivery_photo": {
      title: "Đơn mới mặc định tích \"Khách yêu cầu chụp chứng từ\"",
      hint: "Điều phối tích / bỏ tích ô này ở từng chuyến khi tạo, sửa đơn. Có tích: tài xế bắt buộc chụp ảnh giao hàng. Không tích: app tài xế bỏ qua bước chụp ảnh.",
    },
    "driver.expense_enabled": { title: "Cho tài xế nhập chi phí", hint: "Tắt: hoàn thành chuyến không hỏi chi phí, ẩn Bổ sung chi phí; văn phòng nhập chi phí ở chi tiết chuyến." },
    "driver.expense_sheet_photo": {
      title: "Tài xế chụp phiếu chi phí thay cho nhập từng khoản",
      hint: "Bật: hoàn thành chuyến mặc định Có chi phí, bắt buộc chụp phiếu chi phí; không chụp được thì phải chọn Không có chi phí. Điều phối / kế toán mở ảnh và nhập chi phí. Tắt: tài xế tự nhập từng khoản.",
    },
  };
  const driverRows = DRIVER_KEYS.map((k) => (data ?? []).find((s) => s.key === k)).filter((s): s is NonNullable<typeof s> => Boolean(s));
  const otherRows = (data ?? []).filter((s) => !DRIVER_KEYS.includes(s.key));
  const purgeStatus = isAdmin ? ((await supabase.rpc("purge_password_status")).data as { is_set: boolean; updated_at: string | null } | null) : null;
  return (
    <>
      <PageHeader title="Cấu hình" description="Tham số hệ thống. Mỗi lần thay đổi được ghi nhật ký." />
      {driverRows.length ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Ứng dụng tài xế</CardTitle>
            <CardDescription>Bật / tắt chụp ảnh và nhập chi phí trên điện thoại tài xế. Có tác dụng ngay, không cần tài xế cài lại.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {driverRows.map((s) => (
              <div key={s.key} data-setting={s.key} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <div className="font-medium">{DRIVER_LABEL[s.key]?.title ?? s.description}</div>
                  <div className="text-sm text-muted-foreground">{DRIVER_LABEL[s.key]?.hint}</div>
                </div>
                <SettingValueEditor settingKey={s.key} value={s.value} canEdit={canEdit} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <FeeFormulaCard />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tham số</TableHead>
              <TableHead className="w-[40%]">Giá trị (JSON)</TableHead>
              <TableHead>Cập nhật</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {otherRows.map((s) => (
              <TableRow key={s.key}>
                <TableCell>
                  <div className="font-medium">{s.description ?? s.key}</div>
                  <code className="text-xs text-muted-foreground">{s.key}</code>
                </TableCell>
                <TableCell>
                  <SettingValueEditor settingKey={s.key} value={s.value} canEdit={canEdit} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDateTime(s.updated_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {isAdmin ? <PurgeCard passwordSet={Boolean(purgeStatus?.is_set)} updatedAt={purgeStatus?.updated_at ?? null} /> : null}
    </>
  );
}
