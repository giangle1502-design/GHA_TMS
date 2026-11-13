"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { formatDateTime, todayVN } from "@/lib/format";
import { grantTripDelegation, revokeTripDelegation } from "@/app/(app)/dieu-phoi/actions";

export type TripDelegation = {
  id: string;
  delegate_name: string;
  granted_by_name: string | null;
  starts_at: string;
  ends_at: string | null;
  note: string | null;
  revoked_at: string | null;
  active: boolean;
};
export type DelegationInfo = {
  is_approver: boolean;
  is_delegate: boolean;
  my_delegation: { ends_at: string | null; granted_by_name: string | null } | null;
  delegations: TripDelegation[] | null;
  candidates: { id: string; name: string; email: string; roles: string | null }[] | null;
};

/** Dòng báo cho người đang được ủy quyền duyệt hộ */
export function DelegateNotice({ info }: { info: DelegationInfo | null }) {
  if (!info?.is_delegate || info.is_approver) return null;
  const d = info.my_delegation;
  return (
    <p className="mb-3 rounded-lg border border-tone-blue/40 bg-tone-blue/10 px-3 py-2 text-sm">
      <UserCheck className="mr-1 inline size-4" />
      Bạn đang được {d?.granted_by_name ?? "Giám đốc"} <b>ủy quyền duyệt chuyến</b>
      {d?.ends_at ? ` đến ${formatDateTime(d.ends_at)}` : " đến khi thu hồi"}. Duyệt ở thẻ “Chờ GĐ duyệt”; lịch sử ghi là duyệt hộ và Giám đốc được báo lại.
    </p>
  );
}

/** Giám đốc quản lý ủy quyền duyệt hộ chuyến (công tác, hội họp) */
export function TripDelegationManager({ info, compact }: { info: DelegationInfo | null; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [delegateId, setDelegateId] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const candidates = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (info?.candidates ?? []).filter((c) => !term || `${c.name} ${c.email} ${c.roles ?? ""}`.toLowerCase().includes(term));
  }, [info, q]);
  if (!info?.is_approver) return null;
  const list = info.delegations ?? [];
  const active = list.filter((d) => d.active);
  return (
    <>
      <Button size="sm" variant="outline" className={compact ? "h-7 px-2" : ""} onClick={() => setOpen(true)} title="Ủy quyền người khác duyệt hộ chuyến khi đi công tác, hội họp">
        <UserCheck /> Ủy quyền duyệt hộ{active.length ? ` (${active.length})` : ""}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ủy quyền duyệt chuyến</DialogTitle>
            <DialogDescription>
              Người được ủy quyền duyệt hoặc từ chối chuyến thay Giám đốc trong thời gian ủy quyền (chỉ duyệt chuyến, không duyệt tiền). Mỗi lần duyệt hộ được ghi “Duyệt hộ Giám đốc” và bạn nhận thông báo. Thu hồi được bất cứ lúc nào.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dlg-search">Người được ủy quyền *</Label>
              <Input id="dlg-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, email, vai trò" />
              <select
                aria-label="Chọn người được ủy quyền"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={delegateId}
                onChange={(e) => setDelegateId(e.target.value)}
              >
                <option value="">— Chọn người —</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.roles ?? c.email})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Danh sách gồm người dùng đang hoạt động có quyền điều phối (phân công chuyến), ví dụ trưởng điều phối.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dlg-end">Hiệu lực đến hết ngày</Label>
              <Input id="dlg-end" type="date" min={todayVN()} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
              <p className="text-xs text-muted-foreground">Ví dụ ngày về sau chuyến công tác. Để trống = đến khi bạn thu hồi.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dlg-note">Ghi chú</Label>
              <Textarea id="dlg-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Ví dụ: Đi công tác Hà Nội 3 ngày" />
            </div>
          </div>
          <DialogFooter className="static mx-0 mb-0 border-t-0 p-0">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Đóng
            </Button>
            <Button
              disabled={pending || !delegateId}
              onClick={() =>
                start(async () => {
                  const r = await grantTripDelegation({ delegateId, endsOn, note: note.trim() || undefined });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.message);
                  setDelegateId("");
                  setEndsOn("");
                  setNote("");
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : null} Ủy quyền
            </Button>
          </DialogFooter>

          {list.length ? (
            <div className="mt-2 space-y-2 border-t pt-3">
              <p className="text-sm font-medium">Các lần ủy quyền gần đây</p>
              {list.map((d) => (
                <div key={d.id} className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {d.delegate_name}{" "}
                      {d.active ? <Badge variant="success">Đang hiệu lực</Badge> : <Badge variant="muted">{d.revoked_at ? "Đã thu hồi" : "Hết hạn"}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Từ {formatDateTime(d.starts_at)} {d.ends_at ? `đến ${formatDateTime(d.ends_at)}` : "đến khi thu hồi"}
                      {d.revoked_at ? ` · thu hồi ${formatDateTime(d.revoked_at)}` : ""}
                      {d.note ? ` · ${d.note}` : ""}
                    </div>
                  </div>
                  {d.active ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-destructive"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await revokeTripDelegation(d.id);
                          if (!r.ok) return void toast.error(r.error);
                          toast.success(r.message);
                          router.refresh();
                        })
                      }
                    >
                      Thu hồi
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
