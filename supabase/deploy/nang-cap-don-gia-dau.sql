-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Dầu theo xe: đơn giá dầu và thành tiền
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vehicle_fuel_months' and column_name = 'fuel_price') then
    raise exception 'CSDL đã được nâng cấp Dầu theo xe: đơn giá dầu và thành tiền trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261110000069_vehicle_fuel_price.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0069: Dầu theo xe thêm Đơn giá dầu và Thành tiền (10/11/2026)
--   * vehicle_fuel_months.fuel_price: đơn giá dầu (đồng/lít) của xe trong tháng. Để trống thì tự lấy đơn giá
--     tháng trước của xe đó. Thành tiền tính ở giao diện = số lít Giám đốc chốt × đơn giá
--     (chưa chốt thì tạm tính theo dầu thực tế). Chốt thì ghi cố định đơn giá.
-- Không xóa dữ liệu. Chạy lại nhiều lần không lỗi.
-- =============================================================================

alter table public.vehicle_fuel_months add column if not exists fuel_price numeric(14,2) check (fuel_price >= 0);
comment on column public.vehicle_fuel_months.fuel_price is 'Đơn giá dầu (đồng/lít) của xe trong tháng';

-- Thêm cột trả về nên phải xóa hàm cũ trước
drop function if exists private.fuel_month_rows(date);
create or replace function private.fuel_month_rows(p_month date)
returns table (
  vehicle_id uuid, plate_number text, vehicle_code text, vehicle_type text, driver_name text, vehicle_status text,
  km_start integer, km_start_auto boolean, km_end integer,
  fuel_opening numeric, fuel_opening_auto boolean, fuel_added numeric, fuel_remaining numeric,
  fuel_ratio numeric, fuel_ratio_auto boolean,
  fuel_price numeric, fuel_price_auto boolean,
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
    coalesce(m.fuel_price, prev_price.fuel_price), m.fuel_price is null and prev_price.fuel_price is not null,
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
  -- Đơn giá dầu: tháng gần nhất trước đó của xe này
  left join lateral (
    select x.fuel_price from public.vehicle_fuel_months x
    where x.vehicle_id = v.id and x.period_month < p_month and x.fuel_price is not null
    order by x.period_month desc limit 1
  ) prev_price on true
  where v.ownership_type <> 'outsourced'
    and (m.id is not null or (v.archived_at is null and v.status <> 'sold'));
$$;
revoke all on function private.fuel_month_rows(date) from public, anon, authenticated;

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
    if k not in ('km_start', 'km_end', 'fuel_opening', 'fuel_added', 'fuel_remaining', 'fuel_ratio', 'fuel_price', 'note') then
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
  if p_values ? 'fuel_price' then m.fuel_price := round(private.fuel_num(p_values, 'fuel_price', 'Đơn giá dầu', 1000000), 2); end if;
  if p_values ? 'note' then m.note := nullif(left(trim(coalesce(p_values ->> 'note', '')), 500), ''); end if;

  update public.vehicle_fuel_months
     set km_start = m.km_start, km_end = m.km_end, fuel_opening = m.fuel_opening, fuel_added = m.fuel_added,
         fuel_remaining = m.fuel_remaining, fuel_ratio = m.fuel_ratio, fuel_price = m.fuel_price, note = m.note
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
       set km_start = r.km_start, fuel_opening = r.fuel_opening, fuel_ratio = r.fuel_ratio, fuel_price = r.fuel_price,
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
