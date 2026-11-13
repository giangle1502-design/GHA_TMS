-- =============================================================================
-- 0072 Danh mục lý do ngày công (người dùng tự thêm)
--   * attendance_reasons: tên, ký hiệu, nhóm tính lương (đi làm / nghỉ có lương / nghỉ BHXH /
--     nghỉ không lương / nghỉ không báo / ngày nghỉ). Có sẵn: thai sản (vợ sinh), việc riêng
--     có lương (kết hôn, tang), nghỉ bù, ngừng việc do công ty, công tác, con ốm, tai nạn lao động...
--   * driver_attendance.reason_id: lý do điều phối chọn; status = nhóm của lý do (bảng lương tính theo nhóm).
--   * Lý do hệ thống (6 nhóm gốc) đổi tên được, không xóa, không đổi nhóm.
-- =============================================================================

create table if not exists public.attendance_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  symbol text not null check (length(trim(symbol)) between 1 and 3),
  category text not null check (category in ('work', 'leave_paid', 'sick', 'leave_unpaid', 'absent', 'off')),
  is_system boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.attendance_reasons is 'Lý do ngày công tài xế (điều phối chọn trên bảng chấm công)';
create unique index if not exists attendance_reasons_symbol_uq on public.attendance_reasons (upper(trim(symbol)));
create unique index if not exists attendance_reasons_system_uq on public.attendance_reasons (category) where is_system;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_attendance_reasons_updated_at') then
    perform private.attach_standard_triggers('public.attendance_reasons'::regclass);
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_attendance_reasons_audit') then
    create trigger trg_attendance_reasons_audit after insert or update or delete on public.attendance_reasons
    for each row execute function private.audit_row_change('id');
  end if;
end $$;

-- Lý do hệ thống: không xóa, không đổi nhóm, không tắt
create or replace function private.attendance_reason_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'Không xóa lý do có sẵn "%"; có thể đổi tên', old.name using errcode = '22023';
    end if;
    if exists (select 1 from public.driver_attendance a where a.reason_id = old.id) then
      raise exception 'Lý do "%" đã dùng trên bảng chấm công, hãy bỏ tích Đang sử dụng thay vì xóa', old.name using errcode = '22023';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.is_system := false;
  elsif old.is_system then
    new.is_system := true;
    new.category := old.category;
    new.is_active := true;
  else
    new.is_system := false;
  end if;
  new.symbol := upper(trim(new.symbol));
  return new;
end;
$$;
drop trigger if exists trg_attendance_reasons_guard on public.attendance_reasons;
create trigger trg_attendance_reasons_guard before insert or update or delete on public.attendance_reasons
  for each row execute function private.attendance_reason_guard();

alter table public.attendance_reasons enable row level security;
drop policy if exists attendance_reasons_select on public.attendance_reasons;
drop policy if exists attendance_reasons_insert on public.attendance_reasons;
drop policy if exists attendance_reasons_update on public.attendance_reasons;
drop policy if exists attendance_reasons_delete on public.attendance_reasons;
create policy attendance_reasons_select on public.attendance_reasons for select to authenticated using ((select private.is_active_user()));
create policy attendance_reasons_insert on public.attendance_reasons for insert to authenticated with check ((select private.has_perm('settlements.update')));
create policy attendance_reasons_update on public.attendance_reasons for update to authenticated
  using ((select private.has_perm('settlements.update'))) with check ((select private.has_perm('settlements.update')));
create policy attendance_reasons_delete on public.attendance_reasons for delete to authenticated using ((select private.has_perm('settlements.update')));
revoke all on public.attendance_reasons from anon;
grant select, insert, update, delete on public.attendance_reasons to authenticated;

-- Lý do có sẵn (gốc + các trường hợp theo Bộ luật Lao động, BHXH)
alter table public.attendance_reasons disable trigger trg_attendance_reasons_guard;
insert into public.attendance_reasons (name, symbol, category, is_system, sort_order, notes)
select v.name, v.symbol, v.category, v.sys, v.ord, v.notes
from (values
  ('Có đi làm', '✓', 'work', true, 10, 'Ngày có làm việc nhưng không có chuyến (chờ hàng, bảo dưỡng xe...)'),
  ('Công tác, đào tạo', 'CT', 'work', false, 20, 'Đi công tác, học, đào tạo do công ty cử: tính là ngày đi làm'),
  ('Nghỉ phép năm', 'P', 'leave_paid', true, 30, 'Nghỉ hằng năm có hưởng lương'),
  ('Nghỉ việc riêng có lương (kết hôn, tang)', 'R', 'leave_paid', false, 40, 'Bản thân kết hôn 3 ngày; con kết hôn 1 ngày; cha, mẹ, vợ/chồng, con mất 3 ngày'),
  ('Nghỉ bù', 'NB', 'leave_paid', false, 50, 'Nghỉ bù ngày đã đi làm vào ngày nghỉ, lễ'),
  ('Ngừng việc do công ty (chờ hàng, xe sửa)', 'NV', 'leave_paid', false, 60, 'Không có việc vì lý do của công ty'),
  ('Nghỉ ốm', 'Ô', 'sick', true, 70, 'Nghỉ ốm hưởng BHXH'),
  ('Nghỉ vợ sinh (thai sản)', 'TS', 'sick', false, 80, 'Lao động nam nghỉ khi vợ sinh con: 5 đến 14 ngày, hưởng BHXH'),
  ('Nghỉ chăm con ốm', 'CO', 'sick', false, 90, 'Con dưới 7 tuổi ốm, hưởng BHXH'),
  ('Tai nạn lao động', 'TN', 'sick', false, 100, 'Nghỉ điều trị tai nạn lao động'),
  ('Nghỉ không lương', 'KL', 'leave_unpaid', true, 110, 'Nghỉ việc riêng không hưởng lương'),
  ('Nghỉ không báo', 'V', 'absent', true, 120, 'Nghỉ tự ý không báo trước'),
  ('Ngày nghỉ', 'N', 'off', true, 130, 'Ngày nghỉ tuần, nghỉ lễ của tài xế')
) as v(name, symbol, category, sys, ord, notes)
where not exists (select 1 from public.attendance_reasons r where upper(r.symbol) = upper(v.symbol))
  and not (v.sys and exists (select 1 from public.attendance_reasons r where r.is_system and r.category = v.category));
alter table public.attendance_reasons enable trigger trg_attendance_reasons_guard;

alter table public.driver_attendance add column if not exists reason_id uuid references public.attendance_reasons (id);
update public.driver_attendance a set reason_id = r.id
from public.attendance_reasons r
where a.reason_id is null and r.is_system and r.category = a.status;

-- Xác nhận ngày công theo lý do (null = trả về tự động)
create or replace function public.set_driver_attendance_reason(p_driver_ids uuid[], p_dates date[], p_reason_id uuid, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int := 0;
  v_driver uuid;
  v_date date;
  v_cat text;
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('settlements.update')) then
    raise exception 'Bạn không có quyền xác nhận ngày công' using errcode = '42501';
  end if;
  if p_reason_id is not null then
    select category into v_cat from public.attendance_reasons where id = p_reason_id and is_active;
    if v_cat is null then
      raise exception 'Lý do ngày công không có hoặc đã ngừng dùng' using errcode = '22023';
    end if;
  end if;
  if coalesce(array_length(p_driver_ids, 1), 0) <> coalesce(array_length(p_dates, 1), 0) or coalesce(array_length(p_dates, 1), 0) = 0 then
    raise exception 'Chọn ngày cần xác nhận' using errcode = '22023';
  end if;
  if coalesce(array_length(p_dates, 1), 0) > 2000 then
    raise exception 'Mỗi lần xác nhận tối đa 2000 ô' using errcode = '22023';
  end if;
  for i in 1 .. array_length(p_dates, 1) loop
    v_driver := p_driver_ids[i];
    v_date := p_dates[i];
    if exists (select 1 from public.attendance_locks where period_month = date_trunc('month', v_date)::date) then
      raise exception 'Tháng %/% đã chốt công, nhờ kế toán mở chốt nếu cần sửa', extract(month from v_date), extract(year from v_date) using errcode = '22023';
    end if;
    if v_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date + 60 then
      raise exception 'Chỉ đặt trước ngày nghỉ trong vòng 60 ngày tới' using errcode = '22023';
    end if;
    if not exists (select 1 from public.drivers where id = v_driver and not coalesce(is_outsourced, false)) then
      raise exception 'Không tìm thấy tài xế' using errcode = 'P0001';
    end if;
    if p_reason_id is null then
      delete from public.driver_attendance where driver_id = v_driver and work_date = v_date;
    else
      insert into public.driver_attendance (driver_id, work_date, status, reason_id, note, created_by, updated_by)
      values (v_driver, v_date, v_cat, p_reason_id, nullif(left(trim(coalesce(p_note, '')), 500), ''), auth.uid(), auth.uid())
      on conflict (driver_id, work_date) do update
        set status = excluded.status, reason_id = excluded.reason_id, note = excluded.note, updated_by = auth.uid(), updated_at = now();
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.set_driver_attendance_reason(uuid[], date[], uuid, text) from public, anon;
grant execute on function public.set_driver_attendance_reason(uuid[], date[], uuid, text) to authenticated;

-- Hàm cũ theo nhóm: dùng lý do hệ thống của nhóm
create or replace function public.set_driver_attendance(p_driver_ids uuid[], p_dates date[], p_status text, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason uuid;
begin
  if p_status is not null then
    select id into v_reason from public.attendance_reasons where is_system and category = p_status;
    if v_reason is null then
      raise exception 'Trạng thái ngày công không hợp lệ' using errcode = '22023';
    end if;
  end if;
  return public.set_driver_attendance_reason(p_driver_ids, p_dates, v_reason, p_note);
end;
$$;

-- Bảng chấm công tháng: kèm lý do từng ô và danh mục lý do
create or replace function public.attendance_month(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  if not private.attendance_can_view() then
    raise exception 'Bạn không có quyền xem chấm công' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'month', v_from,
    'days', (select jsonb_agg(jsonb_build_object('date', g::date, 'off', private.is_pay_offday(g::date),
                                                 'holiday', (select h.name from public.pay_holidays h where h.holiday_date = g::date)) order by g)
             from generate_series(v_from, v_to, interval '1 day') g),
    'locked', exists (select 1 from public.attendance_locks where period_month = v_from),
    'can_edit', (private.has_perm('dispatch.update') or private.has_perm('settlements.update'))
                and not exists (select 1 from public.attendance_locks where period_month = v_from),
    'can_lock', private.has_perm('settlements.update'),
    'can_config', private.has_perm('settlements.update'),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'sym', r.symbol, 'cat', r.category, 'active', r.is_active)
                                          order by r.sort_order, r.name)
                         from public.attendance_reasons r), '[]'::jsonb),
    'drivers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'code', d.code, 'name', d.full_name,
        'plate', (select v.plate_number from public.driver_vehicle_view v where v.driver_id = d.id limit 1),
        'cells', r.cells) order by d.full_name)
      from (
        select a.driver_id, jsonb_object_agg(a.work_date::text,
                 jsonb_build_object('s', a.status, 'src', a.source, 't', a.trips, 'n', a.note,
                                    'r', case when a.source = 'manual' then m.reason_id end)) as cells
        from private.attendance_rows(v_from, v_to, null) a
        left join public.driver_attendance m on m.driver_id = a.driver_id and m.work_date = a.work_date
        group by a.driver_id
      ) r
      join public.drivers d on d.id = r.driver_id), '[]'::jsonb));
end;
$$;
