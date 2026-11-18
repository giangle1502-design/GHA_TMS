-- =============================================================================
-- GHA 9030: CỔNG NHÀ XE 3PL – 3PL TỰ ĐĂNG KÝ XE, CHIA ĐƠN LỚN THÀNH NHIỀU XE
--   * Tài khoản 3PL = vai trò carrier_3pl "Nhà xe 3PL" + gắn với một hay nhiều nhà xe
--     (bảng public.user_suppliers, gán ở trang Người dùng). Dùng chung với migration kho 9025
--     (3PL xem tồn kho GHA1/GHA2): bảng, vai trò, hàm đều "nếu chưa có" để chạy theo thứ tự nào cũng được.
--   * Quyền mới carrier_portal.use: chỉ vào trang /nha-xe. Tài khoản 3PL KHÔNG có quyền đọc bảng gốc
--     (chuyến, đơn, giá...): mọi dữ liệu đi qua 2 hàm dưới, chỉ có cột cần cho 3PL,
--     KHÔNG có cước, đơn giá, khách hàng, và chỉ chuyến được chỉ định cho nhà xe của họ.
--   * carrier_portal_shipments(): danh sách chuyến của nhà xe (kèm mã hàng, số lượng, số xe, tài xế).
--   * carrier_register_vehicles(chuyến, dòng xe): 3PL nhập số xe + số lượng từng xe.
--       - Tổng số lượng từng mã hàng không vượt số lượng của chuyến.
--       - Đủ số lượng: dòng 1 ghi vào chính chuyến, các dòng sau thành chuyến mới cùng đơn.
--       - Chưa đủ: mỗi dòng thành chuyến mới, chuyến gốc giữ phần còn lại (chưa có xe) để đăng ký tiếp.
--       - Không nhập tài xế: ghi tài xế "Tài xế & 3PL" (một tài xế đại diện cho mỗi nhà xe).
--       - Chuyến mới chép điểm nhận/giao, ngày, loại xe, đơn giá; tính theo tấn thì số tấn chia theo số lượng.
--         Phụ thu, phí, chi phí 3PL KHÔNG chép (tránh tính trùng): điều phối kiểm lại cước trên chuyến mới.
--   * Nhân viên GHA có quyền dispatch.update cũng dùng được trang này (chọn nhà xe để xem / chia hộ).
-- =============================================================================

-- 1. Tài khoản ↔ nhà xe 3PL (chung với 9025) -------------------------------------
do $$
begin
  if to_regclass('public.user_suppliers') is null then
    create table public.user_suppliers (
      user_id uuid not null references public.profiles (id) on delete cascade,
      supplier_id uuid not null references public.suppliers (id) on delete cascade,
      created_at timestamptz not null default now(),
      created_by uuid references public.profiles (id) default auth.uid(),
      primary key (user_id, supplier_id)
    );
    create index user_suppliers_supplier_idx on public.user_suppliers (supplier_id);
    comment on table public.user_suppliers is 'Tài khoản nhà xe 3PL được làm việc với những nhà xe nào';
    create trigger trg_user_suppliers_audit after insert or update or delete on public.user_suppliers
      for each row execute function private.audit_row_change('user_id');
    alter table public.user_suppliers enable row level security;
    create policy user_suppliers_select on public.user_suppliers for select to authenticated
      using (user_id = (select auth.uid()) or (select private.has_perm('users.view')));
    create policy user_suppliers_insert on public.user_suppliers for insert to authenticated
      with check ((select private.has_perm('users.configure')) and user_id <> (select auth.uid()));
    create policy user_suppliers_delete on public.user_suppliers for delete to authenticated
      using ((select private.has_perm('users.configure')) and user_id <> (select auth.uid()));
    revoke all on public.user_suppliers from anon;
    grant select, insert, delete on public.user_suppliers to authenticated;
  end if;
end $$;

insert into public.roles (code, name, description, is_system, sort_order)
values ('carrier_3pl', 'Nhà xe 3PL',
        'Tài khoản của nhà xe 3PL: xem chuyến được chỉ định cho nhà xe (gắn ở trang Người dùng), tự đăng ký số xe, tài xế, chia đơn lớn thành nhiều xe. Không thấy cước, đơn giá, chuyến của nhà xe khác.',
        true, 92)
on conflict (code) do nothing;

create or replace function private.my_supplier_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select us.supplier_id from public.user_suppliers us where us.user_id = auth.uid()
$$;

create or replace function private.is_supplier_scoped() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and not private.is_super_admin(auth.uid())
     and (
       exists (select 1 from public.user_suppliers us where us.user_id = auth.uid())
       or exists (
         select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
         where ur.user_id = auth.uid() and r.code = 'carrier_3pl'
       )
     )
$$;
revoke all on function private.my_supplier_ids(), private.is_supplier_scoped() from public, anon;
grant execute on function private.my_supplier_ids(), private.is_supplier_scoped() to authenticated;

-- 2. Quyền cổng 3PL ---------------------------------------------------------------
insert into public.permissions (code, module, action, name, description, sort_order) values
  ('carrier_portal.use', 'carrier_portal', 'use', 'Cổng nhà xe 3PL',
   'Tài khoản 3PL: xem chuyến được chỉ định cho nhà xe của mình, đăng ký số xe, tài xế, chia đơn thành nhiều xe. Không thấy cước.', 2740)
on conflict (code) do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, 'carrier_portal.use' from public.roles r where r.code = 'carrier_3pl'
on conflict do nothing;

-- Chuyến tách ra từ chuyến nào (để điều phối lần lại)
alter table public.shipments add column if not exists split_from_id uuid references public.shipments (id) on delete set null;
comment on column public.shipments.split_from_id is 'Chuyến gốc khi nhà xe 3PL (hoặc điều phối) chia đơn lớn thành nhiều xe';

-- 3. Tách phần ghi của phân công khỏi phần kiểm quyền -------------------------------
--    (để cổng 3PL dùng lại đúng logic tìm/thêm xe, tài xế 3PL; hàm public giữ nguyên chữ ký và quyền)
create or replace function private.assign_shipment_core(p_shipment_id uuid, p_driver_id uuid, p_vehicle_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  s public.shipments;
  a public.shipment_assignments;
  v_driver_status text;
begin
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = 'P0001';
  end if;
  if s.status not in ('draft', 'assigned', 'accepted') then
    raise exception 'Chỉ phân công được chuyến chưa chạy (Nháp, Chờ tài xế nhận, Tài xế đã nhận)' using errcode = '22023';
  end if;
  if p_driver_id is not null then
    select status into v_driver_status from public.drivers where id = p_driver_id and archived_at is null;
    if v_driver_status is null then
      raise exception 'Tài xế không tồn tại hoặc đã lưu trữ' using errcode = 'P0001';
    end if;
    if v_driver_status <> 'active' then
      raise exception 'Tài xế không ở trạng thái đang làm việc' using errcode = '22023';
    end if;
  end if;
  if p_vehicle_id is not null and not exists (
    select 1 from public.vehicles v where v.id = p_vehicle_id and v.archived_at is null and v.status in ('active', 'maintenance')
  ) then
    raise exception 'Xe không tồn tại hoặc đã ngừng hoạt động' using errcode = 'P0001';
  end if;

  select * into a from public.shipment_assignments where shipment_id = s.id and response in ('pending', 'accepted');

  -- Cùng tài xế: chỉ đổi xe, giữ phân công
  if p_driver_id is not null and a.id is not null and a.driver_id = p_driver_id then
    update public.shipment_assignments set vehicle_id = p_vehicle_id where id = a.id;
    update public.shipments set vehicle_id = p_vehicle_id, driver_id = p_driver_id,
      status = case when status = 'draft' then 'assigned' else status end
    where id = s.id;
    return;
  end if;

  if a.id is not null then
    update public.shipment_assignments set response = 'superseded', responded_at = now() where id = a.id;
  end if;

  if p_driver_id is null then
    update public.shipments set driver_id = null, vehicle_id = p_vehicle_id, status = 'draft' where id = s.id;
  else
    insert into public.shipment_assignments (shipment_id, driver_id, vehicle_id, assigned_by)
    values (s.id, p_driver_id, p_vehicle_id, auth.uid());
    update public.shipments set driver_id = p_driver_id, vehicle_id = p_vehicle_id, status = 'assigned' where id = s.id;
  end if;
end;
$$;
revoke all on function private.assign_shipment_core(uuid, uuid, uuid) from public, anon;
grant execute on function private.assign_shipment_core(uuid, uuid, uuid) to authenticated;

create or replace function public.assign_shipment(p_shipment_id uuid, p_driver_id uuid, p_vehicle_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not private.has_perm('dispatch.update') then
    raise exception 'Bạn không có quyền phân công chuyến' using errcode = '42501';
  end if;
  perform private.assign_shipment_core(p_shipment_id, p_driver_id, p_vehicle_id);
end;
$$;

create or replace function private.assign_shipment_3pl_core(
  p_shipment_id uuid, p_supplier_id uuid, p_plate text, p_driver_name text, p_driver_phone text,
  p_national_id text, p_license_no text, p_placeholder_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  v_sup public.suppliers;
  v_plate text := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  v_name text := nullif(left(trim(regexp_replace(coalesce(p_driver_name, ''), '\s+', ' ', 'g')), 150), '');
  v_phone text := nullif(left(regexp_replace(coalesce(p_driver_phone, ''), '[^0-9+]', '', 'g'), 20), '');
  v_nid text := nullif(left(regexp_replace(coalesce(p_national_id, ''), '\s', '', 'g'), 20), '');
  v_lic text := nullif(left(regexp_replace(coalesce(p_license_no, ''), '\s', '', 'g'), 30), '');
  v_vehicle public.vehicles;
  v_driver uuid;
  v_placeholder boolean := false;
  v_ph_name text;
begin
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = 'P0001';
  end if;
  if s.status not in ('draft', 'assigned', 'accepted') then
    raise exception 'Chỉ phân công được chuyến chưa chạy (Nháp, Chờ tài xế nhận, Tài xế đã nhận)' using errcode = '22023';
  end if;
  select * into v_sup from public.suppliers where id = p_supplier_id;
  if v_sup.id is null then
    raise exception 'Chọn nhà xe 3PL' using errcode = '22023';
  end if;
  if v_plate <> '' and length(v_plate) < 4 then
    raise exception 'Số xe chưa đúng (ví dụ 61K31295)' using errcode = '22023';
  end if;

  -- Xe: tìm theo số xe, chưa có thì thêm xe Thuê ngoài 3PL của nhà xe
  if v_plate <> '' then
    select * into v_vehicle from public.vehicles
    where upper(regexp_replace(plate_number, '[^A-Za-z0-9]', '', 'g')) = v_plate;
    if v_vehicle.id is null then
      insert into public.vehicles (code, plate_number, ownership_type, supplier_id, status, vehicle_type_id, created_by, updated_by)
      values ('', v_plate, 'outsourced', v_sup.id, 'active', s.vehicle_type_id, auth.uid(), auth.uid())
      returning * into v_vehicle;
    elsif v_vehicle.ownership_type <> 'outsourced' and v_vehicle.supplier_id is null then
      raise exception 'Xe % là xe nội bộ, chọn ở mục Xe nội bộ', v_vehicle.plate_number using errcode = '22023';
    elsif v_vehicle.archived_at is not null or v_vehicle.status not in ('active', 'maintenance') then
      update public.vehicles set archived_at = null, status = 'active', updated_by = auth.uid() where id = v_vehicle.id
      returning * into v_vehicle;
    end if;
    if v_vehicle.supplier_id is distinct from v_sup.id then
      update public.vehicles set supplier_id = v_sup.id, ownership_type = 'outsourced', updated_by = auth.uid() where id = v_vehicle.id
      returning * into v_vehicle;
    end if;
  end if;

  -- Tài xế: tìm tài xế 3PL của nhà xe theo SĐT, rồi theo tên; chưa có thì thêm
  if v_name is not null or v_phone is not null then
    if v_phone is not null then
      select id into v_driver from public.drivers
      where is_outsourced and supplier_id = v_sup.id and regexp_replace(coalesce(phone, ''), '[^0-9+]', '', 'g') = v_phone
      order by archived_at nulls first, created_at limit 1;
    end if;
    if v_driver is null and v_name is not null then
      select id into v_driver from public.drivers
      where is_outsourced and supplier_id = v_sup.id and lower(full_name) = lower(v_name)
      order by archived_at nulls first, created_at limit 1;
    end if;
    if v_driver is null then
      insert into public.drivers (code, full_name, phone, status, is_outsourced, supplier_id, notes, created_by, updated_by)
      values ('', coalesce(v_name, 'Tài xế ' || v_phone), v_phone, 'active', true, v_sup.id, 'Tài xế nhà xe 3PL ' || v_sup.name, auth.uid(), auth.uid())
      returning id into v_driver;
    else
      update public.drivers
      set full_name = coalesce(v_name, full_name), phone = coalesce(v_phone, phone),
          status = 'active', archived_at = null, updated_by = auth.uid()
      where id = v_driver;
    end if;
  else
    -- Không nhập tài xế: tài xế đại diện của nhà xe
    v_placeholder := true;
    v_ph_name := left(coalesce(nullif(trim(p_placeholder_name), ''), 'Tài xế 3PL ' || v_sup.name), 150);
    select id into v_driver from public.drivers
    where is_outsourced and supplier_id = v_sup.id and full_name = v_ph_name
    order by created_at limit 1;
    if v_driver is null then
      insert into public.drivers (code, full_name, status, is_outsourced, supplier_id, notes, created_by, updated_by)
      values ('', v_ph_name, 'active', true, v_sup.id,
              'Tự tạo khi giao chuyến cho nhà xe ' || v_sup.name || ' mà chưa biết tài xế', auth.uid(), auth.uid())
      returning id into v_driver;
    else
      update public.drivers set status = 'active', archived_at = null where id = v_driver and (status <> 'active' or archived_at is not null);
    end if;
  end if;

  if v_nid is not null or v_lic is not null then
    insert into public.driver_sensitive (driver_id, national_id, license_no, created_by, updated_by)
    values (v_driver, v_nid, v_lic, auth.uid(), auth.uid())
    on conflict (driver_id) do update
      set national_id = coalesce(excluded.national_id, public.driver_sensitive.national_id),
          license_no = coalesce(excluded.license_no, public.driver_sensitive.license_no),
          updated_at = now(), updated_by = auth.uid();
  end if;

  -- Xe 3PL chưa có tài xế phụ trách → gắn tài xế vừa nhập (để lần sau tự điền)
  if v_vehicle.id is not null and not v_placeholder and v_vehicle.assigned_driver_id is null
     and not exists (select 1 from public.vehicles where assigned_driver_id = v_driver and archived_at is null) then
    update public.vehicles set assigned_driver_id = v_driver where id = v_vehicle.id;
  end if;

  perform private.assign_shipment_core(s.id, v_driver, v_vehicle.id);
  update public.shipments set carrier_supplier_id = v_sup.id
  where id = s.id and carrier_supplier_id is distinct from v_sup.id;

  return jsonb_build_object('driver_id', v_driver, 'vehicle_id', v_vehicle.id, 'supplier_name', v_sup.name);
end;
$$;
revoke all on function private.assign_shipment_3pl_core(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.assign_shipment_3pl(
  p_shipment_id uuid, p_supplier_id uuid, p_plate text default null, p_driver_name text default null,
  p_driver_phone text default null, p_national_id text default null, p_license_no text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_perm('dispatch.update') then
    raise exception 'Bạn không có quyền phân công chuyến' using errcode = '42501';
  end if;
  return private.assign_shipment_3pl_core(p_shipment_id, p_supplier_id, p_plate, p_driver_name, p_driver_phone, p_national_id, p_license_no, null);
end;
$$;

-- 4. Phạm vi cổng 3PL --------------------------------------------------------------
-- Nhà xe người gọi được xem: tài khoản 3PL = nhà xe được gắn; nhân viên điều phối = nhà xe đang chọn
create or replace function private.portal_supplier_ids(p_supplier_id uuid) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_perm('carrier_portal.use') and not private.has_perm('dispatch.update') then
    raise exception 'Bạn không có quyền vào cổng nhà xe 3PL' using errcode = '42501';
  end if;
  if private.is_supplier_scoped() then
    return coalesce((select array_agg(x) from private.my_supplier_ids() x where p_supplier_id is null or x = p_supplier_id), '{}'::uuid[]);
  end if;
  if not private.has_perm('dispatch.update') then
    return '{}'::uuid[];
  end if;
  return case when p_supplier_id is null then '{}'::uuid[] else array[p_supplier_id] end;
end;
$$;
revoke all on function private.portal_supplier_ids(uuid) from public, anon;
grant execute on function private.portal_supplier_ids(uuid) to authenticated;

-- Nhà xe của chuyến: ghi ở chuyến; chuyến chưa có xe, tài xế thì lấy nhà xe chỉ định trên đơn
create or replace function private.shipment_portal_supplier(s public.shipments) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(s.carrier_supplier_id,
                  case when s.vehicle_id is null and s.driver_id is null
                       then (select o.carrier_supplier_id from public.transport_orders o where o.id = s.order_id) end)
$$;
revoke all on function private.shipment_portal_supplier(public.shipments) from public, anon;
grant execute on function private.shipment_portal_supplier(public.shipments) to authenticated;

-- Nhà xe tài khoản được chọn (ô chọn trên trang)
create or replace function public.carrier_portal_suppliers()
returns table (id uuid, code text, name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.is_supplier_scoped() then
    return query select sp.id, sp.code, sp.name from public.suppliers sp
      where sp.id in (select private.my_supplier_ids()) order by sp.name;
  elsif private.has_perm('dispatch.update') then
    return query select sp.id, sp.code, sp.name from public.suppliers sp
      where sp.status = 'active'
        and (coalesce(sp.custom_fields ->> 'supplier_kind', '') in ('3pl', 'carrier')
             or exists (select 1 from public.shipments x where x.carrier_supplier_id = sp.id))
      order by sp.name;
  end if;
end;
$$;
revoke all on function public.carrier_portal_suppliers() from public, anon;
grant execute on function public.carrier_portal_suppliers() to authenticated;

-- 5. Danh sách chuyến cho 3PL (không có cước, đơn giá, khách hàng) -----------------------
create or replace function public.carrier_portal_shipments(
  p_supplier_id uuid default null, p_from date default null, p_to date default null, p_open_only boolean default true
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_sup uuid[] := private.portal_supplier_ids(p_supplier_id);
begin
  if cardinality(v_sup) = 0 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.pickup_at, t.order_code, t.sequence_in_order)
    from (
      select s.id, s.shipment_code, s.sequence_in_order, o.order_code, o.ref_no, o.voucher_no,
             s.pickup_at, s.expected_delivery_at, s.status,
             sp.id as supplier_id, sp.name as supplier_name,
             pl.name as pickup_name, pl.full_address as pickup_address,
             dl.name as delivery_name, dl.full_address as delivery_address,
             er.name as empty_return_name,
             vt.name as vehicle_type_name, s.container_no,
             v.plate_number, d.full_name as driver_name, d.phone as driver_phone,
             s.delivery_method, s.notes,
             sf.shipment_code as split_from_code,
             coalesce((select jsonb_agg(jsonb_build_object(
                        'id', i.id, 'line_no', i.line_no, 'item_code', i.item_code, 'item_name', i.item_name,
                        'quantity', i.quantity, 'unit', i.unit, 'weight_kg', i.weight_kg, 'bag_count', i.bag_count)
                        order by i.line_no)
                       from public.shipment_items i where i.shipment_id = s.id), '[]'::jsonb) as items,
             case when s.pricing_unit = 'ton' then s.quantity end as tons
      from public.shipments s
      join public.transport_orders o on o.id = s.order_id
      join public.suppliers sp on sp.id = private.shipment_portal_supplier(s)
      left join public.locations pl on pl.id = s.pickup_location_id
      left join public.locations dl on dl.id = s.delivery_location_id
      left join public.locations er on er.id = s.empty_return_location_id
      left join public.vehicle_types vt on vt.id = s.vehicle_type_id
      left join public.vehicles v on v.id = s.vehicle_id
      left join public.drivers d on d.id = s.driver_id
      left join public.shipments sf on sf.id = s.split_from_id
      where private.shipment_portal_supplier(s) = any(v_sup)
        and s.status <> 'cancelled'
        and (not p_open_only or s.status in ('draft', 'assigned', 'accepted', 'in_transit'))
        and (p_from is null or (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date >= p_from)
        and (p_to is null or (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date <= p_to)
      limit 2000
    ) t
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.carrier_portal_shipments(uuid, date, date, boolean) from public, anon;
grant execute on function public.carrier_portal_shipments(uuid, date, date, boolean) to authenticated;

-- 6. 3PL đăng ký xe / chia chuyến thành nhiều xe ------------------------------------------
--    p_lines: [{plate, driver_name, driver_phone, national_id, quantities: {<shipment_item_id>: số}}]
--             chuyến không có dòng mã hàng: {plate, ..., quantity: số} (cùng đơn vị với chuyến)
create or replace function public.carrier_register_vehicles(p_shipment_id uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  v_sup uuid;
  v_allowed uuid[];
  v_n int;
  v_items jsonb;           -- [{id, quantity, weight_kg, bag_count}]
  v_has_items boolean;
  it record;
  ln jsonb;
  k int;
  v_q numeric;
  v_sum numeric;
  v_full boolean := true;  -- mọi mã hàng đã chia hết
  v_line_total numeric[] := '{}';
  v_line_kg numeric[] := '{}';
  v_total_qty numeric := 0;
  v_total_kg numeric := 0;
  v_kg_known boolean := true;
  v_target uuid;
  v_seq int;
  v_new public.shipments;
  v_created text[] := '{}';
  v_plate text;
  v_frac numeric;
  v_rest_kg numeric;
  v_line_no int;
  v_codes text;
begin
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = 'P0001';
  end if;
  v_sup := private.shipment_portal_supplier(s);
  if private.is_supplier_scoped() then
    v_allowed := private.portal_supplier_ids(null);
    if v_sup is null or not (v_sup = any(v_allowed)) then
      raise exception 'Chuyến này không được chỉ định cho nhà xe của bạn' using errcode = '42501';
    end if;
    if not private.has_perm('carrier_portal.use') then
      raise exception 'Bạn không có quyền đăng ký xe' using errcode = '42501';
    end if;
  elsif not private.has_perm('dispatch.update') then
    raise exception 'Bạn không có quyền đăng ký xe' using errcode = '42501';
  end if;
  if v_sup is null then
    raise exception 'Chuyến % chưa chỉ định nhà xe 3PL', s.shipment_code using errcode = '22023';
  end if;
  if s.status not in ('draft', 'assigned', 'accepted') then
    raise exception 'Chuyến % đã chạy hoặc đã xong, không đăng ký lại xe được', s.shipment_code using errcode = '22023';
  end if;
  if s.receivable_id is not null then
    raise exception 'Chuyến % đã lập công nợ, nhờ GHA chia chuyến', s.shipment_code using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nhập ít nhất một xe' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_lines);
  if v_n > 60 then
    raise exception 'Mỗi lần đăng ký tối đa 60 xe' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'quantity', coalesce(i.quantity, 0), 'unit', i.unit,
                                               'weight_kg', i.weight_kg, 'bag_count', i.bag_count) order by i.line_no), '[]'::jsonb)
    into v_items
  from public.shipment_items i where i.shipment_id = s.id and coalesce(i.quantity, 0) > 0;
  v_has_items := jsonb_array_length(v_items) > 0;

  -- Kiểm số lượng: từng xe > 0, tổng từng mã hàng không vượt số lượng của chuyến
  for k in 0 .. v_n - 1 loop
    ln := p_lines -> k;
    v_plate := upper(regexp_replace(coalesce(ln ->> 'plate', ''), '[^A-Za-z0-9]', '', 'g'));
    if length(v_plate) < 4 then
      raise exception 'Xe %: nhập số xe (ví dụ 61K31295)', k + 1 using errcode = '22023';
    end if;
    v_line_total := v_line_total || 0::numeric;
    v_line_kg := v_line_kg || 0::numeric;
  end loop;
  if (select count(distinct upper(regexp_replace(coalesce(x ->> 'plate', ''), '[^A-Za-z0-9]', '', 'g'))) from jsonb_array_elements(p_lines) x) < v_n then
    raise exception 'Mỗi xe chỉ nhập một dòng (đang trùng số xe)' using errcode = '22023';
  end if;

  if v_has_items then
    for it in select * from jsonb_to_recordset(v_items) as x(id uuid, quantity numeric, unit text, weight_kg numeric, bag_count numeric) loop
      v_sum := 0;
      for k in 0 .. v_n - 1 loop
        v_q := coalesce(nullif(trim(p_lines -> k -> 'quantities' ->> it.id::text), '')::numeric, 0);
        if v_q < 0 then
          raise exception 'Xe %: số lượng không được âm', k + 1 using errcode = '22023';
        end if;
        v_sum := v_sum + v_q;
        v_line_total[k + 1] := v_line_total[k + 1] + v_q;
        if it.weight_kg is not null and it.quantity > 0 then
          v_line_kg[k + 1] := v_line_kg[k + 1] + it.weight_kg * v_q / it.quantity;
        elsif upper(coalesce(it.unit, '')) = 'KG' then
          v_line_kg[k + 1] := v_line_kg[k + 1] + v_q;
        else
          v_kg_known := false;
        end if;
      end loop;
      if v_sum > it.quantity + 0.0005 then
        raise exception 'Tổng số lượng các xe (%) vượt số lượng của chuyến (%)',
          to_char(v_sum, 'FM999G999G990D999'), to_char(it.quantity, 'FM999G999G990D999') using errcode = '22023';
      end if;
      if v_sum < it.quantity - 0.0005 then v_full := false; end if;
      v_total_qty := v_total_qty + it.quantity;
      v_total_kg := v_total_kg + coalesce(it.weight_kg, case when upper(coalesce(it.unit, '')) = 'KG' then it.quantity end, 0);
    end loop;
  else
    -- Chuyến không có dòng mã hàng: tính theo tấn thì chia số tấn, còn lại cả chuyến = 1 xe
    v_sum := 0;
    for k in 0 .. v_n - 1 loop
      v_q := coalesce(nullif(trim(p_lines -> k ->> 'quantity'), '')::numeric, 0);
      if v_q < 0 then
        raise exception 'Xe %: số lượng không được âm', k + 1 using errcode = '22023';
      end if;
      v_sum := v_sum + v_q;
      v_line_total[k + 1] := v_q;
    end loop;
    v_total_qty := case when s.pricing_unit = 'ton' then s.quantity else 1 end;
    if v_sum > v_total_qty + 0.0005 then
      raise exception 'Tổng số lượng các xe (%) vượt số lượng của chuyến (%)',
        to_char(v_sum, 'FM999G999G990D999'), to_char(v_total_qty, 'FM999G999G990D999') using errcode = '22023';
    end if;
    v_full := v_sum >= v_total_qty - 0.0005;
    v_kg_known := false;
  end if;
  for k in 1 .. v_n loop
    if v_line_total[k] <= 0 then
      raise exception 'Xe %: nhập số lượng lớn hơn 0', k using errcode = '22023';
    end if;
  end loop;

  select coalesce(max(sequence_in_order), 0) into v_seq from public.shipments where order_id = s.order_id;

  -- Từng xe: xe 1 ghi vào chính chuyến nếu chia đủ; còn lại thành chuyến mới cùng đơn
  for k in 0 .. v_n - 1 loop
    ln := p_lines -> k;
    -- Phần của xe này so với cả chuyến (để chia số tấn khi tính cước theo tấn)
    v_frac := case
      when v_kg_known and v_total_kg > 0 then v_line_kg[k + 1] / v_total_kg
      when v_total_qty > 0 then v_line_total[k + 1] / v_total_qty
      else 1 end;
    if k = 0 and v_full then
      v_target := s.id;
    else
      v_seq := v_seq + 1;
      insert into public.shipments (
        order_id, sequence_in_order, pickup_at, expected_delivery_at, pickup_location_id, delivery_location_id,
        route_id, vehicle_type_id, price_list_id, unit_price, pricing_unit, quantity,
        fuel_support_rate, fuel_support_base, fuel_support_rule_id, pricing_snapshot,
        notes, custom_fields, carrier_supplier_id, plan_id, trip_order, empty_return_location_id, offroute_return_location_id,
        pickup_phone, delivery_phone, pod_photo_required, delivery_days, delivery_method, split_from_id,
        created_by, updated_by)
      values (
        s.order_id, v_seq, s.pickup_at, s.expected_delivery_at, s.pickup_location_id, s.delivery_location_id,
        s.route_id, s.vehicle_type_id, s.price_list_id, s.unit_price, s.pricing_unit,
        case when s.pricing_unit = 'ton' then greatest(round(s.quantity * v_frac, 3), 0.001) else s.quantity end,
        s.fuel_support_rate, s.fuel_support_base, s.fuel_support_rule_id, s.pricing_snapshot,
        s.notes, s.custom_fields, v_sup, s.plan_id, s.trip_order, s.empty_return_location_id, s.offroute_return_location_id,
        s.pickup_phone, s.delivery_phone, s.pod_photo_required, s.delivery_days, s.delivery_method, s.id,
        auth.uid(), auth.uid())
      returning * into v_new;
      v_target := v_new.id;
      v_created := v_created || v_new.shipment_code;
      if v_has_items then
        v_line_no := 0;
        for it in select i.* from public.shipment_items i where i.shipment_id = s.id and coalesce(i.quantity, 0) > 0 order by i.line_no loop
          v_q := coalesce(nullif(trim(ln -> 'quantities' ->> it.id::text), '')::numeric, 0);
          continue when v_q <= 0;
          v_line_no := v_line_no + 1;
          insert into public.shipment_items (shipment_id, line_no, item_code, item_name, quantity, unit, note, custom_fields,
                                             product_id, order_item_id, weight_kg, bag_count)
          values (v_target, v_line_no, it.item_code, it.item_name, v_q, it.unit, it.note, it.custom_fields,
                  it.product_id, it.order_item_id,
                  case when it.weight_kg is not null then round(it.weight_kg * v_q / it.quantity, 3) end,
                  case when it.bag_count is not null then round(it.bag_count * v_q / it.quantity, 2) end);
        end loop;
      end if;
    end if;
    perform private.assign_shipment_3pl_core(v_target, v_sup, ln ->> 'plate', ln ->> 'driver_name', ln ->> 'driver_phone',
                                             ln ->> 'national_id', null, 'Tài xế & 3PL');
  end loop;

  -- Chuyến gốc: chia đủ thì giữ phần của xe 1; chưa đủ thì giữ phần còn lại, chưa có xe
  if v_has_items then
    for it in select i.* from public.shipment_items i where i.shipment_id = s.id and coalesce(i.quantity, 0) > 0 loop
      if v_full then
        v_q := coalesce(nullif(trim(p_lines -> 0 -> 'quantities' ->> it.id::text), '')::numeric, 0);
      else
        select it.quantity - coalesce(sum(coalesce(nullif(trim(x -> 'quantities' ->> it.id::text), '')::numeric, 0)), 0)
          into v_q from jsonb_array_elements(p_lines) x;
      end if;
      if v_q <= 0.0005 then
        delete from public.shipment_items where id = it.id;
      elsif abs(v_q - it.quantity) > 0.0005 then
        update public.shipment_items
        set quantity = v_q,
            weight_kg = case when it.weight_kg is not null then round(it.weight_kg * v_q / it.quantity, 3) end,
            bag_count = case when it.bag_count is not null then round(it.bag_count * v_q / it.quantity, 2) end
        where id = it.id;
      end if;
    end loop;
  end if;
  if v_full then
    v_frac := case when v_kg_known and v_total_kg > 0 then v_line_kg[1] / v_total_kg
                   when v_total_qty > 0 then v_line_total[1] / v_total_qty else 1 end;
  else
    v_rest_kg := v_total_kg - (select coalesce(sum(x), 0) from unnest(v_line_kg) x);
    v_frac := case when v_kg_known and v_total_kg > 0 then v_rest_kg / v_total_kg
                   when v_total_qty > 0 then (v_total_qty - (select coalesce(sum(x), 0) from unnest(v_line_total) x)) / v_total_qty else 1 end;
    perform private.assign_shipment_core(s.id, null, null);
  end if;
  if s.pricing_unit = 'ton' and v_n > (case when v_full then 1 else 0 end) then
    update public.shipments set quantity = greatest(round(s.quantity * v_frac, 3), 0.001) where id = s.id;
  end if;

  -- Báo điều phối khi 3PL tự chia xe
  if v_created <> '{}' then
    v_codes := array_to_string(v_created, ', ');
    perform private.notify_permission_holders('dispatch.update', 'carrier_split',
      'Nhà xe ' || (select name from public.suppliers where id = v_sup) || ' chia chuyến ' || s.shipment_code,
      'Thêm ' || cardinality(v_created) || ' chuyến: ' || v_codes || '. Kiểm lại cước, phụ thu của các chuyến mới.',
      'shipment', s.id, '/dieu-phoi/don-hang/' || s.order_id);
  end if;

  return jsonb_build_object('updated', s.shipment_code, 'created', to_jsonb(v_created), 'full', v_full);
exception
  when invalid_text_representation then
    raise exception 'Số lượng phải là số' using errcode = '22023';
end;
$$;
revoke all on function public.carrier_register_vehicles(uuid, jsonb) from public, anon;
grant execute on function public.carrier_register_vehicles(uuid, jsonb) to authenticated;

-- Kiểm tra sau khi chạy:
-- select code, name from public.roles where code = 'carrier_3pl';
-- select * from public.carrier_portal_suppliers();
