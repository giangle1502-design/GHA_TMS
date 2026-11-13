-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Giai đoạn 5a (tài xế nhận chuyến qua link)
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('public.driver_link_login(text)') is not null then
    raise exception 'CSDL đã được nâng cấp Giai đoạn 5a (tài xế nhận chuyến qua link) trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261021000014_driver_link.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0014: Tài xế nhận chuyến qua link, không cần tài khoản
-- Tài xế mở link /tx và nhập biển số xe (khách hàng đã chọn chỉ cần số xe,
-- chấp nhận rằng ai biết biển số cũng xem và nhận được chuyến của xe đó).
-- Máy được nhớ 30 ngày bằng một mã phiên ngẫu nhiên (cookie httpOnly); CSDL chỉ
-- lưu mã băm SHA-256. Hàm chỉ trả về chuyến của đúng xe trong phiên, không có giá/doanh thu.
-- =============================================================================

create table private.driver_link_sessions (
  token_hash bytea primary key,
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index driver_link_sessions_vehicle_idx on private.driver_link_sessions (vehicle_id);

create or replace function private.plate_key(p text)
returns text
language sql
immutable
set search_path = ''
as $$ select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- Phiên hợp lệ -> vehicle_id; không hợp lệ -> không có dòng nào
create or replace function private.driver_link_session(p_token text)
returns table (vehicle_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
begin
  if p_token is null or length(p_token) < 32 then
    return;
  end if;
  v_hash := sha256(convert_to(p_token, 'UTF8'));
  return query
    update private.driver_link_sessions s
       set last_seen_at = now()
     where s.token_hash = v_hash and s.revoked_at is null and s.expires_at > now()
       and exists (select 1 from public.vehicles v where v.id = s.vehicle_id and v.archived_at is null)
    returning s.vehicle_id;
end;
$$;

-- Chuyến mà xe trong phiên được thấy: chuyến chạy bằng xe này, hoặc chuyến
-- giao cho tài xế mặc định của xe (khi điều phối chưa chọn xe).
create or replace function private.driver_link_visible(p_vehicle_id uuid, p_shipment public.shipments)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_shipment.driver_id is not null and (
    p_shipment.vehicle_id = p_vehicle_id
    or (p_shipment.vehicle_id is null and p_shipment.driver_id =
          (select v.assigned_driver_id from public.vehicles v where v.id = p_vehicle_id))), false);
$$;

-- -----------------------------------------------------------------------------
-- Mở bằng biển số xe. Trả về jsonb {ok, token, plate} hoặc {ok:false, error}
-- -----------------------------------------------------------------------------
create or replace function public.driver_link_login(p_plate text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := private.plate_key(p_plate);
  v_vehicle public.vehicles;
  v_token text;
begin
  if length(v_key) < 5 then
    return jsonb_build_object('ok', false, 'error', 'Nhập đủ biển số xe, ví dụ 51C-123.45.');
  end if;
  select * into v_vehicle from public.vehicles v
   where private.plate_key(v.plate_number) = v_key and v.archived_at is null;
  if v_vehicle.id is null then
    return jsonb_build_object('ok', false, 'error', 'Không tìm thấy xe có biển số này. Kiểm tra lại hoặc gọi điều phối.');
  end if;

  delete from private.driver_link_sessions where expires_at < now() - interval '30 days';
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into private.driver_link_sessions (token_hash, vehicle_id, expires_at)
  values (sha256(convert_to(v_token, 'UTF8')), v_vehicle.id, now() + interval '30 days');
  return jsonb_build_object('ok', true, 'token', v_token, 'plate', v_vehicle.plate_number);
end;
$$;

create or replace function public.driver_link_me(p_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('plate', v.plate_number, 'driver_name', d.full_name)
  from private.driver_link_session(p_token) s
  join public.vehicles v on v.id = s.vehicle_id
  left join public.drivers d on d.id = v.assigned_driver_id;
$$;

create or replace function public.driver_link_logout(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.driver_link_sessions set revoked_at = now()
   where p_token is not null and token_hash = sha256(convert_to(p_token, 'UTF8')) and revoked_at is null;
$$;

-- Chuyến của xe trong phiên: chờ nhận, đã nhận, đang chạy và chuyến xong trong 3 ngày gần nhất
create or replace function public.driver_link_trips(p_token text)
returns table (
  shipment_id uuid,
  shipment_code text,
  status text,
  pickup_at timestamptz,
  expected_delivery_at timestamptz,
  plate_number text,
  vehicle_type_name text,
  quantity numeric,
  notes text,
  pickup_name text,
  pickup_address text,
  pickup_contact text,
  pickup_phone text,
  pickup_maps_url text,
  pickup_gate_instructions text,
  delivery_name text,
  delivery_address text,
  delivery_contact text,
  delivery_phone text,
  delivery_maps_url text,
  delivery_gate_instructions text,
  driver_name text,
  accepted_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select s.id, s.shipment_code, s.status, s.pickup_at, s.expected_delivery_at,
         v.plate_number, vt.name, s.quantity, s.notes,
         pl.name, pl.full_address, pl.contact_name, pl.phone,
         coalesce(pl.google_maps_url, case when pl.latitude is not null then
           'https://www.google.com/maps/search/?api=1&query=' || pl.latitude || ',' || pl.longitude end),
         pl.gate_instructions,
         dl.name, dl.full_address, dl.contact_name, dl.phone,
         coalesce(dl.google_maps_url, case when dl.latitude is not null then
           'https://www.google.com/maps/search/?api=1&query=' || dl.latitude || ',' || dl.longitude end),
         dl.gate_instructions,
         d.full_name, a.responded_at
  from private.driver_link_session(p_token) me
  join public.shipments s on private.driver_link_visible(me.vehicle_id, s)
  join public.drivers d on d.id = s.driver_id
  join public.locations pl on pl.id = s.pickup_location_id
  join public.locations dl on dl.id = s.delivery_location_id
  left join public.vehicles v on v.id = s.vehicle_id
  left join public.vehicle_types vt on vt.id = s.vehicle_type_id
  left join public.shipment_assignments a
    on a.shipment_id = s.id and a.driver_id = s.driver_id and a.response = 'accepted'
  where (s.status in ('assigned', 'accepted', 'in_transit')
     or (s.status in ('driver_completed', 'closed') and s.pickup_at > now() - interval '3 days'))
  order by (s.status = 'assigned') desc, s.pickup_at
  limit 100;
$$;

-- Tài xế bấm "Nhận đơn"
create or replace function public.driver_link_accept(p_token text, p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_s public.shipments;
  v_a public.shipment_assignments;
  v_name text;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  select * into v_s from public.shipments where id = p_shipment_id for update;
  if v_s.id is null or not private.driver_link_visible(v_me.vehicle_id, v_s) then
    return jsonb_build_object('ok', false, 'error', 'Chuyến này không còn được phân công cho xe của bạn. Tải lại trang để xem.');
  end if;
  if v_s.status = 'accepted' then
    return jsonb_build_object('ok', true);
  end if;
  if v_s.status <> 'assigned' then
    return jsonb_build_object('ok', false, 'error', 'Chuyến không còn ở trạng thái chờ nhận.');
  end if;
  select * into v_a from public.shipment_assignments
   where shipment_id = v_s.id and driver_id = v_s.driver_id and response = 'pending' for update;
  if v_a.id is null then
    return jsonb_build_object('ok', false, 'error', 'Chuyến không còn ở trạng thái chờ nhận.');
  end if;

  update public.shipment_assignments set response = 'accepted', responded_at = now() where id = v_a.id;
  update public.shipments set status = 'accepted' where id = v_s.id;

  select full_name into v_name from public.drivers where id = v_s.driver_id;
  update public.shipment_status_history h
     set note = v_name || ' nhận chuyến trên điện thoại'
   where h.id = (select max(id) from public.shipment_status_history
                  where shipment_id = v_s.id and status_field = 'status' and to_status = 'accepted');

  if v_a.assigned_by is not null then
    insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, link)
    values (v_a.assigned_by, 'shipment_accepted', 'Tài xế ' || v_name || ' đã nhận chuyến ' || v_s.shipment_code,
            null, 'shipment', v_s.id, '/chuyen-xe/' || v_s.id);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function private.driver_link_session(text) from public, anon, authenticated;
revoke all on function private.driver_link_visible(uuid, public.shipments) from public, anon, authenticated;
revoke all on function public.driver_link_login(text) from public;
revoke all on function public.driver_link_me(text) from public;
revoke all on function public.driver_link_logout(text) from public;
revoke all on function public.driver_link_trips(text) from public;
revoke all on function public.driver_link_accept(text, uuid) from public;
grant execute on function public.driver_link_login(text) to anon, authenticated;
grant execute on function public.driver_link_me(text) to anon, authenticated;
grant execute on function public.driver_link_logout(text) to anon, authenticated;
grant execute on function public.driver_link_trips(text) to anon, authenticated;
grant execute on function public.driver_link_accept(text, uuid) to anon, authenticated;

commit;
