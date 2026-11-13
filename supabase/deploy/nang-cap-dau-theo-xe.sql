-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Dầu theo xe: KM, tồn dầu, đổ thêm, còn lại, tỷ trọng, Giám đốc chốt theo tháng
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regclass('public.vehicle_fuel_months') is not null then
    raise exception 'CSDL đã được nâng cấp Dầu theo xe: KM, tồn dầu, đổ thêm, còn lại, tỷ trọng, Giám đốc chốt theo tháng trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261110000068_vehicle_fuel.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0068: Dầu theo từng xe, theo tháng (10/11/2026)
--   Mỗi xe công ty (xe cont, xe tải trong Phương tiện, không gồm xe thuê ngoài 3PL), mỗi tháng một dòng:
--     KM đầu tháng, KM cuối tháng, tồn dầu đầu tháng, dầu đổ thêm, dầu còn lại (đo cuối tháng),
--     tỷ trọng dầu (lít/km), Giám đốc chốt số lít tiêu hao.
--   Tính sẵn ở giao diện: dầu thực tế = tồn đầu + đổ thêm − còn lại; dầu theo KM = (KM cuối − KM đầu) × tỷ trọng.
--   Ô để trống tự lấy: KM đầu tháng = KM cuối tháng trước, tồn dầu đầu tháng = dầu còn lại tháng trước,
--   tỷ trọng = tỷ trọng dầu của xe (Phương tiện). Khi Giám đốc chốt, các số tự lấy được ghi cố định.
--   Quyền mới fuel.{view, update, approve, export}: approve = Giám đốc chốt / mở chốt.
-- Không xóa dữ liệu. Chạy lại nhiều lần không lỗi.
-- =============================================================================

-- 1. Quyền
insert into public.permissions (code, module, action, name, sort_order) values
  ('fuel.view', 'fuel', 'view', 'Xem - Dầu theo xe', 2701),
  ('fuel.update', 'fuel', 'update', 'Sửa - Dầu theo xe', 2703),
  ('fuel.approve', 'fuel', 'approve', 'Duyệt (Giám đốc chốt) - Dầu theo xe', 2705),
  ('fuel.export', 'fuel', 'export', 'Xuất dữ liệu - Dầu theo xe', 2707)
on conflict (code) do nothing;

-- Mặc định: Admin toàn quyền; Giám đốc xem, chốt, xuất; Quản lý vận hành, Điều phối, Kế toán xem, nhập số, xuất;
-- Người chỉ xem báo cáo: xem.
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
join public.permissions p on p.module = 'fuel' and (
  r.code = 'admin'
  or (r.code = 'director' and p.action in ('view', 'approve', 'export'))
  or (r.code in ('ops_manager', 'dispatcher', 'accountant') and p.action in ('view', 'update', 'export'))
  or (r.code = 'report_viewer' and p.action = 'view'))
on conflict do nothing;

-- 2. Tỷ trọng dầu của xe (lít/km), lấy sẵn từ định mức lít/100km nếu đã nhập
alter table public.vehicles add column if not exists fuel_ratio_l_per_km numeric(8,4) check (fuel_ratio_l_per_km >= 0 and fuel_ratio_l_per_km <= 10);
comment on column public.vehicles.fuel_ratio_l_per_km is 'Tỷ trọng dầu theo xe: số lít dầu cho 1 km (ví dụ 0.35). Dùng cho báo cáo Dầu theo xe';
update public.vehicles
   set fuel_ratio_l_per_km = round(fuel_norm_l_per_100km / 100, 4)
 where fuel_ratio_l_per_km is null and fuel_norm_l_per_100km is not null;

-- 3. Số liệu dầu từng xe theo tháng
create table if not exists public.vehicle_fuel_months (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  period_month date not null check (extract(day from period_month) = 1),
  km_start integer check (km_start >= 0),
  km_end integer check (km_end >= 0),
  fuel_opening numeric(12,2) check (fuel_opening >= 0),
  fuel_added numeric(12,2) check (fuel_added >= 0),
  fuel_remaining numeric(12,2) check (fuel_remaining >= 0),
  fuel_ratio numeric(8,4) check (fuel_ratio >= 0 and fuel_ratio <= 10),
  final_fuel numeric(12,2) check (final_fuel >= 0),
  final_note text check (final_note is null or length(final_note) <= 500),
  note text check (note is null or length(note) <= 500),
  locked_at timestamptz,
  locked_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (vehicle_id, period_month)
);
comment on table public.vehicle_fuel_months is 'Dầu theo xe theo tháng: KM, tồn đầu, đổ thêm, còn lại, tỷ trọng, số Giám đốc chốt';
comment on column public.vehicle_fuel_months.final_fuel is 'Số lít dầu tiêu hao Giám đốc chốt sau khi cân đối thực tế và định mức (KM × tỷ trọng)';
create index if not exists vehicle_fuel_months_month_idx on public.vehicle_fuel_months (period_month);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_vehicle_fuel_months_updated_at') then
    perform private.attach_standard_triggers('public.vehicle_fuel_months'::regclass);
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_vehicle_fuel_months_audit') then
    create trigger trg_vehicle_fuel_months_audit after insert or update or delete on public.vehicle_fuel_months
    for each row execute function private.audit_row_change('id');
  end if;
end $$;

-- Chỉ ghi qua hàm (kiểm tra quyền, khóa chốt)
alter table public.vehicle_fuel_months enable row level security;
drop policy if exists vehicle_fuel_months_select on public.vehicle_fuel_months;
create policy vehicle_fuel_months_select on public.vehicle_fuel_months for select to authenticated
  using ((select private.has_perm('fuel.view')));
revoke all on public.vehicle_fuel_months from anon;
grant select on public.vehicle_fuel_months to authenticated;

-- 4. Số liệu một tháng của mọi xe công ty (ô trống lấy số tự động)
create or replace function private.fuel_month_rows(p_month date)
returns table (
  vehicle_id uuid, plate_number text, vehicle_code text, vehicle_type text, driver_name text, vehicle_status text,
  km_start integer, km_start_auto boolean, km_end integer,
  fuel_opening numeric, fuel_opening_auto boolean, fuel_added numeric, fuel_remaining numeric,
  fuel_ratio numeric, fuel_ratio_auto boolean,
  final_fuel numeric, final_note text, note text, locked_at timestamptz, locked_by_name text, has_row boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.plate_number, v.code, vt.name, d.full_name, v.status,
    coalesce(m.km_start, prev_km.km_end), m.km_start is null and prev_km.km_end is not null, m.km_end,
    coalesce(m.fuel_opening, prev_fuel.fuel_remaining), m.fuel_opening is null and prev_fuel.fuel_remaining is not null,
    m.fuel_added, m.fuel_remaining,
    coalesce(m.fuel_ratio, v.fuel_ratio_l_per_km), m.fuel_ratio is null and v.fuel_ratio_l_per_km is not null,
    m.final_fuel, m.final_note, m.note, m.locked_at, lp.full_name, m.id is not null
  from public.vehicles v
  left join public.vehicle_types vt on vt.id = v.vehicle_type_id
  left join public.drivers d on d.id = v.assigned_driver_id
  left join public.vehicle_fuel_months m on m.vehicle_id = v.id and m.period_month = p_month
  left join public.profiles lp on lp.id = m.locked_by
  -- Tháng gần nhất trước đó có KM cuối / dầu còn lại
  left join lateral (
    select x.km_end from public.vehicle_fuel_months x
    where x.vehicle_id = v.id and x.period_month < p_month and x.km_end is not null
    order by x.period_month desc limit 1
  ) prev_km on true
  left join lateral (
    select x.fuel_remaining from public.vehicle_fuel_months x
    where x.vehicle_id = v.id and x.period_month < p_month and x.fuel_remaining is not null
    order by x.period_month desc limit 1
  ) prev_fuel on true
  where v.ownership_type <> 'outsourced'
    and (m.id is not null or (v.archived_at is null and v.status <> 'sold'));
$$;
revoke all on function private.fuel_month_rows(date) from public, anon, authenticated;

create or replace function public.fuel_month(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if not private.has_perm('fuel.view') then
    raise exception 'Bạn không có quyền xem dầu theo xe' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'month', v_month,
    'can_edit', private.has_perm('fuel.update'),
    'can_lock', private.has_perm('fuel.approve'),
    'can_export', private.has_perm('fuel.export'),
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.vehicle_type nulls last, r.plate_number)
                      from private.fuel_month_rows(v_month) r), '[]'::jsonb));
end;
$$;
revoke all on function public.fuel_month(date) from public, anon;
grant execute on function public.fuel_month(date) to authenticated;

-- 5. Nhập / sửa số liệu một xe. p_values chỉ chứa các ô cần đổi; giá trị null = để trống (lấy số tự động).
create or replace function private.fuel_num(p_values jsonb, p_key text, p_label text, p_max numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p_values -> p_key is null or jsonb_typeof(p_values -> p_key) = 'null' then
    return null;
  end if;
  begin
    v := (p_values ->> p_key)::numeric;
  exception when others then
    raise exception '% phải là số', p_label using errcode = '22023';
  end;
  if v < 0 then
    raise exception '% không được âm', p_label using errcode = '22023';
  elsif v > p_max then
    raise exception '% quá lớn (tối đa %)', p_label, p_max using errcode = '22023';
  end if;
  return v;
end;
$$;
revoke all on function private.fuel_num(jsonb, text, text, numeric) from public, anon, authenticated;

create or replace function public.save_vehicle_fuel(p_vehicle_id uuid, p_month date, p_values jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  m public.vehicle_fuel_months;
  r record;
  k text;
begin
  if not private.has_perm('fuel.update') then
    raise exception 'Bạn không có quyền nhập số liệu dầu' using errcode = '42501';
  end if;
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'Dữ liệu không hợp lệ' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_values) loop
    if k not in ('km_start', 'km_end', 'fuel_opening', 'fuel_added', 'fuel_remaining', 'fuel_ratio', 'note') then
      raise exception 'Ô "%" không sửa được ở đây', k using errcode = '22023';
    end if;
  end loop;
  if not exists (select 1 from public.vehicles where id = p_vehicle_id and ownership_type <> 'outsourced') then
    raise exception 'Không tìm thấy xe công ty (xe thuê ngoài 3PL không theo dõi dầu)' using errcode = 'P0001';
  end if;

  insert into public.vehicle_fuel_months (vehicle_id, period_month) values (p_vehicle_id, v_month)
  on conflict (vehicle_id, period_month) do nothing;
  select * into m from public.vehicle_fuel_months where vehicle_id = p_vehicle_id and period_month = v_month for update;
  if m.locked_at is not null then
    raise exception 'Xe này tháng %/% đã được Giám đốc chốt, nhờ Giám đốc mở chốt nếu cần sửa',
      extract(month from v_month), extract(year from v_month) using errcode = '22023';
  end if;

  if p_values ? 'km_start' then m.km_start := private.fuel_num(p_values, 'km_start', 'KM đầu tháng', 9999999)::integer; end if;
  if p_values ? 'km_end' then m.km_end := private.fuel_num(p_values, 'km_end', 'KM cuối tháng', 9999999)::integer; end if;
  if p_values ? 'fuel_opening' then m.fuel_opening := round(private.fuel_num(p_values, 'fuel_opening', 'Tồn dầu đầu tháng', 9999999), 2); end if;
  if p_values ? 'fuel_added' then m.fuel_added := round(private.fuel_num(p_values, 'fuel_added', 'Dầu đổ thêm', 9999999), 2); end if;
  if p_values ? 'fuel_remaining' then m.fuel_remaining := round(private.fuel_num(p_values, 'fuel_remaining', 'Dầu còn lại', 9999999), 2); end if;
  if p_values ? 'fuel_ratio' then m.fuel_ratio := round(private.fuel_num(p_values, 'fuel_ratio', 'Tỷ trọng dầu (lít/km)', 10), 4); end if;
  if p_values ? 'note' then m.note := nullif(left(trim(coalesce(p_values ->> 'note', '')), 500), ''); end if;

  update public.vehicle_fuel_months
     set km_start = m.km_start, km_end = m.km_end, fuel_opening = m.fuel_opening, fuel_added = m.fuel_added,
         fuel_remaining = m.fuel_remaining, fuel_ratio = m.fuel_ratio, note = m.note
   where id = m.id;

  -- Kiểm tra theo số đang dùng (kể cả số tự lấy từ tháng trước)
  select * into r from private.fuel_month_rows(v_month) x where x.vehicle_id = p_vehicle_id;
  if r.km_start is not null and r.km_end is not null and r.km_end < r.km_start then
    raise exception 'KM cuối tháng (%) nhỏ hơn KM đầu tháng (%)', r.km_end, r.km_start using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.save_vehicle_fuel(uuid, date, jsonb) from public, anon;
grant execute on function public.save_vehicle_fuel(uuid, date, jsonb) to authenticated;

-- 6. Nhập Excel: mỗi phần tử {"plate": "61K31295", "km_start": ..., ...}. Dòng lỗi bỏ qua, trả danh sách lỗi.
create or replace function public.import_vehicle_fuel(p_month date, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e jsonb;
  i int := 0;
  n int := 0;
  v_id uuid;
  v_plate text;
  errs jsonb := '[]'::jsonb;
begin
  if not private.has_perm('fuel.update') then
    raise exception 'Bạn không có quyền nhập số liệu dầu' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'File không có dòng nào' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Mỗi lần nhập tối đa 2000 dòng' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_plate := upper(regexp_replace(coalesce(e ->> 'plate', ''), '[^A-Za-z0-9]', '', 'g'));
    begin
      select v.id into v_id from public.vehicles v
       where upper(regexp_replace(v.plate_number, '[^A-Za-z0-9]', '', 'g')) = v_plate;
      if v_plate = '' then
        raise exception 'Thiếu số xe' using errcode = '22023';
      elsif v_id is null then
        raise exception 'Không có xe % trong Phương tiện', v_plate using errcode = '22023';
      end if;
      perform public.save_vehicle_fuel(v_id, p_month, e - 'plate' - 'row');
      n := n + 1;
    exception when others then
      errs := errs || jsonb_build_object('row', coalesce((e ->> 'row')::int, i), 'plate', v_plate, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('saved', n, 'errors', errs);
end;
$$;
revoke all on function public.import_vehicle_fuel(date, jsonb) from public, anon;
grant execute on function public.import_vehicle_fuel(date, jsonb) to authenticated;

-- 7. Giám đốc nhập số chốt (chưa khóa)
create or replace function public.set_vehicle_fuel_final(p_vehicle_id uuid, p_month date, p_final numeric, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if not private.has_perm('fuel.approve') then
    raise exception 'Chỉ Giám đốc (quyền chốt dầu) mới nhập số chốt' using errcode = '42501';
  end if;
  if p_final is not null and (p_final < 0 or p_final > 9999999) then
    raise exception 'Số chốt phải từ 0 trở lên' using errcode = '22023';
  end if;
  if not exists (select 1 from public.vehicles where id = p_vehicle_id and ownership_type <> 'outsourced') then
    raise exception 'Không tìm thấy xe công ty' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.vehicle_fuel_months where vehicle_id = p_vehicle_id and period_month = v_month and locked_at is not null) then
    raise exception 'Xe này tháng này đã chốt, mở chốt rồi mới sửa số chốt' using errcode = '22023';
  end if;
  insert into public.vehicle_fuel_months (vehicle_id, period_month, final_fuel, final_note)
  values (p_vehicle_id, v_month, round(p_final, 2), nullif(left(trim(coalesce(p_note, '')), 500), ''))
  on conflict (vehicle_id, period_month) do update
    set final_fuel = excluded.final_fuel, final_note = excluded.final_note;
end;
$$;
revoke all on function public.set_vehicle_fuel_final(uuid, date, numeric, text) from public, anon;
grant execute on function public.set_vehicle_fuel_final(uuid, date, numeric, text) to authenticated;

-- 8. Giám đốc chốt / mở chốt. p_fill khi chốt: ô số chốt còn trống lấy 'actual' (thực tế) / 'norm' (theo KM × tỷ trọng)
--    / 'none' (báo lỗi nếu còn trống). Chốt thì ghi cố định các số đang tự lấy (KM đầu, tồn đầu, tỷ trọng).
create or replace function public.lock_vehicle_fuel(p_vehicle_ids uuid[], p_month date, p_locked boolean, p_fill text default 'none')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  r record;
  v_final numeric;
  n int := 0;
begin
  if not private.has_perm('fuel.approve') then
    raise exception 'Chỉ Giám đốc (quyền chốt dầu) mới chốt / mở chốt' using errcode = '42501';
  end if;
  if coalesce(p_fill, 'none') not in ('none', 'actual', 'norm') then
    raise exception 'Cách lấy số chốt không hợp lệ' using errcode = '22023';
  end if;
  if coalesce(array_length(p_vehicle_ids, 1), 0) = 0 then
    raise exception 'Chọn xe cần chốt' using errcode = '22023';
  end if;
  for r in select * from private.fuel_month_rows(v_month) x where x.vehicle_id = any (p_vehicle_ids) loop
    if not p_locked then
      update public.vehicle_fuel_months set locked_at = null, locked_by = null
       where vehicle_id = r.vehicle_id and period_month = v_month and locked_at is not null;
      if found then n := n + 1; end if;
      continue;
    end if;
    if r.locked_at is not null then
      continue;
    end if;
    v_final := r.final_fuel;
    if v_final is null and p_fill = 'actual' then
      v_final := r.fuel_opening + r.fuel_added - r.fuel_remaining;
    elsif v_final is null and p_fill = 'norm' then
      v_final := (r.km_end - r.km_start) * r.fuel_ratio;
    end if;
    if v_final is null then
      raise exception 'Xe % chưa có số chốt (hoặc thiếu số để tính)', r.plate_number using errcode = '22023';
    end if;
    if v_final < 0 then
      raise exception 'Xe %: số chốt tính ra âm (%), kiểm tra lại tồn đầu / đổ thêm / còn lại', r.plate_number, round(v_final, 2) using errcode = '22023';
    end if;
    insert into public.vehicle_fuel_months (vehicle_id, period_month) values (r.vehicle_id, v_month)
    on conflict (vehicle_id, period_month) do nothing;
    update public.vehicle_fuel_months
       set km_start = r.km_start, fuel_opening = r.fuel_opening, fuel_ratio = r.fuel_ratio,
           final_fuel = round(v_final, 2), locked_at = now(), locked_by = auth.uid()
     where vehicle_id = r.vehicle_id and period_month = v_month;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.lock_vehicle_fuel(uuid[], date, boolean, text) from public, anon;
grant execute on function public.lock_vehicle_fuel(uuid[], date, boolean, text) to authenticated;

commit;
