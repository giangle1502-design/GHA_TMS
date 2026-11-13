"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Lock, LockOpen, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lockAttendance, setAttendance } from "@/lib/attendance/actions";
import { cn } from "@/lib/utils";

type Status = "work" | "leave_paid" | "sick" | "leave_unpaid" | "absent" | "off" | "pending" | "upcoming";
type Cell = { s: Status; src: "manual" | "trip" | "trip_long" | "leave_request" | "auto"; t: number; n: string | null; r?: string | null };
type Reason = { id: string; name: string; sym: string; cat: Exclude<Status, "pending" | "upcoming">; active: boolean };
export type AttendanceMonth = {
  month: string;
  days: { date: string; off: boolean; holiday: string | null }[];
  locked: boolean;
  can_edit: boolean;
  can_lock: boolean;
  can_config?: boolean;
  reasons?: Reason[];
  drivers: { id: string; code: string; name: string; plate: string | null; cells: Record<string, Cell> }[];
};

const LOOK: Record<Status, { sym: string; label: string; cls: string }> = {
  work: { sym: "✓", label: "Đi làm", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  leave_paid: { sym: "P", label: "Nghỉ có lương (phép, việc riêng…)", cls: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  sick: { sym: "BH", label: "Nghỉ hưởng BHXH (ốm, thai sản…)", cls: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300" },
  leave_unpaid: { sym: "KL", label: "Nghỉ không lương", cls: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300" },
  absent: { sym: "V", label: "Nghỉ không báo", cls: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  off: { sym: "N", label: "Ngày nghỉ, lễ", cls: "bg-muted text-muted-foreground" },
  pending: { sym: "?", label: "Chờ xác nhận", cls: "bg-yellow-200 text-yellow-900 dark:bg-yellow-900 dark:text-yellow-100" },
  upcoming: { sym: "", label: "Chưa tới", cls: "" },
};
const SUMMARY: Status[] = ["work", "leave_paid", "sick", "leave_unpaid", "absent", "pending"];
const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

const key = (driverId: string, date: string) => `${driverId}|${date}`;
const shiftMonth = (m: string, delta: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};

export function AttendanceGrid({ month, data, today }: { month: string; data: AttendanceMonth; today: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const reasons = useMemo(() => data.reasons ?? [], [data.reasons]);
  const reasonById = useMemo(() => new Map(reasons.map((r) => [r.id, r])), [reasons]);
  // Ô không có lý do (tự chấm, theo đơn nghỉ): ký hiệu của lý do đầu tiên cùng nhóm (lý do có sẵn)
  const catSym = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of reasons) if (!m.has(r.cat)) m.set(r.cat, r.sym);
    return m;
  }, [reasons]);

  const drivers = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return data.drivers;
    return data.drivers.filter((d) => `${d.name} ${d.code} ${d.plate ?? ""}`.toLowerCase().includes(t));
  }, [data.drivers, q]);
  const pendingKeys = useMemo(
    () => drivers.flatMap((d) => Object.entries(d.cells).filter(([, c]) => c.s === "pending").map(([day]) => key(d.id, day))),
    [drivers],
  );

  const toggle = (k: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const apply = (reasonId: string | null) =>
    start(async () => {
      const cells = [...sel].map((k) => {
        const [driverId, date] = k.split("|");
        return { driverId, date };
      });
      const r = await setAttendance({ cells, reasonId, note: note || undefined });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${r.message} (${r.data ?? cells.length} ô)`);
      setSel(new Set());
      setNote("");
      router.refresh();
    });
  const lock = (locked: boolean) =>
    start(async () => {
      const r = await lockAttendance({ month: `${month}-01`, locked });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm" aria-label="Tháng trước">
          <Link href={`/cham-cong?thang=${shiftMonth(month, -1)}`}>
            <ChevronLeft />
          </Link>
        </Button>
        <Input
          type="month"
          value={month}
          onChange={(e) => e.target.value && router.push(`/cham-cong?thang=${e.target.value}`)}
          className="w-40"
          aria-label="Tháng"
        />
        <Button asChild variant="outline" size="sm" aria-label="Tháng sau">
          <Link href={`/cham-cong?thang=${shiftMonth(month, 1)}`}>
            <ChevronRight />
          </Link>
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tài xế, mã, biển số" className="w-60 pl-8" aria-label="Tìm tài xế" />
        </div>
        {data.locked ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm">
            <Lock className="size-4" /> Đã chốt công tháng này
          </span>
        ) : null}
        {data.can_lock ? (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => lock(!data.locked)} className="ml-auto">
            {data.locked ? <LockOpen /> : <Lock />} {data.locked ? "Mở chốt công" : "Chốt công tháng"}
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {reasons
          .filter((r) => r.active)
          .map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1">
              <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-semibold", LOOK[r.cat].cls)}>{r.sym}</span>
              {r.name}
            </span>
          ))}
        <span className="inline-flex items-center gap-1">
          <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-semibold", LOOK.pending.cls)}>?</span>
          {LOOK.pending.label}
        </span>
        {data.can_config ? (
          <Link href="/luong-tai-xe?tab=attendance_reasons" className="text-primary hover:underline">
            Thêm, sửa lý do ngày công
          </Link>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-dashed border-emerald-400 px-1 font-semibold text-emerald-700">1</span>
          Đã lên lịch (ngày sắp tới)
        </span>
        <span>
          Số trong ô = số chuyến có ngày nhận hôm đó (xe nội bộ). Chuyến nhiều ngày (cột Số ngày giao ở Điều phối) tính công đủ các ngày, hiện ✓. Ô có viền = điều phối đã
          xác nhận / sửa tay.
        </span>
      </div>

      {data.can_edit ? (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 text-sm shadow-sm">
          <span className="font-medium">Đã chọn {sel.size} ô</span>
          <Button size="sm" variant="outline" disabled={!pendingKeys.length || pending} onClick={() => setSel(new Set(pendingKeys))}>
            Chọn tất cả ô chờ xác nhận ({pendingKeys.length})
          </Button>
          {sel.size ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
                Bỏ chọn
              </Button>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú (ví dụ: chờ hàng, bảo dưỡng xe)" className="h-8 w-64" maxLength={500} />
              {reasons
                .filter((r) => r.active)
                .map((r) => (
                  <Button key={r.id} size="sm" variant={r.cat === "work" && r.sym === "✓" ? "default" : "outline"} disabled={pending} onClick={() => apply(r.id)} title={LOOK[r.cat].label}>
                    <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-xs font-semibold", LOOK[r.cat].cls)}>{r.sym}</span>
                    {r.name}
                  </Button>
                ))}
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => apply(null)}>
                Trả về tự động
              </Button>
            </>
          ) : (
            <span className="text-muted-foreground">Bấm vào các ô ngày để chọn, rồi chọn lý do: Có đi làm, Nghỉ phép năm, Nghỉ vợ sinh (thai sản)...</span>
          )}
        </div>
      ) : null}

      <div className="overflow-auto rounded-lg border" style={{ maxHeight: "70vh" }}>
        <table className="w-max border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              <th className="sticky left-0 z-10 min-w-48 border-b bg-card px-2 py-1 text-left">Tài xế</th>
              {data.days.map((d) => {
                const dt = new Date(`${d.date}T00:00:00Z`);
                return (
                  <th
                    key={d.date}
                    title={d.holiday ?? undefined}
                    className={cn("w-8 border-b px-0.5 py-1 text-center font-normal", d.off && "bg-muted", d.date === today && "text-primary font-semibold")}
                  >
                    <div>{dt.getUTCDate()}</div>
                    <div className="text-[10px] text-muted-foreground">{WEEKDAY[dt.getUTCDay()]}</div>
                  </th>
                );
              })}
              <th className="border-b border-l px-1.5 py-1 text-center" title="Tổng số chuyến trong tháng (xe nội bộ, kể cả chuyến đã lên lịch)">
                Chuyến
              </th>
              {SUMMARY.map((s) => (
                <th key={s} className="border-b border-l px-1.5 py-1 text-center" title={LOOK[s].label}>
                  {s === "work" ? "Công" : LOOK[s].sym}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drivers.map((dr) => {
              const counts = Object.fromEntries(SUMMARY.map((s) => [s, 0])) as Record<Status, number>;
              let tripTotal = 0;
              Object.values(dr.cells).forEach((c) => {
                if (c.s in counts) counts[c.s] += 1;
                tripTotal += c.t;
              });
              return (
                <tr key={dr.id} className="hover:bg-muted/40">
                  <td className="sticky left-0 z-[1] border-b bg-card px-2 py-1">
                    <div className="font-medium">{dr.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {dr.code}
                      {dr.plate ? ` · ${dr.plate}` : ""}
                    </div>
                  </td>
                  {data.days.map((d) => {
                    const c = dr.cells[d.date];
                    if (!c) return <td key={d.date} className="border-b bg-muted/30" />;
                    const k = key(dr.id, d.date);
                    const look = LOOK[c.s];
                    const reason = c.r ? reasonById.get(c.r) : undefined;
                    const planned = c.s === "upcoming" && c.t > 0;
                    const title = [
                      planned ? "Đã lên lịch" : (reason?.name ?? look.label),
                      c.t ? `${c.t} chuyến nhận hàng hôm nay` : "",
                      c.src === "trip_long" ? "đang chạy chuyến nhiều ngày" : "",
                      c.src === "manual" ? "đã xác nhận tay" : c.src === "leave_request" ? "theo đơn xin nghỉ" : "",
                      c.n ?? "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <td key={d.date} className="border-b p-0.5 text-center">
                        <button
                          type="button"
                          title={title}
                          disabled={!data.can_edit || pending}
                          onClick={() => toggle(k)}
                          className={cn(
                            "h-7 w-7 rounded text-[11px] font-semibold disabled:cursor-default",
                            look.cls,
                            planned && "border border-dashed border-emerald-400 text-emerald-700",
                            c.src === "manual" && "ring-1 ring-foreground/40",
                            sel.has(k) && "ring-2 ring-primary ring-offset-1",
                          )}
                        >
                          {(c.s === "work" || planned) && c.t > 0 ? c.t : (reason?.sym ?? catSym.get(c.s) ?? look.sym)}
                        </button>
                      </td>
                    );
                  })}
                  <td className="border-b border-l px-1.5 text-center font-medium tabular-nums">{tripTotal || ""}</td>
                  {SUMMARY.map((s) => (
                    <td key={s} className={cn("border-b border-l px-1.5 text-center tabular-nums", s === "pending" && counts[s] > 0 && "font-semibold text-yellow-700")}>
                      {counts[s] || ""}
                    </td>
                  ))}
                </tr>
              );
            })}
            {!drivers.length ? (
              <tr>
                <td colSpan={data.days.length + 2 + SUMMARY.length} className="p-6 text-center text-muted-foreground">
                  Không có tài xế nào.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
