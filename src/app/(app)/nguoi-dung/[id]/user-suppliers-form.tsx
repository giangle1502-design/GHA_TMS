"use client";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setUserSuppliers } from "../actions";

/** Gắn tài khoản nhà xe 3PL với một hay nhiều nhà xe: tài khoản chỉ thấy chuyến chỉ định cho các nhà xe được tích */
export function UserSuppliersForm({
  userId,
  suppliers,
  selected,
  canConfigure,
}: {
  userId: string;
  suppliers: { id: string; code: string; name: string; is3pl: boolean }[];
  selected: string[];
  canConfigure: boolean;
}) {
  const [value, setValue] = useState(new Set(selected));
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const dirty = value.size !== selected.length || selected.some((s) => !value.has(s));
  const term = q.trim().toLowerCase();
  // Nhà xe đã tích luôn hiện trên cùng, rồi tới nhà xe 3PL
  const shown = useMemo(
    () =>
      suppliers
        .filter((c) => !term || `${c.code} ${c.name}`.toLowerCase().includes(term) || value.has(c.id))
        .sort((a, b) => Number(value.has(b.id)) - Number(value.has(a.id)) || Number(b.is3pl) - Number(a.is3pl)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [suppliers, term],
  );
  return (
    <div className="space-y-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nhà xe: Hải Quân…" />
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
        {!shown.length ? <p className="text-sm text-muted-foreground">Không có nhà xe phù hợp.</p> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Đang chọn {value.size} nhà xe.{" "}
        {value.size ? "Tài khoản này chỉ thấy chuyến của các nhà xe trên." : "Tài khoản nhà xe 3PL phải chọn ít nhất một nhà xe, nếu không sẽ không thấy chuyến nào."}
      </p>
      {canConfigure ? (
        <Button
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              const res = await setUserSuppliers(userId, [...value]);
              if (res.ok) toast.success(res.message);
              else toast.error(res.error);
            })
          }
        >
          {pending ? "Đang lưu..." : "Lưu nhà xe được gắn"}
        </Button>
      ) : null}
    </div>
  );
}
