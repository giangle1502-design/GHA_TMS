-- =============================================================================
-- KHÁNH HÀ TMS - 0056: Rút gọn mã chuyến và mã đơn (03/11/2026)
--   * Mã chuyến:  SHP-20261102-0005  ->  SNOV-0005
--   * Mã đơn:     ORD-20261102-0005  ->  ONOV-0005
--   Chữ đầu (S = chuyến, O = đơn) + 3 chữ tiếng Anh của tháng (JAN..DEC, giờ Việt Nam) + số thứ tự 4 chữ số.
--   Số thứ tự đếm theo tháng. Để mã không bao giờ trùng, cùng tháng năm sau đếm tiếp
--   (ví dụ tháng 11/2027 nối tiếp sau số cuối của tháng 11/2026), không quay về 0001.
--   Các mã cũ (SHP-YYYYMMDD-xxxx, ORD-YYYYMMDD-xxxx) được ĐÁNH SỐ LẠI sang dạng mới theo thứ tự tạo trong
--   từng tháng (người dùng chọn 03/11/2026); mã trong "Lập kế hoạch" và nội dung thông báo cũng được đổi theo.
--   Bộ đếm được đặt tiếp sau số lớn nhất để mã mới không trùng. Các chứng từ khác (tạm ứng, thanh toán...) không đổi.
-- Không xóa dữ liệu.
-- =============================================================================

create or replace function private.next_month_code(p_scope text, p_letter text, at_time timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  m text := to_char(at_time at time zone 'Asia/Ho_Chi_Minh', 'MON');  -- luôn tiếng Anh: JAN..DEC
  v integer;
begin
  insert into public.code_sequences as cs (scope, period, last_value)
  values (p_scope, 'M-' || m, 1)
  on conflict (scope, period) do update set last_value = cs.last_value + 1
  returning last_value into v;
  return p_letter || m || '-' || lpad(v::text, greatest(4, length(v::text)), '0');
end;
$$;
revoke all on function private.next_month_code(text, text, timestamptz) from public;
grant execute on function private.next_month_code(text, text, timestamptz) to authenticated, service_role;

create or replace function private.shipments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.shipment_code is null or new.shipment_code = '' then
    new.shipment_code := private.next_month_code('SHP', 'S', now());
  end if;
  new.status := coalesce(new.status, 'draft');
  return new;
end;
$$;

create or replace function private.orders_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.order_code is null or new.order_code = '' then
    new.order_code := private.next_month_code('ORD', 'O', now());
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Đánh số lại mã cũ (một lần). Tắt tạm trigger của hai bảng để chỉ đổi mã:
-- không ghi nhật ký, không tính lại giá, không chặn "không được đổi mã".
-- ---------------------------------------------------------------------------
create temporary table tmp_code_map (old_code text primary key, new_code text not null unique);

-- Thứ tự: theo tháng (giờ Việt Nam), trong tháng theo thời điểm tạo; cùng tháng năm sau nối tiếp năm trước.
insert into tmp_code_map (old_code, new_code)
select order_code,
       'O' || m || '-' || lpad(rn::text, greatest(4, length(rn::text)), '0')
from (
  select order_code, to_char(created_at at time zone 'Asia/Ho_Chi_Minh', 'MON') as m,
         row_number() over (partition by to_char(created_at at time zone 'Asia/Ho_Chi_Minh', 'MON') order by created_at, order_code) as rn
  from public.transport_orders
  where order_code ~ '^ORD-\d{8}-\d+$'
) x;

insert into tmp_code_map (old_code, new_code)
select shipment_code,
       'S' || m || '-' || lpad(rn::text, greatest(4, length(rn::text)), '0')
from (
  select shipment_code, to_char(created_at at time zone 'Asia/Ho_Chi_Minh', 'MON') as m,
         row_number() over (partition by to_char(created_at at time zone 'Asia/Ho_Chi_Minh', 'MON') order by created_at, shipment_code) as rn
  from public.shipments
  where shipment_code ~ '^SHP-\d{8}-\d+$'
) x;

alter table public.transport_orders disable trigger user;
alter table public.shipments disable trigger user;

update public.transport_orders o set order_code = m.new_code from tmp_code_map m where o.order_code = m.old_code;
update public.shipments s set shipment_code = m.new_code from tmp_code_map m where s.shipment_code = m.old_code;

alter table public.transport_orders enable trigger user;
alter table public.shipments enable trigger user;

-- Mã đơn ghi trong "Lập kế hoạch" (chuỗi "ORD-..., ORD-...") và nội dung thông báo cũ
create or replace function pg_temp.swap_codes(p_text text)
returns text
language plpgsql
as $f$
declare
  v_text text := p_text;
  v_code text;
begin
  if p_text is null then
    return null;
  end if;
  for v_code in select distinct (regexp_matches(p_text, '(?:SHP|ORD)-\d{8}-\d+', 'g'))[1] loop
    v_text := replace(v_text, v_code, coalesce((select new_code from tmp_code_map where old_code = v_code), v_code));
  end loop;
  return v_text;
end;
$f$;

alter table public.transport_plans disable trigger user;
update public.transport_plans set order_codes = pg_temp.swap_codes(order_codes) where order_codes ~ 'ORD-\d{8}-\d+';
alter table public.transport_plans enable trigger user;

alter table public.notifications disable trigger user;
update public.notifications
set title = pg_temp.swap_codes(title), body = pg_temp.swap_codes(body)
where coalesce(title, '') || ' ' || coalesce(body, '') ~ '(SHP|ORD)-\d{8}-\d+';
alter table public.notifications enable trigger user;

-- Bộ đếm tháng tiếp sau số lớn nhất đã dùng
insert into public.code_sequences as cs (scope, period, last_value)
select case left(new_code, 1) when 'S' then 'SHP' else 'ORD' end,
       'M-' || substr(new_code, 2, 3),
       max(substr(new_code, 6)::integer)
from tmp_code_map
group by 1, 2
on conflict (scope, period) do update set last_value = greatest(cs.last_value, excluded.last_value);

drop function pg_temp.swap_codes(text);
drop table tmp_code_map;
