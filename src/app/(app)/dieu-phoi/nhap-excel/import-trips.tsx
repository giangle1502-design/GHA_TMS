"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, FileSpreadsheet, Loader2, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, looseKey, str } from "@/lib/import-trips";
import { commitImport, downloadImportTemplate, previewImport, recheckImport, type ImportOutcome, type ImportPreview, type PreviewRow } from "./actions";

const STATUS_BADGE = { draft: "muted", assigned: "warning", completed: "success" } as const;

function download(file: { filename: string; base64: string }) {
  const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImportTrips() {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [createLocations, setCreateLocations] = useState(false);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [view, setView] = useState<"all" | "errors" | "warnings">("all");
  const [q, setQ] = useState("");
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const groupLabel = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of preview?.source ?? []) m.set(s.rowNo, str(s.raw.nhom));
    return m;
  }, [preview]);

  const rows = useMemo(() => preview?.rows ?? [], [preview]);
  const errorRows = rows.filter((r) => r.errors.length);
  const warnRows = rows.filter((r) => !r.errors.length && r.warnings.length);
  const chosen = rows.filter((r) => !r.errors.length && !skip.has(r.rowNo));
  const chosenOrders = new Set(chosen.map((r) => r.group)).size;
  const count = (st: PreviewRow["status"]) => chosen.filter((r) => r.status === st).length;

  const shown = useMemo(() => {
    const base = view === "errors" ? errorRows : view === "warnings" ? rows.filter((r) => r.warnings.length) : rows;
    const k = looseKey(q);
    if (!k) return base;
    return base.filter((r) =>
      looseKey([r.rowNo, groupLabel.get(r.rowNo), ...Object.values(r.show), STATUS_LABELS[r.status], ...r.errors, ...r.warnings].join(" ")).includes(k),
    );
  }, [rows, errorRows, view, q, groupLabel]);

  const check = (file: File, create = createLocations) => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("createLocations", create ? "1" : "0");
    setOutcome(null);
    start(async () => {
      const r = await previewImport(fd);
      if (r.ok && r.data) {
        setPreview(r.data);
        setSkip(new Set());
        setView(r.data.rows.some((x) => x.errors.length) ? "errors" : "all");
      } else if (!r.ok) {
        setPreview(null);
        toast.error(r.error);
      }
    });
  };

  const recheck = (create: boolean) => {
    if (!preview) return;
    start(async () => {
      const r = await recheckImport({ source: preview.source, createLocations: create, fileName: preview.fileName });
      if (r.ok && r.data) setPreview({ ...r.data, unknownHeaders: preview.unknownHeaders, missingHeaders: preview.missingHeaders });
      else if (!r.ok) toast.error(r.error);
    });
  };

  const commit = () => {
    if (!preview) return;
    start(async () => {
      const r = await commitImport({ source: preview.source, createLocations, skipRows: [...skip, ...errorRows.map((x) => x.rowNo)] });
      if (!r.ok || !r.data) return void toast.error(r.ok ? "Không nhập được" : r.error);
      setOutcome(r.data);
      const trips = r.data.orders.reduce((s, o) => s + o.trips, 0);
      if (r.data.failed.length) toast.warning(`Đã nhập ${trips} chuyến, ${r.data.failed.length} đơn bị lỗi. Xem chi tiết bên dưới.`);
      else toast.success(`Đã nhập ${trips} chuyến vào ${r.data.orders.length} đơn hàng.`);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1. Tải file mẫu, điền chuyến</CardTitle>
            <CardDescription>
              File mẫu có sẵn cột theo đúng phần mềm: cột phí theo từng loại phí đang dùng, các trường bổ sung của chuyến, danh sách chọn khách hàng, biển số, tài xế,
              địa điểm. Rê chuột vào tiêu đề cột để xem cách nhập; sheet &quot;Hướng dẫn&quot; giải thích từng cột.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await downloadImportTemplate();
                  if (r.ok && r.data) download(r.data);
                  else if (!r.ok) toast.error(r.error);
                })
              }
            >
              <FileSpreadsheet /> Tải file mẫu Excel
            </Button>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>
                <b className="text-foreground">Đã hoàn thành</b>: chuyến đã chạy (đang theo dõi trên Excel). Không gửi Giám đốc duyệt, không báo tài xế, chứng từ để
                &quot;Thiếu&quot; để bổ sung sau.
              </li>
              <li>
                <b className="text-foreground">Đã phân công</b>: chuyến sắp chạy, có tài xế. Chuyến &quot;Chờ GĐ duyệt&quot; như khi tạo tay.
              </li>
              <li>
                <b className="text-foreground">Chờ phân công</b>: chưa giao xe, tài xế; điều phối phân công sau trên màn hình Điều phối.
              </li>
              <li>Cùng giá trị ở cột &quot;Gộp đơn&quot; (và cùng khách hàng) = một đơn hàng nhiều chuyến. Để trống = mỗi dòng một đơn.</li>
              <li>Có đơn giá trong file thì dùng đúng giá đó; để trống thì lấy bảng giá như khi tạo đơn.</li>
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Chọn file để kiểm tra</CardTitle>
            <CardDescription>Chỉ đọc và kiểm tra, chưa lưu. Sửa lỗi trong Excel rồi chọn lại file để kiểm tra lại.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              aria-label="Chọn tệp Excel"
              className="block w-full text-sm file:mr-2 file:rounded-md file:border file:bg-card file:px-3 file:py-1.5 file:text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) check(f);
              }}
            />
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={createLocations}
                onChange={(e) => {
                  setCreateLocations(e.target.checked);
                  recheck(e.target.checked);
                }}
              />
              <span>
                Tạo địa điểm mới khi điểm nhận / điểm giao chưa có trong Danh mục
                <span className="block text-xs text-muted-foreground">Tắt (mặc định) để tránh tạo trùng do gõ sai tên. Bật khi chắc chắn đó là địa điểm mới.</span>
              </span>
            </label>
            {pending ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Đang xử lý…
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {outcome ? <Outcome outcome={outcome} /> : null}

      {preview ? (
        <Card>
          <CardHeader className="gap-2">
            <CardTitle className="text-base">3. Kết quả kiểm tra: {preview.fileName}</CardTitle>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="muted">{rows.length} dòng</Badge>
              <Badge variant="success">{rows.length - errorRows.length} hợp lệ</Badge>
              <Badge variant={errorRows.length ? "destructive" : "muted"}>{errorRows.length} lỗi</Badge>
              <Badge variant={warnRows.length ? "warning" : "muted"}>{warnRows.length} cần xem lại</Badge>
              <Badge variant="info">Sẽ tạo {chosenOrders} đơn hàng</Badge>
              <Badge variant="success">{count("completed")} đã hoàn thành</Badge>
              <Badge variant="warning">{count("assigned")} chờ GĐ duyệt</Badge>
              <Badge variant="muted">{count("draft")} chờ phân công</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {preview.missingHeaders.length ? (
              <Alert variant="destructive">
                <AlertDescription>Thiếu cột bắt buộc: {preview.missingHeaders.join(", ")}. Dùng file mẫu và giữ nguyên tên cột.</AlertDescription>
              </Alert>
            ) : null}
            {preview.unknownHeaders.length ? (
              <Alert>
                <AlertDescription>Bỏ qua các cột không có trong mẫu: {preview.unknownHeaders.join(", ")}.</AlertDescription>
              </Alert>
            ) : null}
            {preview.newLocations.length ? (
              <Alert>
                <AlertDescription>
                  Sẽ tạo {preview.newLocations.length} địa điểm mới: {preview.newLocations.join(", ")}. Bổ sung địa chỉ chi tiết sau ở Danh mục → Địa điểm.
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute top-2.5 left-2 size-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm dòng, khách, xe, tài xế, lỗi…" className="h-9 w-72 pl-8" />
              </div>
              {(
                [
                  ["all", `Tất cả (${rows.length})`],
                  ["errors", `Dòng lỗi (${errorRows.length})`],
                  ["warnings", `Cần xem lại (${rows.filter((r) => r.warnings.length).length})`],
                ] as const
              ).map(([k, label]) => (
                <Button key={k} size="sm" variant={view === k ? "default" : "outline"} onClick={() => setView(k)}>
                  {label}
                </Button>
              ))}
            </div>
            <div className="max-h-[60vh] overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr className="text-left">
                    <th className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        aria-label="Chọn tất cả dòng hợp lệ"
                        checked={chosen.length > 0 && chosen.length === rows.length - errorRows.length}
                        onChange={(e) => setSkip(e.target.checked ? new Set() : new Set(rows.filter((r) => !r.errors.length).map((r) => r.rowNo)))}
                      />
                    </th>
                    {["Dòng", "Gộp đơn", "Khách hàng", "Ngày nhận", "Tuyến", "Xe", "Tài xế", "Trạng thái", "Giá", "Phí thu khách", "Kiểm tra"].map((h) => (
                      <th key={h} className="px-2 py-1.5 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, 1000).map((r) => (
                    <tr key={r.rowNo} className={cn("border-t align-top", r.errors.length ? "bg-destructive/5" : skip.has(r.rowNo) && "opacity-50")}>
                      <td className="px-2 py-1">
                        <input
                          type="checkbox"
                          aria-label={`Nhập dòng ${r.rowNo}`}
                          disabled={r.errors.length > 0}
                          checked={!r.errors.length && !skip.has(r.rowNo)}
                          onChange={(e) =>
                            setSkip((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.delete(r.rowNo);
                              else n.add(r.rowNo);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-1 tabular-nums">{r.rowNo}</td>
                      <td className="px-2 py-1">{groupLabel.get(r.rowNo) || <span className="text-muted-foreground">riêng</span>}</td>
                      <td className="max-w-44 px-2 py-1">{r.show.customer}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r.show.pickupDate}</td>
                      <td className="max-w-56 px-2 py-1">{r.show.route}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r.show.vehicle}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r.show.driver}</td>
                      <td className="px-2 py-1">
                        <Badge variant={STATUS_BADGE[r.status]}>{r.status === "assigned" ? "Đã phân công (chờ GĐ duyệt)" : STATUS_LABELS[r.status]}</Badge>
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap tabular-nums">{r.show.price}</td>
                      <td className="max-w-48 px-2 py-1">{r.show.fees}</td>
                      <td className="min-w-56 px-2 py-1">
                        {r.errors.map((e) => (
                          <p key={e} className="text-destructive">
                            • {e}
                          </p>
                        ))}
                        {r.warnings.map((w) => (
                          <p key={w} className="text-amber-700 dark:text-amber-400">
                            • {w}
                          </p>
                        ))}
                        {!r.errors.length && !r.warnings.length ? <span className="text-emerald-700">Hợp lệ</span> : null}
                      </td>
                    </tr>
                  ))}
                  {!shown.length ? (
                    <tr>
                      <td colSpan={12} className="px-2 py-6 text-center text-muted-foreground">
                        Không có dòng nào khớp.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Dòng lỗi không được nhập. Bỏ chọn dòng nào không muốn nhập. Mỗi đơn hàng được lưu trọn vẹn hoặc không lưu (không có đơn nhập dở).
              </p>
              <Button disabled={pending || !chosen.length || preview.missingHeaders.length > 0} onClick={commit}>
                {pending ? <Loader2 className="animate-spin" /> : <Upload />} Nhập {chosen.length} chuyến ({chosenOrders} đơn hàng)
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Outcome({ outcome }: { outcome: ImportOutcome }) {
  const trips = outcome.orders.reduce((s, o) => s + o.trips, 0);
  const pendingApproval = outcome.orders.reduce((s, o) => s + o.pendingApproval, 0);
  return (
    <Card className="border-emerald-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="size-5 text-emerald-600" /> Đã nhập {trips} chuyến vào {outcome.orders.length} đơn hàng
        </CardTitle>
        <CardDescription>
          {pendingApproval ? `${pendingApproval} chuyến đang chờ Giám đốc duyệt. ` : ""}
          {outcome.createdLocations ? `Đã tạo ${outcome.createdLocations} địa điểm mới. ` : ""}
          Xem ở{" "}
          <Link href="/dieu-phoi" className="text-primary underline">
            Điều phối
          </Link>{" "}
          (chọn đúng khoảng ngày) hoặc{" "}
          <Link href="/chuyen-xe" className="text-primary underline">
            Quản lý chuyến xe
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {outcome.failed.length ? (
          <Alert variant="destructive">
            <AlertDescription>
              {outcome.failed.map((f) => (
                <p key={f.rows.join(",")}>
                  Dòng {f.rows.join(", ")} chưa nhập: {f.error}
                </p>
              ))}
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {outcome.orders.slice(0, 200).map((o) => (
            <Link key={o.orderId} href={`/dieu-phoi/don-hang/${o.orderId}`} className="rounded-md border px-2 py-1 text-xs hover:bg-muted">
              {o.orderCode} · {o.trips} chuyến · dòng {o.rows.join(", ")}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
