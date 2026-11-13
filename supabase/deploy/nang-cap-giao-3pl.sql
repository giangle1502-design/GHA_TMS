-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Giao chuyến cho nhà xe 3PL (số xe, tài xế, CCCD, GPLX không bắt buộc)
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('public.assign_shipment_3pl(uuid,uuid,text,text,text,text,text)') is not null then
    raise exception 'CSDL đã được nâng cấp Giao chuyến cho nhà xe 3PL (số xe, tài xế, CCCD, GPLX không bắt buộc) trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261103000057_assign_3pl.sql
-- =============================================================================
-- 0057 Giao chuyến cho nhà xe 3PL ngay ở Phân công
-- - Điều phối chọn Nhà xe 3PL (tự điền từ chuyến hoặc NCC của kế hoạch) và nhập Số xe, Tài xế,
--   SĐT, CCCD, GPLX — ô nào cũng để trống được.
-- - Hệ thống tự ghi xe (Thuê ngoài 3PL, gắn nhà xe) và tài xế 3PL (drivers.is_outsourced) rồi phân công
--   như chuyến thường, nên tài xế 3PL vẫn nhập số xe trên điện thoại để xem chuyến, Giám đốc duyệt như cũ.
-- - Không nhập tài xế: dùng một tài xế đại diện của nhà xe ("Tài xế 3PL <tên nhà xe>").
-- - Tài xế 3PL không có trong danh sách chọn tài xế nội bộ, số chuyến, lương.
-- =============================================================================

alter table public.drivers add column if not exists is_outsourced boolean not null default false;
alter table public.drivers add column if not exists supplier_id uuid references public.suppliers (id);
comment on column public.drivers.is_outsourced is 'Tài xế của nhà xe thuê ngoài 3PL (không tính số chuyến, lương, tạm ứng)';
comment on column public.drivers.supplier_id is 'Nhà xe 3PL của tài xế thuê ngoài';
create index if not exists drivers_outsourced_idx on public.drivers (supplier_id) where is_outsourced;

-- Tài xế đang phụ trách xe 3PL và chưa từng chạy xe nội bộ → đánh dấu tài xế 3PL
update public.drivers d
set is_outsourced = true,
    supplier_id = coalesce(d.supplier_id, v.supplier_id)
from public.vehicles v
where v.assigned_driver_id = d.id
  and (v.ownership_type = 'outsourced' or v.supplier_id is not null)
  and d.profile_id is null
  and not d.is_outsourced
  and not exists (
    select 1 from public.shipments s
    join public.vehicles v2 on v2.id = s.vehicle_id
    where s.driver_id = d.id and v2.ownership_type <> 'outsourced' and v2.supplier_id is null
  );

-- Thông tin xe, tài xế 3PL đang gắn với chuyến (để mở lại hộp thoại Phân công)
create or replace function public.shipment_3pl_info(p_shipment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  v_supplier uuid;
  v_plan_code text;
  r jsonb;
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('dispatch.create')) then
    raise exception 'Bạn không có quyền xem phân công chuyến' using errcode = '42501';
  end if;
  select * into s from public.shipments where id = p_shipment_id;
  if s.id is null then
    return null;
  end if;
  v_supplier := s.carrier_supplier_id;
  if v_supplier is null and s.vehicle_id is not null then
    select supplier_id into v_supplier from public.vehicles where id = s.vehicle_id;
  end if;
  if v_supplier is null and s.driver_id is not null then
    select supplier_id into v_supplier from public.drivers where id = s.driver_id and is_outsourced;
  end if;
  if s.plan_id is not null then
    select code, coalesce(v_supplier, supplier_id) into v_plan_code, v_supplier from public.transport_plans where id = s.plan_id;
  end if;

  select jsonb_build_object(
    'supplier_id', v_supplier,
    'supplier_name', (select name from public.suppliers where id = v_supplier),
    'plan_code', v_plan_code,
    'from_plan', s.carrier_supplier_id is null and s.plan_id is not null
                 and v_supplier is not distinct from (select supplier_id from public.transport_plans where id = s.plan_id),
    'is_3pl', coalesce(v.ownership_type = 'outsourced' or v.supplier_id is not null, false) or coalesce(d.is_outsourced, false)
              or s.carrier_supplier_id is not null,
    'plate', v.plate_number,
    'driver_name', case when d.full_name like 'Tài xế 3PL %' then null else d.full_name end,
    'driver_phone', d.phone,
    'national_id', case when d.is_outsourced then ds.national_id end,
    'license_no', case when d.is_outsourced then ds.license_no end
  ) into r
  from (select 1) x
  left join public.vehicles v on v.id = s.vehicle_id
  left join public.drivers d on d.id = s.driver_id
  left join public.driver_sensitive ds on ds.driver_id = s.driver_id;
  return r;
end;
$$;
revoke all on function public.shipment_3pl_info(uuid) from public, anon;
grant execute on function public.shipment_3pl_info(uuid) to authenticated;

-- Giao chuyến cho nhà xe 3PL
create or replace function public.assign_shipment_3pl(
  p_shipment_id uuid,
  p_supplier_id uuid,
  p_plate text default null,
  p_driver_name text default null,
  p_driver_phone text default null,
  p_national_id text default null,
  p_license_no text default null
)
returns jsonb
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
begin
  if not private.has_perm('dispatch.update') then
    raise exception 'Bạn không có quyền phân công chuyến' using errcode = '42501';
  end if;
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
    select id into v_driver from public.drivers
    where is_outsourced and supplier_id = v_sup.id and full_name = 'Tài xế 3PL ' || v_sup.name
    order by created_at limit 1;
    if v_driver is null then
      insert into public.drivers (code, full_name, status, is_outsourced, supplier_id, notes, created_by, updated_by)
      values ('', left('Tài xế 3PL ' || v_sup.name, 150), 'active', true, v_sup.id,
              'Tự tạo khi giao chuyến cho nhà xe mà chưa biết tài xế', auth.uid(), auth.uid())
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

  perform public.assign_shipment(s.id, v_driver, v_vehicle.id);
  update public.shipments set carrier_supplier_id = v_sup.id
  where id = s.id and carrier_supplier_id is distinct from v_sup.id;

  return jsonb_build_object('driver_id', v_driver, 'vehicle_id', v_vehicle.id, 'supplier_name', v_sup.name);
end;
$$;
revoke all on function public.assign_shipment_3pl(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.assign_shipment_3pl(uuid, uuid, text, text, text, text, text) to authenticated;

-- Lập bảng lương tháng: bỏ tài xế 3PL
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
  v_from date := date_trunc('month', p_month)::date;
begin
  if not private.has_perm('settlements.update') then
    raise exception 'Bạn không có quyền lập bảng lương' using errcode = '42501';
  end if;
  for d in
    select dr.id from public.drivers dr
    where dr.archived_at is null and not dr.is_outsourced and (dr.status <> 'terminated'
      or exists (select 1 from public.shipments s where s.driver_id = dr.id
                   and (s.completed_at at time zone 'Asia/Ho_Chi_Minh')::date >= v_from))
    order by dr.full_name
  loop
    if exists (select 1 from public.driver_payrolls p where p.driver_id = d.id and p.period_month = v_from and p.status not in ('cancelled', 'rejected')) then
      skipped := skipped + 1;
      continue;
    end if;
    -- Bỏ qua tài xế không có lương, không chuyến, không chi phí, không tạm ứng
    if (private.payroll_compute(d.id, v_from, 0, 0) ->> 'gross_amount')::numeric = 0
       and private.driver_advance_balance(d.id) = 0 then
      continue;
    end if;
    perform private.payroll_insert(d.id, v_from, 0, 0, null, '{}');
    n := n + 1;
  end loop;
  return jsonb_build_object('created', n, 'skipped', skipped);
end;
$$;


commit;
