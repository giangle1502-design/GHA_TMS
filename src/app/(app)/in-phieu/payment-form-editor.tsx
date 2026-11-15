"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, Download, FilePlus2, ListPlus, Loader2, Plus, Printer, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MoneyField } from "@/components/finance/create-dialogs";
import { PaymentFormSheet } from "@/components/payment-forms/payment-form-sheet";
import { formatDate, formatVND, todayVN } from "@/lib/format";
import { formFileName, formTotal, type PaymentFormData, type PaymentFormItem } from "@/lib/payment-request-form";
import { cn } from "@/lib/utils";
import { deletePaymentForm, listOverheadForForm, markOverheadPaid, savePaymentForm, type OverheadPick } from "./actions";

export type SavedForm = {
  id: string;
  code: string;
  form_type: "payment" | "advance";
  form_date: string;
  requester_name: string;
  content: string;
  amount: number;
};

type Can = { create: boolean; update: boolean; delete: boolean; markPaid: boolean; pickOverhead: boolean };

const fold = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();

export function PaymentFormEditor({ initial, saved, can }: { initial: PaymentFormData; saved: SavedForm[]; can: Can }) {
  const router = useRouter();
  const [d, setD] = useState<PaymentFormData>(initial);
  const [pending, start] = useTransition();
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [term, setTerm] = useState("");
  const isPay = d.form_type === "payment";
  const total = formTotal(d);
  const set = <K extends keyof PaymentFormData>(k: K, v: PaymentFormData[K]) => setD((x) => ({ ...x, [k]: v }));
  const setItem = (i: number, patch: Partial<PaymentFormItem>) => setD((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const canSave = d.id ? can.update : can.create;

  function save() {
    start(async () => {
      const r = await savePaymentForm({ ...d, id: d.id || undefined });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`Đã lưu phiếu ${r.data!.code}.`);
      setD((x) => ({ ...x, id: r.data!.id, code: r.data!.code }));
      router.replace(`/in-phieu?id=${r.data!.id}`, { scroll: false });
    });
  }
  function remove() {
    if (!d.id || !window.confirm(`Xóa phiếu ${d.code}?`)) return;
    start(async () => {
      const r = await deletePaymentForm(d.id!);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Đã xóa.");
      router.replace("/in-phieu");
    });
  }
  function markPaid() {
    start(async () => {
      const r = await markOverheadPaid({ ids: d.overhead_ids, date: todayVN() });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Đã cập nhật.");
    });
  }

  async function downloadPdf() {
    const el = document.querySelector<HTMLElement>(".pf-sheet");
    if (!el) return;
    setPdfBusy(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
      const holder = document.createElement("div");
      holder.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;background:#fff;";
      const copy = el.cloneNode(true) as HTMLElement;
      copy.classList.add("pf-a4");
      holder.appendChild(copy);
      document.body.appendChild(holder);
      let canvas: HTMLCanvasElement;
      try {
        canvas = await html2canvas(copy, { scale: 2, backgroundColor: "#ffffff", windowWidth: 1000 });
      } finally {
        holder.remove();
      }
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const margin = 12;
      const w = 210 - margin * 2;
      const h = (canvas.height * w) / canvas.width;
      const maxH = 297 - margin * 2;
      const scale = h > maxH ? maxH / h : 1;
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", margin + (w - w * scale) / 2, margin, w * scale, h * scale);
      pdf.save(formFileName(d));
    } catch (e) {
      console.error(e);
      toast.error("Không tạo được PDF. Hãy bấm In và chọn “Lưu dưới dạng PDF”.");
    } finally {
      setPdfBusy(false);
    }
  }

  const list = useMemo(() => {
    const q = fold(term.trim());
    return q ? saved.filter((f) => fold(`${f.code} ${f.requester_name} ${f.content}`).includes(q)) : saved;
  }, [saved, term]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        {can.create ? (
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/in-phieu?loai=payment">
                <FilePlus2 /> Phiếu mới: Đề nghị thanh toán
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/in-phieu?loai=advance">
                <FilePlus2 /> Phiếu mới: Đề nghị tạm ứng
              </Link>
            </Button>
          </>
        ) : null}
        <div className="flex-1" />
        {d.id && can.delete ? (
          <Button variant="outline" size="sm" onClick={remove} disabled={pending}>
            <Trash2 /> Xóa
          </Button>
        ) : null}
        {canSave ? (
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Save />} {d.id ? "Lưu thay đổi" : "Lưu phiếu (cấp số)"}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer /> In phiếu
        </Button>
        <Button variant="outline" size="sm" onClick={downloadPdf} disabled={pdfBusy}>
          {pdfBusy ? <Loader2 className="animate-spin" /> : <Download />} Tải PDF
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[440px_minmax(0,1fr)]">
        <div className="space-y-3 rounded-lg border bg-card p-3 print:hidden">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold">{isPay ? "Đề nghị thanh toán" : "Đề nghị tạm ứng"}</div>
            <div className="text-sm text-muted-foreground">{d.code ? `Số ${d.code}` : "Chưa lưu (số tự cấp khi lưu)"}</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Ngày lập" id="pf-date">
              <Input id="pf-date" type="date" value={d.form_date} onChange={(e) => set("form_date", e.target.value)} />
            </F>
            <F label={isPay ? "Hình thức thanh toán" : "Hình thức nhận tiền"} id="pf-method">
              <NativeSelect id="pf-method" value={d.payment_method} onChange={(e) => set("payment_method", e.target.value as "cash" | "transfer")}>
                <option value="cash">Tiền mặt</option>
                <option value="transfer">Chuyển khoản</option>
              </NativeSelect>
            </F>
            <F label="Kính gửi" id="pf-to" wide>
              <Input id="pf-to" value={d.recipient} onChange={(e) => set("recipient", e.target.value)} />
            </F>
            <F label="Họ tên người đề nghị" id="pf-name">
              <Input id="pf-name" value={d.requester_name} onChange={(e) => set("requester_name", e.target.value)} />
            </F>
            <F label="Bộ phận (hoặc địa chỉ)" id="pf-dept">
              <Input id="pf-dept" value={d.department} onChange={(e) => set("department", e.target.value)} placeholder="VD: Ban Giám đốc" />
            </F>
            <F label={isPay ? "Nội dung thanh toán" : "Lý do tạm ứng"} id="pf-content" wide>
              <Textarea id="pf-content" rows={2} value={d.content} onChange={(e) => set("content", e.target.value)} placeholder={isPay ? "VD: Thanh toán tiền xăng đi lại tháng 11/2026" : "VD: Tạm ứng sửa xe 61K31295"} />
            </F>
            {d.payment_method === "transfer" ? (
              <>
                <F label="Số tài khoản" id="pf-acc">
                  <Input id="pf-acc" value={d.bank_account_no} onChange={(e) => set("bank_account_no", e.target.value)} />
                </F>
                <F label="Ngân hàng" id="pf-bank">
                  <Input id="pf-bank" value={d.bank_name} onChange={(e) => set("bank_name", e.target.value)} />
                </F>
                <F label="Chủ tài khoản" id="pf-holder" wide>
                  <Input id="pf-holder" value={d.account_holder} onChange={(e) => set("account_holder", e.target.value)} placeholder="Để trống = người đề nghị" />
                </F>
              </>
            ) : null}
          </div>

          {isPay ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Các khoản chi (để trống thì nhập tổng số tiền)</Label>
                <div className="flex gap-1">
                  {can.pickOverhead ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setPickOpen(true)}>
                      <ListPlus /> Lấy từ chi phí ngoài chuyến
                    </Button>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" onClick={() => set("items", [...d.items, { content: "", invoice_no: "", invoice_date: "", amount: 0 }])}>
                    <Plus /> Thêm dòng
                  </Button>
                </div>
              </div>
              {d.items.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-1 rounded-md border p-2">
                  <Input aria-label="Nội dung" value={it.content} placeholder="Nội dung chi" onChange={(e) => setItem(i, { content: e.target.value })} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Bỏ dòng" onClick={() => set("items", d.items.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                  <div className="col-span-2 grid grid-cols-3 gap-1">
                    <Input aria-label="Số hóa đơn" value={it.invoice_no} placeholder="Số HĐ" onChange={(e) => setItem(i, { invoice_no: e.target.value })} />
                    <Input aria-label="Ngày hóa đơn" type="date" value={it.invoice_date} onChange={(e) => setItem(i, { invoice_date: e.target.value })} />
                    <MoneyField id={`pf-item-${i}`} value={it.amount || null} onChange={(v) => setItem(i, { amount: v ?? 0 })} />
                  </div>
                </div>
              ))}
              {d.items.length ? <div className="text-right text-sm font-semibold">Tổng: {formatVND(total)}</div> : null}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {!isPay || !d.items.length ? (
              <F label={isPay ? "Số tiền thanh toán" : "Số tiền tạm ứng"} id="pf-amount">
                <MoneyField id="pf-amount" value={d.amount || null} onChange={(v) => set("amount", v ?? 0)} />
              </F>
            ) : null}
            {isPay ? (
              <>
                <F label="Số đã tạm ứng (nếu có)" id="pf-adv" help="Có thì phiếu ghi số còn phải thanh toán / phải hoàn lại.">
                  <MoneyField id="pf-adv" value={d.advance_amount || null} onChange={(v) => set("advance_amount", v ?? 0)} />
                </F>
                <F label="Số chứng từ gốc kèm theo" id="pf-att">
                  <Input
                    id="pf-att"
                    inputMode="numeric"
                    value={d.attachment_count ?? ""}
                    onChange={(e) => {
                      const n = e.target.value.replace(/\D/g, "").slice(0, 4);
                      set("attachment_count", n ? Number(n) : null);
                    }}
                  />
                </F>
              </>
            ) : (
              <F label="Thời hạn thanh toán (hoàn ứng)" id="pf-due">
                <Input id="pf-due" type="date" value={d.due_date} onChange={(e) => set("due_date", e.target.value)} />
              </F>
            )}
            <F label="Ghi chú" id="pf-notes" wide>
              <Input id="pf-notes" value={d.notes} onChange={(e) => set("notes", e.target.value)} />
            </F>
          </div>
          {d.id && d.overhead_ids.length && can.markPaid ? (
            <Button type="button" variant="outline" size="sm" onClick={markPaid} disabled={pending}>
              <CheckCheck /> Đã chi tiền: đánh dấu {d.overhead_ids.length} khoản chi ngoài chuyến là đã thanh toán
            </Button>
          ) : null}
        </div>

        <div className="min-w-0 overflow-x-auto rounded-lg bg-muted/50 p-3 print:bg-white print:p-0">
          <PaymentFormSheet d={{ ...d, amount: total }} />
        </div>
      </div>

      <div className="mt-6 print:hidden">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">Phiếu đã lập</h3>
          <Input className="h-8 w-64" placeholder="Tìm số phiếu, người đề nghị, nội dung…" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-[var(--grid-head,#eef4fb)] text-left font-semibold">
              <tr className="[&>th]:border-r [&>th]:px-2 [&>th]:py-1.5">
                <th>Số phiếu</th>
                <th>Loại</th>
                <th>Ngày</th>
                <th>Người đề nghị</th>
                <th>Nội dung</th>
                <th className="text-right">Số tiền</th>
              </tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.id} className={cn("border-t [&>td]:border-r [&>td]:px-2 [&>td]:py-1", f.id === d.id && "bg-primary/10")}>
                  <td>
                    <Link href={`/in-phieu?id=${f.id}`} className="font-medium text-primary hover:underline">
                      {f.code}
                    </Link>
                  </td>
                  <td>{f.form_type === "advance" ? "Tạm ứng" : "Thanh toán"}</td>
                  <td>{formatDate(f.form_date)}</td>
                  <td>{f.requester_name}</td>
                  <td className="max-w-[420px] truncate">{f.content}</td>
                  <td className="text-right tabular-nums">{formatVND(f.amount)}</td>
                </tr>
              ))}
              {!list.length ? (
                <tr>
                  <td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">
                    Chưa có phiếu nào.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {pickOpen ? (
        <PickOverheadDialog
          onClose={() => setPickOpen(false)}
          onPick={(rows) => {
            setD((x) => ({
              ...x,
              items: [
                ...x.items.filter((it) => it.content.trim() || it.amount),
                ...rows.map((r) => ({
                  content: [r.category_name, r.plate_number, r.description].filter(Boolean).join(" · "),
                  invoice_no: r.invoice_no ?? "",
                  invoice_date: r.invoice_date ?? "",
                  amount: r.total_amount,
                })),
              ],
              overhead_ids: [...new Set([...x.overhead_ids, ...rows.map((r) => r.id)])],
              attachment_count: x.attachment_count ?? (rows.filter((r) => r.invoice_no).length || null),
              requester_name: x.requester_name || rows.find((r) => r.spender_name)?.spender_name || "",
            }));
            setPickOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function F({ label, id, help, wide, children }: { label: string; id: string; help?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1", wide && "sm:col-span-2")}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );
}

function PickOverheadDialog({ onClose, onPick }: { onClose: () => void; onPick: (rows: OverheadPick[]) => void }) {
  const today = todayVN();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [onlyUnpaid, setOnlyUnpaid] = useState(true);
  const [rows, setRows] = useState<OverheadPick[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, start] = useTransition();

  function load() {
    start(async () => {
      const r = await listOverheadForForm({ from, to, onlyUnpaid });
      if (!r.ok) return void toast.error(r.error);
      setRows(r.data ?? []);
      setSel(new Set((r.data ?? []).map((x) => x.id)));
    });
  }
  const chosen = (rows ?? []).filter((r) => sel.has(r.id));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Lấy khoản chi ngoài chuyến</DialogTitle>
          <DialogDescription>Chọn các khoản để đưa vào giấy đề nghị thanh toán (VD: xăng đi lại cá nhân chi trước, chưa hoàn).</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="pk-from">Từ ngày</Label>
            <Input id="pk-from" type="date" className="h-8 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pk-to">Đến ngày</Label>
            <Input id="pk-to" type="date" className="h-8 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <label className="flex h-8 items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyUnpaid} onChange={(e) => setOnlyUnpaid(e.target.checked)} /> Chỉ khoản chưa thanh toán
          </label>
          <Button size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : null} Xem
          </Button>
        </div>
        {rows ? (
          <div className="max-h-[50vh] overflow-auto rounded border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left">
                <tr className="[&>th]:px-2 [&>th]:py-1">
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Chọn tất cả"
                      checked={rows.length > 0 && sel.size === rows.length}
                      onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                    />
                  </th>
                  <th>Ngày</th>
                  <th>Loại phí</th>
                  <th>Xe</th>
                  <th>Nội dung</th>
                  <th>Số HĐ</th>
                  <th>Người chi</th>
                  <th className="text-right">Tổng tiền</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t [&>td]:px-2 [&>td]:py-1">
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Chọn ${r.code}`}
                        checked={sel.has(r.id)}
                        onChange={(e) => {
                          const n = new Set(sel);
                          if (e.target.checked) n.add(r.id);
                          else n.delete(r.id);
                          setSel(n);
                        }}
                      />
                    </td>
                    <td>{formatDate(r.expense_date)}</td>
                    <td>{r.category_name}</td>
                    <td>{r.plate_number}</td>
                    <td>{r.description}</td>
                    <td>{r.invoice_no}</td>
                    <td>{r.spender_name}</td>
                    <td className="text-right tabular-nums">{formatVND(r.total_amount)}</td>
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">
                      Không có khoản chi nào.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
        <DialogFooter>
          <div className="mr-auto self-center text-sm">
            Đã chọn {chosen.length} khoản · {formatVND(chosen.reduce((a, r) => a + r.total_amount, 0))}
          </div>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          <Button disabled={!chosen.length} onClick={() => onPick(chosen)}>
            Đưa vào phiếu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
