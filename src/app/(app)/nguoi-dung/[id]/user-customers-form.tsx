"use client";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setUserCustomers } from "../actions";

/** Gắn tài khoản khách với một hay nhiều khách hàng: tài khoản chỉ thấy dữ liệu của các khách hàng được tích */
export function UserCustomersForm({
  userId,
  customers,
  selected,
  canConfigure,
}: {
  userId: string;
  customers: { id: string; code: string; name: string }[];
  selected: string[];
  canConfigure: boolean;
}) {
  const [value, setValue] = useState(new Set(selected));
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const dirty = value.size !== selected.length || selected.some((s) => !value.has(s));
  const term = q.trim().toLowerCase();
  // Khách đã tích luôn hiện trên cùng
  const shown = useMemo(
    () =>
      customers
        .filter((c) => !term || `${c.code} ${c.name}`.toLowerCase().includes(term) || value.has(c.id))
        .sort((a, b) => Number(value.has(b.id)) - Number(value.has(a.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [customers, term],
  );
  return (
    <div className="space-y-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm khách hàng: VAP, PLA, DAM…" />
      <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
        {shown.map((c) => (
          <label key={c.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.has(c.id)}
              disabled={!canConfigure}
              onChange={(e) => {
                const next = new Set(value);
                if (e.target.checked) next.add(c.id);
                else next.delete(c.id);
                setValue(next);
              }}
            />
            <span className="font-medium">{c.code}</span> – {c.name}
          </label>
        ))}
        {!shown.length ? <p className="text-sm text-muted-foreground">Không có khách hàng phù hợp.</p> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Đang chọn {value.size} khách hàng.{" "}
        {value.size ? "Tài khoản này chỉ thấy dữ liệu của các khách hàng trên." : "Nhân viên GHA để trống. Tài khoản khách phải chọn ít nhất một khách hàng, nếu không sẽ không thấy gì."}
      </p>
      {canConfigure ? (
        <Button
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              const res = await setUserCustomers(userId, [...value]);
              if (res.ok) toast.success(res.message);
              else toast.error(res.error);
            })
          }
        >
          {pending ? "Đang lưu..." : "Lưu khách hàng được xem"}
        </Button>
      ) : null}
    </div>
  );
}
