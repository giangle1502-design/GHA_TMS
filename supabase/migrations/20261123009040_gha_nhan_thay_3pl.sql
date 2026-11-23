-- =============================================================================
-- 9040: GHA nhận thay chuyến xe 3PL theo từng nhà xe (LE, 23/11/2026)
--
-- * suppliers.gha_acts_for_driver: bật (mặc định) = chỉ cần chỉ định số xe là nhân viên
--   GHA bấm được Nhận thay → Bắt đầu chạy → Hoàn thành trên web, không cần tài xế 3PL dùng app.
--   Tắt = tài xế của nhà xe tự thao tác trên app; GHA không làm thay được.
--   Mặc định TẮT cho Thành Cảnh và Thế Bùi.
-- * dispatch_act_for_driver:
--   - chặn làm thay khi nhà xe 3PL của chuyến đang tắt cờ trên;
--   - chuyến 3PL đã có số xe nhưng chưa có tài xế (Nháp): bấm Nhận thay tự gắn
--     "Tài xế 3PL <nhà xe>" rồi nhận luôn.
-- * assign_shipment_3pl_core: nhà xe tắt cờ (Thành Cảnh, Thế Bùi) bắt buộc nhập tên hoặc SĐT
--   tài xế khi giao số xe (cả GHA và cổng nhà xe); nhà xe khác tài xế không bắt buộc như cũ.
-- Chạy được nhiều lần.
-- =============================================================================

alter table public.suppliers add column if not exists gha_acts_for_driver boolean not null default true;
comment on column public.suppliers.gha_acts_for_driver is
  'Nhà xe 3PL: true = GHA nhận thay, bắt đầu, hoàn thành chuyến trên web chỉ cần số xe; false = tài xế tự thao tác trên app';

-- Thành Cảnh, Thế Bùi: tài xế tự thao tác trên app (viết có dấu hoặc không dấu)
update public.suppliers
   set gha_acts_for_driver = false
 where gha_acts_for_driver
   and (lower(name) like '%thành cảnh%' or lower(name) like '%thanh canh%'
        or lower(name) like '%thế bùi%' or lower(name) like '%the bui%');

-- Giao xe cho nhà xe 3PL: Thành Cảnh, Thế Bùi bắt buộc tài xế; nhà xe khác tài xế không bắt buộc
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
  -- Nhà xe để tài xế tự làm trên app (Thành Cảnh, Thế Bùi): bắt buộc tên hoặc SĐT tài xế khi giao xe
  if not v_sup.gha_acts_for_driver and v_plate <> '' and v_name is null and v_phone is null then
    raise exception 'Nhà xe 3PL % cần nhập tên tài xế (tài xế tự nhận chuyến trên app). Bấm Phân công để nhập số xe kèm tài xế.', v_sup.name
      using errcode = '22023';
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

-- Nhà xe 3PL của chuyến: ghi ở chuyến → nhà xe của xe → nhà xe của tài xế 3PL
create or replace function private.shipment_carrier_id(s public.shipments)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    s.carrier_supplier_id,
    (select v.supplier_id from public.vehicles v where v.id = s.vehicle_id),
    (select d.supplier_id from public.drivers d where d.id = s.driver_id and d.is_outsourced)
  );
$$;
revoke all on function private.shipment_carrier_id(public.shipments) from public, anon, authenticated;

create or replace function public.dispatch_act_for_driver(
  p_shipment_id uuid, p_step text, p_result text default null, p_note text default null,
  p_no_expense boolean default null, p_photo_skip_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.shipments;
  v_a public.shipment_assignments;
  v_driver text;
  v_me text;
  v_photos int;
  v_3pl boolean;
  v_skip text := nullif(trim(coalesce(p_photo_skip_reason, '')), '');
  v_sup public.suppliers;
  v_plate text;
begin
  if not private.has_perm('dispatch.update') then
    raise exception 'Bạn không có quyền làm thay tài xế' using errcode = '42501';
  end if;
  select * into v_s from public.shipments where id = p_shipment_id for update;
  if v_s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = '22023';
  end if;

  select * into v_sup from public.suppliers where id = private.shipment_carrier_id(v_s);
  if v_sup.id is not null and not v_sup.gha_acts_for_driver then
    raise exception 'Nhà xe 3PL % để tài xế tự nhận, bắt đầu và hoàn thành chuyến trên app, GHA không làm thay. Muốn GHA làm thay: Danh mục Nhà cung cấp, tick "GHA nhận thay chuyến 3PL".', v_sup.name
      using errcode = '22023';
  end if;

  if v_s.driver_id is null then
    -- Chuyến 3PL đã có số xe, chưa có tài xế: gắn tài xế đại diện của nhà xe rồi nhận thay
    if p_step = 'accept' and v_s.status = 'draft' and v_s.vehicle_id is not null and v_sup.id is not null then
      select plate_number into v_plate from public.vehicles where id = v_s.vehicle_id;
      perform private.assign_shipment_3pl_core(v_s.id, v_sup.id, v_plate, null, null, null, null, null);
      select * into v_s from public.shipments where id = p_shipment_id for update;
    elsif v_sup.id is not null then
      raise exception 'Chuyến 3PL chưa có số xe: nhập số xe ở cột Số xe trước khi nhận thay' using errcode = '22023';
    else
      raise exception 'Chuyến chưa phân công tài xế' using errcode = '22023';
    end if;
  end if;
  select full_name into v_driver from public.drivers where id = v_s.driver_id;
  select coalesce(nullif(full_name, ''), email) into v_me from public.profiles where id = auth.uid();
  v_me := coalesce(v_me, 'Điều phối');

  if p_step = 'accept' then
    if v_s.status <> 'assigned' then
      raise exception 'Chuyến không còn ở trạng thái chờ tài xế nhận' using errcode = '22023';
    end if;
    select * into v_a from public.shipment_assignments
     where shipment_id = v_s.id and driver_id = v_s.driver_id and response = 'pending' for update;
    if v_a.id is not null then
      update public.shipment_assignments set response = 'accepted', responded_at = now() where id = v_a.id;
    end if;
    update public.shipments set status = 'accepted' where id = v_s.id;
    perform private.driver_link_note(v_s.id, 'accepted', v_me || ' nhận chuyến thay tài xế ' || v_driver);

  elsif p_step = 'start' then
    if v_s.status <> 'accepted' then
      raise exception 'Chỉ bắt đầu được chuyến đã nhận' using errcode = '22023';
    end if;
    update public.shipments set status = 'in_transit', departed_pickup_at = coalesce(departed_pickup_at, now()) where id = v_s.id;
    perform private.driver_link_note(v_s.id, 'in_transit', v_me || ' bấm bắt đầu chạy thay tài xế ' || v_driver);

  elsif p_step = 'complete' then
    if v_s.status <> 'in_transit' then
      raise exception 'Bấm "Bắt đầu chạy" trước khi hoàn thành chuyến' using errcode = '22023';
    end if;
    if coalesce(p_result, '') not in ('full', 'partial', 'failed') then
      raise exception 'Chọn kết quả giao hàng' using errcode = '22023';
    end if;
    if p_result <> 'full' and length(trim(coalesce(p_note, ''))) = 0 then
      raise exception 'Giao thiếu hoặc không giao được: vui lòng ghi lý do' using errcode = '22023';
    end if;
    if length(coalesce(p_note, '')) > 500 or length(coalesce(v_skip, '')) > 500 then
      raise exception 'Ghi chú tối đa 500 ký tự' using errcode = '22023';
    end if;
    v_3pl := private.shipment_is_3pl(v_s);
    if p_no_expense is null and not v_3pl then
      raise exception 'Chọn "Có chi phí" hoặc "Không phát sinh chi phí"' using errcode = '22023';
    end if;
    select count(*) into v_photos from public.documents
     where entity_type = 'shipment' and entity_id = v_s.id and doc_type in ('photo', 'delivery_note') and archived_at is null;
    if v_photos = 0 and v_skip is null then
      raise exception 'Tải ít nhất 1 ảnh hàng hoặc phiếu ký nhận, hoặc ghi lý do chưa có chứng từ' using errcode = '22023';
    end if;
    update public.shipments
       set status = 'driver_completed',
           completed_at = now(),
           arrived_delivery_at = coalesce(arrived_delivery_at, now()),
           delivery_result = p_result,
           completion_note = nullif(trim(coalesce(p_note, '')), ''),
           photo_skip_reason = case when v_photos = 0 then v_skip end,
           document_status = case when v_photos > 0 and document_status in ('missing', 'rejected') then 'submitted' else document_status end,
           expense_declaration = case when v_3pl then null when p_no_expense then 'none' else 'has' end,
           expense_declared_at = case when v_3pl then null else now() end
     where id = v_s.id;
    perform private.driver_link_note(v_s.id, 'driver_completed', v_me || ' hoàn thành chuyến thay tài xế ' || v_driver
      || case when v_photos > 0 then ' (' || v_photos || ' ảnh)' else ' (chưa có ảnh: ' || v_skip || ')' end);
  else
    raise exception 'Bước không hợp lệ' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.dispatch_act_for_driver(uuid, text, text, text, boolean, text) from public, anon;
grant execute on function public.dispatch_act_for_driver(uuid, text, text, text, boolean, text) to authenticated;

-- Xem kết quả: nhà xe nào GHA làm thay, nhà xe nào tài xế tự làm trên app
select name as "Nhà cung cấp", case when gha_acts_for_driver then 'GHA nhận thay' else 'Tài xế tự làm trên app' end as "Cách làm"
  from public.suppliers
 order by gha_acts_for_driver, name;
