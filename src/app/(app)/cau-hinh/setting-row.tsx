"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateSystemSetting } from "./actions";

export function SettingValueEditor({ settingKey, value, canEdit }: { settingKey: string; value: unknown; canEdit: boolean }) {
  const initial = JSON.stringify(value);
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  // Tham số bật/tắt: hiện nút gạt thay cho ô JSON
  if (typeof value === "boolean") {
    const on = v === "true";
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={settingKey}
          disabled={!canEdit || pending}
          onClick={() =>
            start(async () => {
              const next = on ? "false" : "true";
              const res = await updateSystemSetting(settingKey, next);
              if (res.ok) {
                setV(next);
                toast.success(res.message);
              } else toast.error(res.error);
            })
          }
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${on ? "bg-primary" : "bg-muted-foreground/30"}`}
        >
          <span className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
        <span className="text-sm">{on ? "Bật" : "Tắt"}</span>
      </div>
    );
  }
  if (!canEdit) return <code className="text-sm">{initial}</code>;
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateSystemSetting(settingKey, v);
          if (res.ok) toast.success(res.message);
          else toast.error(res.error);
        });
      }}
    >
      <Input value={v} onChange={(e) => setV(e.target.value)} className="font-mono" aria-label={settingKey} />
      <Button type="submit" size="sm" variant="outline" disabled={pending || v === initial}>
        Lưu
      </Button>
    </form>
  );
}
