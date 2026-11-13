"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, Copy, IdCard, Loader2, Plus, RotateCcw, Save, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { AddFieldButton } from "@/components/entities/add-field-button";
import { fillDriverShareInfo, loadDriverShareInfo, saveDriverShareTemplate, type DriverShareInfo } from "@/app/(app)/dieu-phoi/driver-info-actions";
import { DEFAULT_SHARE_TEMPLATE, driverShareText, rawShareValue, type DriverShareRow, type ShareLine } from "@/lib/driver-share";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Trình duyệt chặn clipboard (http, iframe): chép kiểu cũ
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/**
 * Nút "Thông tin tài xế": mở hộp có sẵn văn bản theo mẫu (mặc định Tên, Số xe, Số CCCD, Số GPLX) để chép gửi khách hàng.
 * Một chuyến hoặc nhiều chuyến (chép một lần cho cả danh sách). Người có quyền điều phối tự chọn, đổi tên, sắp xếp,
 * thêm dòng (kể cả trường bổ sung tự tạo cho tài xế / xe); mẫu lưu chung cho mọi người.
 */
export function DriverInfoButton({
  shipmentIds,
  label = "Thông tin tài xế",
  compact,
  canFill,
  variant = "ghost",
}: {
  shipmentIds: string[];
  label?: string;
  compact?: boolean;
  canFill?: boolean;
  variant?: "ghost" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<DriverShareInfo | null>(null);
  const [template, setTemplate] = useState<ShareLine[]>(DEFAULT_SHARE_TEMPLATE);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();

  const load = (keepTemplate?: ShareLine[]) =>
    startLoad(async () => {
      setError(null);
      const r = await loadDriverShareInfo(shipmentIds);
      if (!r.ok || !r.data) {
        setInfo(null);
        setText("");
        return void setError(r.ok ? "Không tải được dữ liệu" : r.error);
      }
      const tpl = keepTemplate ?? r.data.template;
      setInfo(r.data);
      setTemplate(tpl);
      setText(driverShareText(r.data.rows, tpl, r.data.sources));
    });

  const onOpen = () => {
    setOpen(true);
    setCopied(false);
    setEditing(false);
    setDirty(false);
    setInfo(null);
    load();
  };

  /** Đổi mẫu: văn bản ghép lại ngay để xem trước */
  const changeTemplate = (next: ShareLine[]) => {
    setTemplate(next);
    setDirty(true);
    setCopied(false);
    if (info) setText(driverShareText(info.rows, next, info.sources));
  };

  const rows = info?.rows ?? [];
  const withDriver = rows.filter((r) => r.data);
  const noDriver = rows.filter((r) => !r.data);
  const labelOf = new Map((info?.sources ?? []).map((s) => [s.key, s.label]));
  // Ô trống theo mẫu đang dùng, mỗi tài xế báo một lần
  const missing = [
    ...new Map(
      withDriver
        .map((r) => ({ row: r, empty: template.filter((l) => { const v = rawShareValue(r.data, l.source); return v === null || v === undefined || v === ""; }) }))
        .filter((m) => m.empty.length > 0)
        .map((m) => [m.row.driver_id, m]),
    ).values(),
  ];

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        className={compact ? "h-7 px-2" : undefined}
        onClick={onOpen}
        disabled={shipmentIds.length === 0}
        aria-label={label}
        title="Chép thông tin tài xế (tên, biển số, CCCD, GPLX…) để gửi khách hàng đăng ký xe"
      >
        <IdCard />
        {compact ? null : ` ${label}`}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Thông tin tài xế gửi khách hàng</DialogTitle>
            <DialogDescription>
              Bấm Sao chép rồi dán vào Zalo / email gửi khách đăng ký xe. Có thể sửa trực tiếp trong ô trước khi chép.
            </DialogDescription>
          </DialogHeader>
          {loading && info === null ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Đang tải…
            </p>
          ) : error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          ) : (
            <div className="space-y-3">
              {info?.canEditTemplate ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant={editing ? "default" : "outline"} size="sm" onClick={() => setEditing((e) => !e)}>
                    <Settings2 /> {editing ? "Ẩn chọn trường" : "Chọn trường, thêm trường"}
                  </Button>
                  {!editing ? <span className="text-xs text-muted-foreground">Thêm Ngày cấp, SĐT… hoặc bỏ bớt dòng</span> : null}
                </div>
              ) : null}
              {editing && info ? (
                <TemplateEditor
                  info={info}
                  template={template}
                  onChange={changeTemplate}
                  dirty={dirty}
                  saving={saving}
                  onSave={() =>
                    startSave(async () => {
                      const r = await saveDriverShareTemplate(template);
                      if (!r.ok) return void toast.error(r.error);
                      toast.success(r.message);
                      setDirty(false);
                    })
                  }
                  onFieldAdded={() => load(template)}
                />
              ) : null}
              {info?.legacy ? (
                <p className="text-xs text-muted-foreground">Mẫu cố định 4 dòng. Chạy SQL nâng cấp số 45 để tự chọn, thêm trường.</p>
              ) : null}
              {withDriver.length > 0 ? (
                <Textarea
                  aria-label="Văn bản gửi khách"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setCopied(false);
                  }}
                  rows={Math.min(16, Math.max(5, text.split("\n").length + 1))}
                  className="font-mono text-sm"
                />
              ) : (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">Chuyến chưa được phân công tài xế.</p>
              )}
              {noDriver.length > 0 && withDriver.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Bỏ qua {noDriver.length} chuyến chưa có tài xế: {noDriver.map((r) => r.shipment_code).join(", ")}.
                </p>
              ) : null}
              {missing.map((m) => (
                <MissingDocs
                  key={m.row.driver_id}
                  row={m.row}
                  emptyLabels={m.empty.map((l) => l.label || labelOf.get(l.source) || l.source)}
                  needNid={m.empty.some((l) => l.source === "national_id")}
                  needLic={m.empty.some((l) => l.source === "license_no")}
                  canFill={Boolean(canFill)}
                  onSaved={() => {
                    setCopied(false);
                    load(template);
                  }}
                />
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Đóng
            </Button>
            <Button
              disabled={!text.trim() || loading}
              onClick={async () => {
                if (await copyText(text)) {
                  setCopied(true);
                  toast.success("Đã sao chép thông tin tài xế");
                } else toast.error("Trình duyệt không cho sao chép. Hãy bôi đen văn bản rồi nhấn Ctrl+C.");
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Đã sao chép" : "Sao chép"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Chọn trường: đổi tên dòng, đổi trường lấy dữ liệu, lên / xuống, bỏ dòng, thêm dòng, tạo trường mới cho tài xế */
function TemplateEditor({
  info,
  template,
  onChange,
  dirty,
  saving,
  onSave,
  onFieldAdded,
}: {
  info: DriverShareInfo;
  template: ShareLine[];
  onChange: (t: ShareLine[]) => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onFieldAdded: () => void;
}) {
  const [adding, setAdding] = useState("");
  const used = new Set(template.map((l) => l.source));
  const labelOf = new Map(info.sources.map((s) => [s.key, s.label]));
  const set = (i: number, patch: Partial<ShareLine>) => onChange(template.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= template.length) return;
    const next = [...template];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  /** Tên dòng gợi ý: bỏ phần "(trường thêm của …)" và chữ "tài xế" thừa */
  const shortLabel = (key: string) => (labelOf.get(key) ?? key).replace(/\s*\(trường thêm của (tài xế|xe)\)$/, "").replace(/ tài xế$/, "");
  return (
    <div className="space-y-2 rounded-md border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">
        Mỗi dòng gồm <b>tên dòng</b> (chữ hiện cho khách, sửa được) và <b>trường</b> lấy dữ liệu. Lưu mẫu thì mọi người dùng chung.
      </p>
      {template.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
          <Input
            aria-label={`Tên dòng ${i + 1}`}
            value={l.label}
            maxLength={60}
            onChange={(e) => set(i, { label: e.target.value })}
            className="h-8 sm:w-36"
            placeholder="Ví dụ: Ngày cấp"
          />
          <NativeSelect aria-label={`Trường dòng ${i + 1}`} value={l.source} onChange={(e) => set(i, { source: e.target.value })} className="h-8 min-w-0 flex-1">
            {info.sources.some((s) => s.key === l.source) ? null : <option value={l.source}>{l.source} (trường đã xóa)</option>}
            {info.sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-1.5" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Lên trên" title="Lên trên">
            <ArrowUp />
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-1.5" disabled={i === template.length - 1} onClick={() => move(i, 1)} aria-label="Xuống dưới" title="Xuống dưới">
            <ArrowDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-1.5 text-destructive"
            disabled={template.length <= 1}
            onClick={() => onChange(template.filter((_, j) => j !== i))}
            aria-label="Bỏ dòng"
            title="Bỏ dòng"
          >
            <X />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        <NativeSelect aria-label="Chọn trường để thêm dòng" value={adding} onChange={(e) => setAdding(e.target.value)} className="h-8 min-w-0 flex-1">
          <option value="">Chọn trường để thêm dòng (Ngày cấp CCCD, SĐT…)</option>
          {info.sources.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
              {used.has(s.key) ? " (đã có)" : ""}
            </option>
          ))}
        </NativeSelect>
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={!adding || template.length >= 40}
          onClick={() => {
            onChange([...template, { label: shortLabel(adding), source: adding }]);
            setAdding("");
          }}
        >
          <Plus /> Thêm dòng
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t pt-2">
        <Button type="button" size="sm" disabled={!dirty || saving || template.some((l) => !l.label.trim())} onClick={onSave}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />} Lưu mẫu
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(DEFAULT_SHARE_TEMPLATE)} title="Về 4 dòng Tên, Số xe, Số CCCD, Số GPLX">
          <RotateCcw /> Mẫu mặc định
        </Button>
        {info.canAddField ? (
          <AddFieldButton module="drivers" entityKey="drivers" customRows={[]} label="Tạo trường mới cho tài xế" onSaved={onFieldAdded} />
        ) : (
          <span className="text-xs text-muted-foreground">Trường chưa có trong danh sách: nhờ người có quyền Trường dữ liệu tạo thêm cho Tài xế.</span>
        )}
      </div>
    </div>
  );
}

function MissingDocs({
  row,
  emptyLabels,
  needNid,
  needLic,
  canFill,
  onSaved,
}: {
  row: DriverShareRow;
  emptyLabels: string[];
  needNid: boolean;
  needLic: boolean;
  canFill: boolean;
  onSaved: () => void;
}) {
  const [nid, setNid] = useState("");
  const [lic, setLic] = useState("");
  const [pending, start] = useTransition();
  const name = String(row.data?.full_name ?? "");
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <p>
        Tài xế <b>{name}</b> chưa có {emptyLabels.join(", ")}.{" "}
        {row.driver_id ? (
          <Link href={`/tai-xe/${row.driver_id}`} className="text-primary hover:underline" target="_blank">
            Mở hồ sơ tài xế
          </Link>
        ) : null}
      </p>
      {canFill && row.driver_id && (needNid || needLic) ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {needNid ? (
            <div className="min-w-36 flex-1 space-y-1">
              <Label htmlFor={`nid-${row.driver_id}`}>Số CCCD</Label>
              <Input id={`nid-${row.driver_id}`} value={nid} onChange={(e) => setNid(e.target.value.replace(/\s/g, ""))} inputMode="numeric" maxLength={20} placeholder="Ví dụ: 084091007921" />
            </div>
          ) : null}
          {needLic ? (
            <div className="min-w-36 flex-1 space-y-1">
              <Label htmlFor={`lic-${row.driver_id}`}>Số GPLX</Label>
              <Input id={`lic-${row.driver_id}`} value={lic} onChange={(e) => setLic(e.target.value.replace(/\s/g, ""))} maxLength={30} placeholder="Ví dụ: 790168005497" />
            </div>
          ) : null}
          <Button
            size="sm"
            disabled={pending || (!nid && !lic)}
            onClick={() =>
              start(async () => {
                const r = await fillDriverShareInfo({ driverId: row.driver_id!, nationalId: nid, licenseNo: lic });
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.message);
                onSaved();
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Save />} Lưu vào hồ sơ
          </Button>
        </div>
      ) : null}
    </div>
  );
}
