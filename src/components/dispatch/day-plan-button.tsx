"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarDays, Download, ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { exportDayPlan, loadDayPlan } from "@/app/(app)/dieu-phoi/day-plan-actions";
import { C20_INDEX, DAY_PLAN_ADDRESS, DAY_PLAN_COLUMNS, DAY_PLAN_TITLE, dayPlanTotals, type DayPlan } from "@/lib/day-plan";
import { cellText, drawPlan } from "./day-plan-image";

const STORE = "dayPlanHeader.v1";
function tomorrowVN(): string {
  const now = new Date(Date.now() + 7 * 3600_000);
  now.setUTCDate(now.getUTCDate() + 1);
  return now.toISOString().slice(0, 10);
}
const dmy = (ymd: string) => ymd.split("-").reverse().join("/");

/**
 * Nút "Kế hoạch xe ngày mai" ở Điều phối: chọn ngày (mặc định ngày mai), xem trước,
 * xuất Excel đúng mẫu Bảng phân công lịch vận chuyển, hoặc chép ảnh bảng để dán Zalo.
 */
export function DayPlanButton() {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(tomorrowVN);
  const [address, setAddress] = useState(DAY_PLAN_ADDRESS);
  const [title, setTitle] = useState(DAY_PLAN_TITLE);
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [exporting, startExport] = useTransition();
  const [copying, setCopying] = useState(false);

  const saveHeader = (a: string, t: string) => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ address: a, title: t }));
    } catch {}
  };

  const load = (d: string) => {
    setDate(d);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
    startLoad(async () => {
      const r = await loadDayPlan(d);
      if (!r.ok || !r.data) {
        setPlan(null);
        setError(r.ok ? "Không tải được dữ liệu" : r.error);
      } else {
        setPlan(r.data);
        setError(null);
      }
    });
  };

  const openDialog = () => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) ?? "null") as { address?: string; title?: string } | null;
      if (s?.address) setAddress(s.address);
      if (s?.title) setTitle(s.title);
    } catch {}
    setOpen(true);
    load(date);
  };

  const dateLabel = `Ngày ${dmy(date)}`;
  const busy = loading || !plan;

  const doExport = () =>
    startExport(async () => {
      const r = await exportDayPlan(date, address, title);
      if (!r.ok || !r.data) return void toast.error(r.ok ? "Không tạo được tệp" : r.error);
      const bytes = Uint8Array.from(atob(r.data.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.data.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Đã xuất kế hoạch ${dmy(date)}: ${r.data.count} chuyến.`);
    });

  const doCopy = async () => {
    if (!plan) return;
    setCopying(true);
    try {
      const cv = drawPlan(plan, address || DAY_PLAN_ADDRESS, title || DAY_PLAN_TITLE, dateLabel);
      const blob = new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"));
      try {
        if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("no clipboard");
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast.success("Đã chép ảnh kế hoạch. Mở Zalo hoặc email rồi bấm Ctrl+V để dán.");
      } catch {
        // Trình duyệt không cho chép ảnh (Firefox cũ, iPhone): tải ảnh về máy
        const url = URL.createObjectURL(await blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ke-hoach-xe_${date}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.info("Trình duyệt không cho chép ảnh, đã tải ảnh kế hoạch về máy.");
      }
    } catch {
      toast.error("Không tạo được ảnh kế hoạch.");
    } finally {
      setCopying(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={openDialog}>
        <CalendarDays /> Kế hoạch xe ngày mai
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Kế hoạch xe theo ngày</DialogTitle>
            <DialogDescription>
              Bảng phân công các chuyến nhận hàng trong ngày đã chọn (mặc định ngày mai, không tính chuyến đã hủy). Xuất Excel hoặc chép ảnh để gửi tài xế, khách hàng.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <div className="grid gap-1">
              <Label htmlFor="dp-date">Ngày</Label>
              <Input id="dp-date" type="date" value={date} onChange={(e) => load(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="dp-addr">Địa chỉ công ty (dòng đầu)</Label>
              <Input
                id="dp-addr"
                value={address}
                placeholder={DAY_PLAN_ADDRESS}
                onChange={(e) => setAddress(e.target.value)}
                onBlur={() => saveHeader(address, title)}
              />
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <Label htmlFor="dp-title">Tiêu đề</Label>
              <Input id="dp-title" value={title} placeholder={DAY_PLAN_TITLE} onChange={(e) => setTitle(e.target.value)} onBlur={() => saveHeader(address, title)} />
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border">
            {error ? (
              <p className="p-4 text-sm text-destructive">{error}</p>
            ) : loading || !plan ? (
              <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Đang tải...
              </p>
            ) : (
              <table className="w-full min-w-[900px] border-collapse text-center text-xs">
                <thead className="bg-[#95B3D7] font-semibold text-black">
                  <tr>
                    {DAY_PLAN_COLUMNS.map((c, i) =>
                      !c.group ? (
                        <th key={c.key} rowSpan={2} className="border border-black/60 px-1 py-1">
                          {c.label}
                        </th>
                      ) : DAY_PLAN_COLUMNS[i - 1]?.group !== c.group ? (
                        <th key={c.key} colSpan={DAY_PLAN_COLUMNS.filter((d) => d.group === c.group).length} className="border border-black/60 px-1 py-1">
                          {c.group}
                        </th>
                      ) : null,
                    )}
                  </tr>
                  <tr>
                    {DAY_PLAN_COLUMNS.filter((c) => c.group).map((c) => (
                      <th key={c.key} className="border border-black/60 px-1 py-1">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((r) => (
                    <tr key={r.stt}>
                      {DAY_PLAN_COLUMNS.map((c) => (
                        <td key={c.key} className="border border-black/30 px-1 py-1">
                          {cellText(r, c.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {plan.rows.length === 0 ? (
                    <tr>
                      <td colSpan={DAY_PLAN_COLUMNS.length} className="p-4 text-muted-foreground">
                        Chưa có chuyến nào nhận hàng ngày {dmy(date)}.
                      </td>
                    </tr>
                  ) : null}
                  {(() => {
                    const sum = dayPlanTotals(plan.rows);
                    const rest = DAY_PLAN_COLUMNS.length - C20_INDEX - 2;
                    const td = "border border-black/60 bg-[#DCE6F1] px-1 py-1 font-semibold";
                    return (
                      <>
                        <tr>
                          <td colSpan={C20_INDEX} className={td}>Tổng</td>
                          <td className={td}>{sum.c20}</td>
                          <td className={td}>{sum.c40}</td>
                          {rest > 0 ? <td colSpan={rest} className={td} /> : null}
                        </tr>
                        <tr>
                          <td colSpan={C20_INDEX} className={td}>TOTAL</td>
                          <td colSpan={2} className={td}>{sum.total}</td>
                          {rest > 0 ? <td colSpan={rest} className={td} /> : null}
                        </tr>
                      </>
                    );
                  })()}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Nơi lấy cont = Điểm nhận, Nơi đóng hàng = Điểm giao, Nơi hạ = Điểm hạ rỗng (hoặc hạ rỗng trái tuyến). Cont 20/40 lấy theo Loại cont, dòng Total = tổng cont 20 + tổng cont 40. Loại hình và Số cont lấy từ trường bổ sung &quot;Loại hình...&quot; và &quot;Số cont&quot; của chuyến hoặc đơn (nếu chưa có trường Số cont, hệ thống tìm số cont trong hàng hóa và ghi chú).
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={busy || copying} onClick={doCopy}>
              {copying ? <Loader2 className="animate-spin" /> : <ImageIcon />} Copy hình ảnh
            </Button>
            <Button disabled={busy || exporting} onClick={doExport}>
              {exporting ? <Loader2 className="animate-spin" /> : <Download />} Xuất Excel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
