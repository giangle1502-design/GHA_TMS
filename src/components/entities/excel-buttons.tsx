"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { exportRecords, importCommit, importPreview, importTemplate, type FileResult, type ImportPreview } from "@/lib/entities/excel-actions";

function download(file: FileResult) {
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportButton({
  entityKey,
  params,
  visibleColumns,
}: {
  entityKey: string;
  params: { q?: string; sort?: string; dir?: "asc" | "desc"; filters?: Record<string, string>; adv?: string[] };
  visibleColumns: string[];
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await exportRecords(entityKey, params, visibleColumns);
          if (!r.ok || !r.data) return void toast.error(r.ok ? "Không tạo được tệp" : r.error);
          download(r.data);
          toast.success(r.data.truncated ? `Đã xuất ${r.data.count} dòng đầu tiên (giới hạn mỗi lần xuất).` : `Đã xuất ${r.data.count} dòng.`);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Download />} Xuất Excel
    </Button>
  );
}

export function ImportDialog({ entityKey, revalidate }: { entityKey: string; revalidate: string }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const errorRows = preview?.rows.filter((r) => r.errors.length) ?? [];
  const blocked = !preview || preview.missingRequired.length > 0 || preview.validCount === 0;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload /> Nhập Excel
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setPreview(null);
        }}
      >
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Nhập dữ liệu từ Excel/CSV</DialogTitle>
            <DialogDescription>
              Dòng đầu tiên là tiêu đề cột (đúng tên cột như file mẫu). Hệ thống kiểm tra từng dòng trước, chỉ ghi khi bạn xác nhận.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await importTemplate(entityKey);
                  if (r.ok && r.data) download(r.data);
                  else if (!r.ok) toast.error(r.error);
                })
              }
            >
              <FileSpreadsheet /> Tải file mẫu
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv"
              aria-label="Chọn tệp"
              className="text-sm file:mr-2 file:rounded-md file:border file:bg-card file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const fd = new FormData();
                fd.set("file", f);
                start(async () => {
                  const r = await importPreview(entityKey, fd);
                  if (r.ok && r.data) setPreview(r.data);
                  else if (!r.ok) {
                    setPreview(null);
                    toast.error(r.error);
                  }
                });
              }}
            />
            {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
          </div>

          {preview ? (
            <div className="space-y-3">
              {preview.missingRequired.length ? (
                <Alert variant="destructive">
                  <AlertDescription>Thiếu cột bắt buộc: {preview.missingRequired.join(", ")}.</AlertDescription>
                </Alert>
              ) : null}
              {preview.unknownHeaders.length ? (
                <Alert>
                  <AlertDescription>Bỏ qua các cột không nhận ra: {preview.unknownHeaders.join(", ")}.</AlertDescription>
                </Alert>
              ) : null}
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>
                  Tổng {preview.rows.length} dòng · <b className="text-emerald-700">{preview.validCount} hợp lệ</b> ·{" "}
                  <b className={cn(errorRows.length && "text-destructive")}>{errorRows.length} lỗi</b>
                </span>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Chỉ xem dòng lỗi
                </label>
              </div>
              <div className="max-h-[45vh] overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Dòng</th>
                      {preview.columns.map((c) => (
                        <th key={c.key} className="px-2 py-1.5 text-left whitespace-nowrap">
                          {c.label}
                        </th>
                      ))}
                      <th className="px-2 py-1.5 text-left">Kết quả kiểm tra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(onlyErrors ? errorRows : preview.rows).slice(0, 500).map((r) => (
                      <tr key={r.line} className={cn("border-t", r.errors.length && "bg-destructive/5")}>
                        <td className="px-2 py-1">{r.line}</td>
                        {preview.columns.map((c) => (
                          <td key={c.key} className="max-w-48 truncate px-2 py-1">
                            {r.display[c.key]}
                          </td>
                        ))}
                        <td className={cn("px-2 py-1", r.errors.length ? "text-destructive" : "text-emerald-700")}>
                          {r.errors.length ? r.errors.join("; ") : "Hợp lệ"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {errorRows.length ? (
                <p className="text-xs text-muted-foreground">Dòng lỗi sẽ không được nhập. Sửa trong tệp rồi chọn lại tệp để kiểm tra lại.</p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Đóng
            </Button>
            <Button
              disabled={blocked || pending}
              onClick={() =>
                start(async () => {
                  const valid = preview!.rows.filter((r) => r.errors.length === 0).map((r) => r.values);
                  const r = await importCommit(entityKey, valid, revalidate);
                  if (r.ok) {
                    toast.success(`Đã nhập ${r.data?.count ?? 0} dòng.`);
                    setOpen(false);
                    setPreview(null);
                    if (fileRef.current) fileRef.current.value = "";
                    router.refresh();
                  } else toast.error(r.error);
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : null}
              Nhập {preview?.validCount ?? 0} dòng hợp lệ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
