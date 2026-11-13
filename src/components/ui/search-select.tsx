"use client";
import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Từ bao nhiêu lựa chọn trở lên thì hiện ô tìm kiếm */
const SEARCH_FROM = 8;

type Opt = { value: string; label: string; group: string; disabled: boolean };

/** Bỏ dấu, viết thường để tìm "ha noi" ra "Hà Nội" */
function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

function readOptions(sel: HTMLSelectElement): Opt[] {
  return Array.from(sel.options).map((o) => ({
    value: o.value,
    label: o.text,
    group: o.parentElement instanceof HTMLOptGroupElement ? o.parentElement.label : "",
    disabled: o.disabled || (o.parentElement instanceof HTMLOptGroupElement && o.parentElement.disabled),
  }));
}

function textOf(n: React.ReactNode): string {
  if (n === null || n === undefined || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(n)) return textOf(n.props.children);
  return "";
}

/** Nhãn ban đầu đọc từ các <option> con, để lúc tải trang (trước khi chạy JS) không bị trống */
function initialShown(children: React.ReactNode, value: unknown) {
  const all: { value: string; label: string }[] = [];
  const walk = (n: React.ReactNode) =>
    React.Children.forEach(n, (c) => {
      if (!React.isValidElement<{ value?: unknown; children?: React.ReactNode }>(c)) return;
      if (c.type === "option") {
        const label = textOf(c.props.children);
        all.push({ value: c.props.value === undefined ? label : String(c.props.value), label });
      } else walk(c.props.children);
    });
  walk(children);
  const v = Array.isArray(value) ? value[0] : value;
  const o = v === undefined || v === null ? all[0] : all.find((x) => x.value === String(v));
  return { label: o?.label ?? "", empty: !o || o.value === "" };
}

/** Gắn phần tử vào ref truyền từ ngoài (hàm hoặc đối tượng ref) */
function assignRef<T>(ref: React.Ref<T> | undefined, el: T | null) {
  if (typeof ref === "function") ref(el);
  else if (ref) (ref as React.RefObject<T | null>).current = el;
}

/**
 * Ô chọn có tìm kiếm, thay cho thẻ <select> ở mọi màn hình.
 * Vẫn giữ một <select> thật (ẩn) để biểu mẫu, onChange, name, required, id hoạt động y như cũ;
 * danh sách và ô tìm hiện trong khung bật lên.
 */
export function SearchSelect({ className, style, disabled, ...props }: React.ComponentProps<"select">) {
  const selRef = React.useRef<HTMLSelectElement | null>(null);
  const btnRef = React.useRef<HTMLButtonElement | null>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [opts, setOpts] = React.useState<Opt[]>([]);
  const [hi, setHi] = React.useState(0);
  const [shown, setShown] = React.useState<{ label: string; empty: boolean }>(() => initialShown(props.children, props.value ?? props.defaultValue));

  // ref từ ngoài (ví dụ form.register của react-hook-form) phải gắn vào <select> thật,
  // nếu bỏ đi thì biểu mẫu đọc giá trị ra undefined sau khi người dùng đổi lựa chọn
  const { ref: outerRef, ...selectProps } = props as React.ComponentProps<"select">;
  const setSelRef = React.useCallback(
    (el: HTMLSelectElement | null) => {
      selRef.current = el;
      assignRef(outerRef, el);
    },
    [outerRef],
  );
  const [curValue, setCurValue] = React.useState("");

  // Nhãn đang chọn đọc từ <select> thật (đúng cả khi dùng value hay defaultValue)
  const sync = React.useCallback(() => {
    const sel = selRef.current;
    if (!sel) return;
    const o = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
    const next = { label: o?.text ?? "", empty: !o || o.value === "" };
    setShown((cur) => (cur.label === next.label && cur.empty === next.empty ? cur : next));
  }, []);
  React.useLayoutEffect(sync);
  React.useEffect(() => {
    const sel = selRef.current;
    const form = sel?.form;
    const onReset = () => setTimeout(sync, 0);
    sel?.addEventListener("change", sync);
    form?.addEventListener("reset", onReset);
    return () => {
      sel?.removeEventListener("change", sync);
      form?.removeEventListener("reset", onReset);
    };
  }, [sync]);

  const filtered = React.useMemo(() => {
    const t = norm(q);
    if (!t) return opts;
    const words = t.split(/\s+/);
    return opts.filter((o) => {
      const h = norm(`${o.label} ${o.group}`);
      return words.every((w) => h.includes(w));
    });
  }, [opts, q]);
  // Tiêu đề nhóm (optgroup) hiện trước lựa chọn đầu tiên của nhóm
  const heads = React.useMemo(() => filtered.map((o, i) => (o.group && o.group !== filtered[i - 1]?.group ? o.group : "")), [filtered]);

  function openList(seed = "") {
    const sel = selRef.current;
    if (!sel || disabled) return;
    const list = readOptions(sel);
    setOpts(list);
    setCurValue(sel.value);
    setQ(seed);
    const cur = list.findIndex((o) => o.value === sel.value);
    setHi(seed ? 0 : Math.max(0, cur));
    setOpen(true);
  }

  function pick(o: Opt | undefined) {
    const sel = selRef.current;
    if (!sel || !o || o.disabled) return;
    setOpen(false);
    btnRef.current?.focus();
    if (o.value === sel.value) return;
    // Gán giá trị rồi phát sự kiện change để onChange của React chạy như khi chọn trên <select> thường
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(sel, o.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    sync();
  }

  React.useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  function onListKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!filtered.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      let i = hi;
      for (let n = 0; n < filtered.length; n++) {
        i = (i + step + filtered.length) % filtered.length;
        if (!filtered[i].disabled) break;
      }
      setHi(i);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(filtered[hi]);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setHi(e.key === "Home" ? 0 : Math.max(0, filtered.length - 1));
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const showSearch = opts.length >= SEARCH_FROM;

  return (
    <Popover open={open} onOpenChange={(v) => (v ? openList() : setOpen(false))}>
      <PopoverAnchor asChild>
        <button
          ref={btnRef}
          type="button"
          data-slot="select"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={selectProps["aria-label"]}
          title={shown.label || undefined}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "F4" || (e.altKey && e.key === "ArrowDown")) {
              e.preventDefault();
              openList();
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== " ") {
              // Gõ chữ ngay trên ô: mở danh sách và tìm luôn
              e.preventDefault();
              openList(e.key);
            }
          }}
          className={cn(
            "flex h-9 w-full min-w-0 items-center justify-between gap-1 rounded-md border border-input bg-card px-3 py-1 text-left text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
            selectProps["aria-invalid"] && "border-destructive",
            className,
          )}
          style={style}
        >
          <span className={cn("min-w-0 flex-1 truncate", shown.empty && "text-muted-foreground")}>{shown.label || " "}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverAnchor>
      <select
        ref={setSelRef}
        {...selectProps}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        onFocus={() => btnRef.current?.focus()}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", margin: 0, padding: 0, border: 0 }}
      />
      <PopoverContent
        className="flex max-w-[min(28rem,calc(100vw-1rem))] flex-col p-0"
        style={{ minWidth: "max(var(--radix-popover-trigger-width), 12rem)" }}
        onKeyDown={onListKey}
        onPointerDownOutside={(e) => {
          // Bấm lại vào ô thì để onClick của ô tự đóng/mở
          if (btnRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
        onOpenAutoFocus={(e) => {
          if (!showSearch) {
            e.preventDefault();
            listRef.current?.focus();
          }
        }}
      >
        {showSearch ? (
          <div className="flex items-center gap-2 border-b px-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setHi(0);
              }}
              placeholder="Gõ để tìm…"
              aria-label="Tìm trong danh sách"
              className="h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {q ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{filtered.length}</span> : null}
          </div>
        ) : null}
        <ul ref={listRef} role="listbox" tabIndex={-1} className="max-h-72 overflow-y-auto p-1 outline-none">
          {filtered.length === 0 ? <li className="px-2 py-2 text-muted-foreground">Không thấy “{q.trim()}”.</li> : null}
          {filtered.map((o, i) => {
            const head = heads[i];
            const selected = curValue === o.value;
            return (
              <React.Fragment key={`${o.group}|${o.value}|${i}`}>
                {head ? <li className="px-2 pt-2 pb-1 text-xs font-semibold text-muted-foreground">{head}</li> : null}
                <li
                  data-i={i}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={o.disabled || undefined}
                  onMouseMove={() => !o.disabled && hi !== i && setHi(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5",
                    o.group && "pl-4",
                    i === hi && !o.disabled && "bg-accent",
                    o.disabled && "cursor-not-allowed opacity-50",
                    o.value === "" && "text-muted-foreground",
                  )}
                >
                  <Check className={cn("size-4 shrink-0", selected ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 break-words">{o.label || " "}</span>
                </li>
              </React.Fragment>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
