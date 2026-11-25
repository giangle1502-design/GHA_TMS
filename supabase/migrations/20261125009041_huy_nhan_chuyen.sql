-- =============================================================================
-- GHA 9041: HỦY NHẬN CHUYẾN, GIAO LẠI CHO NHÀ XE 3PL KHÁC (25/11/2026)
--   LE: tài xế / nhà xe đã nhận chuyến nhưng không đi → điều phối hủy việc nhận chuyến rồi
--   chỉ định 3PL khác.
--   * release_shipment(chuyến, lý do, nhà xe mới, xóa chi phí 3PL cũ):
--       - Chuyến Chờ tài xế nhận / Tài xế đã nhận / Đang chạy (hoặc Nháp đã gắn nhà xe, số xe):
--         gỡ xe, rơ moóc, tài xế, phân công; chuyến về Nháp. KHÔNG xóa đơn / chuyến.
--       - Nhà xe mới (không bắt buộc): ghi vào chuyến, số xe nhập sau như bình thường.
--       - Đổi nhà xe mà chuyến đã có chi phí 3PL của nhà xe cũ: mặc định xóa các khoản đó
--         (nhà xe cũ không chạy) và hủy công nợ phải trả; đã trả tiền thì báo lỗi.
--       - Chuyến ghép chung xe (load_group_id): hủy nhận cả nhóm, nhóm giữ nguyên.
--       - Tài xế cũ không còn thấy chuyến trên app (chuyến không còn tài xế, phân công cũ = superseded).
--       - Bắt buộc lý do; lưu vào bảng shipment_releases (ai hủy, lúc nào, tài xế / xe / 3PL cũ, 3PL mới)
--         và ghi chú ở Lịch sử trạng thái.
--   Chạy lại nhiều lần không sao.
-- =============================================================================

-- 1. Nhật ký hủy nhận chuyến -----------------------------------------------------
create table if not exists public.shipment_releases (
  id uuid primary key default gen_random_uuid(),
  -- Không khóa ngoại tới shipments để "Xóa dữ liệu thử" (truncate shipments) vẫn chạy; dòng mồ côi vô hại
  shipment_id uuid not null,
  from_status text not null,
  old_driver_id uuid references public.drivers (id) on delete set null,
  old_vehicle_id uuid references public.vehicles (id) on delete set null,
  old_carrier_supplier_id uuid references public.suppliers (id) on delete set null,
  new_carrier_supplier_id uuid references public.suppliers (id) on delete set null,
  old_driver_name text,
  old_plate text,
  old_carrier_name text,
  new_carrier_name text,
  carrier_costs_removed numeric(18, 2) not null default 0,
  reason text not null check (length(trim(reason)) between 3 and 500),
  released_by uuid default auth.uid(),
  released_at timestamptz not null default now()
);
comment on table public.shipment_releases is 'Hủy nhận chuyến: tài xế / nhà xe 3PL đã nhận nhưng không đi, điều phối gỡ ra để giao lại (GHA 9041)';
create index if not exists shipment_releases_shipment_idx on public.shipment_releases (shipment_id, released_at desc);

alter table public.shipment_releases enable row level security;
drop policy if exists shipment_releases_select on public.shipment_releases;
create policy shipment_releases_select on public.shipment_releases for select to authenticated
  using ((select private.has_perm('dispatch.view')) or (select private.has_perm('dispatch.update')) or (select private.has_perm('shipments.view')));
revoke all on public.shipment_releases from anon;
revoke insert, update, delete on public.shipment_releases from authenticated;
grant select on public.shipment_releases to authenticated;

-- 2. Chuyển trạng thái: thêm "Đang chạy -> Nháp" chỉ qua release_shipment ------------
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
  ) or (from_s = 'cancelled' and to_s = 'draft' and coalesce(current_setting('app.shipment_restore', true), '') = 'on')
    or (from_s = 'in_transit' and to_s = 'assigned' and coalesce(current_setting('app.shipment_unaccept', true), '') = 'on')
    or (from_s = 'in_transit' and to_s = 'draft' and coalesce(current_setting('app.shipment_release', true), '') = 'on');
$$;

-- 3. Hủy nhận chuyến ----------------------------------------------------------------
create or replace function public.release_shipment(
  p_shipment_id uuid, p_reason text, p_supplier_id uuid default null, p_clear_carrier_costs boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s0 public.shipments;
  s public.shipments;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_new_sup public.suppliers;
  v_ids uuid[];
  v_codes text[] := '{}';
  v_note text;
  v_removed numeric;
  v_total_removed numeric := 0;
  v_hist bigint;
begin
  if not private.has_perm('dispatch.update') then
    raise exception 'Bạn không có quyền điều phối chuyến' using errcode = '42501';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Nhập lý do hủy nhận chuyến (ít nhất 3 ký tự), ví dụ: Tài xế nhận nhưng không đi' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Lý do tối đa 500 ký tự' using errcode = '22023';
  end if;
  select * into s0 from public.shipments where id = p_shipment_id;
  if s0.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = 'P0001';
  end if;
  if p_supplier_id is not null then
    select * into v_new_sup from public.suppliers where id = p_supplier_id and status = 'active';
    if v_new_sup.id is null then
      raise exception 'Nhà xe 3PL mới không tồn tại hoặc ngừng hoạt động' using errcode = '22023';
    end if;
  end if;

  -- Chuyến ghép chung xe: hủy nhận cả nhóm (một xe, một lượt)
  if s0.load_group_id is not null then
    select array_agg(id order by shipment_code) into v_ids
    from public.shipments where load_group_id = s0.load_group_id and status <> 'cancelled';
  else
    v_ids := array[s0.id];
  end if;

  v_note := 'Hủy nhận chuyến: ' || v_reason;
  perform set_config('gha.audit_reason', v_note, true);
  perform set_config('app.shipment_release', 'on', true);

  for s in select * from public.shipments where id = any (v_ids) order by shipment_code for update loop
    if s.status not in ('draft', 'assigned', 'accepted', 'in_transit') then
      raise exception 'Chuyến % đã giao xong hoặc đã hủy, không hủy nhận được. Chuyến đã giao mà nhập sai thì dùng nút Sửa xe, TX, 3PL.', s.shipment_code
        using errcode = '22023';
    end if;
    if s.status = 'draft' and s.driver_id is null and s.vehicle_id is null and s.carrier_supplier_id is null then
      continue; -- chưa ai nhận
    end if;

    -- Chi phí 3PL của nhà xe cũ (nhà xe cũ không chạy)
    v_removed := 0;
    if s.carrier_supplier_id is not null and s.carrier_supplier_id is distinct from p_supplier_id and coalesce(p_clear_carrier_costs, true) then
      select coalesce(sum(amount), 0) into v_removed from public.shipment_carrier_costs where shipment_id = s.id;
      if v_removed > 0 then
        delete from public.shipment_carrier_costs where shipment_id = s.id;
      end if;
    end if;
    v_total_removed := v_total_removed + v_removed;

    insert into public.shipment_releases (
      shipment_id, from_status, old_driver_id, old_vehicle_id, old_carrier_supplier_id, new_carrier_supplier_id,
      old_driver_name, old_plate, old_carrier_name, new_carrier_name, carrier_costs_removed, reason
    )
    select s.id, s.status, s.driver_id, s.vehicle_id, s.carrier_supplier_id, p_supplier_id,
           (select full_name from public.drivers where id = s.driver_id),
           (select plate_number from public.vehicles where id = s.vehicle_id),
           (select name from public.suppliers where id = s.carrier_supplier_id),
           v_new_sup.name, v_removed, v_reason;

    update public.shipment_assignments set response = 'superseded', responded_at = now()
     where shipment_id = s.id and response in ('pending', 'accepted');

    update public.shipments
       set status = 'draft', driver_id = null, vehicle_id = null, trailer_id = null,
           vehicle_day_order = null, arrived_pickup_at = null, departed_pickup_at = null,
           carrier_supplier_id = p_supplier_id
     where id = s.id;

    -- Công nợ phải trả 3PL đi theo nhà xe mới / hủy khi không còn chi phí
    if s.carrier_supplier_id is distinct from p_supplier_id then
      perform private.sync_carrier_payable(s.id);
    end if;

    -- Ghi chú vào Lịch sử trạng thái (chuyến đang Nháp thì thêm dòng mới)
    if s.status = 'draft' then
      insert into public.shipment_status_history (shipment_id, status_field, from_status, to_status, changed_by, note)
      values (s.id, 'status', 'draft', 'draft', auth.uid(), v_note);
    else
      select max(id) into v_hist from public.shipment_status_history
       where shipment_id = s.id and status_field = 'status' and to_status = 'draft';
      update public.shipment_status_history set note = v_note where id = v_hist;
    end if;
    v_codes := v_codes || s.shipment_code;
  end loop;

  perform set_config('app.shipment_release', '', true);
  perform set_config('gha.audit_reason', '', true);

  if cardinality(v_codes) = 0 then
    raise exception 'Chuyến chưa có tài xế, xe hoặc nhà xe nào nhận, không cần hủy nhận' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'codes', to_jsonb(v_codes), 'new_carrier', v_new_sup.name,
                            'carrier_costs_removed', v_total_removed);
end;
$$;
revoke all on function public.release_shipment(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.release_shipment(uuid, text, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
