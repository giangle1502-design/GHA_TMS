"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { savePayrollSetting, type PayrollSettings } from "@/lib/finance/actions";
import { cn } from "@/lib/utils";

const DAYS = [
  { v: 1, label: "Thứ 2" },
  { v: 2, label: "Thứ 3" },
  { v: 3, label: "Thứ 4" },
  { v: 4, label: "Thứ 5" },
  { v: 5, label: "Thứ 6" },
  { v: 6, label: "Thứ 7" },
  { v: 0, label: "Chủ nhật" },
];

/** Thiết lập chung của bảng lương: kế toán tự đổi, không cần sửa phần mềm */
export function PayrollSettingsCard({ initial }: { initial: PayrollSettings }) {
  const [offset, setOffset] = useState(initial.offset_advance);
  const [deduct, setDeduct] = useState(initial.deduct_base_unpaid ?? true);
  const [ret, setRet] = useState(String(initial.return_trip_percent ?? 100));
  const [retSaved, setRetSaved] = useState(String(initial.return_trip_percent ?? 100));
  const [off, setOff] = useState<number[]>(initial.weekly_off_days);
  const [pending, start] = useTransition();
  const can = initial.can_edit && !pending;

  const toggleOffset = () =>
    start(async () => {
      const r = await savePayrollSetting({ key: "payroll.offset_advance", value: !offset });
      if (!r.ok) return void toast.error(r.error);
      setOffset(!offset);
      toast.success(r.message);
    });
  const toggleDeduct = () =>
    start(async () => {
      const r = await savePayrollSetting({ key: "payroll.deduct_base_unpaid", value: !deduct });
      if (!r.ok) return void toast.error(r.error);
      setDeduct(!deduct);
      toast.success(r.message);
    });
  const saveReturn = () => {
    const v = Number(ret.replace(",", "."));
    if (ret === retSaved) return;
    if (!Number.isFinite(v) || v < 0 || v > 200) {
      toast.error("% chiều về phải từ 0 đến 200");
      return setRet(retSaved);
    }
    start(async () => {
      const r = await savePayrollSetting({ key: "payroll.return_trip_percent", value: v });
      if (!r.ok) return void toast.error(r.error);
      setRetSaved(String(v));
      setRet(String(v));
      toast.success(r.message);
    });
  };
  const toggleDay = (d: number) =>
    start(async () => {
      const next = off.includes(d) ? off.filter((x) => x !== d) : [...off, d].sort();
      const r = await savePayrollSetting({ key: "payroll.weekly_off_days", value: next });
      if (!r.ok) return void toast.error(r.error);
      setOff(next);
      toast.success(r.message);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Thiết lập chung</CardTitle>
        <CardDescription>Đổi ở đây là có tác dụng ngay với các bảng lương lập sau đó. Bảng lương đã lập giữ nguyên số cũ.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        <div className="flex items-center justify-between gap-4 py-3">
          <div>
            <div className="font-medium">Trừ tiền ứng còn dư vào lương</div>
            <div className="text-sm text-muted-foreground">
              Bật: tiền tài xế đã ứng mà chưa quyết toán hết được trừ vào lương tháng. Tắt: trả đủ lương, tài xế hoàn ứng riêng. Khi lập từng bảng lương vẫn đổi được.
            </div>
          </div>
          <Switch on={offset} label="Trừ tiền ứng còn dư vào lương" disabled={!can} onClick={toggleOffset} />
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <div>
            <div className="font-medium">Trừ lương cơ bản ngày nghỉ không lương, nghỉ không báo</div>
            <div className="text-sm text-muted-foreground">
              Bật: lương cơ bản chia theo ngày công chuẩn (các ngày không phải ngày nghỉ, lễ trong tháng), trừ các ngày KL và V trên bảng Chấm công tài xế. Tắt: trả đủ lương
              cơ bản.
            </div>
          </div>
          <Switch on={deduct} label="Trừ lương cơ bản ngày nghỉ không lương" disabled={!can} onClick={toggleDeduct} />
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <div>
            <label htmlFor="pay-return-pct" className="font-medium">
              Chuyến chiều về tính % đơn giá
            </label>
            <div className="text-sm text-muted-foreground">
              Ví dụ 80: tuyến Cát Lái ↔ Bến Tre 1,000,000 thì chuyến lấy hàng ở Bến Tre chở về được 800,000. 100 = hai chiều như nhau. Từng dòng đơn giá có thể đặt %
              riêng ở cột % chiều về. Chỉ chuyến có đơn chở hàng mới tính lương.
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <input
              id="pay-return-pct"
              inputMode="decimal"
              value={ret}
              disabled={!can}
              onChange={(e) => setRet(e.target.value)}
              onBlur={saveReturn}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
              className="h-9 w-20 rounded-md border bg-background px-2 text-right tabular-nums disabled:opacity-60"
            />
            <span className="text-sm">%</span>
          </div>
        </div>
        <div className="py-3">
          <div className="font-medium">Ngày nghỉ trong tuần</div>
          <div className="mb-2 text-sm text-muted-foreground">
            Tích các ngày công ty nghỉ. Chuyến chạy vào ngày nghỉ hoặc ngày lễ (tab Ngày nghỉ lễ) được tính khoản &quot;Thêm tiền chuyến ngày nghỉ, lễ&quot; nếu
            khoản đó có mức. Bảng Chấm công tài xế không bắt xác nhận các ngày này.
          </div>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => (
              <label
                key={d.v}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm",
                  off.includes(d.v) && "border-primary bg-primary/10 font-medium",
                  !can && "cursor-not-allowed opacity-60",
                )}
              >
                <input type="checkbox" className="size-4" checked={off.includes(d.v)} disabled={!can} onChange={() => toggleDay(d.v)} />
                {d.label}
              </label>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Switch({ on, label, disabled, onClick }: { on: boolean; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60", on ? "bg-primary" : "bg-muted-foreground/30")}
    >
      <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}
