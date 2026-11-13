"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lock, Pencil, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import type { SystemFieldSetting, SystemFieldSettings } from "@/lib/entities/types";
import { saveSystemField } from "./actions";

/** Trường hệ thống ở dạng gửi được xuống trình duyệt (giá trị mặc định trong mã nguồn) */
export type SystemFieldInfo = {
  key: string;
  label: string;
  typeLabel: string;
  help: string;
  required: boolean;
  list: boolean;
  /** Bật được "bắt buộc" / "ẩn khỏi biểu mẫu" (biểu mẫu viết riêng như Tạo đơn hàng chỉ đổi tên được) */
  canRequire: boolean;
  canHide: boolean;
  /** Có cột trên bảng danh sách */
  hasTable: boolean;
  options: { value: string; label: string }[];
};

export function SystemFieldsCard({
  module,
  moduleLabel,
  fields,
  settings,
  canConfigure,
  note,
}: {
  module: string;
  moduleLabel: string;
  fields: SystemFieldInfo[];
  settings: SystemFieldSettings;
  canConfigure: boolean;
  note?: string;
}) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<SystemFieldInfo | null>(null);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return fields;
    return fields.filter((f) => [f.key, f.label, settings[f.key]?.label ?? "", f.typeLabel].some((x) => x.toLowerCase().includes(t)));
  }, [q, fields, settings]);

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Trường hệ thống của {moduleLabel.toLowerCase()}</CardTitle>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm trường hệ thống..." className="h-8 pl-8" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {canConfigure ? "Bấm nút bút chì để đổi tên hiển thị, gợi ý" : "Bạn chỉ được xem, cần quyền Cấu hình trường để sửa tên hiển thị, gợi ý"}
          {fields.some((f) => f.canRequire || f.canHide) ? ", bắt buộc, ẩn khỏi biểu mẫu, cột trên bảng và tên lựa chọn" : ""}.{" "}
          <Lock className="inline size-3.5" /> Mã trường và kiểu dữ liệu không đổi được vì phần mềm dùng chúng để lưu và tính toán; trường hệ thống cũng không xóa được.
          {note ? ` ${note}` : ""}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Tên hiển thị</th>
                <th className="px-3 py-2 text-left">Mã trường</th>
                <th className="px-3 py-2 text-left">Kiểu</th>
                <th className="px-3 py-2 text-left">Thuộc tính</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => {
                const s = settings[f.key];
                const required = f.required || (f.canRequire && s?.required);
                return (
                  <tr key={f.key} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium">{s?.label || f.label}</div>
                      {s?.label ? <div className="text-xs text-muted-foreground">Tên gốc: {f.label}</div> : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{f.key}</td>
                    <td className="px-3 py-2">{f.typeLabel}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {[
                        required && (f.required ? "bắt buộc (cố định)" : "bắt buộc"),
                        f.canHide && s?.hidden && !required && "ẩn khỏi biểu mẫu",
                        f.hasTable && (s?.list ?? f.list) && "hiện trên bảng",
                        (s?.help ?? f.help) && "có gợi ý",
                        s?.options && Object.keys(s.options).length && "đã đổi tên lựa chọn",
                        s && Object.keys(s).length > 0 && "đã tùy chỉnh",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {canConfigure ? (
                        <Button size="icon" variant="ghost" className="size-7" title="Sửa" aria-label={`Sửa ${f.label}`} onClick={() => setEditing(f)}>
                          <Pencil className="size-3.5" />
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!shown.length ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    Không có trường nào khớp “{q}”.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
      {editing ? (
        <SystemFieldDialog key={editing.key} module={module} field={editing} setting={settings[editing.key] ?? {}} onClose={() => setEditing(null)} />
      ) : null}
    </Card>
  );
}

function SystemFieldDialog({ module, field, setting, onClose }: { module: string; field: SystemFieldInfo; setting: SystemFieldSetting; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [label, setLabel] = useState(setting.label ?? field.label);
  const [help, setHelp] = useState(setting.help ?? field.help);
  const [required, setRequired] = useState(field.required || Boolean(setting.required));
  const [hidden, setHidden] = useState(Boolean(setting.hidden));
  const [list, setList] = useState(setting.list ?? field.list);
  const [options, setOptions] = useState<Record<string, string>>(() =>
    Object.fromEntries(field.options.map((o) => [o.value, setting.options?.[o.value] ?? o.label])),
  );

  const save = (values: Parameters<typeof saveSystemField>[2]) =>
    start(async () => {
      const r = await saveSystemField(module, field.key, values);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Đã lưu");
      onClose();
      router.refresh();
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sửa trường hệ thống “{field.label}”</DialogTitle>
          <DialogDescription>Thay đổi áp dụng cho mọi người dùng. Dữ liệu đã nhập giữ nguyên.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Mã trường</Label>
              <Input value={field.key} disabled className="font-mono" />
            </div>
            <div className="space-y-1">
              <Label>Kiểu dữ liệu</Label>
              <Input value={field.typeLabel} disabled />
            </div>
            <p className="col-span-2 -mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="size-3" /> Hai ô này khóa vì phần mềm dùng để lưu dữ liệu, tính tiền và báo cáo.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sf-label">Tên hiển thị *</Label>
            <Input id="sf-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={150} placeholder={`VD: ${field.label}`} />
            <p className="text-xs text-muted-foreground">Tên gốc: {field.label}. Ví dụ đổi “Biển số” thành “Số xe”.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sf-help">Gợi ý cho người nhập</Label>
            <Textarea id="sf-help" value={help} onChange={(e) => setHelp(e.target.value)} maxLength={500} rows={2} placeholder="VD: Ghi đúng như trên giấy đăng ký xe" />
          </div>
          {field.canRequire || field.canHide || field.hasTable ? (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={required} disabled={!field.canRequire} onChange={(e) => (setRequired(e.target.checked), e.target.checked && setHidden(false))} />
                <span>
                  Bắt buộc nhập
                  {field.required ? <span className="block text-xs text-muted-foreground">Luôn bắt buộc vì phần mềm cần trường này, không tắt được.</span> : null}
                </span>
              </label>
              {field.canHide ? (
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={hidden} disabled={required} onChange={(e) => setHidden(e.target.checked)} />
                  <span>
                    Ẩn khỏi biểu mẫu Thêm/Sửa
                    <span className="block text-xs text-muted-foreground">Dữ liệu đã có vẫn giữ nguyên. Trường đang bắt buộc thì không ẩn được.</span>
                  </span>
                </label>
              ) : null}
              {field.hasTable ? (
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5" checked={list} onChange={(e) => setList(e.target.checked)} />
                  <span>
                    Hiện thành cột trên bảng (mặc định)
                    <span className="block text-xs text-muted-foreground">Mỗi người vẫn tự chọn cột riêng bằng nút Cột trên bảng.</span>
                  </span>
                </label>
              ) : null}
            </div>
          ) : (
            <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
              Trường này nằm trên biểu mẫu viết riêng (Tạo/Sửa đơn hàng) nên chỉ đổi được tên hiển thị và gợi ý. Bắt buộc và ẩn/hiện của biểu mẫu này do phần mềm quy định.
            </p>
          )}
          {field.options.length ? (
            <div className="space-y-2">
              <Label>Tên các lựa chọn</Label>
              <p className="text-xs text-muted-foreground">Chỉ đổi tên hiển thị; giá trị lưu bên trong giữ nguyên nên báo cáo cũ không bị ảnh hưởng.</p>
              {field.options.map((o) => (
                <div key={o.value} className="grid grid-cols-[1fr_1.4fr] items-center gap-2">
                  <span className="truncate text-xs text-muted-foreground" title={o.value}>
                    {o.label} <span className="font-mono">({o.value})</span>
                  </span>
                  <Input
                    value={options[o.value] ?? ""}
                    onChange={(e) => setOptions((x) => ({ ...x, [o.value]: e.target.value }))}
                    maxLength={150}
                    className="h-8"
                    aria-label={`Tên mới cho ${o.label}`}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" disabled={pending} onClick={() => save({})}>
            <RotateCcw /> Trả về mặc định
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Hủy
            </Button>
            <Button
              disabled={pending || !label.trim()}
              onClick={() =>
                save({
                  label: label.trim(),
                  help: help.trim(),
                  required: field.canRequire ? required : undefined,
                  hidden: field.canHide ? hidden && !required : undefined,
                  list: field.hasTable ? list : undefined,
                  options: field.options.length ? options : undefined,
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : null} Lưu
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
