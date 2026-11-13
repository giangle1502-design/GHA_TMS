"use client";
import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { fold, initials, type StaffPerson } from "@/lib/chat";
import { cn } from "@/lib/utils";

export type PickerMode = "direct" | "group" | "add";

/**
 * Chọn người: một người (trò chuyện riêng), nhiều người + tên nhóm (tạo nhóm), hoặc thêm người vào nhóm.
 * Danh sách là nhân viên đang hoạt động (không gồm tài xế), tìm theo tên hoặc vai trò, gõ không dấu cũng được.
 */
export function PeoplePicker({
  open,
  onOpenChange,
  mode,
  people,
  meId,
  exclude = [],
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: PickerMode;
  people: StaffPerson[];
  meId: string;
  exclude?: string[];
  busy?: boolean;
  onSubmit: (ids: string[], name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const skip = useMemo(() => new Set([meId, ...exclude]), [meId, exclude]);
  const list = useMemo(() => {
    const f = fold(q.trim());
    return people.filter((p) => p.status === "active" && !skip.has(p.id) && (!f || fold(`${p.display_name} ${p.role_names ?? ""}`).includes(f)));
  }, [people, q, skip]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const reset = (v: boolean) => {
    if (!v) {
      setQ("");
      setPicked([]);
      setName("");
    }
    onOpenChange(v);
  };
  const toggle = (id: string) => {
    if (mode === "direct") return onSubmit([id], "");
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const title = mode === "direct" ? "Tin nhắn mới" : mode === "group" ? "Tạo nhóm trò chuyện" : "Thêm thành viên";
  const desc =
    mode === "direct"
      ? "Bấm vào tên một người để mở cuộc trò chuyện riêng với người đó."
      : mode === "group"
        ? "Đặt tên nhóm (ví dụ: Điều phối miền Nam, Kế toán – Giám đốc) rồi chọn các thành viên. Bạn là quản trị nhóm."
        : "Chọn những người muốn thêm vào nhóm. Người được thêm sẽ thấy toàn bộ tin nhắn cũ của nhóm.";
  const canSubmit = mode === "group" ? name.trim().length > 0 && picked.length > 0 : picked.length > 0;

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        {mode === "group" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="chat-group-name">Tên nhóm</Label>
            <Input id="chat-group-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Điều phối miền Nam" autoFocus />
          </div>
        ) : null}
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo tên hoặc vai trò (gõ không dấu cũng được)"
            className="pl-8"
            autoFocus={mode !== "group"}
            aria-label="Tìm người"
          />
        </div>
        {picked.length ? (
          <div className="flex flex-wrap gap-1.5">
            {picked.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary hover:bg-primary/20"
                title="Bấm để bỏ chọn"
              >
                {byId.get(id)?.display_name ?? "?"} ×
              </button>
            ))}
          </div>
        ) : null}
        <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
          {list.map((p) => {
            const on = picked.includes(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => toggle(p.id)}
                  className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent", on && "bg-primary/5")}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {initials(p.display_name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.display_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{p.role_names || "Nhân viên"}</span>
                  </span>
                  {mode !== "direct" ? (
                    <span className={cn("flex size-5 items-center justify-center rounded border", on && "border-primary bg-primary text-white")}>
                      {on ? <Check className="size-3.5" /> : null}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {!list.length ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              Không thấy ai. Người chưa có tài khoản: mời ở mục Người dùng và phân quyền.
            </li>
          ) : null}
        </ul>
        {mode !== "direct" ? (
          <DialogFooter>
            <Button variant="outline" onClick={() => reset(false)}>
              Hủy
            </Button>
            <Button disabled={!canSubmit || busy} onClick={() => onSubmit(picked, name.trim())}>
              {mode === "group" ? `Tạo nhóm (${picked.length + 1} người)` : `Thêm ${picked.length} người`}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
