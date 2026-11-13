-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Trò chuyện riêng và nhóm trong ứng dụng
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.chat_messages') is not null then
    raise exception 'CSDL đã được nâng cấp Trò chuyện riêng và nhóm trong ứng dụng trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261101000043_chat.sql
-- =============================================================================
-- 0043: Trò chuyện trong ứng dụng (yêu cầu Khánh Hà 01/11/2026)
--   - Trò chuyện riêng 1-1 giữa hai nhân viên và nhóm trò chuyện (tạo nhóm, thêm/bớt thành viên, đổi tên, rời nhóm).
--   - Chỉ nhân viên văn phòng (người dùng đang hoạt động, có vai trò khác tài xế) – cùng danh bạ staff_directory.
--   - Gửi chữ và tệp đính kèm (ảnh, PDF, Excel, Word ≤ 10 MB, lưu ở bucket documents, thư mục chat/{phòng}/).
--   - Thu hồi tin nhắn của mình. Đếm tin chưa đọc theo từng cuộc trò chuyện.
--   - Tin mới hiện ngay nhờ Supabase Realtime (bảng chat_messages trong publication supabase_realtime; RLS lọc theo thành viên).
--   - Mọi thao tác ghi đi qua hàm nghiệp vụ (security definer); bảng chỉ cho đọc.
-- =============================================================================

create table public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  name text check (name is null or length(name) between 1 and 100),
  direct_key text unique, -- 'uuid nhỏ:uuid lớn' cho trò chuyện riêng, để hai người chỉ có một phòng
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  check ((kind = 'direct') = (direct_key is not null)),
  check (kind = 'direct' or name is not null)
);
comment on table public.chat_rooms is 'Cuộc trò chuyện: riêng 1-1 (direct) hoặc nhóm (group)';
create index chat_rooms_last_idx on public.chat_rooms (last_message_at desc nulls last);
select private.attach_standard_triggers('public.chat_rooms');

create table public.chat_members (
  room_id uuid not null references public.chat_rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
comment on table public.chat_members is 'Thành viên cuộc trò chuyện; last_read_at để đếm tin chưa đọc';
create index chat_members_user_idx on public.chat_members (user_id);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  kind text not null default 'text' check (kind in ('text', 'system')),
  body text not null default '' check (length(body) <= 4000),
  attachment_path text check (attachment_path is null or attachment_path ~ '^chat/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|pdf|xlsx|docx)$'),
  attachment_name text check (attachment_name is null or length(attachment_name) <= 200),
  attachment_mime text,
  attachment_size integer check (attachment_size is null or attachment_size between 1 and 10485760),
  client_id uuid unique,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
comment on table public.chat_messages is 'Tin nhắn; kind=system là dòng thông báo (tạo nhóm, thêm người...); deleted_at = đã thu hồi';
create index chat_messages_room_idx on public.chat_messages (room_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Quyền đọc: chỉ thành viên phòng
-- -----------------------------------------------------------------------------
create or replace function private.my_chat_rooms()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.room_id from public.chat_members m where m.user_id = auth.uid();
$$;
revoke all on function private.my_chat_rooms() from public, anon;
grant execute on function private.my_chat_rooms() to authenticated;

create or replace function private.is_chat_member(p_room uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.chat_members m where m.room_id = p_room and m.user_id = p_user);
$$;
revoke all on function private.is_chat_member(uuid, uuid) from public, anon;
grant execute on function private.is_chat_member(uuid, uuid) to authenticated;

alter table public.chat_rooms enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
create policy chat_rooms_select on public.chat_rooms for select to authenticated
  using (id in (select private.my_chat_rooms()));
create policy chat_members_select on public.chat_members for select to authenticated
  using (room_id in (select private.my_chat_rooms()));
create policy chat_messages_select on public.chat_messages for select to authenticated
  using (room_id in (select private.my_chat_rooms()));
revoke all on public.chat_rooms, public.chat_members, public.chat_messages from anon, authenticated;
grant select on public.chat_rooms, public.chat_members, public.chat_messages to authenticated;

-- -----------------------------------------------------------------------------
-- Hàm phụ
-- -----------------------------------------------------------------------------
create or replace function private.chat_require_staff()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not private.is_staff(v_me) then
    raise exception 'Chỉ nhân viên đang hoạt động mới dùng được Trò chuyện' using errcode = '42501';
  end if;
  return v_me;
end;
$$;
revoke all on function private.chat_require_staff() from public, anon;

create or replace function private.chat_system_message(p_room uuid, p_body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.chat_messages (room_id, sender_id, kind, body) values (p_room, auth.uid(), 'system', left(p_body, 4000));
  update public.chat_rooms set last_message_at = now() where id = p_room;
$$;
revoke all on function private.chat_system_message(uuid, text) from public, anon;

-- Thêm danh sách người vào phòng (bỏ qua người đã có); trả về tên những người vừa thêm
create or replace function private.chat_insert_members(p_room uuid, p_members uuid[])
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_names text[] := '{}';
begin
  if coalesce(cardinality(p_members), 0) > 200 then
    raise exception 'Mỗi lần thêm tối đa 200 người' using errcode = '22023';
  end if;
  foreach v_id in array coalesce(p_members, '{}') loop
    if v_id is null or private.is_chat_member(p_room, v_id) then
      continue;
    end if;
    if not private.is_staff(v_id) then
      raise exception 'Chỉ thêm được nhân viên đang hoạt động (không phải tài xế)' using errcode = '22023';
    end if;
    insert into public.chat_members (room_id, user_id) values (p_room, v_id) on conflict do nothing;
    v_names := v_names || private.person_name(v_id);
  end loop;
  return array_to_string(v_names, ', ');
end;
$$;
revoke all on function private.chat_insert_members(uuid, uuid[]) from public, anon;

create or replace function private.chat_require_group_member(p_room uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.chat_rooms r where r.id = p_room and r.kind = 'group') then
    raise exception 'Không tìm thấy nhóm trò chuyện' using errcode = 'P0002';
  end if;
  if not private.is_chat_member(p_room) then
    raise exception 'Bạn không ở trong nhóm này' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.chat_require_group_member(uuid) from public, anon;

-- -----------------------------------------------------------------------------
-- Hàm nghiệp vụ
-- -----------------------------------------------------------------------------

-- Mở (hoặc tạo) trò chuyện riêng với một người
create or replace function public.chat_open_direct(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.chat_require_staff();
  v_key text;
  v_room uuid;
begin
  if p_user is null or p_user = v_me then
    raise exception 'Chọn một người khác để trò chuyện' using errcode = '22023';
  end if;
  if not private.is_staff(p_user) then
    raise exception 'Người này không phải nhân viên đang hoạt động' using errcode = '22023';
  end if;
  v_key := least(v_me::text, p_user::text) || ':' || greatest(v_me::text, p_user::text);
  select id into v_room from public.chat_rooms where direct_key = v_key;
  if v_room is null then
    insert into public.chat_rooms (kind, direct_key) values ('direct', v_key)
      on conflict (direct_key) do nothing returning id into v_room;
    if v_room is null then
      select id into v_room from public.chat_rooms where direct_key = v_key;
    end if;
  end if;
  insert into public.chat_members (room_id, user_id) values (v_room, v_me), (v_room, p_user) on conflict do nothing;
  return v_room;
end;
$$;

-- Tạo nhóm: người tạo là quản trị nhóm
create or replace function public.chat_create_group(p_name text, p_members uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.chat_require_staff();
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_room uuid;
  v_added text;
begin
  if v_name is null then
    raise exception 'Nhập tên nhóm' using errcode = '22023';
  end if;
  if length(v_name) > 100 then
    raise exception 'Tên nhóm tối đa 100 ký tự' using errcode = '22023';
  end if;
  if not exists (select 1 from unnest(coalesce(p_members, '{}')) u where u is not null and u <> v_me) then
    raise exception 'Chọn ít nhất một thành viên' using errcode = '22023';
  end if;
  insert into public.chat_rooms (kind, name) values ('group', v_name) returning id into v_room;
  insert into public.chat_members (room_id, user_id, role) values (v_room, v_me, 'admin');
  v_added := private.chat_insert_members(v_room, p_members);
  perform private.chat_system_message(v_room, private.person_name(v_me) || ' đã tạo nhóm "' || v_name || '"'
    || case when v_added <> '' then ' và thêm ' || v_added else '' end);
  return v_room;
end;
$$;

-- Thành viên nào trong nhóm cũng thêm được người
create or replace function public.chat_add_members(p_room uuid, p_members uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.chat_require_staff();
  v_before int;
  v_added text;
begin
  perform private.chat_require_group_member(p_room);
  select count(*) into v_before from public.chat_members where room_id = p_room;
  v_added := private.chat_insert_members(p_room, p_members);
  if v_added <> '' then
    perform private.chat_system_message(p_room, private.person_name(v_me) || ' đã thêm ' || v_added);
  end if;
  return (select count(*) from public.chat_members where room_id = p_room) - v_before;
end;
$$;

-- Quản trị nhóm mời người ra khỏi nhóm
create or replace function public.chat_remove_member(p_room uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.chat_require_staff();
begin
  perform private.chat_require_group_member(p_room);
  if p_user = v_me then
    raise exception 'Muốn rời nhóm hãy bấm Rời nhóm' using errcode = '22023';
  end if;
  if not exists (select 1 from public.chat_members where room_id = p_room and user_id = v_me and role = 'admin') then
    raise exception 'Chỉ quản trị nhóm mới mời người khác ra khỏi nhóm' using errcode = '42501';
  end if;
  delete from public.chat_members where room_id = p_room and user_id = p_user;
  if found then
    perform private.chat_system_message(p_room, private.person_name(v_me) || ' đã mời ' || private.person_name(p_user) || ' ra khỏi nhóm');
  end if;
end;
$$;

-- Quản trị nhóm giao/bỏ quyền quản trị cho thành viên khác
create or replace function public.chat_set_admin(p_room uuid, p_user uuid, p_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.chat_require_staff();
begin
  perform private.chat_require_group_member(p_room);
  if not exists (select 1 from public.chat_members where room_id = p_room and user_id = v_me and role = 'admin') then
    raise exception 'Chỉ quản trị nhóm mới đổi được quyền quản trị' using errcode = '42501';
  end if;
  if not coalesce(p_admin, false) and p_user = v_me
     and not exists (select 1 from public.chat_members where room_id = p_room and role = 'admin' and user_id <> v_me) then
    raise exception 'Nhóm cần ít nhất một quản trị' using errcode = '22023';
  end if;
  update public.chat_members set role = case when p_admin then 'admin' else 'member' end
   where room_id = p_room and user_id = p_user;
  if not found then
    raise exception 'Người này không ở trong nhóm' using errcode = 'P0002';
  end if;
end;
$$;

-- Rời nhóm; quản trị cuối cùng rời thì người vào nhóm sớm nhất thành quản trị
create or replace function public.chat_leave(p_room uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  perform private.chat_require_group_member(p_room);
  perform private.chat_system_message(p_room, private.person_name(v_me) || ' đã rời nhóm');
  delete from public.chat_members where room_id = p_room and user_id = v_me;
  if not exists (select 1 from public.chat_members where room_id = p_room and role = 'admin') then
    update public.chat_members set role = 'admin'
     where room_id = p_room and user_id = (select user_id from public.chat_members where room_id = p_room order by joined_at, user_id limit 1);
  end if;
end;
$$;

-- Đổi tên nhóm (mọi thành viên)
create or replace function public.chat_rename(p_room uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.chat_require_staff();
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  perform private.chat_require_group_member(p_room);
  if v_name is null or length(v_name) > 100 then
    raise exception 'Tên nhóm từ 1 đến 100 ký tự' using errcode = '22023';
  end if;
  update public.chat_rooms set name = v_name where id = p_room and name is distinct from v_name;
  if found then
    perform private.chat_system_message(p_room, private.person_name(v_me) || ' đã đổi tên nhóm thành "' || v_name || '"');
  end if;
end;
$$;

-- Gửi tin nhắn (chữ và/hoặc một tệp đã tải lên chat/{phòng}/). Bấm gửi hai lần cùng client_id chỉ tạo một tin.
create or replace function public.chat_send(p_room uuid, p_body text, p_attachment jsonb default null, p_client_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.chat_require_staff();
  v_body text := coalesce(p_body, '');
  v_id uuid;
  v_path text := nullif(p_attachment->>'path', '');
begin
  if not private.is_chat_member(p_room, v_me) then
    raise exception 'Bạn không ở trong cuộc trò chuyện này' using errcode = '42501';
  end if;
  if p_client_id is not null then
    select id into v_id from public.chat_messages where client_id = p_client_id and sender_id = v_me;
    if v_id is not null then
      return v_id;
    end if;
  end if;
  if length(trim(v_body)) = 0 and v_path is null then
    raise exception 'Tin nhắn trống' using errcode = '22023';
  end if;
  if length(v_body) > 4000 then
    raise exception 'Tin nhắn tối đa 4.000 ký tự' using errcode = '22023';
  end if;
  if v_path is not null and split_part(v_path, '/', 2) <> p_room::text then
    raise exception 'Tệp đính kèm không thuộc cuộc trò chuyện này' using errcode = '22023';
  end if;
  insert into public.chat_messages (room_id, sender_id, body, attachment_path, attachment_name, attachment_mime, attachment_size, client_id)
  values (p_room, v_me, v_body, v_path,
          case when v_path is not null then left(coalesce(nullif(p_attachment->>'name', ''), 'tep-dinh-kem'), 200) end,
          case when v_path is not null then left(p_attachment->>'mime', 100) end,
          case when v_path is not null then nullif(p_attachment->>'size', '')::integer end,
          p_client_id)
  returning id into v_id;
  update public.chat_rooms set last_message_at = now() where id = p_room;
  update public.chat_members set last_read_at = now() where room_id = p_room and user_id = v_me;
  return v_id;
end;
$$;

-- Thu hồi tin nhắn của mình
create or replace function public.chat_delete_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  update public.chat_messages
     set deleted_at = now(), body = '', attachment_path = null, attachment_name = null, attachment_mime = null, attachment_size = null
   where id = p_id and sender_id = v_me and kind = 'text' and deleted_at is null;
  if not found then
    raise exception 'Chỉ thu hồi được tin nhắn của chính mình' using errcode = '42501';
  end if;
end;
$$;

-- Đánh dấu đã đọc
create or replace function public.chat_mark_read(p_room uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.chat_members set last_read_at = now() where room_id = p_room and user_id = auth.uid();
$$;

-- Tổng số tin chưa đọc (biểu tượng trên thanh đầu trang)
create or replace function public.chat_unread_total()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.chat_members m
  join public.chat_messages msg on msg.room_id = m.room_id and msg.created_at > m.last_read_at
  where m.user_id = auth.uid() and msg.kind = 'text' and msg.sender_id is distinct from m.user_id and msg.deleted_at is null;
$$;

revoke all on function public.chat_open_direct(uuid), public.chat_create_group(text, uuid[]), public.chat_add_members(uuid, uuid[]),
  public.chat_remove_member(uuid, uuid), public.chat_set_admin(uuid, uuid, boolean), public.chat_leave(uuid), public.chat_rename(uuid, text),
  public.chat_send(uuid, text, jsonb, uuid), public.chat_delete_message(uuid), public.chat_mark_read(uuid), public.chat_unread_total() from public, anon;
grant execute on function public.chat_open_direct(uuid), public.chat_create_group(text, uuid[]), public.chat_add_members(uuid, uuid[]),
  public.chat_remove_member(uuid, uuid), public.chat_set_admin(uuid, uuid, boolean), public.chat_leave(uuid), public.chat_rename(uuid, text),
  public.chat_send(uuid, text, jsonb, uuid), public.chat_delete_message(uuid), public.chat_mark_read(uuid), public.chat_unread_total() to authenticated;

-- -----------------------------------------------------------------------------
-- Danh sách cuộc trò chuyện của tôi (tên hiển thị, tin cuối, số chưa đọc)
-- -----------------------------------------------------------------------------
create or replace view public.chat_room_list with (security_invoker = true) as
select r.id,
       r.kind,
       case when r.kind = 'group' then r.name
            else coalesce((select private.person_name(o.user_id) from public.chat_members o where o.room_id = r.id and o.user_id <> me.user_id limit 1), 'Trò chuyện riêng')
       end as display_name,
       (select o.user_id from public.chat_members o where r.kind = 'direct' and o.room_id = r.id and o.user_id <> me.user_id limit 1) as other_user_id,
       (select count(*)::integer from public.chat_members o where o.room_id = r.id) as member_count,
       me.role as my_role,
       r.last_message_at,
       r.created_at,
       lm.body as last_body,
       lm.kind as last_kind,
       lm.attachment_name as last_attachment_name,
       lm.deleted_at is not null as last_deleted,
       lm.sender_id as last_sender_id,
       case when lm.sender_id = me.user_id then 'Bạn' else private.person_name(lm.sender_id) end as last_sender_name,
       (select count(*)::integer from public.chat_messages u
         where u.room_id = r.id and u.created_at > me.last_read_at and u.kind = 'text'
           and u.sender_id is distinct from me.user_id and u.deleted_at is null) as unread_count
from public.chat_members me
join public.chat_rooms r on r.id = me.room_id
left join lateral (
  select m.body, m.kind, m.attachment_name, m.deleted_at, m.sender_id
  from public.chat_messages m where m.room_id = r.id order by m.created_at desc limit 1
) lm on true
where me.user_id = (select auth.uid());
revoke all on public.chat_room_list from anon;
grant select on public.chat_room_list to authenticated;

-- Thành viên kèm tên (để hiển thị trong nhóm)
create or replace view public.chat_member_list with (security_invoker = true) as
select m.room_id, m.user_id, m.role, m.joined_at, m.last_read_at,
       private.person_name(m.user_id) as display_name,
       (select string_agg(ro.name, ', ' order by ro.sort_order) from public.user_roles ur join public.roles ro on ro.id = ur.role_id
         where ur.user_id = m.user_id) as role_names
from public.chat_members m;
revoke all on public.chat_member_list from anon;
grant select on public.chat_member_list to authenticated;

-- -----------------------------------------------------------------------------
-- Tệp đính kèm: thư mục chat/{phòng}/ trong bucket documents; chỉ thành viên phòng tải lên và xem
-- -----------------------------------------------------------------------------
create or replace function private.chat_path_member(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_name ~ '^chat/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|pdf|xlsx|docx)$'
     and private.is_chat_member(split_part(p_name, '/', 2)::uuid);
$$;
revoke all on function private.chat_path_member(text) from public, anon;
grant execute on function private.chat_path_member(text) to authenticated;

do $outer$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;
  execute 'drop policy if exists chat_bucket_insert on storage.objects';
  execute 'drop policy if exists chat_bucket_select on storage.objects';
  execute $p$
    create policy chat_bucket_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'documents' and name like 'chat/%' and private.chat_path_member(name))
  $p$;
  execute $p$
    create policy chat_bucket_select on storage.objects for select to authenticated
    using (bucket_id = 'documents' and name like 'chat/%' and private.chat_path_member(name))
  $p$;
end
$outer$;

-- -----------------------------------------------------------------------------
-- Realtime: tin nhắn mới hiện ngay (chỉ trên Supabase thật có publication supabase_realtime)
-- -----------------------------------------------------------------------------
do $outer$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    execute 'alter publication supabase_realtime add table public.chat_messages';
  end if;
end
$outer$;

commit;
