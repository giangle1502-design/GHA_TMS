"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Container, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatVND } from "@/lib/format";
import { formatContainerNo, isValidContainerNo, normalizeContainerNo } from "@/lib/container-no";
import { saveContainer } from "./actions";
import { MoneyInput } from "./expense-forms";

/** Trả rỗng & cược cont của một chuyến (driver_link_containers) */
export type ContainerInfo = {
  shipment_id: string;
  container_no: string | null;
  empty_return_state: "returned" | "kept" | null;
  prev_code: string | null;
  next_code: string | null;
  root_id: string;
  root_code: string;
  empty_amount: number | null;
  empty_ref: string | null;
  deposit_amount: number | null;
  deposit_ref: string | null;
  locked: boolean;
};

export type ContainerForm = {
  emptyAmount: number | null;
  emptyRef: string;
  depositAmount: number | null;
  depositRef: string;
  state: "returned" | "kept" | null;
  /** Số cont tài xế gõ khi chuyến chưa có số cont */
  containerNo: string;
};

const num = (v: number | string | null) => (v === null || v === "" ? null : Number(v));

export function containerForm(c: ContainerInfo): ContainerForm {
  return {
    emptyAmount: num(c.empty_amount),
    emptyRef: c.empty_ref ?? "",
    depositAmount: num(c.deposit_amount),
    depositRef: c.deposit_ref ?? "",
    state: c.empty_return_state,
    containerNo: "",
  };
}

/** Kiểm tra trước khi gửi (máy chủ kiểm tra lại) */
export function containerError(f: ContainerForm, askState: boolean, knownNo: string | null): string | null {
  if (askState && !f.state) return 'Chọn "Đã trả rỗng" hoặc "Giữ vỏ cho chuyến sau".';
  if (f.state === "returned" && f.emptyAmount === null) return "Đã trả rỗng: nhập số tiền trả rỗng.";
  if (f.emptyRef.trim() && f.emptyAmount === null) return "Nhập số tiền trả rỗng.";
  if (f.depositRef.trim() && f.depositAmount === null) return "Nhập số tiền cược cont.";
  const filled = f.emptyAmount !== null || f.depositAmount !== null || f.emptyRef.trim() || f.depositRef.trim();
  if (!knownNo && filled && !f.containerNo.trim()) return "Nhập số cont (in trên hóa đơn) để không nhập nhầm cont.";
  if (!knownNo && f.containerNo.trim() && !isValidContainerNo(f.containerNo))
    return "Số cont không đúng: 4 chữ cái + 7 số, số cuối là số kiểm tra. Xem lại số cont trên hóa đơn / vỏ cont.";
  return null;
}

export async function submitContainer(shipmentId: string, f: ContainerForm) {
  return saveContainer({
    shipmentId,
    emptyAmount: f.emptyAmount,
    emptyRef: f.emptyRef.trim() || null,
    depositAmount: f.depositAmount,
    depositRef: f.depositRef.trim() || null,
    state: f.state,
    containerNo: f.containerNo.trim() ? normalizeContainerNo(f.containerNo) : null,
  });
}

/** Dòng "Vỏ cont … nhận từ chuyến …" và nơi gộp phí */
export function ContainerOrigin({ c }: { c: ContainerInfo }) {
  return (
    <>
      {c.prev_code ? (
        <p className="rounded-lg bg-tone-blue/12 p-2 text-sm">
          Vỏ cont {c.container_no ? <strong className="font-mono">{formatContainerNo(c.container_no)}</strong> : null} nhận từ chuyến <strong className="font-mono">{c.prev_code}</strong>.
          {c.root_code !== c.prev_code ? ` Phí ghi vào chuyến đầu ${c.root_code}.` : " Phí ghi vào chuyến đó."}
        </p>
      ) : null}
      {c.next_code ? (
        <p className="rounded-lg bg-muted p-2 text-sm">
          Vỏ đã chuyển sang chuyến <strong className="font-mono">{c.next_code}</strong>, trả rỗng nhập ở chuyến đó.
        </p>
      ) : null}
    </>
  );
}

/** 4 ô tài xế nhập + chọn Đã trả rỗng / Giữ vỏ */
export function ContainerFields({
  id,
  value,
  onChange,
  askState,
  canReturn,
  knownNo,
}: {
  id: string;
  value: ContainerForm;
  onChange: (f: ContainerForm) => void;
  askState: boolean;
  canReturn: boolean;
  /** Số cont của chuyến (đã có): hiện to để đối chiếu hóa đơn */
  knownNo: string | null;
}) {
  const typed = value.containerNo.trim();
  return (
    <div className="space-y-3">
      {knownNo ? (
        <div data-container-no className="rounded-xl border-2 border-primary bg-primary/5 p-3 text-center">
          <div className="text-xs font-medium uppercase text-muted-foreground">Số cont của chuyến này</div>
          <div className="font-mono text-2xl font-bold tracking-wider">{formatContainerNo(knownNo)}</div>
          <div className="mt-1 text-xs">Chỉ nhập hóa đơn có đúng số cont này.</div>
        </div>
      ) : (
        <div>
          <label htmlFor={`${id}-cn`} className="mb-1 block text-sm font-medium">Số cont (bắt buộc, in trên hóa đơn / vỏ cont)</label>
          <Input
            id={`${id}-cn`}
            className="h-14 font-mono text-xl uppercase tracking-wider"
            placeholder="Ví dụ CSQU3054383"
            autoCapitalize="characters"
            maxLength={20}
            value={value.containerNo}
            onChange={(e) => onChange({ ...value, containerNo: e.target.value })}
          />
          {typed ? (
            isValidContainerNo(typed) ? (
              <p className="mt-1 text-xs text-success">Đúng định dạng: {formatContainerNo(typed)}</p>
            ) : (
              <p className="mt-1 text-xs text-destructive">Chưa đúng: 4 chữ cái + 7 số, số cuối là số kiểm tra.</p>
            )
          ) : null}
        </div>
      )}
      {askState ? (
        <div>
          <div className="mb-1 text-sm font-medium">Vỏ container (bắt buộc chọn)</div>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Vỏ container">
            {(
              [
                ["returned", "Đã trả rỗng"],
                ["kept", "Giữ vỏ cho chuyến sau"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={value.state === v}
                disabled={v === "returned" && !canReturn}
                onClick={() => onChange({ ...value, state: v })}
                className={`rounded-lg px-1 py-2 text-sm font-medium disabled:opacity-50 ${value.state === v ? "bg-card shadow-xs" : "text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {value.state === "kept" ? <p className="mt-1 text-xs text-muted-foreground">Chạy tiếp chuyến sau bằng vỏ này (chuyển kho). Trả rỗng nhập ở chuyến cuối khi hạ vỏ.</p> : null}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-ea`} className="mb-1 block text-sm font-medium">Số tiền trả rỗng</label>
          <MoneyInput id={`${id}-ea`} value={value.emptyAmount} onChange={(emptyAmount) => onChange({ ...value, emptyAmount })} placeholder="Ví dụ 300,000" />
        </div>
        <div>
          <label htmlFor={`${id}-er`} className="mb-1 block text-sm font-medium">Số hóa đơn trả rỗng</label>
          <Input id={`${id}-er`} className="h-14 text-lg" value={value.emptyRef} maxLength={100} onChange={(e) => onChange({ ...value, emptyRef: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${id}-da`} className="mb-1 block text-sm font-medium">Số tiền cược cont</label>
          <MoneyInput id={`${id}-da`} value={value.depositAmount} onChange={(depositAmount) => onChange({ ...value, depositAmount })} placeholder="Ví dụ 500,000" />
        </div>
        <div>
          <label htmlFor={`${id}-dr`} className="mb-1 block text-sm font-medium">Số hóa đơn cược cont</label>
          <Input id={`${id}-dr`} className="h-14 text-lg" value={value.depositRef} maxLength={100} onChange={(e) => onChange({ ...value, depositRef: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

/** Thẻ trả rỗng & cược cont trên thẻ chuyến: xem và sửa */
export function ContainerCard({ c, code, completed }: { c: ContainerInfo; code: string; completed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ContainerForm>(() => containerForm(c));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Chuyến đã hoàn thành: được đổi Đã trả rỗng / Giữ vỏ. Chuyến đang chạy: chọn khi bấm Hoàn thành.
  const askState = completed && !c.next_code;

  function submit() {
    start(async () => {
      setError(null);
      const bad = containerError(form, false, c.container_no);
      if (bad) return setError(bad);
      const r = await submitContainer(c.shipment_id, form);
      if (!r.ok) return setError(r.error);
      setOpen(false);
      router.refresh();
    });
  }

  const line = (label: string, amount: number | null, ref: string | null) => (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">
        {amount === null ? "chưa nhập" : formatVND(amount)}
        {ref ? <span className="text-muted-foreground"> · HĐ {ref}</span> : null}
      </span>
    </div>
  );

  return (
    <div data-container-card className="mt-3 space-y-2 rounded-xl border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">
          <Container className="size-4 text-primary" /> Trả rỗng & cược cont
        </div>
        {c.empty_return_state ? (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.empty_return_state === "returned" ? "bg-success/10 text-success" : "bg-warning/10"}`}>
            {c.empty_return_state === "returned" ? "Đã trả rỗng" : "Giữ vỏ"}
          </span>
        ) : null}
      </div>
      {c.container_no ? (
        <div className="rounded-lg bg-primary/5 px-3 py-2 text-center">
          <span className="text-xs text-muted-foreground">Số cont </span>
          <span className="font-mono text-lg font-bold tracking-wider">{formatContainerNo(c.container_no)}</span>
        </div>
      ) : (
        <p className="rounded-lg bg-warning/10 p-2 text-xs">Chuyến chưa có số cont: nhập số cont khi nhập trả rỗng / cược.</p>
      )}
      <ContainerOrigin c={c} />
      {line("Trả rỗng", num(c.empty_amount), c.empty_ref)}
      {line("Cược cont", num(c.deposit_amount), c.deposit_ref)}
      {c.locked ? (
        <p className="text-xs text-muted-foreground">Đã khóa (đã lập công nợ hoặc văn phòng đã đóng chuyến). Cần sửa vui lòng gọi điều phối.</p>
      ) : (
        <button
          type="button"
          aria-label={`Nhập trả rỗng, cược cont ${code}`}
          onClick={() => {
            setForm(containerForm(c));
            setError(null);
            setOpen(true);
          }}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border font-medium"
        >
          <Pencil className="size-4" /> Nhập / sửa trả rỗng, cược cont
        </button>
      )}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Trả rỗng & cược cont {code}</DialogTitle>
            <DialogDescription>
              Ô nào chưa phát sinh thì để trống.{c.root_code !== code ? ` Phí ghi vào chuyến đầu ${c.root_code} của vỏ cont.` : ""}
            </DialogDescription>
          </DialogHeader>
          <ContainerFields id={`cc-${c.shipment_id}`} value={form} onChange={setForm} askState={askState} canReturn={!c.next_code} knownNo={c.container_no} />
          {error ? <p className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive">{error}</p> : null}
          <button type="button" disabled={pending} onClick={submit} className="flex h-14 w-full items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground disabled:opacity-60">
            {pending ? "Đang lưu…" : "Lưu"}
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
