"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { formatDateTime, formatNumber } from "@/lib/format";
import { checkPurgePassword, purgeTestData, setPurgePassword, type TestDataCounts } from "./purge-actions";

const CONFIRM_TEXT = "XOA DU LIEU";

const DELETE_ROWS: [string, string][] = [
  ["transport_orders", "Đơn hàng"],
  ["shipments", "Chuyến xe"],
  ["shipment_items", "Hàng hóa của chuyến"],
  ["shipment_fees", "Phí thu khách của chuyến"],
  ["shipment_expenses", "Chi phí chuyến"],
  ["advance_requests", "Phiếu ứng tiền"],
  ["purchase_requests", "Phiếu đề nghị chi, mua sắm"],
  ["approval_requests", "Yêu cầu phê duyệt"],
  ["driver_payrolls", "Bảng lương tài xế"],
  ["receivables", "Công nợ phải thu"],
  ["payables", "Công nợ phải trả"],
  ["payments", "Phiếu thu / chi"],
  ["notifications", "Thông báo"],
];
const KEEP_ROWS: [string, string][] = [
  ["customers", "Khách hàng"],
  ["vehicles", "Xe"],
  ["drivers", "Tài xế"],
  ["profiles", "Người dùng"],
];

/** Xóa dữ liệu thử: nhập mật khẩu xóa dữ liệu → xem số dòng → gõ XOA DU LIEU → Xóa (chỉ Super Admin/Admin) */
export function PurgeCard({ passwordSet, updatedAt }: { passwordSet: boolean; updatedAt: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [counts, setCounts] = useState<TestDataCounts | null>(null);
  const [confirm, setConfirm] = useState("");
  const [pwOpen, setPwOpen] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");

  const reset = () => {
    setPassword("");
    setCounts(null);
    setConfirm("");
  };
  const total = counts ? DELETE_ROWS.reduce((s, [k]) => s + (counts[k] ?? 0), 0) : 0;

  return (
    <Card className="mt-4 border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base">Xóa dữ liệu thử</CardTitle>
        <CardDescription>
          Xóa toàn bộ đơn hàng, chuyến, chi phí, ứng tiền, lương, công nợ, phiếu thu chi để bắt đầu dùng thật. Giữ nguyên khách hàng, xe, tài xế, bảng giá, danh mục, người
          dùng, cấu hình và nhật ký. Không hoàn tác được. Chỉ Super Admin, Admin thực hiện được và phải nhập mật khẩu xóa dữ liệu.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button variant="destructive" disabled={!passwordSet} onClick={() => (reset(), setOpen(true))}>
          <Trash2 /> Xóa dữ liệu
        </Button>
        <Button variant="outline" onClick={() => (setOldPw(""), setNewPw(""), setNewPw2(""), setPwOpen(true))}>
          <KeyRound /> {passwordSet ? "Đổi mật khẩu xóa dữ liệu" : "Đặt mật khẩu xóa dữ liệu"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {passwordSet ? `Mật khẩu đặt lúc ${formatDateTime(updatedAt)}.` : "Chưa có mật khẩu xóa dữ liệu: đặt trước rồi mới xóa được."}
        </span>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{counts ? "Xác nhận xóa dữ liệu thử" : "Nhập mật khẩu xóa dữ liệu"}</DialogTitle>
            <DialogDescription>
              {counts ? `Gõ ${CONFIRM_TEXT} rồi bấm Xóa. Việc này không hoàn tác được.` : "Mật khẩu riêng cho việc xóa dữ liệu (không phải mật khẩu đăng nhập)."}
            </DialogDescription>
          </DialogHeader>
          {!counts ? (
            <form
              id="purge-step1"
              className="space-y-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const r = await checkPurgePassword(password);
                  if (!r.ok) return void toast.error(r.error);
                  setCounts(r.data ?? {});
                });
              }}
            >
              <Label htmlFor="purge-pw">Mật khẩu xóa dữ liệu</Label>
              <Input id="purge-pw" type="password" autoComplete="off" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="text-xs text-muted-foreground">Sai 5 lần trong 15 phút sẽ bị khóa thử lại 15 phút. Mỗi lần sai đều ghi vào nhật ký.</p>
            </form>
          ) : (
            <form
              id="purge-step2"
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const r = await purgeTestData({ password, confirm });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.message);
                  setOpen(false);
                  reset();
                  router.refresh();
                });
              }}
            >
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 rounded-md border p-3 text-sm">
                <div className="col-span-2 mb-1 font-medium text-destructive">Sẽ xóa ({formatNumber(total)} dòng)</div>
                {DELETE_ROWS.map(([k, label]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="tabular-nums">{formatNumber(counts[k] ?? 0)}</span>
                  </div>
                ))}
                <div className="col-span-2 mt-2 mb-1 font-medium">Giữ lại</div>
                {KEEP_ROWS.map(([k, label]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="tabular-nums">{formatNumber(counts[k] ?? 0)}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="purge-confirm">
                  Gõ <b>{CONFIRM_TEXT}</b> để xác nhận
                </Label>
                <Input id="purge-confirm" autoComplete="off" autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={CONFIRM_TEXT} />
              </div>
            </form>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Hủy
            </Button>
            {!counts ? (
              <Button type="submit" form="purge-step1" disabled={pending || !password}>
                {pending ? <Loader2 className="animate-spin" /> : null} Tiếp tục
              </Button>
            ) : (
              <Button type="submit" form="purge-step2" variant="destructive" disabled={pending || confirm.trim().toUpperCase() !== CONFIRM_TEXT}>
                {pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Xóa
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pwOpen} onOpenChange={(o) => !pending && setPwOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{passwordSet ? "Đổi mật khẩu xóa dữ liệu" : "Đặt mật khẩu xóa dữ liệu"}</DialogTitle>
            <DialogDescription>Mật khẩu riêng, chỉ dùng khi xóa dữ liệu thử. Ít nhất 8 ký tự. Hệ thống chỉ lưu dạng mã hóa, không ai xem lại được.</DialogDescription>
          </DialogHeader>
          <form
            id="purge-setpw"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (newPw !== newPw2) return void toast.error("Hai lần nhập mật khẩu mới không khớp.");
              start(async () => {
                const r = await setPurgePassword({ newPassword: newPw, oldPassword: passwordSet ? oldPw : undefined });
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.message);
                setPwOpen(false);
                router.refresh();
              });
            }}
          >
            {passwordSet ? (
              <div className="space-y-1.5">
                <Label htmlFor="purge-old">Mật khẩu hiện tại</Label>
                <Input id="purge-old" type="password" autoComplete="off" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="purge-new">Mật khẩu mới</Label>
              <Input id="purge-new" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="purge-new2">Nhập lại mật khẩu mới</Label>
              <Input id="purge-new2" type="password" autoComplete="new-password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setPwOpen(false)}>
              Hủy
            </Button>
            <Button type="submit" form="purge-setpw" disabled={pending || newPw.length < 8}>
              {pending ? <Loader2 className="animate-spin" /> : null} Lưu mật khẩu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
