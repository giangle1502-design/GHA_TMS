-- =============================================================================
-- GHA 9036: CƯỚC XE GHÉP TÍNH THEO MÃ CHUYẾN (một giá cho cả xe), không theo từng đơn
--   LE 21/11/2026: "Cước thì phải theo mã chuyến, không phải theo số đơn hàng".
--   * Nhóm xe tính giá theo chuyến (ĐVT chuyến): chuyến đầu của nhóm (mã nhỏ nhất) giữ đơn giá cước,
--     các chuyến ghép thêm về 0 (đơn giá, phụ phí bảng giá, hỗ trợ dầu). Phí chi hộ, bốc xếp... từng đơn giữ nguyên.
--     Nhóm tính theo tấn / km (VD 3PL chia đơn lớn) giữ cước từng đơn như cũ.
--   * Số cont, thứ tự xe trong ngày, số ngày giao: một giá trị cho cả nhóm (sửa ở chuyến nào cũng chép sang chuyến còn lại).
--   * Áp dụng cho nhóm đang có. Chuyến đã lập công nợ thì không đổi cước (báo NOTICE).
--   Chạy lại nhiều lần không sao.
-- =============================================================================

-- Chuẩn hóa một nhóm: cước theo chuyến dồn về chuyến đầu, chép số cont / thứ tự xe / số ngày giao của chuyến đầu
create or replace function private.load_group_normalize(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  head public.shipments;
  v_trip boolean;
begin
  if p_group is null then
    return;
  end if;
  select * into head from public.shipments
  where load_group_id = p_group and status <> 'cancelled'
  order by shipment_code limit 1;
  if head.id is null then
    return;
  end if;
  select bool_and(pricing_unit = 'trip') into v_trip
  from public.shipments where load_group_id = p_group and status <> 'cancelled';

  perform set_config('app.load_group_sync', 'on', true);
  update public.shipments s
     set container_no = coalesce(head.container_no, s.container_no),
         vehicle_day_order = coalesce(head.vehicle_day_order, s.vehicle_day_order),
         delivery_days = coalesce(head.delivery_days, s.delivery_days)
   where s.load_group_id = p_group and s.id <> head.id and s.status <> 'cancelled'
     and (s.container_no, s.vehicle_day_order, s.delivery_days)
         is distinct from (coalesce(head.container_no, s.container_no), coalesce(head.vehicle_day_order, s.vehicle_day_order), coalesce(head.delivery_days, s.delivery_days));

  if v_trip then
    update public.shipments s
       set unit_price = 0, surcharge_amount = 0, fuel_support_amount = 0
     where s.load_group_id = p_group and s.id <> head.id and s.status <> 'cancelled'
       and s.receivable_id is null
       and (s.unit_price <> 0 or s.surcharge_amount <> 0 or s.fuel_support_amount <> 0);
  end if;
  perform set_config('app.load_group_sync', 'off', true);
end;
$$;
revoke all on function private.load_group_normalize(uuid) from public, anon, authenticated;

-- Sửa số cont / thứ tự xe / số ngày giao ở một chuyến trong nhóm: chép sang các chuyến cùng nhóm
create or replace function private.load_group_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.load_group_id is null or coalesce(current_setting('app.load_group_sync', true), 'off') = 'on' then
    return null;
  end if;
  perform set_config('app.load_group_sync', 'on', true);
  update public.shipments s
     set container_no = new.container_no,
         vehicle_day_order = new.vehicle_day_order,
         delivery_days = new.delivery_days
   where s.load_group_id = new.load_group_id and s.id <> new.id and s.status <> 'cancelled'
     and (s.container_no, s.vehicle_day_order, s.delivery_days) is distinct from (new.container_no, new.vehicle_day_order, new.delivery_days);
  perform set_config('app.load_group_sync', 'off', true);
  return null;
end;
$$;
drop trigger if exists trg_shipments_load_group_sync on public.shipments;
create trigger trg_shipments_load_group_sync
after update of container_no, vehicle_day_order, delivery_days on public.shipments
for each row
when (new.load_group_id is not null and (old.container_no, old.vehicle_day_order, old.delivery_days) is distinct from (new.container_no, new.vehicle_day_order, new.delivery_days))
execute function private.load_group_sync();

-- Ghép chung xe: như 9035, thêm chuẩn hóa cước theo mã chuyến
create or replace function public.set_shipment_load_group(p_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_n int;
  v_found int;
  v_vehicles int;
  v_days int;
  v_group uuid;
  v_order smallint;
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('dispatch.create')) then
    raise exception 'Bạn không có quyền điều phối chuyến' using errcode = '42501';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_ids, '{}'::uuid[])) x where x is not null;
  v_n := coalesce(cardinality(v_ids), 0);
  if v_n < 2 then
    raise exception 'Chọn ít nhất 2 chuyến để ghép chung xe' using errcode = '22023';
  end if;
  if v_n > 20 then
    raise exception 'Mỗi lần ghép tối đa 20 chuyến' using errcode = '22023';
  end if;
  perform 1 from public.shipments where id = any(v_ids) order by id for update;
  select count(*), count(distinct vehicle_id), count(distinct (pickup_at at time zone 'Asia/Ho_Chi_Minh')::date)
    into v_found, v_vehicles, v_days
  from public.shipments where id = any(v_ids) and status <> 'cancelled';
  if v_found <> v_n then
    raise exception 'Có chuyến không tồn tại hoặc đã hủy' using errcode = '22023';
  end if;
  if exists (select 1 from public.shipments where id = any(v_ids) and vehicle_id is null) then
    raise exception 'Chọn số xe cho các chuyến trước khi ghép chung xe' using errcode = '22023';
  end if;
  if v_vehicles <> 1 then
    raise exception 'Các chuyến ghép phải cùng một số xe' using errcode = '22023';
  end if;
  if v_days <> 1 then
    raise exception 'Các chuyến ghép phải cùng ngày nhận hàng' using errcode = '22023';
  end if;

  -- Giữ nhóm đã có (VD nhóm 3PL tạo ở cổng nhà xe); nhiều nhóm thì gộp về một
  select load_group_id into v_group from public.shipments
  where id = any(v_ids) and load_group_id is not null order by pickup_at, shipment_code limit 1;
  v_group := coalesce(v_group, gen_random_uuid());
  select min(vehicle_day_order) into v_order from public.shipments where id = any(v_ids);

  update public.shipments s
     set load_group_id = v_group,
         vehicle_day_order = coalesce(v_order, s.vehicle_day_order)
   where (s.id = any(v_ids)
          or s.load_group_id in (select g.load_group_id from public.shipments g where g.id = any(v_ids) and g.load_group_id is not null))
     and s.status <> 'cancelled'
     and (s.load_group_id, s.vehicle_day_order) is distinct from (v_group, coalesce(v_order, s.vehicle_day_order));
  perform private.load_group_normalize(v_group);
  return v_group;
end;
$$;

-- Áp dụng cho các nhóm xe đang có
do $$
declare
  g uuid;
  n int := 0;
begin
  for g in select distinct load_group_id from public.shipments where load_group_id is not null and status <> 'cancelled' loop
    perform private.load_group_normalize(g);
    n := n + 1;
  end loop;
  if exists (select 1 from public.shipments s where s.load_group_id is not null and s.receivable_id is not null and s.status <> 'cancelled'
             and s.id <> (select h.id from public.shipments h where h.load_group_id = s.load_group_id and h.status <> 'cancelled' order by h.shipment_code limit 1)
             and s.unit_price <> 0 and s.pricing_unit = 'trip') then
    raise notice 'Có chuyến ghép đã lập công nợ nên chưa đưa cước về 0. Hủy phiếu công nợ rồi chạy lại nếu cần.';
  end if;
  raise notice 'Đã chuẩn hóa % nhóm xe ghép.', n;
end $$;
