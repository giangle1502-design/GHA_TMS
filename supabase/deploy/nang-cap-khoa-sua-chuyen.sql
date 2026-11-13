-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Một chuyến chỉ một người sửa: người sau chỉ xem, báo người đang sửa thoát ra
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('public.shipment_edit_lock(uuid,bigint)') is not null then
    raise exception 'CSDL đã được nâng cấp Một chuyến chỉ một người sửa: người sau chỉ xem, báo người đang sửa thoát ra trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261104000061_shipment_edit_lock.sql
-- =============================================================================
-- 0061: Một chuyến chỉ một người sửa tại một thời điểm
-- Người A đang sửa chuyến (mở khung sửa / đang nhập) thì người B chỉ xem được:
-- mọi thao tác lưu của B vào chuyến (thông tin chuyến, phí thu khách, chi phí
-- đầu ra, chi phí 3PL, hàng hóa) bị chặn, báo "A đang sửa", tới khi A thoát.
-- Quyền sửa tự hết sau 2 phút máy A không báo "còn đang sửa" (tắt tab, mất mạng)
-- nên không ai bị kẹt. Người giữ quyền sửa mà dữ liệu đã cũ (người khác lưu
-- trước khi mình vào) cũng không lưu được: phải tải lại trang (không ghi đè).
-- Tài xế (app tài xế) và hệ thống không tham gia khóa.
-- =============================================================================

create table if not exists public.shipment_edit_locks (
  -- Không khóa ngoại tới shipments để "Xóa dữ liệu thử" (truncate shipments) vẫn chạy; dòng mồ côi vô hại
  shipment_id uuid primary key,
  -- Số lần lưu của người dùng văn phòng (mỗi giao dịch lưu tăng 1)
  rev bigint not null default 0,
  saved_by uuid,
  saved_by_name text,
  saved_at timestamptz,
  saved_xid bigint,
  -- Người đang giữ quyền sửa
  lock_user uuid,
  lock_name text,
  lock_since timestamptz,
  lock_seen timestamptz,
  lock_base_rev bigint,
  -- Người đang chờ (bấm "Báo người đang sửa thoát ra")
  ask_name text,
  ask_at timestamptz
);
alter table public.shipment_edit_locks enable row level security;
revoke all on public.shipment_edit_locks from public, anon, authenticated;

-- Chỉ người dùng văn phòng có quyền sửa chuyến mới tham gia khóa
create or replace function private.shipment_lock_participant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and (
    private.has_perm('shipments.update') or private.has_perm('dispatch.update')
    or private.has_perm('dispatch.create') or private.has_perm('receivables.create'));
$$;

create or replace function private.user_display_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(nullif(trim(p.full_name), ''), p.email, 'Người dùng khác') from public.profiles p where p.id = uid;
$$;

create or replace function private.vn_hm(t timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(t at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI');
$$;

-- Trạng thái gửi về giao diện
create or replace function private.shipment_lock_json(l public.shipment_edit_locks)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'mine', l.lock_user is not distinct from auth.uid() and l.lock_seen > now() - interval '2 minutes',
    'holder_name', case when l.lock_user is distinct from auth.uid() and l.lock_seen > now() - interval '2 minutes' then l.lock_name end,
    'holder_since', case when l.lock_user is distinct from auth.uid() and l.lock_seen > now() - interval '2 minutes' then l.lock_since end,
    'rev', coalesce(l.rev, 0),
    'saved_by_name', l.saved_by_name,
    'saved_by_me', l.saved_by is not distinct from auth.uid(),
    'saved_at', l.saved_at,
    'ask_name', case when l.ask_at > now() - interval '5 minutes' then l.ask_name end,
    'ask_at', case when l.ask_at > now() - interval '5 minutes' then l.ask_at end);
$$;

/** Xem ai đang sửa chuyến (không giữ quyền sửa) */
create or replace function public.shipment_edit_status(p_shipment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.shipment_edit_locks;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập' using errcode = '42501';
  end if;
  select * into l from public.shipment_edit_locks where shipment_id = p_shipment_id;
  if l.shipment_id is null then
    return jsonb_build_object('mine', false, 'rev', 0);
  end if;
  return private.shipment_lock_json(l);
end;
$$;

/**
 * Nhận (hoặc giữ tiếp) quyền sửa chuyến. p_rev: số lần lưu lúc trang được tải.
 * Người khác đang sửa thì trả mine = false và tên người đó.
 * stale = true: người khác đã lưu sau khi trang được tải, phải tải lại trang.
 */
create or replace function public.shipment_edit_lock(p_shipment_id uuid, p_rev bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l public.shipment_edit_locks;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Chưa đăng nhập' using errcode = '42501';
  end if;
  if not exists (select 1 from public.shipments where id = p_shipment_id) then
    raise exception 'Không tìm thấy chuyến' using errcode = '22023';
  end if;
  if not private.shipment_lock_participant() then
    return public.shipment_edit_status(p_shipment_id);
  end if;
  insert into public.shipment_edit_locks (shipment_id) values (p_shipment_id) on conflict (shipment_id) do nothing;
  select * into l from public.shipment_edit_locks where shipment_id = p_shipment_id for update;
  if l.lock_user is not null and l.lock_user <> uid and l.lock_seen > now() - interval '2 minutes' then
    return private.shipment_lock_json(l);
  end if;
  update public.shipment_edit_locks
  set lock_since = case when l.lock_user is not distinct from uid and l.lock_seen > now() - interval '2 minutes' then l.lock_since else now() end,
      ask_name = case when l.lock_user is not distinct from uid then l.ask_name end,
      ask_at = case when l.lock_user is not distinct from uid then l.ask_at end,
      lock_user = uid,
      lock_name = private.user_display_name(uid),
      lock_seen = now(),
      lock_base_rev = coalesce(p_rev, l.lock_base_rev, l.rev)
  where shipment_id = p_shipment_id
  returning * into l;
  return private.shipment_lock_json(l)
    || jsonb_build_object('stale', l.lock_base_rev < l.rev and l.saved_by is distinct from uid);
end;
$$;

/** Thoát khỏi chế độ sửa: nhả quyền sửa cho người khác */
create or replace function public.shipment_edit_unlock(p_shipment_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.shipment_edit_locks
  set lock_user = null, lock_name = null, lock_since = null, lock_seen = null, ask_name = null, ask_at = null
  where shipment_id = p_shipment_id and lock_user = auth.uid();
$$;

/** Người đang chờ báo người đang sửa thoát ra (gửi thông báo, tối đa 1 lần/phút) */
create or replace function public.shipment_edit_ask(p_shipment_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  l public.shipment_edit_locks;
  uid uuid := auth.uid();
  v_name text;
  v_code text;
begin
  if uid is null then
    raise exception 'Chưa đăng nhập' using errcode = '42501';
  end if;
  select * into l from public.shipment_edit_locks where shipment_id = p_shipment_id for update;
  if l.shipment_id is null or l.lock_user is null or l.lock_user = uid or l.lock_seen <= now() - interval '2 minutes' then
    return jsonb_build_object('sent', false);
  end if;
  v_name := private.user_display_name(uid);
  select shipment_code into v_code from public.shipments where id = p_shipment_id;
  if l.ask_at is null or l.ask_at < now() - interval '1 minute' or l.ask_name is distinct from v_name then
    insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
    values (l.lock_user, 'shipment.edit_ask', concat(v_name, ' đang chờ sửa chuyến ', v_code),
            'Bạn lưu xong thì đóng khung sửa để người khác sửa được.', 'shipment', p_shipment_id, concat('/chuyen-xe/', p_shipment_id));
  end if;
  update public.shipment_edit_locks set ask_name = v_name, ask_at = now() where shipment_id = p_shipment_id;
  return jsonb_build_object('sent', true, 'holder_name', l.lock_name);
end;
$$;

-- Chặn lưu khi người khác đang sửa chuyến; đếm số lần lưu
create or replace function private.guard_shipment_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  sid uuid;
  uid uuid := auth.uid();
  l public.shipment_edit_locks;
  v_code text;
begin
  if uid is null or not private.shipment_lock_participant() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'shipments' then
    if tg_op <> 'UPDATE' then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    sid := (r ->> 'id')::uuid;
  else
    sid := (r ->> 'shipment_id')::uuid;
    -- Xóa theo chuyến (chuyến bị xóa hẳn) hoặc dòng không gắn chuyến
    if sid is null or not exists (select 1 from public.shipments where id = sid) then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
  end if;

  select * into l from public.shipment_edit_locks where shipment_id = sid for update;
  if l.shipment_id is null then
    insert into public.shipment_edit_locks (shipment_id, rev, saved_by, saved_by_name, saved_at, saved_xid)
    values (sid, 1, uid, private.user_display_name(uid), now(), txid_current())
    on conflict (shipment_id) do nothing;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if l.lock_user is not null and l.lock_user <> uid and l.lock_seen > now() - interval '2 minutes' then
    select shipment_code into v_code from public.shipments where id = sid;
    raise exception 'Chuyến % đang được % sửa (từ %). Bạn chỉ xem được: bấm "Báo người đang sửa thoát ra", chờ người đó thoát rồi lưu lại.',
      v_code, l.lock_name, private.vn_hm(l.lock_since) using errcode = '42501';
  end if;
  if l.lock_user = uid and l.lock_base_rev < l.rev and l.saved_by is distinct from uid
     and l.saved_xid is distinct from txid_current() then
    select shipment_code into v_code from public.shipments where id = sid;
    raise exception 'Chuyến % vừa được % lưu lúc %, dữ liệu bạn đang xem đã cũ. Tải lại trang (F5) rồi nhập lại.',
      v_code, coalesce(l.saved_by_name, 'người khác'), private.vn_hm(l.saved_at) using errcode = '42501';
  end if;
  if l.saved_xid is distinct from txid_current() then
    update public.shipment_edit_locks
    set rev = rev + 1, saved_by = uid, saved_by_name = private.user_display_name(uid), saved_at = now(), saved_xid = txid_current(),
        lock_base_rev = case when lock_user = uid then rev + 1 else lock_base_rev end
    where shipment_id = sid;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_shipments_edit_lock on public.shipments;
create trigger trg_shipments_edit_lock before update on public.shipments
for each row execute function private.guard_shipment_edit();
drop trigger if exists trg_shipment_fees_edit_lock on public.shipment_fees;
create trigger trg_shipment_fees_edit_lock before insert or update or delete on public.shipment_fees
for each row execute function private.guard_shipment_edit();
drop trigger if exists trg_shipment_expenses_edit_lock on public.shipment_expenses;
create trigger trg_shipment_expenses_edit_lock before insert or update or delete on public.shipment_expenses
for each row execute function private.guard_shipment_edit();
drop trigger if exists trg_shipment_carrier_costs_edit_lock on public.shipment_carrier_costs;
create trigger trg_shipment_carrier_costs_edit_lock before insert or update or delete on public.shipment_carrier_costs
for each row execute function private.guard_shipment_edit();
drop trigger if exists trg_shipment_items_edit_lock on public.shipment_items;
create trigger trg_shipment_items_edit_lock before insert or update or delete on public.shipment_items
for each row execute function private.guard_shipment_edit();

revoke all on function public.shipment_edit_status(uuid) from public, anon;
revoke all on function public.shipment_edit_lock(uuid, bigint) from public, anon;
revoke all on function public.shipment_edit_unlock(uuid) from public, anon;
revoke all on function public.shipment_edit_ask(uuid) from public, anon;
grant execute on function public.shipment_edit_status(uuid) to authenticated;
grant execute on function public.shipment_edit_lock(uuid, bigint) to authenticated;
grant execute on function public.shipment_edit_unlock(uuid) to authenticated;
grant execute on function public.shipment_edit_ask(uuid) to authenticated;

commit;
