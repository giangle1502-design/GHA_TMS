"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BellRing, Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type LockState = {
  mine: boolean;
  holder_name?: string | null;
  holder_since?: string | null;
  rev: number;
  saved_by_name?: string | null;
  saved_by_me?: boolean;
  saved_at?: string | null;
  ask_name?: string | null;
  stale?: boolean;
};

/** Báo "còn đang sửa" mỗi 30 giây; CSDL coi là đã thoát sau 2 phút không báo */
const HEARTBEAT_MS = 30_000;
/** Không mở khung sửa: xem có ai đang sửa mỗi 20 giây */
const POLL_MS = 20_000;
/** Đang nhập trên trang (không mở khung): giữ quyền sửa thêm 3 phút sau lần gõ cuối */
const TYPING_HOLD_MS = 3 * 60_000;
/** Không thao tác 10 phút thì tự nhả quyền sửa (để quên mở khung sửa) */
const IDLE_MS = 10 * 60_000;

const hm = (t?: string | null) => (t ? new Date(t).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : "");
const dialogOpen = () => Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));

/**
 * Một chuyến chỉ một người sửa: mở khung sửa hoặc gõ vào ô nhập trên trang chi tiết chuyến thì nhận quyền sửa.
 * Người khác đang sửa: hiện thanh đỏ "X đang sửa", người sau chỉ xem (CSDL chặn lưu), bấm báo người kia thoát ra.
 * Người khác lưu xong: tự tải lại trang khi mình không mở khung sửa; đang mở khung thì báo dữ liệu đã cũ.
 */
export function ShipmentEditLock({ shipmentId, rev }: { shipmentId: string; rev: number }) {
  const router = useRouter();
  const [state, setState] = useState<LockState | null>(null);
  const [asking, setAsking] = useState(false);
  const holding = useRef(false);
  const lastPing = useRef(0);
  const lastPoll = useRef(0);
  const lastTyping = useRef(0);
  const lastActivity = useRef(0);
  const busy = useRef(false);
  const wasBlocked = useRef(false);
  const refreshedFor = useRef(-1);
  const revRef = useRef(rev);
  useEffect(() => {
    revRef.current = rev;
  }, [rev]);

  const apply = useCallback(
    (s: LockState) => {
      setState(s);
      const blocked = Boolean(s.holder_name);
      if (wasBlocked.current && !blocked) toast.success("Người kia đã thoát ra, bạn sửa được chuyến này rồi.");
      wasBlocked.current = blocked;
      // Có người khác lưu sau khi trang được tải: không mở khung sửa thì tự tải bản mới
      if (s.rev > revRef.current && !s.saved_by_me && !dialogOpen() && Date.now() - lastTyping.current > 5000 && refreshedFor.current !== s.rev) {
        refreshedFor.current = s.rev;
        router.refresh();
      }
    },
    [router],
  );

  const tick = useCallback(async () => {
    if (busy.current || document.visibilityState === "hidden") return;
    const now = Date.now();
    const editing = dialogOpen() || now - lastTyping.current < TYPING_HOLD_MS;
    const idle = now - lastActivity.current > IDLE_MS;
    const want = editing && !idle;
    const supabase = createClient();
    busy.current = true;
    try {
      if (want) {
        if (holding.current && now - lastPing.current < HEARTBEAT_MS) return;
        const { data, error } = await supabase.rpc("shipment_edit_lock", { p_shipment_id: shipmentId, p_rev: revRef.current });
        if (error) return;
        lastPing.current = lastPoll.current = Date.now();
        const s = data as LockState;
        if (s.mine && !holding.current && s.stale) toast.warning(`${s.saved_by_name ?? "Người khác"} vừa lưu chuyến này lúc ${hm(s.saved_at)}. Dữ liệu bạn đang xem đã cũ: đóng khung sửa để tải bản mới rồi nhập lại.`, { duration: 15000 });
        holding.current = Boolean(s.mine);
        apply(s);
      } else {
        if (holding.current) {
          holding.current = false;
          await supabase.rpc("shipment_edit_unlock", { p_shipment_id: shipmentId });
          if (idle) toast.info("Bạn không thao tác 10 phút nên đã thoát chế độ sửa chuyến để người khác sửa.", { duration: 15000 });
          lastPoll.current = 0;
        }
        if (Date.now() - lastPoll.current < POLL_MS) return;
        const { data, error } = await supabase.rpc("shipment_edit_status", { p_shipment_id: shipmentId });
        if (error) return;
        lastPoll.current = Date.now();
        apply(data as LockState);
      }
    } finally {
      busy.current = false;
    }
  }, [shipmentId, apply]);

  useEffect(() => {
    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    const onTyping = (e: Event) => {
      onActivity();
      const t = e.target as HTMLElement | null;
      if (!t || t.closest("[data-no-edit-lock]")) return;
      // Chỉ ô nhập trong trang chi tiết chuyến hoặc trong khung sửa (không tính ô tìm kiếm trên thanh menu)
      if (!t.closest("main") && !t.closest('[role="dialog"]')) return;
      if (t instanceof HTMLInputElement && t.type === "search") return;
      lastTyping.current = Date.now();
      void tick();
    };
    // Khung sửa mở / đóng (gắn vào body) → nhận / nhả quyền sửa ngay
    let open = dialogOpen();
    const mo = new MutationObserver(() => {
      const o = dialogOpen();
      if (o === open) return;
      open = o;
      if (o) {
        lastActivity.current = Date.now();
        lastPing.current = 0;
      }
      void tick();
    });
    mo.observe(document.body, { childList: true });
    const iv = window.setInterval(() => void tick(), 5000);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        lastPoll.current = 0;
        void tick();
      }
    };
    document.addEventListener("input", onTyping, true);
    document.addEventListener("change", onTyping, true);
    document.addEventListener("pointerdown", onActivity, true);
    document.addEventListener("keydown", onActivity, true);
    document.addEventListener("visibilitychange", onVis);
    lastActivity.current = Date.now();
    void tick();
    return () => {
      mo.disconnect();
      window.clearInterval(iv);
      document.removeEventListener("input", onTyping, true);
      document.removeEventListener("change", onTyping, true);
      document.removeEventListener("pointerdown", onActivity, true);
      document.removeEventListener("keydown", onActivity, true);
      document.removeEventListener("visibilitychange", onVis);
      if (holding.current) {
        holding.current = false;
        void createClient().rpc("shipment_edit_unlock", { p_shipment_id: shipmentId });
      }
    };
  }, [shipmentId, tick]);

  async function ask() {
    setAsking(true);
    const { data, error } = await createClient().rpc("shipment_edit_ask", { p_shipment_id: shipmentId });
    setAsking(false);
    if (error) return void toast.error("Chưa gửi được, thử lại sau.");
    const r = data as { sent: boolean; holder_name?: string };
    if (r.sent) toast.success(`Đã báo ${r.holder_name ?? "người đang sửa"} lưu và thoát ra. Người đó thoát thì bạn sửa được.`);
    else {
      toast.info("Người kia đã thoát ra.");
      lastPoll.current = 0;
      void tick();
    }
  }

  if (!state) return null;
  if (state.holder_name) {
    return (
      <div className="fixed inset-x-2 top-2 z-[100] mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 shadow-lg dark:border-red-800 dark:bg-red-950 dark:text-red-100" role="status">
        <Lock className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <b>{state.holder_name}</b> đang sửa chuyến này (từ {hm(state.holder_since)}). Bạn chỉ xem được, chưa lưu được cho tới khi người đó thoát ra.
        </span>
        <Button size="sm" variant="outline" disabled={asking} onClick={ask} className="bg-white dark:bg-transparent">
          <BellRing /> Báo người đang sửa thoát ra
        </Button>
      </div>
    );
  }
  if (state.mine && state.stale && state.rev > rev && !state.saved_by_me) {
    return (
      <div className="fixed inset-x-2 top-2 z-[100] mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-lg dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" role="status">
        <RefreshCw className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          {state.saved_by_name ?? "Người khác"} vừa lưu chuyến này lúc {hm(state.saved_at)}. Dữ liệu bạn đang xem đã cũ nên chưa lưu được.
        </span>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()} className="bg-white dark:bg-transparent">
          <RefreshCw /> Tải lại trang
        </Button>
      </div>
    );
  }
  if (state.mine && state.ask_name) {
    return (
      <div className="fixed inset-x-2 top-2 z-[100] mx-auto flex max-w-3xl items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-lg dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" role="status">
        <BellRing className="size-4 shrink-0" />
        <span>
          <b>{state.ask_name}</b> đang chờ sửa chuyến này. Bạn lưu xong thì đóng khung sửa để nhả quyền sửa.
        </span>
      </div>
    );
  }
  return null;
}
