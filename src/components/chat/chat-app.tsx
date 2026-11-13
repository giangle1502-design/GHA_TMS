"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown, ArrowLeft, FileText, Info, Loader2, LogOut, MessageSquarePlus, Paperclip, Search, SendHorizontal, Shield, Trash2, UserMinus,
  UserPlus, Users, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/driver-link/upload";
import {
  CHAT_FILE_ACCEPT, CHAT_FILE_TYPES, CHAT_MAX_FILE, CHAT_READ_EVENT, MESSAGE_COLUMNS, chatDayKey, chatDayLabel, chatFileMime, chatListTime,
  chatTime, fold, formatFileSize, initials, roomPreview, sortRooms, type ChatMember, type ChatMessage, type ChatRoom, type StaffPerson,
} from "@/lib/chat";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PeoplePicker, type PickerMode } from "@/components/chat/people-picker";
import { cn } from "@/lib/utils";

const PAGE = 40;
type SearchHit = { id: string; room_id: string; body: string; created_at: string; sender_id: string | null };

function errText(e: unknown): string {
  const m = (e as { message?: string })?.message;
  return m && !/^[a-z_]+$/i.test(m) ? m : "Không thực hiện được, vui lòng thử lại";
}

function Avatar({ name, group, className }: { name: string; group?: boolean; className?: string }) {
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold", group ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-primary/10 text-primary", className)}>
      {group ? <Users className="size-5" /> : initials(name)}
    </span>
  );
}

/** Tô đậm chữ tìm thấy */
function Highlight({ text, q }: { text: string; q: string }) {
  const f = fold(q.trim());
  if (!f) return <>{text}</>;
  const i = fold(text).indexOf(f);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-700">{text.slice(i, i + f.length)}</mark>
      {text.slice(i + f.length)}
    </>
  );
}

/** Chữ tin nhắn, đường link bấm được */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 break-all">
            {p}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export function ChatApp({ meId, people }: { meId: string; people: StaffPerson[] }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const activeId = params.get("c");

  const names = useMemo(() => new Map(people.map((p) => [p.id, p.display_name])), [people]);
  const nameOf = useCallback((id: string | null) => (id === meId ? "Bạn" : (id && names.get(id)) || "Người dùng cũ"), [names, meId]);

  const [rooms, setRooms] = useState<ChatRoom[] | null>(null);
  const [listQ, setListQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState<PickerMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [roomQ, setRoomQ] = useState<string | null>(null);
  const [roomHits, setRoomHits] = useState<SearchHit[]>([]);
  const [rename, setRename] = useState("");
  const [memberQ, setMemberQ] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeRef = useRef(activeId);
  const hasNewerRef = useRef(hasNewer);
  const stickBottom = useRef(true);
  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);
  useEffect(() => {
    hasNewerRef.current = hasNewer;
  }, [hasNewer]);

  const active = rooms?.find((r) => r.id === activeId) ?? null;
  const open = useCallback(
    (id: string | null) => {
      const sp = new URLSearchParams(params.toString());
      if (id) sp.set("c", id);
      else sp.delete("c");
      router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // ------------------------------------------------------------- Danh sách cuộc trò chuyện
  const loadRooms = useCallback(async () => {
    const { data, error } = await supabase.from("chat_room_list").select("*").limit(500);
    if (error) return void toast.error(errText(error));
    setRooms(sortRooms((data ?? []) as ChatRoom[]));
  }, [supabase]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRooms();
  }, [loadRooms]);

  const markRead = useCallback(
    async (roomId: string) => {
      await supabase.rpc("chat_mark_read", { p_room: roomId });
      setRooms((rs) => rs?.map((r) => (r.id === roomId ? { ...r, unread_count: 0 } : r)) ?? rs);
      window.dispatchEvent(new Event(CHAT_READ_EVENT));
    },
    [supabase],
  );

  // ------------------------------------------------------------- Tệp đính kèm: đường dẫn xem tạm thời
  const signFiles = useCallback(
    async (list: ChatMessage[]) => {
      const paths = list.map((m) => m.attachment_path).filter((p): p is string => !!p);
      if (!paths.length) return;
      const { data } = await supabase.storage.from("documents").createSignedUrls(paths, 3600);
      if (!data) return;
      setUrls((u) => {
        const next = { ...u };
        for (const d of data) if (d.path && d.signedUrl) next[d.path] = d.signedUrl;
        return next;
      });
    },
    [supabase],
  );

  // ------------------------------------------------------------- Tin nhắn của cuộc trò chuyện đang mở
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const loadLatest = useCallback(
    async (roomId: string) => {
      setLoadingMsgs(true);
      const { data, error } = await supabase.from("chat_messages").select(MESSAGE_COLUMNS).eq("room_id", roomId).order("created_at", { ascending: false }).limit(PAGE);
      if (activeRef.current !== roomId) return;
      setLoadingMsgs(false);
      if (error) return void toast.error(errText(error));
      const rows = ((data ?? []) as ChatMessage[]).reverse();
      setMessages(rows);
      setHasOlder(rows.length === PAGE);
      setHasNewer(false);
      setFocusId(null);
      stickBottom.current = true;
      scrollToBottom();
      void signFiles(rows);
    },
    [supabase, scrollToBottom, signFiles],
  );

  const loadMembers = useCallback(
    async (roomId: string) => {
      const { data } = await supabase.from("chat_member_list").select("*").eq("room_id", roomId).order("joined_at");
      if (activeRef.current === roomId) setMembers((data ?? []) as ChatMember[]);
    },
    [supabase],
  );

  /** Tải các tin quanh một tin nhắn tìm thấy và cuộn tới tin đó */
  const loadAround = useCallback(
    async (hit: SearchHit) => {
      setLoadingMsgs(true);
      const [older, newer] = await Promise.all([
        supabase.from("chat_messages").select(MESSAGE_COLUMNS).eq("room_id", hit.room_id).lte("created_at", hit.created_at).order("created_at", { ascending: false }).limit(20),
        supabase.from("chat_messages").select(MESSAGE_COLUMNS).eq("room_id", hit.room_id).gt("created_at", hit.created_at).order("created_at").limit(20),
      ]);
      if (activeRef.current !== hit.room_id) return;
      const rows = [...((older.data ?? []) as ChatMessage[]).reverse(), ...((newer.data ?? []) as ChatMessage[])];
      setMessages(rows);
      setHasOlder((older.data ?? []).length === 20);
      setHasNewer((newer.data ?? []).length === 20);
      setFocusId(hit.id);
      setLoadingMsgs(false);
      stickBottom.current = false;
      void signFiles(rows);
      setTimeout(() => document.getElementById(`msg-${hit.id}`)?.scrollIntoView({ block: "center" }), 50);
    },
    [supabase, signFiles],
  );
  const pendingJump = useRef<SearchHit | null>(null);
  const jumpTo = (hit: SearchHit) => {
    if (hit.room_id === activeId) return void loadAround(hit);
    pendingJump.current = hit;
    open(hit.room_id);
  };

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setMessages([]);
    setMembers([]);
    setRoomQ(null);
    setRoomHits([]);
    setInfoOpen(false);
    setFile(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (!activeId) return;
    const pj = pendingJump.current;
    pendingJump.current = null;
    if (pj && pj.room_id === activeId) void loadAround(pj);
    else void loadLatest(activeId);
    void loadMembers(activeId);
    void markRead(activeId);
  }, [activeId, loadLatest, loadAround, loadMembers, markRead]);

  const loadOlder = async () => {
    if (!activeId || !messages.length) return;
    const el = scrollRef.current;
    const before = el?.scrollHeight ?? 0;
    const { data } = await supabase
      .from("chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("room_id", activeId)
      .lt("created_at", messages[0].created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE);
    const rows = ((data ?? []) as ChatMessage[]).reverse();
    setHasOlder(rows.length === PAGE);
    setMessages((m) => [...rows, ...m]);
    void signFiles(rows);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - before;
    });
  };

  // ------------------------------------------------------------- Realtime: tin mới, thu hồi
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refreshList = () => {
      clearTimeout(timer);
      timer = setTimeout(loadRooms, 300);
    };
    const channel = supabase
      .channel(`chat-app-${meId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
        const m = payload.new as ChatMessage;
        refreshList();
        if (m.room_id !== activeRef.current) return;
        if (m.kind === "system") void loadMembers(m.room_id);
        if (hasNewerRef.current) return;
        setMessages((list) => {
          if (list.some((x) => x.id === m.id)) return list;
          const i = m.client_id ? list.findIndex((x) => x.client_id === m.client_id) : -1;
          if (i >= 0) return list.map((x, j) => (j === i ? m : x));
          return [...list, m];
        });
        void signFiles([m]);
        if (stickBottom.current) scrollToBottom();
        if (m.sender_id !== meId && document.visibilityState === "visible") void markRead(m.room_id);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages" }, (payload) => {
        const m = payload.new as ChatMessage;
        refreshList();
        setMessages((list) => list.map((x) => (x.id === m.id ? m : x)));
      })
      .subscribe();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      refreshList();
      if (activeRef.current) void markRead(activeRef.current);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [supabase, meId, loadRooms, loadMembers, markRead, signFiles, scrollToBottom]);

  // ------------------------------------------------------------- Tìm kiếm
  useEffect(() => {
    const q = listQ.trim();
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("id, room_id, body, created_at, sender_id")
        .eq("kind", "text")
        .is("deleted_at", null)
        .ilike("body", `%${q.replace(/[%_\\]/g, "\\$&")}%`)
        .order("created_at", { ascending: false })
        .limit(30);
      setHits((data ?? []) as SearchHit[]);
    }, 300);
    return () => clearTimeout(t);
  }, [listQ, supabase]);

  useEffect(() => {
    const q = roomQ?.trim() ?? "";
    if (!activeId || q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRoomHits([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("chat_messages")
        .select("id, room_id, body, created_at, sender_id")
        .eq("room_id", activeId)
        .eq("kind", "text")
        .is("deleted_at", null)
        .ilike("body", `%${q.replace(/[%_\\]/g, "\\$&")}%`)
        .order("created_at", { ascending: false })
        .limit(50);
      setRoomHits((data ?? []) as SearchHit[]);
    }, 300);
    return () => clearTimeout(t);
  }, [roomQ, activeId, supabase]);

  const roomName = (id: string) => rooms?.find((r) => r.id === id)?.display_name ?? "";
  const shownRooms = useMemo(() => {
    const f = fold(listQ.trim());
    if (!rooms) return [];
    return f ? rooms.filter((r) => fold(`${r.display_name} ${roomPreview(r)}`).includes(f)) : rooms;
  }, [rooms, listQ]);

  // ------------------------------------------------------------- Gửi tin
  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!chatFileMime(f)) return void toast.error("Chỉ gửi được ảnh (JPG, PNG, WEBP, HEIC), PDF, Excel (.xlsx), Word (.docx)");
    // Ảnh lớn được thu nhỏ trước khi gửi; tệp khác tối đa 10 MB
    if (f.size > (f.type.startsWith("image/") ? CHAT_MAX_FILE * 4 : CHAT_MAX_FILE)) return void toast.error("Tệp tối đa 10 MB");
    setFile(f);
    inputRef.current?.focus();
  };

  const send = async () => {
    if (!activeId || sending) return;
    const body = draft;
    if (!body.trim() && !file) return;
    if (body.length > 4000) return void toast.error("Tin nhắn tối đa 4,000 ký tự");
    setSending(true);
    const clientId = crypto.randomUUID();
    let attachment: { path: string; name: string; mime: string; size: number } | null = null;
    try {
      if (file) {
        const mime = chatFileMime(file)!;
        const blob = mime.startsWith("image/") ? await compressImage(file) : file;
        const realMime = blob.type && CHAT_FILE_TYPES[blob.type] ? blob.type : mime;
        if (blob.size > CHAT_MAX_FILE) throw new Error("Tệp tối đa 10 MB");
        const path = `chat/${activeId}/${crypto.randomUUID()}.${CHAT_FILE_TYPES[realMime]}`;
        const up = await supabase.storage.from("documents").upload(path, blob, { contentType: realMime, upsert: false });
        if (up.error) throw new Error("Tải tệp không thành công: " + file.name);
        attachment = { path, name: file.name.slice(0, 200), mime: realMime, size: blob.size };
      }
      const temp: ChatMessage = {
        id: clientId, room_id: activeId, sender_id: meId, kind: "text", body, client_id: clientId, created_at: new Date().toISOString(), deleted_at: null,
        attachment_path: attachment?.path ?? null, attachment_name: attachment?.name ?? null, attachment_mime: attachment?.mime ?? null,
        attachment_size: attachment?.size ?? null, pending: true,
      };
      if (!hasNewer) {
        setMessages((m) => [...m, temp]);
        stickBottom.current = true;
        scrollToBottom();
      }
      setDraft("");
      setFile(null);
      const { data, error } = await supabase.rpc("chat_send", { p_room: activeId, p_body: body, p_attachment: attachment, p_client_id: clientId });
      if (error) {
        setMessages((m) => m.filter((x) => x.client_id !== clientId));
        setDraft(body);
        throw error;
      }
      setMessages((m) => m.map((x) => (x.client_id === clientId ? { ...x, id: data as string, pending: false } : x)));
      if (attachment) void signFiles([temp]);
      if (hasNewer) void loadLatest(activeId);
      void loadRooms();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const recall = async (m: ChatMessage) => {
    if (!confirm("Thu hồi tin nhắn này? Mọi người trong cuộc trò chuyện sẽ thấy “Tin nhắn đã thu hồi”.")) return;
    const { error } = await supabase.rpc("chat_delete_message", { p_id: m.id });
    if (error) return void toast.error(errText(error));
    setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, deleted_at: new Date().toISOString(), body: "", attachment_path: null, attachment_name: null } : x)));
    void loadRooms();
  };

  // ------------------------------------------------------------- Tạo cuộc trò chuyện, quản lý nhóm
  const submitPicker = async (ids: string[], name: string) => {
    setBusy(true);
    try {
      if (picker === "direct") {
        const { data, error } = await supabase.rpc("chat_open_direct", { p_user: ids[0] });
        if (error) throw error;
        await loadRooms();
        open(data as string);
      } else if (picker === "group") {
        const { data, error } = await supabase.rpc("chat_create_group", { p_name: name, p_members: ids });
        if (error) throw error;
        await loadRooms();
        open(data as string);
        toast.success("Đã tạo nhóm " + name);
      } else if (picker === "add" && activeId) {
        const { data, error } = await supabase.rpc("chat_add_members", { p_room: activeId, p_members: ids });
        if (error) throw error;
        toast.success(`Đã thêm ${data} người vào nhóm`);
        void loadMembers(activeId);
        void loadRooms();
      }
      setPicker(null);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const groupAction = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return void toast.error(errText(error));
    toast.success(ok);
    if (activeId) void loadMembers(activeId);
    void loadRooms();
  };

  const leave = async () => {
    if (!activeId || !confirm("Rời nhóm này? Bạn sẽ không xem được tin nhắn của nhóm nữa (trừ khi được thêm lại).")) return;
    setBusy(true);
    const { error } = await supabase.rpc("chat_leave", { p_room: activeId });
    setBusy(false);
    if (error) return void toast.error(errText(error));
    toast.success("Đã rời nhóm");
    setInfoOpen(false);
    open(null);
    void loadRooms();
  };

  const isAdmin = active?.my_role === "admin";
  const memberIds = members.map((m) => m.user_id);
  const shownMembers = members.filter((m) => !memberQ.trim() || fold(`${m.display_name} ${m.role_names ?? ""}`).includes(fold(memberQ.trim())));
  const directPerson = active?.kind === "direct" ? members.find((m) => m.user_id !== meId) : null;

  // ------------------------------------------------------------- Giao diện
  return (
    <div className="flex h-[calc(100dvh-4rem-2rem)] overflow-hidden rounded-lg border bg-card sm:h-[calc(100dvh-4rem-3rem)]">
      {/* Cột trái: danh sách cuộc trò chuyện */}
      <aside className={cn("flex w-full shrink-0 flex-col border-r md:w-80", activeId && "hidden md:flex")}>
        <div className="space-y-2 border-b p-3">
          <h1 className="text-lg font-semibold">Trò chuyện</h1>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={() => setPicker("direct")} title="Nhắn riêng cho một người">
              <MessageSquarePlus /> Nhắn tin
            </Button>
            <Button size="sm" onClick={() => setPicker("group")} title="Tạo nhóm nhiều người">
              <Users /> Tạo nhóm
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              value={listQ}
              onChange={(e) => setListQ(e.target.value)}
              placeholder="Tìm người, nhóm hoặc nội dung tin nhắn"
              className="pr-8 pl-8"
              aria-label="Tìm cuộc trò chuyện"
            />
            {listQ ? (
              <button type="button" className="absolute top-2 right-2 rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={() => setListQ("")} aria-label="Xóa tìm kiếm">
                <X className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {rooms === null ? (
            <div className="flex justify-center p-6 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : null}
          {rooms && !rooms.length ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Chưa có cuộc trò chuyện nào. Bấm <b>Nhắn tin</b> để nhắn riêng cho một người, hoặc <b>Tạo nhóm</b> để trò chuyện nhiều người.
            </div>
          ) : null}
          <ul>
            {shownRooms.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => open(r.id)}
                  className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent", r.id === activeId && "bg-primary/10 hover:bg-primary/10")}
                >
                  <Avatar name={r.display_name} group={r.kind === "group"} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={cn("flex-1 truncate text-sm", r.unread_count ? "font-semibold" : "font-medium")}>
                        <Highlight text={r.display_name} q={listQ} />
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{chatListTime(r.last_message_at)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={cn("flex-1 truncate text-xs", r.unread_count ? "font-medium text-foreground" : "text-muted-foreground")}>{roomPreview(r)}</span>
                      {r.unread_count ? (
                        <span className="flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white">
                          {r.unread_count > 99 ? "99+" : r.unread_count}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {listQ.trim().length >= 2 ? (
            <div className="border-t">
              <p className="px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground uppercase">Tin nhắn có chữ “{listQ.trim()}”</p>
              {hits.length ? (
                <ul>
                  {hits.map((h) => (
                    <li key={h.id}>
                      <button type="button" onClick={() => jumpTo(h)} className="w-full px-3 py-2 text-left hover:bg-accent">
                        <span className="flex items-baseline gap-2 text-xs">
                          <span className="flex-1 truncate font-medium">{roomName(h.room_id)}</span>
                          <span className="text-muted-foreground">{chatListTime(h.created_at)}</span>
                        </span>
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {nameOf(h.sender_id)}: <Highlight text={h.body} q={listQ} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 pb-3 text-xs text-muted-foreground">Không có tin nhắn nào khớp.</p>
              )}
            </div>
          ) : null}
        </div>
      </aside>

      {/* Cột phải: tin nhắn */}
      <section className={cn("min-w-0 flex-1 flex-col", activeId ? "flex" : "hidden md:flex")}>
        {!activeId ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <MessageSquarePlus className="size-10" />
            <p className="text-sm">Chọn một cuộc trò chuyện bên trái, hoặc bấm Nhắn tin / Tạo nhóm để bắt đầu.</p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b px-2 py-2 sm:px-3">
              <Button variant="ghost" size="icon" className="md:hidden" onClick={() => open(null)} aria-label="Quay lại danh sách">
                <ArrowLeft />
              </Button>
              <Avatar name={active?.display_name ?? ""} group={active?.kind === "group"} className="size-9" />
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setInfoOpen(true)}>
                <span className="block truncate font-semibold">{active?.display_name ?? "…"}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {active?.kind === "group" ? `${active.member_count} thành viên` : directPerson?.role_names || "Trò chuyện riêng"}
                </span>
              </button>
              <Button variant="ghost" size="icon" onClick={() => setRoomQ((v) => (v === null ? "" : null))} aria-label="Tìm trong cuộc trò chuyện" title="Tìm trong cuộc trò chuyện">
                <Search />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setInfoOpen(true)} aria-label="Thông tin" title={active?.kind === "group" ? "Thành viên, đổi tên, rời nhóm" : "Thông tin"}>
                <Info />
              </Button>
            </header>
            {roomQ !== null ? (
              <div className="border-b bg-muted/40 p-2">
                <Input autoFocus value={roomQ} onChange={(e) => setRoomQ(e.target.value)} placeholder="Tìm chữ trong cuộc trò chuyện này (ít nhất 2 ký tự)" aria-label="Tìm trong cuộc trò chuyện" />
                {roomQ.trim().length >= 2 ? (
                  <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border bg-card">
                    {roomHits.map((h) => (
                      <li key={h.id}>
                        <button type="button" className="w-full px-3 py-1.5 text-left text-xs hover:bg-accent" onClick={() => jumpTo(h)}>
                          <span className="text-muted-foreground">
                            {chatListTime(h.created_at)} · {nameOf(h.sender_id)}:{" "}
                          </span>
                          <Highlight text={h.body} q={roomQ} />
                        </button>
                      </li>
                    ))}
                    {!roomHits.length ? <li className="px-3 py-2 text-xs text-muted-foreground">Không có tin nhắn nào khớp.</li> : null}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div
              ref={scrollRef}
              className="flex-1 space-y-1 overflow-y-auto bg-muted/30 px-3 py-3 sm:px-4"
              onScroll={(e) => {
                const el = e.currentTarget;
                stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              {hasOlder ? (
                <div className="flex justify-center pb-2">
                  <Button size="sm" variant="outline" onClick={() => void loadOlder()}>
                    Xem tin cũ hơn
                  </Button>
                </div>
              ) : null}
              {loadingMsgs ? (
                <div className="flex justify-center p-6 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : null}
              {!loadingMsgs && !messages.length ? <p className="py-10 text-center text-sm text-muted-foreground">Chưa có tin nhắn. Hãy gửi lời chào!</p> : null}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const newDay = !prev || chatDayKey(prev.created_at) !== chatDayKey(m.created_at);
                const mine = m.sender_id === meId;
                const firstOfRun = newDay || !prev || prev.sender_id !== m.sender_id || prev.kind === "system";
                const url = m.attachment_path ? urls[m.attachment_path] : undefined;
                const isImage = m.attachment_mime?.startsWith("image/") && m.attachment_mime !== "image/heic";
                return (
                  <Fragment key={m.client_id ?? m.id}>
                    {newDay ? (
                      <div className="flex justify-center py-2">
                        <span className="rounded-full bg-card px-3 py-0.5 text-[11px] text-muted-foreground shadow-xs">{chatDayLabel(m.created_at)}</span>
                      </div>
                    ) : null}
                    {m.kind === "system" ? (
                      <p className="py-1 text-center text-xs text-muted-foreground">
                        {m.body} · {chatTime(m.created_at)}
                      </p>
                    ) : (
                      <div id={`msg-${m.id}`} className={cn("group flex items-end gap-2", mine ? "justify-end" : "justify-start", firstOfRun && "pt-2")}>
                        {mine && !m.deleted_at && !m.pending ? (
                          <button
                            type="button"
                            onClick={() => void recall(m)}
                            className="mb-1 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus:opacity-100"
                            title="Thu hồi tin nhắn"
                            aria-label="Thu hồi tin nhắn"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        ) : null}
                        <div className={cn("max-w-[85%] sm:max-w-[70%]", mine && "text-right")}>
                          {!mine && firstOfRun && active?.kind === "group" ? <p className="mb-0.5 px-1 text-xs font-medium text-muted-foreground">{nameOf(m.sender_id)}</p> : null}
                          <div
                            className={cn(
                              "inline-block rounded-2xl px-3 py-2 text-left text-sm shadow-xs",
                              mine ? "bg-primary text-primary-foreground" : "bg-card",
                              m.pending && "opacity-60",
                              focusId === m.id && "ring-2 ring-yellow-400",
                            )}
                          >
                            {m.deleted_at ? (
                              <span className="italic opacity-70">Tin nhắn đã thu hồi</span>
                            ) : (
                              <>
                                {m.attachment_path ? (
                                  isImage && url ? (
                                    <a href={url} target="_blank" rel="noreferrer noopener" className="mb-1 block">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={url} alt={m.attachment_name ?? "Ảnh"} className="max-h-64 max-w-full rounded-lg object-contain" loading="lazy" />
                                    </a>
                                  ) : (
                                    <a
                                      href={url}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      className={cn("mb-1 flex items-center gap-2 rounded-lg border px-2 py-1.5", mine ? "border-white/30" : "bg-muted/50")}
                                    >
                                      <FileText className="size-5 shrink-0" />
                                      <span className="min-w-0">
                                        <span className="block truncate font-medium">{m.attachment_name}</span>
                                        <span className="block text-xs opacity-70">{formatFileSize(m.attachment_size)} · bấm để mở/tải</span>
                                      </span>
                                    </a>
                                  )
                                ) : null}
                                {m.body ? (
                                  <span className="break-words whitespace-pre-wrap">
                                    <Linkified text={m.body} />
                                  </span>
                                ) : null}
                              </>
                            )}
                            <span className={cn("mt-0.5 block text-right text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                              {m.pending ? "Đang gửi…" : chatTime(m.created_at)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              })}
              {hasNewer ? (
                <div className="flex justify-center pt-2">
                  <Button size="sm" variant="outline" onClick={() => activeId && void loadLatest(activeId)}>
                    <ArrowDown /> Về tin mới nhất
                  </Button>
                </div>
              ) : null}
            </div>

            <footer className="border-t p-2 sm:p-3">
              {file ? (
                <div className="mb-2 flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1 text-sm">
                  <Paperclip className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {file.name} <span className="text-xs text-muted-foreground">({formatFileSize(file.size)})</span>
                  </span>
                  <button type="button" onClick={() => setFile(null)} className="rounded p-0.5 hover:bg-accent" aria-label="Bỏ tệp">
                    <X className="size-4" />
                  </button>
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <input ref={fileRef} type="file" accept={CHAT_FILE_ACCEPT} className="hidden" onChange={(e) => (pickFile(e.target.files?.[0]), (e.target.value = ""))} />
                <Button variant="ghost" size="icon" onClick={() => fileRef.current?.click()} aria-label="Gửi kèm ảnh hoặc tệp" title="Gửi kèm ảnh, PDF, Excel, Word (tối đa 10 MB)">
                  <Paperclip />
                </Button>
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  onPaste={(e) => {
                    const f = Array.from(e.clipboardData.files)[0];
                    if (f) {
                      e.preventDefault();
                      pickFile(f);
                    }
                  }}
                  rows={1}
                  maxLength={4000}
                  placeholder="Nhập tin nhắn…"
                  title="Enter để gửi, Shift+Enter xuống dòng, dán ảnh (Ctrl+V) để gửi kèm"
                  className="max-h-40 min-h-9 flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 text-sm outline-none field-sizing-content focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  aria-label="Nội dung tin nhắn"
                />
                <Button size="icon" onClick={() => void send()} disabled={sending || (!draft.trim() && !file)} aria-label="Gửi" title="Gửi">
                  {sending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
                </Button>
              </div>
            </footer>
          </>
        )}
      </section>

      <PeoplePicker
        open={picker !== null}
        onOpenChange={(v) => !v && setPicker(null)}
        mode={picker ?? "direct"}
        people={people}
        meId={meId}
        exclude={picker === "add" ? memberIds : []}
        busy={busy}
        onSubmit={(ids, name) => void submitPicker(ids, name)}
      />

      {/* Thông tin cuộc trò chuyện / quản lý nhóm */}
      <Dialog open={infoOpen && !!active} onOpenChange={(v) => (setInfoOpen(v), setRename(""), setMemberQ(""))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{active?.display_name}</DialogTitle>
            <DialogDescription>
              {active?.kind === "group"
                ? "Mọi thành viên thêm được người và đổi tên nhóm. Quản trị nhóm mời người ra và giao quyền quản trị."
                : `Trò chuyện riêng với ${directPerson?.display_name ?? ""}${directPerson?.role_names ? ` (${directPerson.role_names})` : ""}.`}
            </DialogDescription>
          </DialogHeader>
          {active?.kind === "group" ? (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="chat-rename">Đổi tên nhóm</Label>
                <div className="flex gap-2">
                  <Input id="chat-rename" maxLength={100} value={rename} onChange={(e) => setRename(e.target.value)} placeholder={active.display_name} />
                  <Button
                    variant="outline"
                    disabled={busy || !rename.trim()}
                    onClick={() => void groupAction("chat_rename", { p_room: active.id, p_name: rename.trim() }, "Đã đổi tên nhóm").then(() => setRename(""))}
                  >
                    Lưu
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <p className="flex-1 text-sm font-medium">{members.length} thành viên</p>
                <Button size="sm" variant="outline" onClick={() => setPicker("add")}>
                  <UserPlus /> Thêm thành viên
                </Button>
              </div>
              {members.length > 6 ? <Input value={memberQ} onChange={(e) => setMemberQ(e.target.value)} placeholder="Tìm thành viên" aria-label="Tìm thành viên" /> : null}
              <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
                {shownMembers.map((m) => (
                  <li key={m.user_id} className="flex items-center gap-3 px-3 py-2">
                    <Avatar name={m.display_name} className="size-8 text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {m.display_name}
                        {m.user_id === meId ? " (bạn)" : ""}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {m.role === "admin" ? "Quản trị nhóm · " : ""}
                        {m.role_names || "Nhân viên"}
                      </span>
                    </span>
                    {isAdmin && m.user_id !== meId ? (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={busy}
                          title={m.role === "admin" ? "Bỏ quyền quản trị" : "Giao quyền quản trị nhóm"}
                          aria-label={m.role === "admin" ? "Bỏ quyền quản trị" : "Giao quyền quản trị nhóm"}
                          onClick={() =>
                            void groupAction("chat_set_admin", { p_room: active.id, p_user: m.user_id, p_admin: m.role !== "admin" }, m.role === "admin" ? "Đã bỏ quyền quản trị" : "Đã giao quyền quản trị")
                          }
                        >
                          <Shield className={cn(m.role === "admin" && "fill-current text-primary")} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={busy}
                          title="Mời ra khỏi nhóm"
                          aria-label="Mời ra khỏi nhóm"
                          onClick={() =>
                            confirm(`Mời ${m.display_name} ra khỏi nhóm?`) &&
                            void groupAction("chat_remove_member", { p_room: active.id, p_user: m.user_id }, `Đã mời ${m.display_name} ra khỏi nhóm`)
                          }
                        >
                          <UserMinus />
                        </Button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
              <DialogFooter>
                <Button variant="destructive" disabled={busy} onClick={() => void leave()}>
                  <LogOut /> Rời nhóm
                </Button>
              </DialogFooter>
            </>
          ) : (
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setInfoOpen(false);
                  setPicker("group");
                }}
              >
                <Users /> Tạo nhóm mới
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
