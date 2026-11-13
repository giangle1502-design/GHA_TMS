-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Hủy đơn trả cont về Lập kế hoạch, khôi phục chuyến đã hủy
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('public.restore_shipment(uuid)') is not null then
    raise exception 'CSDL đã được nâng cấp Hủy đơn trả cont về Lập kế hoạch, khôi phục chuyến đã hủy trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261102000046_plan_return_restore.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0046: Kế hoạch ↔ hủy/khôi phục chuyến (khách hàng yêu cầu 02/11/2026)
--   * Hủy chuyến/đơn tạo từ kế hoạch: cont đó trở về Lập kế hoạch (chưa tạo đơn) để tích tạo lại hoặc xóa.
--     Hủy một phần: các cont bị hủy gom vào một dòng kế hoạch "trả về" (source_plan_id), kế hoạch gốc giữ các cont còn chạy.
--   * restore_shipment: khôi phục chuyến đã hủy về "Chưa phân công" (mở lại đơn nếu đơn đã hủy), cont lấy lại khỏi kế hoạch.
--   * Xóa kế hoạch chưa tạo đơn: chuyến đã hủy chỉ bỏ liên kết (không chặn xóa).
-- =============================================================================

alter table public.transport_plans
  add column if not exists source_plan_id uuid references public.transport_plans (id) on delete set null;
comment on column public.transport_plans.source_plan_id is 'Dòng kế hoạch trả về khi hủy một phần các cont của kế hoạch gốc';

alter table public.shipments drop constraint if exists shipments_plan_id_fkey;
alter table public.shipments add constraint shipments_plan_id_fkey
  foreign key (plan_id) references public.transport_plans (id) on delete set null;

-- Kế hoạch đã tạo đơn không xóa được (hủy đơn ở Điều phối thì kế hoạch trở về, khi đó mới xóa)
create or replace function private.transport_plans_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'ordered' and coalesce(current_setting('app.plan_ordering', true), '') <> 'on' then
    raise exception 'Kế hoạch % đã tạo đơn (%): hủy đơn ở Điều phối trước, kế hoạch sẽ trở về để xóa.', old.code, old.order_codes
      using errcode = '22023';
  end if;
  return old;
end;
$$;
drop trigger if exists trg_transport_plans_before_delete on public.transport_plans;
create trigger trg_transport_plans_before_delete before delete on public.transport_plans
for each row execute function private.transport_plans_before_delete();

-- Cập nhật số cont, mã đơn của kế hoạch đã tạo đơn theo các chuyến còn chạy
create or replace function private.plan_sync_ordered(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
  v_codes text;
begin
  select count(*), string_agg(distinct o.order_code, ', ')
    into v_n, v_codes
  from public.shipments s join public.transport_orders o on o.id = s.order_id
  where s.plan_id = p_plan_id and s.status <> 'cancelled';
  perform set_config('app.plan_ordering', 'on', true);
  update public.transport_plans
     set container_qty = greatest(v_n, 1), order_count = v_n, order_codes = v_codes
   where id = p_plan_id and status = 'ordered';
  perform set_config('app.plan_ordering', 'off', true);
end;
$$;
revoke all on function private.plan_sync_ordered(uuid) from public, anon, authenticated;

-- Chuyến từ kế hoạch bị hủy → cont trở về Lập kế hoạch
create or replace function private.shipments_plan_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.transport_plans;
  r public.transport_plans;
  v_active integer;
begin
  select * into p from public.transport_plans where id = new.plan_id for update;
  if p.id is null or p.status <> 'ordered' then
    return null;
  end if;
  select count(*) into v_active from public.shipments where plan_id = p.id and status <> 'cancelled';
  -- Dòng "trả về" đang chờ của kế hoạch này (nếu đã có thì gom vào)
  select * into r from public.transport_plans where source_plan_id = p.id and status = 'planned' order by created_at limit 1 for update;

  perform set_config('app.plan_ordering', 'on', true);
  if v_active = 0 then
    -- Hủy hết: kế hoạch gốc trở về chưa tạo đơn với đủ số cont đã hủy
    update public.transport_plans
       set status = 'planned', container_qty = 1 + coalesce(r.container_qty, 0),
           order_count = 0, order_codes = null, ordered_at = null, ordered_by = null, order_pickup_date = null
     where id = p.id;
    if r.id is not null then
      update public.shipments set plan_id = p.id where plan_id = r.id;
      delete from public.transport_plans where id = r.id;
    end if;
  else
    if r.id is null then
      insert into public.transport_plans (customer_id, delivery_date, vehicle_type_id, payer_customer_id, empty_return_location_id, supplier_id,
        offroute_return_location_id, container_qty, pickup_location_id, delivery_location_id, route_name, trip_order, pickup_phone, delivery_phone,
        notes, custom_fields, source_plan_id)
      values (p.customer_id, p.delivery_date, p.vehicle_type_id, p.payer_customer_id, p.empty_return_location_id, p.supplier_id,
        p.offroute_return_location_id, 1, p.pickup_location_id, p.delivery_location_id, p.route_name, p.trip_order, p.pickup_phone, p.delivery_phone,
        concat_ws(' · ', 'Trả về từ kế hoạch ' || p.code || ' do hủy đơn', p.notes), p.custom_fields, p.id)
      returning * into r;
    else
      update public.transport_plans set container_qty = container_qty + 1 where id = r.id;
    end if;
    update public.shipments set plan_id = r.id where id = new.id;
  end if;
  perform set_config('app.plan_ordering', 'off', true);
  perform private.plan_sync_ordered(p.id);
  return null;
end;
$$;
drop trigger if exists trg_shipments_plan_on_cancel on public.shipments;
create trigger trg_shipments_plan_on_cancel after update of status on public.shipments
for each row when (new.status = 'cancelled' and old.status <> 'cancelled' and new.plan_id is not null)
execute function private.shipments_plan_on_cancel();

-- Chuyển trạng thái: thêm "đã hủy → chưa phân công" chỉ qua restore_shipment
create or replace function private.shipment_transition_allowed(from_s text, to_s text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select from_s = to_s or (from_s, to_s) in (
    ('draft', 'assigned'), ('draft', 'cancelled'),
    ('assigned', 'accepted'), ('assigned', 'draft'), ('assigned', 'cancelled'),
    ('accepted', 'in_transit'), ('accepted', 'assigned'), ('accepted', 'draft'), ('accepted', 'cancelled'),
    ('in_transit', 'driver_completed'), ('in_transit', 'cancelled'),
    ('driver_completed', 'in_transit'), ('driver_completed', 'closed'),
    ('closed', 'driver_completed')
  ) or (from_s = 'cancelled' and to_s = 'draft' and coalesce(current_setting('app.shipment_restore', true), '') = 'on');
$$;

-- Khôi phục chuyến đã hủy: về "Chưa phân công" (bỏ xe, tài xế), mở lại đơn, lấy lại cont khỏi kế hoạch
create or replace function public.restore_shipment(p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  q public.transport_plans;
  parent public.transport_plans;
  v_code text;
begin
  if not (private.has_perm('dispatch.delete') or private.has_perm('shipments.delete')) then
    raise exception 'Bạn không có quyền khôi phục chuyến' using errcode = '42501';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = 'P0001';
  end if;
  if s.status <> 'cancelled' then
    raise exception 'Chuyến % không ở trạng thái đã hủy', s.shipment_code using errcode = '22023';
  end if;
  if s.receivable_id is not null then
    raise exception 'Chuyến % đã gắn công nợ, không khôi phục được', s.shipment_code using errcode = '22023';
  end if;

  -- Cont đã trở về kế hoạch: lấy lại (chặn nếu kế hoạch đó đã tạo đơn mới cho cont này)
  if s.plan_id is not null then
    select * into q from public.transport_plans where id = s.plan_id for update;
    if q.status = 'ordered' then
      raise exception 'Cont của chuyến % đã được tạo đơn lại từ kế hoạch % (%). Không khôi phục để tránh trùng đơn.', s.shipment_code, q.code, q.order_codes
        using errcode = '22023';
    end if;
  end if;

  update public.transport_orders set status = 'open' where id = s.order_id and status = 'cancelled';

  perform set_config('app.shipment_restore', 'on', true);
  update public.shipments
     set status = 'draft', driver_id = null, vehicle_id = null, vehicle_day_order = null,
         cancel_reason = null, cancelled_at = null, cancelled_by = null
   where id = s.id;
  perform set_config('app.shipment_restore', 'off', true);
  update public.shipment_status_history h set note = 'Khôi phục chuyến đã hủy'
   where h.id = (select max(id) from public.shipment_status_history where shipment_id = s.id and status_field = 'status' and to_status = 'draft');

  if q.id is not null and q.status = 'planned' then
    if q.source_plan_id is not null then
      select * into parent from public.transport_plans where id = q.source_plan_id for update;
    end if;
    perform set_config('app.plan_ordering', 'on', true);
    if parent.id is not null and parent.status = 'ordered' then
      -- Gắn lại vào kế hoạch gốc đang chạy
      update public.shipments set plan_id = parent.id where id = s.id;
      if q.container_qty <= 1 then
        if not exists (select 1 from public.shipments where plan_id = q.id) then
          delete from public.transport_plans where id = q.id;
        end if;
      else
        update public.transport_plans set container_qty = container_qty - 1 where id = q.id;
      end if;
      perform set_config('app.plan_ordering', 'off', true);
      perform private.plan_sync_ordered(parent.id);
    elsif q.container_qty <= 1 then
      select order_code into v_code from public.transport_orders where id = s.order_id;
      update public.transport_plans
         set status = 'ordered', ordered_at = now(), ordered_by = auth.uid(), order_pickup_date = (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date
       where id = q.id;
      perform set_config('app.plan_ordering', 'off', true);
      perform private.plan_sync_ordered(q.id);
    else
      update public.transport_plans set container_qty = container_qty - 1 where id = q.id;
      update public.shipments set plan_id = null where id = s.id;
      perform set_config('app.plan_ordering', 'off', true);
    end if;
  end if;

  return jsonb_build_object('shipment_code', s.shipment_code);
end;
$$;
revoke all on function public.restore_shipment(uuid) from public, anon;
grant execute on function public.restore_shipment(uuid) to authenticated;

commit;
