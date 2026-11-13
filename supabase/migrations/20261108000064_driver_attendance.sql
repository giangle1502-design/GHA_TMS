-- =============================================================================
-- 0064: Bảng chấm công tài xế (lương tài xế đợt 2)
--   * Tự chấm công: ngày tài xế bấm Nhận chuyến (hoặc hoàn thành chuyến) = 1 công.
--   * Ngày có đơn nghỉ đã duyệt (tài xế có tài khoản) = nghỉ theo loại đơn.
--   * Ngày nghỉ trong tuần, ngày lễ (thiết lập ở 0063) = ngày nghỉ, không cảnh báo.
--   * Ngày đã qua mà không có chuyến, không đơn nghỉ = "Chờ xác nhận": điều phối chọn
--     Có đi làm / Nghỉ phép / Nghỉ ốm / Nghỉ không lương / Nghỉ không báo.
--     Điều phối cũng sửa được mọi ngày (ví dụ nghỉ phép báo qua điện thoại).
--   * Kế toán Chốt công tháng: không ai sửa được ngày công tháng đó nữa (mở chốt được).
--   * Bảng lương: ngày công = số ngày đi làm theo bảng chấm công; tùy chọn trừ lương cơ
--     bản theo ngày nghỉ không lương / không báo (payroll.deduct_base_unpaid).
-- Chạy lại nhiều lần không lỗi.
-- =============================================================================

-- 1. Ngày công điều phối xác nhận / sửa tay
create table if not exists public.driver_attendance (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers (id) on delete cascade,
  work_date date not null,
  status text not null check (status in ('work', 'leave_paid', 'sick', 'leave_unpaid', 'absent', 'off')),
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (driver_id, work_date)
);
comment on table public.driver_attendance is 'Ngày công tài xế do điều phối xác nhận hoặc sửa tay (ngày có chuyến tự chấm, không cần dòng ở đây)';

create table if not exists public.attendance_locks (
  period_month date primary key check (extract(day from period_month) = 1),
  locked_by uuid,
  locked_at timestamptz not null default now()
);
comment on table public.attendance_locks is 'Tháng đã chốt công: không sửa ngày công nữa';

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_driver_attendance_updated_at') then
    perform private.attach_standard_triggers('public.driver_attendance'::regclass);
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_driver_attendance_audit') then
    create trigger trg_driver_attendance_audit after insert or update or delete on public.driver_attendance
    for each row execute function private.audit_row_change('id');
  end if;
end $$;
-- Chỉ ghi qua hàm (kiểm tra quyền, khóa tháng); ai có quyền xem điều phối hoặc quyết toán thì xem được
alter table public.driver_attendance enable row level security;
alter table public.attendance_locks enable row level security;
drop policy if exists driver_attendance_select on public.driver_attendance;
create policy driver_attendance_select on public.driver_attendance for select to authenticated
  using ((select private.has_perm('dispatch.view')) or (select private.has_perm('settlements.view')) or (select private.has_perm('settlements.update')));
drop policy if exists attendance_locks_select on public.attendance_locks;
create policy attendance_locks_select on public.attendance_locks for select to authenticated using ((select private.is_active_user()));
revoke all on public.driver_attendance, public.attendance_locks from anon;
grant select on public.driver_attendance, public.attendance_locks to authenticated;

insert into public.system_settings (key, value, description, is_public) values
  ('payroll.deduct_base_unpaid', 'true'::jsonb, 'Lương tài xế: trừ lương cơ bản theo số ngày nghỉ không lương / nghỉ không báo', false)
on conflict (key) do nothing;

-- 2. Trạng thái từng ngày của tài xế
create or replace function private.attendance_rows(p_from date, p_to date, p_driver_id uuid default null)
returns table (driver_id uuid, work_date date, status text, source text, trips integer, note text)
language sql
stable
security definer
set search_path = ''
as $$
  with today as (select (now() at time zone 'Asia/Ho_Chi_Minh')::date as d),
  drv as (
    select dr.id, dr.profile_id, dr.start_date
    from public.drivers dr
    where not coalesce(dr.is_outsourced, false)
      and (p_driver_id is null or dr.id = p_driver_id)
      and (p_driver_id is not null or (dr.archived_at is null and dr.status <> 'terminated')
           or exists (select 1 from public.shipments s where s.driver_id = dr.id
                        and (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to))
  ),
  days as (select g::date as d from generate_series(p_from, p_to, interval '1 day') g),
  trip_days as (
    select x.driver_id, x.d, count(distinct x.shipment_id)::int as n
    from (
      select a.driver_id, a.shipment_id, (a.responded_at at time zone 'Asia/Ho_Chi_Minh')::date as d
      from public.shipment_assignments a
      join public.shipments s on s.id = a.shipment_id and s.status <> 'cancelled'
      where a.response = 'accepted' and a.responded_at is not null
        and (a.responded_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
      union
      select s.driver_id, s.id, (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date
      from public.shipments s
      where s.driver_id is not null and s.completed_at is not null and s.status in ('driver_completed', 'closed')
        and (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date between p_from and p_to
    ) x
    where p_driver_id is null or x.driver_id = p_driver_id
    group by x.driver_id, x.d
  )
  select drv.id, days.d,
    case
      when m.status is not null then m.status
      when coalesce(t.n, 0) > 0 then 'work'
      when lv.leave_type is not null then case lv.leave_type when 'sick' then 'sick' when 'unpaid' then 'leave_unpaid' else 'leave_paid' end
      when private.is_pay_offday(days.d) then 'off'
      when days.d < (select d from today) then 'pending'
      else 'upcoming'
    end,
    case
      when m.status is not null then 'manual'
      when coalesce(t.n, 0) > 0 then 'trip'
      when lv.leave_type is not null then 'leave_request'
      else 'auto'
    end,
    coalesce(t.n, 0), m.note
  from drv
  cross join days
  left join trip_days t on t.driver_id = drv.id and t.d = days.d
  left join public.driver_attendance m on m.driver_id = drv.id and m.work_date = days.d
  left join lateral (
    select l.leave_type from public.leave_requests l
    where drv.profile_id is not null and l.requester_id = drv.profile_id and l.status = 'approved'
      and days.d between l.start_date and l.end_date
    order by l.created_at desc limit 1
  ) lv on true
  where days.d >= coalesce(drv.start_date, p_from);
$$;
revoke all on function private.attendance_rows(date, date, uuid) from public, anon, authenticated;

create or replace function private.attendance_can_view()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.has_perm('dispatch.view') or private.has_perm('settlements.view') or private.has_perm('settlements.update');
$$;

-- Bảng chấm công một tháng cho màn hình
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
    'drivers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'code', d.code, 'name', d.full_name,
        'plate', (select v.plate_number from public.driver_vehicle_view v where v.driver_id = d.id limit 1),
        'cells', r.cells) order by d.full_name)
      from (
        select a.driver_id, jsonb_object_agg(a.work_date::text,
                 jsonb_build_object('s', a.status, 'src', a.source, 't', a.trips, 'n', a.note)) as cells
        from private.attendance_rows(v_from, v_to, null) a
        group by a.driver_id
      ) r
      join public.drivers d on d.id = r.driver_id), '[]'::jsonb));
end;
$$;
revoke all on function public.attendance_month(date) from public, anon;
grant execute on function public.attendance_month(date) to authenticated;

-- Số ngày chờ xác nhận (31 ngày gần nhất) để nhắc điều phối
create or replace function public.attendance_pending_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not private.attendance_can_view() then
    return 0;
  end if;
  return (select count(*) from private.attendance_rows(v_today - 31, v_today - 1, null) a
          where a.status = 'pending'
            and not exists (select 1 from public.attendance_locks l where l.period_month = date_trunc('month', a.work_date)::date));
end;
$$;
revoke all on function public.attendance_pending_count() from public, anon;
grant execute on function public.attendance_pending_count() to authenticated;

-- Điều phối / kế toán xác nhận hoặc sửa ngày công (p_status null = trả về tự động)
create or replace function public.set_driver_attendance(p_driver_ids uuid[], p_dates date[], p_status text, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int := 0;
  v_driver uuid;
  v_date date;
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('settlements.update')) then
    raise exception 'Bạn không có quyền xác nhận ngày công' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('work', 'leave_paid', 'sick', 'leave_unpaid', 'absent', 'off') then
    raise exception 'Trạng thái ngày công không hợp lệ' using errcode = '22023';
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
    if p_status is null then
      delete from public.driver_attendance where driver_id = v_driver and work_date = v_date;
    else
      insert into public.driver_attendance (driver_id, work_date, status, note, created_by, updated_by)
      values (v_driver, v_date, p_status, nullif(left(trim(coalesce(p_note, '')), 500), ''), auth.uid(), auth.uid())
      on conflict (driver_id, work_date) do update
        set status = excluded.status, note = excluded.note, updated_by = auth.uid(), updated_at = now();
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.set_driver_attendance(uuid[], date[], text, text) from public, anon;
grant execute on function public.set_driver_attendance(uuid[], date[], text, text) to authenticated;

-- Kế toán chốt / mở chốt công tháng
create or replace function public.lock_attendance_month(p_month date, p_locked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_pending int;
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Chỉ kế toán (quyền lập bảng lương) mới chốt công' using errcode = '42501';
  end if;
  if p_locked then
    select count(*) into v_pending from private.attendance_rows(v_from, (v_from + interval '1 month - 1 day')::date, null) a where a.status = 'pending';
    if v_pending > 0 then
      raise exception 'Còn % ngày công chờ xác nhận, xác nhận hết rồi mới chốt', v_pending using errcode = '22023';
    end if;
    insert into public.attendance_locks (period_month, locked_by) values (v_from, auth.uid()) on conflict (period_month) do nothing;
  else
    delete from public.attendance_locks where period_month = v_from;
  end if;
end;
$$;
revoke all on function public.lock_attendance_month(date, boolean) from public, anon;
grant execute on function public.lock_attendance_month(date, boolean) to authenticated;

-- 3. Thiết lập chung: thêm "trừ lương cơ bản theo ngày nghỉ không lương"
create or replace function public.payroll_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.has_perm('settlements.view') or private.has_perm('settlements.update')) then
    raise exception 'Bạn không có quyền xem thiết lập lương' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'offset_advance', private.payroll_setting_bool('payroll.offset_advance', true),
    'deduct_base_unpaid', private.payroll_setting_bool('payroll.deduct_base_unpaid', true),
    'weekly_off_days', coalesce((select value from public.system_settings where key = 'payroll.weekly_off_days'), '[0]'::jsonb),
    'can_edit', private.has_perm('settlements.update'));
end;
$$;

create or replace function public.set_payroll_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Bạn không có quyền đổi thiết lập lương' using errcode = '42501';
  end if;
  if p_key in ('payroll.offset_advance', 'payroll.deduct_base_unpaid') then
    if jsonb_typeof(p_value) <> 'boolean' then
      raise exception 'Giá trị phải là bật hoặc tắt' using errcode = '22023';
    end if;
  elsif p_key = 'payroll.weekly_off_days' then
    if jsonb_typeof(p_value) <> 'array' or exists (
      select 1 from jsonb_array_elements(p_value) e
      where jsonb_typeof(e) <> 'number' or e::text not in ('0', '1', '2', '3', '4', '5', '6')) then
      raise exception 'Ngày nghỉ trong tuần không hợp lệ' using errcode = '22023';
    end if;
  else
    raise exception 'Không có thiết lập lương %', p_key using errcode = '22023';
  end if;
  update public.system_settings set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key;
end;
$$;

-- 4. Bảng lương lấy ngày công từ bảng chấm công
create or replace function private.payroll_compute(p_driver_id uuid, p_month date, p_bonus numeric, p_deduction numeric, p_manual jsonb default '{}'::jsonb,
  p_offset_advance boolean default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.drivers;
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_trips int;
  v_workdays int;
  v_missing int;
  v_exp_count int;
  v_exp numeric;
  v_balance numeric;
  v_trip_salary numeric;
  v_base numeric := 0;
  v_meal numeric := 0;
  v_other numeric := 0;
  v_comp_deduct numeric := 0;
  v_gross numeric;
  v_offset numeric;
  v_setup boolean;
  v_lines jsonb := '[]'::jsonb;
  c record;
  v_rate numeric;
  v_qty numeric;
  v_amt numeric;
  v_offday_trips int;
  v_do_offset boolean := coalesce(p_offset_advance, private.payroll_setting_bool('payroll.offset_advance', true));
  v_exp_lines jsonb;
  v_att record;
  v_standard int;
begin
  select * into d from public.drivers where id = p_driver_id;
  if d.id is null then
    raise exception 'Không tìm thấy tài xế' using errcode = 'P0001';
  end if;
  if coalesce(p_bonus, 0) < 0 or coalesce(p_deduction, 0) < 0 then
    raise exception 'Thưởng và khấu trừ không được âm' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_manual, '{}'::jsonb)) <> 'object' then
    raise exception 'Khoản nhập tay không hợp lệ' using errcode = '22023';
  end if;
  -- Chuyến hoàn thành trong tháng và đơn giá lương của từng chuyến
  select count(*), count(distinct trip_date), coalesce(sum(pay_amount), 0), count(*) filter (where missing_rate),
         count(*) filter (where private.is_pay_offday(trip_date))
    into v_trips, v_workdays, v_trip_salary, v_missing, v_offday_trips
  from (
    select (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date as trip_date,
           case when d.pay_type = 'monthly_only' then 0 else coalesce(r.amount, d.per_trip_salary, 0) end as pay_amount,
           (d.pay_type <> 'monthly_only' and r.rate_id is null and coalesce(d.per_trip_salary, 0) = 0) as missing_rate
    from public.shipments s
    left join lateral private.trip_pay_rate_for(s.driver_id, s.pickup_location_id, s.delivery_location_id, s.vehicle_type_id,
      (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date) r on true
    where s.driver_id = d.id and s.status in ('driver_completed', 'closed')
      and (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date between v_from and v_to
  ) t;
  select count(*), coalesce(sum(e.amount), 0) into v_exp_count, v_exp from public.shipment_expenses e
  where e.driver_id = d.id and e.paid_by = 'driver' and e.status = 'approved' and e.payroll_id is null
    and (e.incurred_at at time zone 'Asia/Ho_Chi_Minh')::date <= v_to;
  -- Ngày công theo bảng chấm công
  select count(*) filter (where a.status = 'work') as work,
         count(*) filter (where a.status = 'leave_paid') as leave_paid,
         count(*) filter (where a.status = 'sick') as sick,
         count(*) filter (where a.status = 'leave_unpaid') as leave_unpaid,
         count(*) filter (where a.status = 'absent') as absent,
         count(*) filter (where a.status = 'pending') as pending,
         count(*) filter (where a.status <> 'off' and not private.is_pay_offday(a.work_date)) as standard
    into v_att
  from private.attendance_rows(v_from, v_to, d.id) a;
  v_workdays := coalesce(v_att.work, 0);
  -- Công chuẩn = số ngày trong tháng trừ ngày nghỉ tuần, ngày lễ
  select count(*) into v_standard from generate_series(v_from, v_to, interval '1 day') g where not private.is_pay_offday(g::date);
  -- Hoàn chi phí tài xế tự trả, chia theo danh mục phí (bốc xếp, vá vỏ, vệ sinh cont...)
  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'count', x.n, 'amount', x.amount) order by x.amount desc), '[]'::jsonb)
    into v_exp_lines
  from (
    select coalesce(ec.name, 'Khác') as name, count(*) as n, sum(e.amount) as amount
    from public.shipment_expenses e
    left join public.expense_categories ec on ec.id = e.category_id
    where e.driver_id = d.id and e.paid_by = 'driver' and e.status = 'approved' and e.payroll_id is null
      and (e.incurred_at at time zone 'Asia/Ho_Chi_Minh')::date <= v_to
    group by coalesce(ec.name, 'Khác')
  ) x;
  v_balance := greatest(private.driver_advance_balance(d.id), 0);

  -- Đã thiết lập lương theo khoản (có mức riêng hoặc khoản có mức mặc định) thì tính theo khoản; chưa thì như cũ
  v_setup := exists (select 1 from public.driver_pay_components x where x.driver_id = d.id and x.effective_from <= v_to)
          or exists (select 1 from public.pay_components x where x.is_active and coalesce(x.default_amount, 0) > 0);

  if not v_setup then
    v_base := case when d.pay_type = 'trip_only' then 0 else coalesce(d.base_salary, 0) end;
    v_meal := coalesce(d.meal_allowance, 0);
    v_other := coalesce(d.other_allowance, 0);
    v_lines := jsonb_build_array(
      jsonb_build_object('code', 'LCB', 'name', 'Lương cơ bản', 'kind', 'income', 'method', 'monthly', 'qty', 1, 'rate', v_base, 'amount', v_base),
      jsonb_build_object('code', 'LCHUYEN', 'name', 'Lương chuyến', 'kind', 'income', 'method', 'trip_rate', 'qty', v_trips, 'rate', null, 'amount', v_trip_salary),
      jsonb_build_object('code', 'PCAN', 'name', 'Phụ cấp ăn uống', 'kind', 'income', 'method', 'monthly', 'qty', 1, 'rate', v_meal, 'amount', v_meal),
      jsonb_build_object('code', 'PCKHAC', 'name', 'Phụ cấp khác', 'kind', 'income', 'method', 'monthly', 'qty', 1, 'rate', v_other, 'amount', v_other));
  else
    for c in select * from public.pay_components where is_active order by sort_order, code loop
      v_rate := private.driver_component_amount(d.id, c.id, v_to);
      v_qty := 1;
      if c.method = 'trip_rate' then
        v_rate := null; v_qty := v_trips; v_amt := v_trip_salary;
      elsif c.code = 'LCB' and d.pay_type = 'trip_only' then
        v_amt := 0;
      elsif c.code = 'LCB' and private.payroll_setting_bool('payroll.deduct_base_unpaid', true) and v_standard > 0
            and coalesce(v_att.leave_unpaid, 0) + coalesce(v_att.absent, 0) > 0 then
        -- Trừ lương cơ bản theo ngày nghỉ không lương / không báo: mức × (1 − ngày nghỉ / công chuẩn)
        v_qty := greatest(v_standard - v_att.leave_unpaid - v_att.absent, 0)::numeric / v_standard;
        v_amt := v_rate * v_qty;
      elsif c.method = 'monthly' then
        v_amt := v_rate;
      elsif c.method = 'per_workday' then
        v_qty := v_workdays; v_amt := v_rate * v_workdays;
      elsif c.method = 'per_trip' then
        v_qty := v_trips; v_amt := v_rate * v_trips;
      elsif c.method = 'per_trip_offday' then
        v_qty := v_offday_trips; v_amt := v_rate * v_offday_trips;
      elsif c.method = 'over_trips' then
        v_qty := greatest(v_trips - coalesce(c.threshold, 0), 0); v_amt := v_rate * v_qty;
      else -- nhập tay khi lập bảng lương
        v_amt := coalesce(nullif(p_manual ->> c.code, '')::numeric, 0);
        if v_amt < 0 then
          raise exception 'Số tiền "%" không được âm', c.name using errcode = '22023';
        end if;
        v_rate := null;
      end if;
      v_amt := round(coalesce(v_amt, 0), 0);
      continue when v_amt = 0 and c.method not in ('trip_rate') and c.code <> 'LCB';
      v_lines := v_lines || jsonb_build_object('code', c.code, 'name', c.name, 'kind', c.kind, 'method', c.method,
        'qty', v_qty, 'rate', v_rate, 'amount', v_amt);
      if c.kind = 'deduction' then
        v_comp_deduct := v_comp_deduct + v_amt;
      elsif c.code = 'LCB' then
        v_base := v_amt;
      elsif c.method = 'trip_rate' then
        null; -- đã nằm trong v_trip_salary
      elsif c.code = 'PCAN' then
        v_meal := v_meal + v_amt;
      else
        v_other := v_other + v_amt;
      end if;
    end loop;
  end if;

  v_gross := v_base + v_trip_salary + v_meal + v_other + coalesce(p_bonus, 0) - coalesce(p_deduction, 0) - v_comp_deduct + v_exp;
  -- Cấn trừ tối đa bằng số được nhận; phần còn lại chuyển sang tháng sau.
  -- Thiết lập "Không trừ tiền ứng vào lương": trả đủ lương, tạm ứng giữ nguyên để tài xế hoàn riêng
  v_offset := case when v_do_offset then least(v_balance, greatest(v_gross, 0)) else 0 end;
  return jsonb_build_object(
    'driver_id', d.id, 'driver_name', d.full_name, 'period_month', v_from, 'period_from', v_from, 'period_to', v_to,
    'pay_type', d.pay_type, 'setup', v_setup,
    'trip_count', v_trips, 'workdays', v_workdays, 'standard_days', v_standard,
    'attendance', jsonb_build_object('work', v_att.work, 'leave_paid', v_att.leave_paid, 'sick', v_att.sick,
      'leave_unpaid', v_att.leave_unpaid, 'absent', v_att.absent, 'pending', v_att.pending), 'trips_missing_rate', v_missing,
    'base_salary', v_base, 'per_trip_salary', coalesce(d.per_trip_salary, 0),
    'trip_salary', v_trip_salary, 'meal_allowance', v_meal, 'other_allowance', v_other,
    'bonus', coalesce(p_bonus, 0), 'deduction', coalesce(p_deduction, 0) + v_comp_deduct,
    'components', v_lines,
    'expense_count', v_exp_count, 'expense_reimbursement', v_exp, 'expense_lines', v_exp_lines,
    'offset_advance', v_do_offset, 'offday_trips', v_offday_trips,
    'advance_balance', v_balance, 'advance_offset', v_offset,
    'gross_amount', v_gross, 'net_amount', greatest(v_gross - v_offset, 0),
    'advance_carry', v_balance - v_offset,
    'existing', (select p.code from public.driver_payrolls p where p.driver_id = d.id and p.period_month = v_from
                   and p.status not in ('cancelled', 'rejected') limit 1));
end;
$$;
revoke all on function private.payroll_compute(uuid, date, numeric, numeric, jsonb, boolean) from public, anon, authenticated;


-- Bảng lương: thêm cột ngày công chuẩn và chi tiết chấm công
alter table public.driver_payrolls add column if not exists attendance jsonb not null default '{}'::jsonb;
comment on column public.driver_payrolls.attendance is 'Tóm tắt chấm công lúc lập: work, leave_paid, sick, leave_unpaid, absent, pending';
create or replace function private.payroll_insert(p_driver_id uuid, p_month date, p_bonus numeric, p_deduction numeric, p_note text, p_custom_fields jsonb,
  p_manual jsonb default '{}'::jsonb, p_offset_advance boolean default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb;
  v_id uuid;
  v_to date;
begin
  -- Khóa theo tài xế để hai người lập cùng lúc không trùng
  perform 1 from public.drivers where id = p_driver_id for update;
  c := private.payroll_compute(p_driver_id, p_month, p_bonus, p_deduction, p_manual, p_offset_advance);
  if c ->> 'existing' is not null then
    raise exception 'Tài xế đã có bảng lương tháng này (%). Hủy bảng cũ nếu muốn lập lại.', c ->> 'existing' using errcode = '23505';
  end if;
  if (c ->> 'gross_amount')::numeric < 0 then
    raise exception 'Khấu trừ lớn hơn tổng lương, kiểm tra lại số tiền' using errcode = '22023';
  end if;
  v_to := (c ->> 'period_to')::date;
  insert into public.driver_payrolls (driver_id, period_month, trip_count, base_salary, per_trip_salary, trip_salary,
    meal_allowance, other_allowance, bonus, deduction, expense_count, expense_reimbursement, advance_balance, advance_offset,
    gross_amount, net_amount, note, custom_fields, components, workdays, trips_missing_rate, attendance)
  values (p_driver_id, (c ->> 'period_month')::date, (c ->> 'trip_count')::int, (c ->> 'base_salary')::numeric,
    (c ->> 'per_trip_salary')::numeric, (c ->> 'trip_salary')::numeric, (c ->> 'meal_allowance')::numeric,
    (c ->> 'other_allowance')::numeric, (c ->> 'bonus')::numeric, (c ->> 'deduction')::numeric, (c ->> 'expense_count')::int,
    (c ->> 'expense_reimbursement')::numeric, (c ->> 'advance_balance')::numeric, (c ->> 'advance_offset')::numeric,
    (c ->> 'gross_amount')::numeric, (c ->> 'net_amount')::numeric, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_custom_fields, '{}'),
    c -> 'components', (c ->> 'workdays')::int, (c ->> 'trips_missing_rate')::int, coalesce(c -> 'attendance', '{}'::jsonb))
  returning id into v_id;
  update public.shipment_expenses set payroll_id = v_id
  where driver_id = p_driver_id and paid_by = 'driver' and status = 'approved' and payroll_id is null
    and (incurred_at at time zone 'Asia/Ho_Chi_Minh')::date <= v_to;
  update public.driver_payrolls set approval_request_id = private.submit_approval(
      'driver_payroll', 'driver_payroll', v_id, null, (c ->> 'net_amount')::numeric,
      'Lương tháng ' || to_char((c ->> 'period_month')::date, 'MM/YYYY') || ' - ' || (c ->> 'driver_name'),
      auth.uid(), p_driver_id, null)
  where id = v_id;
  return v_id;
end;
$$;
revoke all on function private.payroll_insert(uuid, date, numeric, numeric, text, jsonb, jsonb, boolean) from public, anon, authenticated;

