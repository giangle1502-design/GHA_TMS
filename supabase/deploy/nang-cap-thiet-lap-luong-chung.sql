-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Lương tài xế: tự chọn trừ tiền ứng, ngày nghỉ trong tuần, ngày lễ, thêm tiền chuyến ngày nghỉ
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.pay_holidays') is not null then
    raise exception 'CSDL đã được nâng cấp Lương tài xế: tự chọn trừ tiền ứng, ngày nghỉ trong tuần, ngày lễ, thêm tiền chuyến ngày nghỉ trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261108000063_driver_pay_settings.sql
-- =============================================================================
-- 0063: Thiết lập lương tài xế, bổ sung theo trả lời của người dùng 08/11/2026
--   * Chuyến tính lương khi hoàn thành (như 0062); cont 20/40 cùng giá (để trống Loại cont).
--   * Bốc xếp, vá vỏ, vệ sinh cont = hoàn tiền tài xế đã chi trong các chuyến của tháng
--     (chi phí tài xế tự trả đã duyệt) → tắt 3 khoản nhập tay đó; bảng lương hiện chi tiết
--     hoàn chi phí theo danh mục phí.
--   * Thưởng vượt chuyến: người dùng tự đặt mốc và mức (đã có ở 0062).
--   * Người dùng tự chọn có trừ tiền ứng còn dư vào lương không (payroll.offset_advance),
--     đổi được ở từng bảng lương khi lập.
--   * Người dùng tự đặt ngày nghỉ trong tuần (payroll.weekly_off_days) và ngày lễ
--     (pay_holidays); cách tính mới "Theo chuyến ngày nghỉ, lễ".
-- Chạy lại nhiều lần không lỗi.
-- =============================================================================

-- 1. Tham số lương
insert into public.system_settings (key, value, description, is_public) values
  ('payroll.offset_advance', 'true'::jsonb, 'Lương tài xế: trừ tiền ứng còn dư vào lương tháng (tắt = trả đủ lương, tài xế hoàn ứng riêng)', false),
  ('payroll.weekly_off_days', '[0]'::jsonb, 'Lương tài xế: ngày nghỉ trong tuần (0 = Chủ nhật, 1 = Thứ hai ... 6 = Thứ bảy)', false)
on conflict (key) do nothing;

create or replace function private.payroll_setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select case when jsonb_typeof(value) = 'boolean' then value::text::boolean end
                   from public.system_settings where key = p_key), p_default);
$$;
revoke all on function private.payroll_setting_bool(text, boolean) from public, anon, authenticated;

-- 2. Ngày nghỉ lễ
create table if not exists public.pay_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text not null check (length(trim(name)) between 1 and 150),
  notes text check (notes is null or length(notes) <= 500),
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);
comment on table public.pay_holidays is 'Ngày nghỉ lễ của công ty: dùng tính khoản "Theo chuyến ngày nghỉ, lễ" và chấm công';
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_pay_holidays_updated_at') then
    perform private.attach_standard_triggers('public.pay_holidays'::regclass);
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_pay_holidays_audit') then
    create trigger trg_pay_holidays_audit after insert or update or delete on public.pay_holidays
    for each row execute function private.audit_row_change('id');
  end if;
end $$;
alter table public.pay_holidays enable row level security;
drop policy if exists pay_holidays_select on public.pay_holidays;
drop policy if exists pay_holidays_insert on public.pay_holidays;
drop policy if exists pay_holidays_update on public.pay_holidays;
drop policy if exists pay_holidays_delete on public.pay_holidays;
create policy pay_holidays_select on public.pay_holidays for select to authenticated using ((select private.is_active_user()));
create policy pay_holidays_insert on public.pay_holidays for insert to authenticated with check ((select private.has_perm('settlements.update')));
create policy pay_holidays_update on public.pay_holidays for update to authenticated
  using ((select private.has_perm('settlements.update'))) with check ((select private.has_perm('settlements.update')));
create policy pay_holidays_delete on public.pay_holidays for delete to authenticated using ((select private.has_perm('settlements.update')));
revoke all on public.pay_holidays from anon;
grant select, insert, update, delete on public.pay_holidays to authenticated;

-- Ngày nghỉ = ngày nghỉ trong tuần theo thiết lập hoặc ngày lễ
create or replace function private.is_pay_offday(p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_date is not null and (
    exists (select 1 from public.pay_holidays h where h.holiday_date = p_date)
    or coalesce((select s.value @> to_jsonb(extract(dow from p_date)::int) from public.system_settings s
                 where s.key = 'payroll.weekly_off_days' and jsonb_typeof(s.value) = 'array'), false));
$$;
revoke all on function private.is_pay_offday(date) from public, anon;
grant execute on function private.is_pay_offday(date) to authenticated;

-- Kế toán (quyền lập bảng lương) xem / đổi tham số lương ngay ở trang Lương tài xế
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
    'weekly_off_days', coalesce((select value from public.system_settings where key = 'payroll.weekly_off_days'), '[0]'::jsonb),
    'can_edit', private.has_perm('settlements.update'));
end;
$$;
revoke all on function public.payroll_settings() from public, anon;
grant execute on function public.payroll_settings() to authenticated;

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
  if p_key = 'payroll.offset_advance' then
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
revoke all on function public.set_payroll_setting(text, jsonb) from public, anon;
grant execute on function public.set_payroll_setting(text, jsonb) to authenticated;

-- 3. Khoản lương: cách tính mới "Theo chuyến ngày nghỉ, lễ"; tắt 3 khoản nhập tay đã chuyển sang hoàn chi phí
alter table public.pay_components drop constraint if exists pay_components_method_check;
alter table public.pay_components add constraint pay_components_method_check
  check (method in ('monthly', 'per_workday', 'per_trip', 'per_trip_offday', 'trip_rate', 'over_trips', 'manual'));
comment on column public.pay_components.method is 'monthly: cố định tháng; per_workday: mức × ngày công; per_trip: mức × số chuyến; per_trip_offday: mức × số chuyến ngày nghỉ, lễ; trip_rate: tổng đơn giá lương chuyến; over_trips: mức × (số chuyến − mốc); manual: nhập tay khi lập bảng lương';
insert into public.pay_components (code, name, kind, method, is_system, sort_order, description)
select 'CHUYENNGHI', 'Thêm tiền chuyến ngày nghỉ, lễ', 'income', 'per_trip_offday', false, 105,
       'Mức × số chuyến chạy vào ngày nghỉ trong tuần hoặc ngày lễ. Để mức trống nếu không trả thêm.'
where not exists (select 1 from public.pay_components where code = 'CHUYENNGHI');
update public.pay_components c set is_active = false,
  description = 'Không dùng: tài xế nhập khoản này trong chi phí chuyến, bảng lương tự hoàn ở dòng Hoàn chi phí tự trả.'
where c.code in ('PCBX', 'PCVV', 'PCVS') and c.is_active
  and not exists (select 1 from public.driver_pay_components x where x.component_id = c.id);

-- 4. Tính bảng lương (thêm ngày nghỉ, lễ; tùy chọn trừ tiền ứng; chi tiết hoàn chi phí)
drop function if exists private.payroll_compute(uuid, date, numeric, numeric, jsonb);
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
    'trip_count', v_trips, 'workdays', v_workdays, 'trips_missing_rate', v_missing,
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

drop function if exists public.driver_payroll_preview(uuid, date, numeric, numeric, jsonb);
create or replace function public.driver_payroll_preview(p_driver_id uuid, p_month date, p_bonus numeric default 0, p_deduction numeric default 0,
  p_manual jsonb default '{}'::jsonb, p_offset_advance boolean default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Bạn không có quyền lập bảng lương' using errcode = '42501';
  end if;
  return private.payroll_compute(p_driver_id, p_month, p_bonus, p_deduction, p_manual, p_offset_advance);
end;
$$;

drop function if exists private.payroll_insert(uuid, date, numeric, numeric, text, jsonb, jsonb);
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
    gross_amount, net_amount, note, custom_fields, components, workdays, trips_missing_rate)
  values (p_driver_id, (c ->> 'period_month')::date, (c ->> 'trip_count')::int, (c ->> 'base_salary')::numeric,
    (c ->> 'per_trip_salary')::numeric, (c ->> 'trip_salary')::numeric, (c ->> 'meal_allowance')::numeric,
    (c ->> 'other_allowance')::numeric, (c ->> 'bonus')::numeric, (c ->> 'deduction')::numeric, (c ->> 'expense_count')::int,
    (c ->> 'expense_reimbursement')::numeric, (c ->> 'advance_balance')::numeric, (c ->> 'advance_offset')::numeric,
    (c ->> 'gross_amount')::numeric, (c ->> 'net_amount')::numeric, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_custom_fields, '{}'),
    c -> 'components', (c ->> 'workdays')::int, (c ->> 'trips_missing_rate')::int)
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

drop function if exists public.create_driver_payroll(uuid, date, numeric, numeric, text, jsonb, jsonb);
create or replace function public.create_driver_payroll(
  p_driver_id uuid, p_month date, p_bonus numeric default 0, p_deduction numeric default 0,
  p_note text default null, p_custom_fields jsonb default '{}', p_manual jsonb default '{}'::jsonb, p_offset_advance boolean default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Bạn không có quyền lập bảng lương' using errcode = '42501';
  end if;
  v_id := private.payroll_insert(p_driver_id, p_month, p_bonus, p_deduction, p_note, p_custom_fields, p_manual, p_offset_advance);
  return (select code from public.driver_payrolls where id = v_id);
end;
$$;

-- Lập cho cả tháng: theo thiết lập trừ tiền ứng
create or replace function public.create_driver_payrolls_for_month(p_month date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
  n int := 0;
  skipped int := 0;
  missing int := 0;
  c jsonb;
  v_from date := date_trunc('month', p_month)::date;
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Bạn không có quyền lập bảng lương' using errcode = '42501';
  end if;
  for d in
    select dr.id from public.drivers dr
    where dr.archived_at is null and not coalesce(dr.is_outsourced, false) and (dr.status <> 'terminated'
      or exists (select 1 from public.shipments s where s.driver_id = dr.id
                   and (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date >= v_from))
    order by dr.full_name
  loop
    if exists (select 1 from public.driver_payrolls p where p.driver_id = d.id and p.period_month = v_from and p.status not in ('cancelled', 'rejected')) then
      skipped := skipped + 1;
      continue;
    end if;
    c := private.payroll_compute(d.id, v_from, 0, 0, '{}'::jsonb, null);
    if (c ->> 'gross_amount')::numeric = 0 and private.driver_advance_balance(d.id) = 0 then
      continue;
    end if;
    perform private.payroll_insert(d.id, v_from, 0, 0, null, '{}', '{}'::jsonb, null);
    n := n + 1;
    missing := missing + (c ->> 'trips_missing_rate')::int;
  end loop;
  return jsonb_build_object('created', n, 'skipped', skipped, 'trips_missing_rate', missing);
end;
$$;

-- 5. Trường bổ sung cho Ngày nghỉ, lễ
create or replace function private.custom_field_table(p_module text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_module
    when 'vehicles' then 'vehicles'
    when 'drivers' then 'drivers'
    when 'customers' then 'customers'
    when 'suppliers' then 'suppliers'
    when 'locations' then 'locations'
    when 'shipments' then 'shipments'
    when 'transport_orders' then 'transport_orders'
    when 'vehicle_types' then 'vehicle_types'
    when 'routes' then 'routes'
    when 'price_lists' then 'transport_price_lists'
    when 'fuel_rules' then 'fuel_support_rules'
    when 'expense_categories' then 'expense_categories'
    when 'expense_groups' then 'expense_groups'
    when 'banks' then 'banks'
    when 'payment_methods' then 'payment_methods'
    when 'company_entities' then 'company_entities'
    when 'salary_rules' then 'salary_rules'
    when 'maintenance_records' then 'maintenance_records'
    when 'catalog_items' then 'catalog_items'
    when 'advances' then 'advance_requests'
    when 'expenses' then 'shipment_expenses'
    when 'payrolls' then 'driver_payrolls'
    when 'receivables' then 'receivables'
    when 'payables' then 'payables'
    when 'shipment_items' then 'shipment_items'
    when 'fee_types' then 'fee_types'
    when 'fee_groups' then 'fee_groups'
    when 'declaration_types' then 'declaration_types'
    when 'leaves' then 'leave_requests'
    when 'purchase_requests' then 'purchase_requests'
    when 'purchase_request_types' then 'purchase_request_types'
    when 'tasks' then 'tasks'
    when 'transport_plans' then 'transport_plans'
    when 'pay_zones' then 'pay_zones'
    when 'trip_pay_rates' then 'trip_pay_rates'
    when 'pay_components' then 'pay_components'
    when 'driver_pay_components' then 'driver_pay_components'
    when 'pay_holidays' then 'pay_holidays'
  end;
$$;

commit;
