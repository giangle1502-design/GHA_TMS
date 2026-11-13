-- =============================================================================
-- GHA 9002: Chuyển dữ liệu từ file sao lưu JSON của app QLVT cũ (Firebase) vào GHA-TMS
--
-- Cách dùng (script scripts/import-legacy.mjs làm hộ):
--   1. Nạp file:  insert into legacy.backup_files(file_name, content) values (..., <json>)
--   2. Tách:      select legacy.load_backup(<id>);       -- bung từng bản ghi vào legacy.raw_docs
--   3. Chuyển:    select * from legacy.run_import();     -- trả về bảng đối chiếu số lượng
--   Chạy lại được: bản ghi đã chuyển (có trong legacy.id_map) sẽ bỏ qua, chỉ thêm bản ghi mới.
--
-- Toàn bộ bản gốc (kể cả ảnh base64, cấu hình, tài khoản) được giữ nguyên trong legacy.raw_docs,
-- nên phần nào chưa chuyển (tài chính, EIR, ảnh) vẫn chuyển tiếp được về sau, không mất dữ liệu.
-- Schema legacy KHÔNG mở cho API (chỉ quản trị CSDL đọc được).
-- =============================================================================

create schema if not exists legacy;
revoke all on schema legacy from public, anon, authenticated;

create table if not exists legacy.backup_files (
  id bigint generated always as identity primary key,
  file_name text,
  exported_at timestamptz,
  content jsonb not null,
  loaded_at timestamptz not null default now()
);

create table if not exists legacy.raw_docs (
  collection text not null,
  doc_id text not null,
  data jsonb not null,
  backup_id bigint references legacy.backup_files (id) on delete set null,
  loaded_at timestamptz not null default now(),
  primary key (collection, doc_id)
);

-- Bản ghi cũ -> bản ghi mới
create table if not exists legacy.id_map (
  collection text not null,
  doc_id text not null,
  target_table text not null,
  target_id uuid not null,
  imported_at timestamptz not null default now(),
  primary key (collection, doc_id, target_table)
);
create index if not exists id_map_target_idx on legacy.id_map (target_table, target_id);

create table if not exists legacy.import_log (
  id bigint generated always as identity primary key,
  run_at timestamptz not null default now(),
  level text not null check (level in ('info', 'warn')),
  collection text,
  doc_id text,
  message text not null
);

-- ---------- Hàm tiện ích ----------
create or replace function legacy.txt(v jsonb) returns text language sql immutable as $$
  select nullif(btrim(case jsonb_typeof(v) when 'string' then v #>> '{}' when 'number' then v::text when 'boolean' then v::text else null end), '')
$$;

create or replace function legacy.num(v jsonb) returns numeric language plpgsql immutable as $$
declare t text := replace(replace(legacy.txt(v), ',', ''), ' ', '');
begin
  if t is null or t !~ '^-?[0-9]+(\.[0-9]+)?$' then return null; end if;
  return t::numeric;
end $$;

create or replace function legacy.bool(v jsonb) returns boolean language sql immutable as $$
  select coalesce(case jsonb_typeof(v) when 'boolean' then (v #>> '{}')::boolean
                                       when 'string' then lower(v #>> '{}') in ('true', '1', 'x', 'yes', 'có') end, false)
$$;

create or replace function legacy.ts(v jsonb) returns timestamptz language plpgsql immutable as $$
declare t text := legacy.txt(v);
begin
  if t is null then return null; end if;
  if t ~ '^\d{4}-\d{2}-\d{2}$' then return (t || ' 00:00')::timestamp at time zone 'Asia/Ho_Chi_Minh'; end if;
  return t::timestamptz;
exception when others then return null;
end $$;

create or replace function legacy.dt(v jsonb) returns date language sql immutable as $$
  select (legacy.ts(v) at time zone 'Asia/Ho_Chi_Minh')::date
$$;

create or replace function legacy.plate(t text) returns text language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

create or replace function legacy.map_id(p_collection text, p_doc_id text, p_table text) returns uuid language sql stable as $$
  select target_id from legacy.id_map where collection = p_collection and doc_id = p_doc_id and target_table = p_table
$$;

-- Bỏ các trường ảnh base64 khỏi custom_fields (ảnh vẫn nằm trong legacy.raw_docs)
create or replace function legacy.strip_images(d jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
  from jsonb_each(d) as e(k, v)
  where not (jsonb_typeof(v) = 'string' and (v #>> '{}') like 'data:%;base64,%')
    and k not in ('token', 'shipmentLink')
$$;


-- Tìm địa điểm theo id cũ; id đã bị xóa ở app cũ thì tìm theo tên/mã; vẫn không có thì tạo mới theo tên
create or replace function legacy.resolve_location(p_collection text, p_id text, p_code text, p_name text, p_address text)
returns uuid language plpgsql as $$
declare v uuid;
begin
  v := legacy.map_id(p_collection, p_id, 'locations');
  if v is not null then return v; end if;
  select m.target_id into v from legacy.id_map m join public.locations l on l.id = m.target_id
  where m.collection = p_collection and m.target_table = 'locations'
    and ((p_code is not null and l.code = upper(p_code)) or upper(btrim(l.name)) = upper(btrim(p_name)))
  order by (p_code is not null and l.code = upper(p_code)) desc limit 1;
  if v is null and coalesce(p_name, p_code) is not null then
    insert into public.locations (code, name, company_name, full_address, custom_fields)
    values (case when p_code is not null and not exists (select 1 from public.locations where code = upper(p_code)) then upper(p_code) end,
            coalesce(p_name, p_code), p_name, coalesce(p_address, p_name, p_code),
            jsonb_build_object('location_kind', case p_collection when 'warehouses' then 'pickup' else 'delivery' end,
                               'created_from_missing_ref', p_id))
    returning id into v;
    insert into legacy.import_log (level, collection, doc_id, message)
    values ('warn', p_collection, p_id, format('Không còn bản ghi gốc (đã xóa ở app cũ); đã tạo địa điểm "%s" theo tên trên đơn', coalesce(p_name, p_code)));
  end if;
  if v is not null and p_id is not null then
    insert into legacy.id_map values (p_collection, p_id, 'locations', v) on conflict do nothing;
  end if;
  return v;
end $$;

-- ---------- Nạp file ----------
create or replace function legacy.load_backup(p_backup_id bigint) returns table (collection text, docs integer)
language plpgsql as $$
declare
  b legacy.backup_files;
begin
  select * into b from legacy.backup_files where id = p_backup_id;
  if b.id is null then raise exception 'Không có file sao lưu %', p_backup_id; end if;
  if jsonb_typeof(b.content -> 'collections') <> 'object' then
    raise exception 'File không đúng định dạng sao lưu QLVT (thiếu "collections")';
  end if;
  update legacy.backup_files set exported_at = legacy.ts(b.content -> '_exportedAt') where id = b.id;

  insert into legacy.raw_docs (collection, doc_id, data, backup_id)
  select c.key, d.value ->> '_id', d.value - '_id', b.id
  from jsonb_each(b.content -> 'collections') c
  cross join lateral jsonb_array_elements(c.value) d
  where d.value ->> '_id' is not null
  on conflict on constraint raw_docs_pkey do update set data = excluded.data, backup_id = excluded.backup_id, loaded_at = now();

  insert into legacy.import_log (level, collection, message)
  select 'warn', s.key, 'File sao lưu KHÔNG có dữ liệu này (thiếu quyền khi xuất): ' || (s.value #>> '{}')
  from jsonb_each(coalesce(b.content -> '_skipped', '{}'::jsonb)) s;

  return query
  select c.key, jsonb_array_length(c.value)
  from jsonb_each(b.content -> 'collections') c order by 1;
end $$;

-- ---------- Chuyển dữ liệu ----------
-- Bật lại các kiểm tra nghiệp vụ đã tắt trong lúc nhập
create or replace function legacy.enable_guards()
returns void
language plpgsql
set search_path = ''
as $$
begin
  alter table public.transport_orders enable trigger trg_transport_orders_guard;
  alter table public.shipments enable trigger trg_shipments_guard;
  alter table public.shipments enable trigger trg_shipments_edit_lock;
  alter table public.shipments enable trigger trg_shipments_billed_guard;
  alter table public.shipments enable trigger trg_shipments_dispatch_approval;
  alter table public.shipments enable trigger trg_shipments_submit_dispatch_approval;
  alter table public.shipments enable trigger trg_shipments_end_on_behalf;
  alter table public.shipments enable trigger trg_shipments_pricing;
  alter table public.shipments enable trigger trg_shipments_history;
  alter table public.shipment_items enable trigger trg_shipment_items_edit_lock;
  alter table public.shipment_fees enable trigger trg_shipment_fees_edit_lock;
end;
$$;

create or replace function legacy.run_import()
returns table (buoc text, nguon integer, da_chuyen integer, ghi_chu text)
language plpgsql
set search_path = public, legacy, private, pg_temp
as $$
declare
  r record;
  v_id uuid;
  v_gha uuid;
  v_unknown_customer uuid;
  v_code text;
  v_n int;
  v_line int;
  v_fee_type uuid;
  v_fee_kind text;
  v_extra numeric;
  v_pass numeric;
  v_costs jsonb;
  v_unit numeric;
  v_fuel_rate numeric;
  v_fuel_amt numeric;
  v_freight numeric;
  v_xsum numeric;
  v_fee_defs jsonb;
  f record;
  it record;
begin
  -- Chỉ tắt các kiểm tra nghiệp vụ trên bảng vận hành trong lúc nhập. ALTER TABLE không tự hoàn tác khi COMMIT,
  -- nên cuối hàm PHẢI bật lại (xem legacy.enable_guards); lỗi giữa chừng thì ROLLBACK hoàn tác cả lệnh tắt.
  alter table public.transport_orders disable trigger trg_transport_orders_guard;
  alter table public.shipments disable trigger trg_shipments_guard;
  alter table public.shipments disable trigger trg_shipments_edit_lock;
  alter table public.shipments disable trigger trg_shipments_billed_guard;
  alter table public.shipments disable trigger trg_shipments_dispatch_approval;
  alter table public.shipments disable trigger trg_shipments_submit_dispatch_approval;
  alter table public.shipments disable trigger trg_shipments_end_on_behalf;
  alter table public.shipments disable trigger trg_shipments_pricing;
  alter table public.shipments disable trigger trg_shipments_history;
  alter table public.shipment_items disable trigger trg_shipment_items_edit_lock;
  alter table public.shipment_fees disable trigger trg_shipment_fees_edit_lock;

  -- Bảng tạm ghi kết quả
  create temp table if not exists _rep (ord int, buoc text, nguon int, da_chuyen int, ghi_chu text) on commit drop;
  truncate _rep;

  -- 0. Pháp nhân GHA
  select id into v_gha from public.company_entities where tax_code = '3703489735' or code = 'GHA' limit 1;
  if v_gha is null then
    insert into public.company_entities (code, name, tax_code)
    values ('GHA', 'CÔNG TY TNHH GHA LOGISTICS & SERVICE', '3703489735') returning id into v_gha;
  end if;

  -- 1. Công ty xuất hàng (VAP, PLA...) -> Khách hàng (người thuê vận chuyển, trả cước)
  for r in
    -- Trùng mã: lấy bản ghi được dùng nhiều nhất trên đơn/xe làm bản chính (bản thừa thường do nhập file lỗi)
    select upper(legacy.txt(d.data -> 'code')) as code,
           array_agg(d.doc_id order by d.refs desc, d.doc_id) as ids,
           (array_agg(legacy.txt(d.data -> 'name') order by d.refs desc, d.doc_id))[1] as name,
           (array_agg(legacy.txt(d.data -> 'taxCode') order by d.refs desc, legacy.txt(d.data -> 'taxCode') nulls last))[1] as tax,
           (array_agg(legacy.txt(d.data -> 'address') order by d.refs desc, legacy.txt(d.data -> 'address') nulls last))[1] as addr,
           (array_agg(legacy.bool(d.data -> 'isExternal') order by d.refs desc, d.doc_id))[1] as ext,
           count(distinct legacy.bool(d.data -> 'isExternal')) > 1 as ext_conflict
    from (select c.*, (select count(*) from legacy.raw_docs o where o.collection in ('orders', 'shipmentDetails')
                         and o.data ->> 'companyId' = c.doc_id) as refs
          from legacy.raw_docs c where c.collection = 'companies') d
    where not exists (select 1 from legacy.id_map m where m.collection = 'companies' and m.doc_id = d.doc_id)
    group by 1
  loop
    select c.id into v_id from public.customers c
    where c.code = r.code or (r.tax is not null and c.tax_code = r.tax) limit 1;
    if v_id is null then
      insert into public.customers (code, name, tax_code, billing_address, is_shipper, is_payer, custom_fields)
      values (r.code, coalesce(r.name, r.code), r.tax, r.addr, true, true,
              jsonb_build_object('is_external', r.ext, 'legacy_ids', to_jsonb(r.ids)))
      returning id into v_id;
    end if;
    insert into legacy.id_map (collection, doc_id, target_table, target_id)
    select 'companies', x, 'customers', v_id from unnest(r.ids) x on conflict do nothing;
    if array_length(r.ids, 1) > 1 then
      insert into legacy.import_log (level, collection, message) values ('warn', 'companies',
        format('Công ty %s có %s bản ghi trùng mã, đã gộp làm 1%s', r.code, array_length(r.ids, 1),
               case when r.ext_conflict then '; ô "bên ngoài" lấy theo bản ghi được dùng trên đơn nhiều nhất: ' || case when r.ext then 'bên ngoài' else 'không phải bên ngoài' end else '' end));
    end if;
  end loop;
  insert into _rep select 1, 'Công ty xuất hàng → Khách hàng', (select count(*) from raw_docs where collection = 'companies'),
    (select count(distinct target_id) from id_map where collection = 'companies'), 'gộp theo mã công ty';

  -- 2. Kho / điểm nhận -> Địa điểm
  for r in
    select d.doc_id, d.data from legacy.raw_docs d
    where d.collection = 'warehouses' and legacy.map_id('warehouses', d.doc_id, 'locations') is null
    order by legacy.txt(d.data -> 'name')
  loop
    insert into public.locations (name, company_name, full_address, billing_address, phone, google_maps_url, custom_fields)
    values (coalesce(legacy.txt(r.data -> 'name'), r.doc_id), legacy.txt(r.data -> 'name'),
            coalesce(legacy.txt(r.data -> 'address'), legacy.txt(r.data -> 'name'), r.doc_id),
            coalesce(legacy.txt(r.data -> 'invoiceInfo'), legacy.txt(r.data -> 'x_mvg6qt1q')),
            left(legacy.txt(r.data -> 'contactPhone'), 100), legacy.txt(r.data -> 'mapLink'),
            jsonb_build_object('location_kind', 'pickup', 'has_gate_control', legacy.bool(r.data -> 'hasGateControl'),
                               'legacy_id', r.doc_id, 'legacy', legacy.strip_images(r.data)))
    returning id into v_id;
    insert into legacy.id_map values ('warehouses', r.doc_id, 'locations', v_id);
  end loop;
  insert into _rep select 2, 'Kho / điểm nhận → Địa điểm', (select count(*) from raw_docs where collection = 'warehouses'),
    (select count(*) from id_map where collection = 'warehouses'), 'mã tự sinh DDxxx';

  -- 3. Khách hàng (điểm giao) -> Địa điểm giao (giữ mã, MST, thông tin xuất hóa đơn)
  for r in
    select d.doc_id, d.data, upper(legacy.txt(d.data -> 'code')) as code from legacy.raw_docs d
    where d.collection = 'customers' and legacy.map_id('customers', d.doc_id, 'locations') is null
    order by legacy.txt(d.data -> 'code'), d.doc_id
  loop
    v_code := r.code;
    if v_code is not null and exists (select 1 from public.locations l where l.code = v_code) then
      v_n := 2;
      while exists (select 1 from public.locations l where l.code = v_code || '-' || v_n) loop v_n := v_n + 1; end loop;
      insert into legacy.import_log (level, collection, doc_id, message)
      values ('warn', 'customers', r.doc_id, format('Mã khách hàng %s dùng cho 2 điểm giao khác nhau, điểm này mang mã %s', v_code, v_code || '-' || v_n));
      v_code := v_code || '-' || v_n;
    end if;
    insert into public.locations (code, name, company_name, full_address, tax_code, billing_address, phone, google_maps_url, custom_fields)
    values (v_code, coalesce(legacy.txt(r.data -> 'name'), r.doc_id), legacy.txt(r.data -> 'name'),
            coalesce(legacy.txt(r.data -> 'address'), legacy.txt(r.data -> 'name'), r.doc_id),
            legacy.txt(r.data -> 'taxCode'), legacy.txt(r.data -> 'invoiceInfo'),
            left(legacy.txt(r.data -> 'phone'), 100), legacy.txt(r.data -> 'mapLink'),
            jsonb_strip_nulls(jsonb_build_object('location_kind', 'delivery', 'legacy_id', r.doc_id,
              'receiver_phone', legacy.txt(r.data -> 'receiverPhone'),
              'delivery_contact_phone', legacy.txt(r.data -> 'deliveryContactPhone'),
              'legacy', legacy.strip_images(r.data))))
    returning id into v_id;
    insert into legacy.id_map values ('customers', r.doc_id, 'locations', v_id);
  end loop;
  insert into _rep select 3, 'Khách hàng (điểm giao) → Địa điểm', (select count(*) from raw_docs where collection = 'customers'),
    (select count(*) from id_map where collection = 'customers'), 'giữ mã khách hàng cũ';

  -- 4. Mã hàng -> Danh mục mã hàng
  for r in
    select d.doc_id, d.data, upper(legacy.txt(d.data -> 'code')) as code from legacy.raw_docs d
    where d.collection = 'products' and legacy.map_id('products', d.doc_id, 'products') is null
    order by 3, d.doc_id
  loop
    select p.id into v_id from public.products p where p.code = r.code;
    if v_id is null then
      insert into public.products (code, name, unit, kg_per_unit, custom_fields)
      values (r.code, coalesce(legacy.txt(r.data -> 'name'), r.code), coalesce(upper(legacy.txt(r.data -> 'unit')), 'KG'),
              case upper(coalesce(legacy.txt(r.data -> 'unit'), 'KG')) when 'KG' then 1 when 'TẤN' then 1000 when 'TAN' then 1000 end,
              jsonb_build_object('legacy_id', r.doc_id))
      returning id into v_id;
    else
      insert into legacy.import_log (level, collection, doc_id, message)
      values ('warn', 'products', r.doc_id, format('Mã hàng %s trùng, đã gộp vào mã có sẵn', r.code));
    end if;
    insert into legacy.id_map values ('products', r.doc_id, 'products', v_id);
  end loop;
  insert into _rep select 4, 'Mã hàng → Danh mục mã hàng', (select count(*) from raw_docs where collection = 'products'),
    (select count(distinct target_id) from id_map where collection = 'products'), 'ĐVT KG quy đổi 1 kg';

  -- 5. Đơn vị vận tải và 3-PL -> Nhà cung cấp (nhà xe)
  for r in
    select d.doc_id, d.data from legacy.raw_docs d
    where d.collection = 'carriers' and legacy.map_id('carriers', d.doc_id, 'suppliers') is null order by d.doc_id
  loop
    insert into public.suppliers (name, email, notes, custom_fields)
    values (coalesce(legacy.txt(r.data -> 'name'), r.doc_id),
            case when legacy.txt(r.data -> 'email') not like '%@qlvt.local' then legacy.txt(r.data -> 'email') end,
            'Đơn vị vận tải (app cũ)',
            jsonb_strip_nulls(jsonb_build_object(
              'supplier_kind', case when legacy.bool(r.data -> 'isSelfPickup') then 'self_pickup'
                                    when legacy.bool(r.data -> 'isInternalFleet') then 'internal_fleet' else 'carrier' end,
              'legacy_login', legacy.txt(r.data -> 'email'), 'legacy_id', r.doc_id)))
    returning id into v_id;
    insert into legacy.id_map values ('carriers', r.doc_id, 'suppliers', v_id);
  end loop;
  for r in
    select d.doc_id, d.data from legacy.raw_docs d
    where d.collection = 'subCarriers' and legacy.map_id('subCarriers', d.doc_id, 'suppliers') is null order by d.doc_id
  loop
    insert into public.suppliers (name, notes, custom_fields)
    values (coalesce(legacy.txt(r.data -> 'name'), r.doc_id),
            '3-PL thuộc ' || coalesce(legacy.txt(r.data -> 'carrierName'), '?'),
            jsonb_strip_nulls(jsonb_build_object('supplier_kind', '3pl',
              'short_code', case when legacy.txt(r.data -> 'code') not like '%@%' then legacy.txt(r.data -> 'code') end,
              'legacy_login', case when legacy.txt(r.data -> 'code') like '%@%' then legacy.txt(r.data -> 'code') end,
              'parent_supplier_id', legacy.map_id('carriers', legacy.txt(r.data -> 'carrierId'), 'suppliers'),
              'legacy_id', r.doc_id)))
    returning id into v_id;
    insert into legacy.id_map values ('subCarriers', r.doc_id, 'suppliers', v_id);
  end loop;
  insert into _rep select 5, 'Đơn vị vận tải + 3-PL → Nhà cung cấp',
    (select count(*) from raw_docs where collection in ('carriers', 'subCarriers')),
    (select count(*) from id_map where collection in ('carriers', 'subCarriers')), 'đánh dấu loại: carrier / 3pl / internal_fleet / self_pickup';

  -- 6. Tài xế: hồ sơ tài xế + xe nội bộ + tài xế ghi trên chuyến (gộp theo CCCD, không có CCCD thì theo tên)
  create temp table _drv on commit drop as
  with src as (
    select 'driverProfiles' as col, d.doc_id, legacy.txt(d.data -> 'driverName') as name, legacy.txt(d.data -> 'idNumber') as idno,
           legacy.txt(d.data -> 'carrierId') as carrier_id, null::text as sub_id, legacy.plate(legacy.txt(d.data -> 'truckNo')) as plate,
           false as internal, legacy.ts(d.data -> 'updatedAt') as at
    from legacy.raw_docs d where d.collection = 'driverProfiles'
    union all
    select 'internalTrucks', d.doc_id, legacy.txt(d.data -> 'driverName'), legacy.txt(d.data -> 'driverIdNumber'),
           legacy.txt(d.data -> 'carrierId'), null, legacy.plate(legacy.txt(d.data -> 'truckNo')), true, null
    from legacy.raw_docs d where d.collection = 'internalTrucks'
    union all
    select 'shipmentDetails', d.doc_id, legacy.txt(d.data -> 'driverName'), legacy.txt(d.data -> 'driverIdNumber'),
           legacy.txt(d.data -> 'carrierId'), legacy.txt(d.data -> 'subCarrierId'), legacy.plate(legacy.txt(d.data -> 'truckNo')), false,
           legacy.ts(d.data -> 'createdAt')
    from legacy.raw_docs d where d.collection = 'shipmentDetails'
  )
  select *, case when regexp_replace(coalesce(idno, ''), '\s', '', 'g') ~ '^[0-9]{9,12}$'
                 then 'ID:' || regexp_replace(idno, '\s', '', 'g')
                 else 'NM:' || upper(regexp_replace(btrim(name), '\s+', ' ', 'g')) end as dkey
  from src where name is not null;

  for r in
    select dkey,
           (array_agg(name order by internal desc, at desc nulls last))[1] as name,
           (array_agg(idno order by internal desc, at desc nulls last) filter (where idno ~ '^[0-9\s]{9,14}$'))[1] as idno,
           bool_or(internal) as internal,
           (array_agg(coalesce(nullif(sub_id, ''), carrier_id) order by internal desc, at desc nulls last))[1] as owner_id,
           array_agg(distinct plate) filter (where plate is not null) as plates
    from _drv group by dkey order by 2
  loop
    v_id := (select m.target_id from legacy.id_map m where m.collection = 'drivers' and m.doc_id = r.dkey);
    if v_id is null then
      insert into public.drivers (full_name, is_outsourced, supplier_id, notes, custom_fields)
      values (r.name, not r.internal,
              coalesce(legacy.map_id('subCarriers', r.owner_id, 'suppliers'), legacy.map_id('carriers', r.owner_id, 'suppliers')),
              'Chuyển từ app cũ', jsonb_build_object('legacy_key', r.dkey, 'legacy_plates', to_jsonb(r.plates)))
      returning id into v_id;
      if r.idno is not null then
        insert into public.driver_sensitive (driver_id, national_id) values (v_id, regexp_replace(r.idno, '\s', '', 'g'));
      end if;
      insert into legacy.id_map values ('drivers', r.dkey, 'drivers', v_id);
    end if;
  end loop;
  insert into _rep select 6, 'Tài xế (hồ sơ + xe nội bộ + trên chuyến)', (select count(distinct dkey) from _drv),
    (select count(*) from id_map where collection = 'drivers'), 'gộp theo CCCD, không có CCCD thì theo tên; ảnh CCCD giữ ở bản gốc';

  -- 7. Phương tiện: xe nội bộ + mọi biển số đã chạy chuyến (trừ "KHÁCH HÀNG" tự lấy)
  --    Phân loại: có số container => Đầu kéo, còn lại => Xe tải (cần kiểm lại trong danh sách xe)
  for r in
    with plates as (
      select legacy.plate(legacy.txt(d.data -> 'truckNo')) as plate, legacy.txt(d.data -> 'truckNo') as raw,
             true as internal, legacy.txt(d.data -> 'carrierId') as owner_id, false as has_cont, d.doc_id,
             legacy.txt(d.data -> 'driverName') as dname, legacy.txt(d.data -> 'driverIdNumber') as didno, null::timestamptz as at
      from legacy.raw_docs d where d.collection = 'internalTrucks'
      union all
      select legacy.plate(legacy.txt(d.data -> 'truckNo')), legacy.txt(d.data -> 'truckNo'), false,
             coalesce(legacy.txt(d.data -> 'subCarrierId'), legacy.txt(d.data -> 'carrierId')),
             legacy.txt(d.data -> 'contNo') is not null, d.doc_id, null, null, legacy.ts(d.data -> 'createdAt')
      from legacy.raw_docs d where d.collection = 'shipmentDetails'
    )
    select plate, bool_or(internal) as internal, bool_or(has_cont) as has_cont,
           (array_agg(raw order by internal desc, at desc nulls last))[1] as raw,
           array_agg(distinct raw) as raws,
           (array_agg(owner_id order by internal desc, at desc nulls last))[1] as owner_id,
           (array_agg(case when internal then 'NM:' || upper(regexp_replace(btrim(dname), '\s+', ' ', 'g')) end) filter (where internal))[1] as dname_key,
           (array_agg(case when internal and regexp_replace(coalesce(didno, ''), '\s', '', 'g') ~ '^[0-9]{9,12}$'
                           then 'ID:' || regexp_replace(didno, '\s', '', 'g') end) filter (where internal))[1] as did_key
    from plates
    where plate is not null and plate !~ '^KH' and plate <> upper('KHÁCHHÀNG')
    group by plate
  loop
    continue when r.plate ~ '^[^0-9]';  -- chữ "KHÁCH HÀNG" và các giá trị không phải biển số
    select v.id into v_id from public.vehicles v
    where upper(regexp_replace(v.plate_number, '[^A-Za-z0-9]', '', 'g')) = r.plate;
    if v_id is null then
      insert into public.vehicles (code, plate_number, vehicle_type_id, vehicle_kind, ownership_type, supplier_id, notes, custom_fields)
      values (r.plate, r.raw,
              (select id from public.vehicle_types where code = case when r.has_cont then 'DK' else 'XT' end),
              case when r.has_cont then 'tractor' else 'truck' end,
              case when r.internal then 'owned' else 'outsourced' end,
              case when not r.internal then coalesce(legacy.map_id('subCarriers', r.owner_id, 'suppliers'), legacy.map_id('carriers', r.owner_id, 'suppliers')) end,
              'Loại xe suy ra từ app cũ: ' || case when r.has_cont then 'có chở container → đầu kéo' else 'không chở container → xe tải' end || ' (cần kiểm lại)',
              jsonb_build_object('legacy_plates', to_jsonb(r.raws), 'kind_inferred', true))
      returning id into v_id;
      if r.internal then
        update public.vehicles set assigned_driver_id = coalesce(
          (select target_id from legacy.id_map where collection = 'drivers' and doc_id = r.did_key),
          (select target_id from legacy.id_map where collection = 'drivers' and doc_id = r.dname_key))
        where id = v_id
          and not exists (select 1 from public.vehicles x where x.assigned_driver_id = coalesce(
            (select target_id from legacy.id_map where collection = 'drivers' and doc_id = r.did_key),
            (select target_id from legacy.id_map where collection = 'drivers' and doc_id = r.dname_key)));
      end if;
    end if;
    insert into legacy.id_map values ('plates', r.plate, 'vehicles', v_id) on conflict do nothing;
    if array_length(r.raws, 1) > 1 then
      insert into legacy.import_log (level, collection, doc_id, message)
      values ('info', 'vehicles', r.plate, 'Gộp các cách ghi biển số: ' || array_to_string(r.raws, ', '));
    end if;
    if r.plate !~ '^[0-9]{2}[A-Z]{1,2}[0-9]{4,6}$' then
      insert into legacy.import_log (level, collection, doc_id, message)
      values ('warn', 'vehicles', r.plate, 'Biển số không đúng dạng thường gặp: ' || r.raw || ' (kiểm lại)');
    end if;
  end loop;
  insert into _rep select 7, 'Phương tiện', (select count(*) from raw_docs where collection = 'internalTrucks'),
    (select count(*) from id_map where collection = 'plates'), 'gồm xe nội bộ + xe 3-PL đã chạy; gộp biển số viết khác nhau';

  -- Khách hàng dự phòng khi đơn không có công ty
  select id into v_unknown_customer from public.customers where code = 'CHUARO';

  -- 8. Đơn hàng: các dòng mã hàng cùng Số shipment -> 1 đơn cha + nhiều dòng mã hàng
  for r in
    select legacy.txt(d.data -> 'shipmentNo') as shp,
           array_agg(d.doc_id order by d.data ->> 'createdAt', d.doc_id) as ids,
           (array_agg(d.data order by d.data ->> 'createdAt', d.doc_id))[1] as h,
           string_agg(distinct legacy.txt(d.data -> 'orderNo'), ', ') as order_nos,
           string_agg(distinct legacy.txt(d.data -> 'voucherNo'), ', ') as vouchers,
           string_agg(distinct legacy.txt(d.data -> 'notes'), '; ') as notes,
           string_agg(distinct legacy.txt(d.data -> 'destinationPoint'), '; ') as dest,
           count(distinct legacy.txt(d.data -> 'customerId')) as n_cust,
           bool_and(legacy.txt(d.data -> 'status') = 'fully_split') as all_split
    from legacy.raw_docs d
    where d.collection = 'orders' and legacy.txt(d.data -> 'shipmentNo') is not null
    group by 1 order by 1
  loop
    v_id := (select m.target_id from legacy.id_map m where m.collection = 'orderShipments' and m.doc_id = r.shp);
    if v_id is null then
      if legacy.map_id('companies', legacy.txt(r.h -> 'companyId'), 'customers') is null and v_unknown_customer is null then
        insert into public.customers (code, name, notes) values ('CHUARO', 'Chưa rõ công ty (dữ liệu cũ)', 'Tạo khi chuyển dữ liệu cũ cho đơn không có công ty xuất hàng')
        returning id into v_unknown_customer;
      end if;
      insert into public.transport_orders (order_code, order_date, delivery_date, company_entity_id, customer_id, payer_customer_id,
        status, notes, ref_no, voucher_no, pickup_location_id, delivery_location_id, destination_note, carrier_supplier_id, custom_fields, created_at)
      values (r.shp,
              coalesce(legacy.dt(r.h -> 'createdAt'), legacy.dt(r.h -> 'deliveryDate'), current_date),
              legacy.dt(r.h -> 'deliveryDate'), v_gha,
              coalesce(legacy.map_id('companies', legacy.txt(r.h -> 'companyId'), 'customers'), v_unknown_customer),
              coalesce(legacy.map_id('companies', legacy.txt(r.h -> 'companyId'), 'customers'), v_unknown_customer),
              'open', r.notes, r.order_nos, r.vouchers,
              legacy.resolve_location('warehouses', legacy.txt(r.h -> 'warehouseId'), null, legacy.txt(r.h -> 'warehouseName'), null),
              legacy.resolve_location('customers', legacy.txt(r.h -> 'customerId'), legacy.txt(r.h -> 'customerCode'),
                                      legacy.txt(r.h -> 'customerName'), legacy.txt(r.h -> 'customerAddress')),
              r.dest,
              coalesce(legacy.map_id('subCarriers', legacy.txt(r.h -> 'subCarrierId'), 'suppliers'),
                       legacy.map_id('carriers', legacy.txt(r.h -> 'carrierId'), 'suppliers')),
              jsonb_strip_nulls(jsonb_build_object('legacy_order_line_ids', to_jsonb(r.ids),
                'created_by_carrier', case when legacy.bool(r.h -> 'createdByCarrier') then true end)),
              coalesce(legacy.ts(r.h -> 'createdAt'), now()))
      returning id into v_id;
      insert into legacy.id_map values ('orderShipments', r.shp, 'transport_orders', v_id);
      if r.n_cust > 1 then
        insert into legacy.import_log (level, collection, doc_id, message)
        values ('warn', 'orders', r.shp, 'Cùng số shipment nhưng nhiều khách hàng (điểm giao) khác nhau; đơn cha lấy điểm giao của dòng đầu');
      end if;
    end if;
    -- dòng mã hàng
    v_line := coalesce((select max(line_no) from public.transport_order_items where order_id = v_id), 0);
    for it in
      select d.doc_id, d.data from legacy.raw_docs d
      where d.collection = 'orders' and d.doc_id = any (r.ids)
        and legacy.map_id('orders', d.doc_id, 'transport_order_items') is null
      order by array_position(r.ids, d.doc_id)
    loop
      v_line := v_line + 1;
      insert into public.transport_order_items (order_id, line_no, product_id, item_code, item_name, unit, quantity, note, custom_fields)
      values (v_id, v_line, legacy.map_id('products', legacy.txt(it.data -> 'productId'), 'products'),
              legacy.txt(it.data -> 'productCode'), legacy.txt(it.data -> 'productName'), null,
              coalesce(legacy.num(it.data -> 'qty'), 0), null,
              jsonb_strip_nulls(jsonb_build_object('legacy_id', it.doc_id, 'legacy_order_no', legacy.txt(it.data -> 'orderNo'),
                'legacy_registered_qty', legacy.num(it.data -> 'registeredQty'))))
      returning id into v_id;
      insert into legacy.id_map values ('orders', it.doc_id, 'transport_order_items', v_id);
      v_id := (select m.target_id from legacy.id_map m where m.collection = 'orderShipments' and m.doc_id = r.shp);
    end loop;
  end loop;
  insert into _rep select 8, 'Dòng đơn hàng → Đơn cha', (select count(*) from raw_docs where collection = 'orders'),
    (select count(*) from id_map where collection = 'orderShipments'), 'gộp theo số shipment (SHP-...)';
  insert into _rep select 9, 'Dòng đơn hàng → Mã hàng của đơn', (select count(*) from raw_docs where collection = 'orders'),
    (select count(*) from id_map where collection = 'orders'), 'số lượng giữ nguyên';

  -- Loại phí cho cước GHA (tìm theo tên, chưa có thì tạo)
  create temp table _fee_map (cost_key text primary key, fee_name text, fee_kind text, is_loading boolean) on commit drop;
  insert into _fee_map values
    ('x_phi_thu_thu_ve_sp_itc_vict', 'Phụ thu vé (SP-ITC...)', 'revenue', false),
    ('x_phi_phu_thu_ha_trai_tuyen', 'Phụ thu hạ trái tuyến', 'revenue', false),
    ('unloadEmptyFee', 'Phí hạ', 'pass_through', false),
    ('liftFee', 'Phí nâng', 'pass_through', false),
    ('loadingFee', 'Phí bốc xếp', 'pass_through', true),
    ('customsDeclFee', 'Phí tờ khai theo cont', 'revenue', false),
    ('truckDetentionFee', 'Phí neo xe', 'revenue', false),
    ('otherFee', 'Phí bổ sung khác', 'revenue', false);
  -- Trường cước tự thêm ở app cũ (config/costFieldDefs) chưa có trong bảng trên
  select data -> 'fields' into v_fee_defs from legacy.raw_docs where collection = 'config' and doc_id = 'costFieldDefs';
  insert into _fee_map
  select x ->> 'key', left(x ->> 'label', 150), 'revenue', false
  from jsonb_array_elements(coalesce(v_fee_defs, '[]'::jsonb)) x
  where x ->> 'type' = 'number' and x ->> 'key' is not null
  on conflict (cost_key) do nothing;

  -- 9. Xe / chuyến -> Chuyến (1 xe = 1 chuyến, nhiều mã hàng)
  for r in
    select d.doc_id, d.data,
           o.target_id as order_id,
           c.data as cost
    from legacy.raw_docs d
    left join legacy.id_map o on o.collection = 'orderShipments' and o.doc_id = legacy.txt(d.data -> 'parentShipmentNo')
    left join legacy.raw_docs c on c.collection = 'costsGha' and c.doc_id = d.doc_id
    where d.collection = 'shipmentDetails' and legacy.map_id('shipmentDetails', d.doc_id, 'shipments') is null
    order by legacy.txt(d.data -> 'shipmentNo'), d.doc_id
  loop
    if r.order_id is null then
      insert into legacy.import_log (level, collection, doc_id, message)
      values ('warn', 'shipmentDetails', r.doc_id, format('Bỏ qua xe %s: không tìm thấy đơn cha %s',
        legacy.txt(r.data -> 'shipmentNo'), legacy.txt(r.data -> 'parentShipmentNo')));
      continue;
    end if;
    v_costs := coalesce(r.cost -> 'costs', '{}'::jsonb);
    v_unit := legacy.num(v_costs -> 'unitFreightPrice');
    v_freight := legacy.num(v_costs -> 'freightCost');
    v_fuel_rate := legacy.num(v_costs -> 'fuelSupportPercent');
    if v_unit is null then v_unit := v_freight; v_fuel_rate := null; end if;
    v_fuel_amt := case when v_unit is not null and v_fuel_rate is not null then round(v_unit * v_fuel_rate / 100, 0) else 0 end;

    v_code := legacy.txt(r.data -> 'shipmentNo');
    if v_code is null or exists (select 1 from public.shipments s where s.shipment_code = v_code) then
      insert into legacy.import_log (level, collection, doc_id, message)
      values ('warn', 'shipmentDetails', r.doc_id, format('Số chuyến %s trống hoặc trùng, đã cấp số mới', coalesce(v_code, '(trống)')));
      v_code := null;
    end if;

    insert into public.shipments (shipment_code, order_id, sequence_in_order, pickup_at,
      pickup_location_id, delivery_location_id, vehicle_type_id, vehicle_id, driver_id, carrier_supplier_id,
      container_no, unit_price, pricing_unit, quantity, fuel_support_rate, fuel_support_amount,
      status, document_status, arrived_pickup_at, departed_pickup_at, arrived_delivery_at, completed_at,
      delivery_result, completion_note, notes, custom_fields, created_at, dispatch_approval)
    select v_code, r.order_id,
      coalesce((select max(s.sequence_in_order) from public.shipments s where s.order_id = r.order_id), 0) + 1,
      coalesce(legacy.ts(r.data -> 'arrivedAt'), legacy.ts(r.data -> 'registeredAt'),
               legacy.ts(r.data -> 'date') + interval '8 hours', legacy.ts(r.data -> 'createdAt')),
      coalesce(legacy.resolve_location('warehouses', legacy.txt(r.data -> 'warehouseId'), null, legacy.txt(r.data -> 'warehouseName'), null),
               o.pickup_location_id),
      coalesce(case when legacy.txt(r.data -> 'customerId') is not null
                    then legacy.resolve_location('customers', legacy.txt(r.data -> 'customerId'), legacy.txt(r.data -> 'customerCode'),
                                                 legacy.txt(r.data -> 'customerName'), legacy.txt(r.data -> 'customerAddress')) end,
               o.delivery_location_id),
      v.vehicle_type_id, v.id,
      coalesce(
        (select target_id from legacy.id_map where collection = 'drivers' and doc_id =
           'ID:' || regexp_replace(coalesce(legacy.txt(r.data -> 'driverIdNumber'), ''), '\s', '', 'g')),
        (select target_id from legacy.id_map where collection = 'drivers' and doc_id =
           'NM:' || upper(regexp_replace(btrim(coalesce(legacy.txt(r.data -> 'driverName'), '')), '\s+', ' ', 'g')))),
      coalesce(legacy.map_id('subCarriers', legacy.txt(r.data -> 'subCarrierId'), 'suppliers'),
               case when (select custom_fields ->> 'supplier_kind' from public.suppliers
                          where id = legacy.map_id('carriers', legacy.txt(r.data -> 'carrierId'), 'suppliers')) = 'carrier'
                    then legacy.map_id('carriers', legacy.txt(r.data -> 'carrierId'), 'suppliers') end),
      legacy.txt(r.data -> 'contNo'),
      coalesce(v_unit, 0), 'trip', 1, v_fuel_rate, v_fuel_amt,
      case legacy.txt(r.data -> 'status')
        when 'completed' then 'driver_completed'
        when 'waiting_arrival' then 'assigned'
        when 'arrived_pickup' then 'in_transit' when 'waiting_gate' then 'in_transit' when 'in_progress' then 'in_transit'
        when 'waiting_exit' then 'in_transit' when 'waiting_delivery' then 'in_transit' when 'arrived_delivery' then 'in_transit'
        else 'assigned' end,
      case when legacy.txt(r.data -> 'deliveryPhotoUrl') is not null or legacy.txt(r.data -> 'pxkImageUrl') is not null
           then 'submitted' else 'missing' end,
      legacy.ts(r.data -> 'arrivedAt'), legacy.ts(r.data -> 'receivedAt'), legacy.ts(r.data -> 'arrivedDeliveryAt'),
      case when legacy.txt(r.data -> 'status') = 'completed'
           then coalesce(legacy.ts(r.data -> 'deliveredAt'), legacy.ts(r.data -> 'confirmedAt'), legacy.ts(r.data -> 'arrivedDeliveryAt')) end,
      case when legacy.txt(r.data -> 'status') = 'completed' then 'full' end,
      legacy.txt(r.data -> 'confirmNote'),
      nullif(concat_ws('; ', legacy.txt(v_costs -> 'notes'),
                       case when legacy.plate(legacy.txt(r.data -> 'truckNo')) !~ '^[0-9]' then 'Xe: ' || legacy.txt(r.data -> 'truckNo') end), ''),
      jsonb_strip_nulls(jsonb_build_object(
        'legacy_id', r.doc_id,
        'legacy_truck_no', legacy.txt(r.data -> 'truckNo'),
        'legacy_driver_name', legacy.txt(r.data -> 'driverName'),
        'legacy_driver_id_number', legacy.txt(r.data -> 'driverIdNumber'),
        'self_pickup', case when legacy.plate(legacy.txt(r.data -> 'truckNo')) !~ '^[0-9]' then true end,
        'origin_point', legacy.txt(r.data -> 'originPoint'),
        'destination_point', legacy.txt(r.data -> 'destinationPoint'),
        'voucher_no', legacy.txt(r.data -> 'voucherNo'),
        'legacy_order_no', legacy.txt(r.data -> 'orderNo'),
        'has_gate_control', legacy.bool(r.data -> 'hasGateControl'),
        'confirmed_by', legacy.txt(r.data -> 'confirmedByName'),
        'confirmed_on_behalf', case when legacy.bool(r.data -> 'confirmedOnBehalf') then true end,
        'completed_by_admin', case when legacy.bool(r.data -> 'completedByAdmin') then true end,
        'returned_from', legacy.txt(r.data -> 'returnedFrom'),
        'return_info', r.data -> 'returnInfo',
        'gps', jsonb_strip_nulls(jsonb_build_object('arrived', r.data -> 'arrivedLocation', 'received', r.data -> 'receivedLocation',
                 'arrived_delivery', r.data -> 'arrivedDeliveryLocation', 'delivered', r.data -> 'deliveredLocation')),
        'legacy_photos', jsonb_strip_nulls(jsonb_build_object(
                 'delivery', case when legacy.txt(r.data -> 'deliveryPhotoUrl') is not null then true end,
                 'pxk', case when legacy.txt(r.data -> 'pxkImageUrl') is not null then true end,
                 'driver_id', case when legacy.txt(r.data -> 'driverIdImageUrl') is not null then true end)),
        'legacy_cost_gha', case when r.cost is not null then v_costs end,
        'legacy_cost_updated_by', legacy.txt(r.cost -> 'updatedBy'))),
      coalesce(legacy.ts(r.data -> 'createdAt'), now()),
      'not_required'
    from public.transport_orders o
    left join public.vehicles v on v.id = legacy.map_id('plates', legacy.plate(legacy.txt(r.data -> 'truckNo')), 'vehicles')
    where o.id = r.order_id
    returning id into v_id;
    insert into legacy.id_map values ('shipmentDetails', r.doc_id, 'shipments', v_id);

    -- hàng trên xe
    v_line := 0;
    for it in select x, ord from jsonb_array_elements(coalesce(r.data -> 'items', '[]'::jsonb)) with ordinality as t(x, ord) loop
      v_line := v_line + 1;
      insert into public.shipment_items (shipment_id, line_no, product_id, order_item_id, item_code, item_name, quantity, custom_fields)
      values (v_id, v_line, legacy.map_id('products', legacy.txt(it.x -> 'productId'), 'products'),
              legacy.map_id('orders', legacy.txt(it.x -> 'orderId'), 'transport_order_items'),
              legacy.txt(it.x -> 'productCode'), legacy.txt(it.x -> 'productName'), legacy.num(it.x -> 'qty'),
              jsonb_build_object('legacy_order_line_id', legacy.txt(it.x -> 'orderId')));
    end loop;

    -- phụ phí / chi hộ từ cước GHA
    v_line := 0; v_extra := 0; v_pass := 0; v_xsum := 0;
    for f in select m.*, legacy.num(v_costs -> m.cost_key) as amt from _fee_map m
             where legacy.num(v_costs -> m.cost_key) is not null and legacy.num(v_costs -> m.cost_key) <> 0 loop
      select ft.id, ft.fee_kind into v_fee_type, v_fee_kind from public.fee_types ft
      where lower(ft.name) = lower(f.fee_name) order by ft.is_active desc, ft.code limit 1;
      if v_fee_type is null then
        insert into public.fee_types (name, fee_kind, is_loading, description)
        values (f.fee_name, f.fee_kind, f.is_loading, 'Tạo khi chuyển dữ liệu cước từ app cũ (' || f.cost_key || ')')
        returning id, fee_kind into v_fee_type, v_fee_kind;
      end if;
      if f.amt < 0 then
        insert into legacy.import_log (level, collection, doc_id, message)
        values ('warn', 'costsGha', r.doc_id, format('%s âm (%s), không chuyển được, cần nhập tay', f.fee_name, f.amt));
        continue;
      end if;
      v_line := v_line + 1;
      insert into public.shipment_fees (shipment_id, line_no, fee_type_id, fee_kind, amount, note, ref_no)
      values (v_id, v_line, v_fee_type, v_fee_kind, round(f.amt, 0),
              case when f.cost_key = 'otherFee' then legacy.txt(v_costs -> 'otherFeeReason') end,
              case when f.cost_key = 'unloadEmptyFee' then left(legacy.txt(v_costs -> 'invoiceNo'), 100) end);
      if v_fee_kind = 'pass_through' then v_pass := v_pass + round(f.amt, 0); else v_extra := v_extra + round(f.amt, 0); end if;
      if f.cost_key like 'x\_%' then v_xsum := v_xsum + f.amt; end if;
    end loop;
    update public.shipments set extra_fee_amount = v_extra, pass_through_amount = v_pass where id = v_id;

    -- Đối chiếu: cước cũ = đơn giá + hỗ trợ dầu + phụ thu (theo công thức app cũ)
    if v_freight is not null and abs(v_freight - (coalesce(v_unit, 0) + v_fuel_amt + v_xsum)) > 1 then
      insert into legacy.import_log (level, collection, doc_id, message)
      values ('warn', 'costsGha', r.doc_id, format('Chuyến %s: cước cũ %s ≠ đơn giá %s + dầu %s + phụ thu %s; đã giữ đơn giá/dầu/phụ thu, số gốc ở custom_fields.legacy_cost_gha',
        legacy.txt(r.data -> 'shipmentNo'), v_freight, coalesce(v_unit, 0), v_fuel_amt, v_xsum));
    end if;
  end loop;
  insert into _rep select 10, 'Xe / chuyến → Chuyến', (select count(*) from raw_docs where collection = 'shipmentDetails'),
    (select count(*) from id_map where collection = 'shipmentDetails'), 'trạng thái "Hoàn thành" → chờ kế toán đóng chuyến';
  insert into _rep select 11, 'Cước GHA → giá + phụ phí của chuyến', (select count(*) from raw_docs where collection = 'costsGha'),
    (select count(*) from raw_docs c join id_map m on m.collection = 'shipmentDetails' and m.doc_id = c.doc_id where c.collection = 'costsGha'),
    'xem bảng đối chiếu tiền bên dưới';

  -- Cước không gắn được xe
  insert into legacy.import_log (level, collection, doc_id, message)
  select 'warn', 'costsGha', c.doc_id, 'Cước của xe ' || coalesce(legacy.txt(c.data -> 'shipmentNo'), '?') || ' không còn xe tương ứng, chưa chuyển'
  from legacy.raw_docs c
  where c.collection = 'costsGha' and not exists (select 1 from legacy.id_map m where m.collection = 'shipmentDetails' and m.doc_id = c.doc_id)
    and not exists (select 1 from legacy.import_log l where l.collection = 'costsGha' and l.doc_id = c.doc_id);

  -- Đơn cha: hoàn tất khi mọi chuyến đã xong và đã xếp đủ hàng
  update public.transport_orders o set status = 'completed'
  where o.id in (select target_id from legacy.id_map where collection = 'orderShipments')
    and exists (select 1 from public.shipments s where s.order_id = o.id)
    and not exists (select 1 from public.shipments s where s.order_id = o.id and s.status not in ('driver_completed', 'closed', 'cancelled'))
    and not exists (select 1 from public.order_item_balance b where b.order_id = o.id and b.remaining_quantity > 0);

  -- Phần giữ nguyên trong legacy.raw_docs, chưa chuyển
  insert into _rep
  select 20, 'Giữ ở bản gốc, chưa chuyển: ' || d.collection, count(*)::int, 0,
         case d.collection when 'users' then 'tài khoản: cấp lại ở hệ thống mới (mật khẩu cũ không dùng được)'
                           when 'config' then 'cấu hình trường/công thức cũ (đã dùng để tạo loại phí)'
                           else 'chuyển ở bước làm module tương ứng' end
  from legacy.raw_docs d
  where d.collection in ('users', 'config', 'eirRequests', 'eirPrivate', 'tripFinance', 'payReqs', 'overheadExpenses',
                         'travelClaims', 'quotes', 'priceLists', 'financeSettings', 'costs3pl', 'ownerClaim')
  group by d.collection;

  perform legacy.enable_guards();
  return query select _rep.buoc, _rep.nguon, _rep.da_chuyen, _rep.ghi_chu from _rep order by _rep.ord, _rep.buoc;
end $$;


-- Chạy thử toàn bộ rồi HỦY (dùng khi chỉ gọi được từng câu lệnh rời, VD qua API quản lý của Supabase).
-- Trả về jsonb: kết quả từng bước, đối chiếu, cảnh báo. Không ghi gì (trừ legacy.raw_docs đã nạp trước đó).
create or replace function legacy.dry_run() returns jsonb
language plpgsql as $$
declare res jsonb;
begin
  begin
    select jsonb_build_object('buoc', jsonb_agg(to_jsonb(r))) into res from legacy.run_import() r;
    res := res || jsonb_build_object(
      'doi_chieu', (select jsonb_agg(to_jsonb(c)) from legacy.reconcile c),
      'canh_bao', (select jsonb_agg(jsonb_build_object('level', l.level, 'collection', l.collection, 'doc_id', l.doc_id, 'message', l.message) order by l.id) from legacy.import_log l));
    raise exception using errcode = 'P0001', message = '__chay_thu_huy__';
  exception when sqlstate 'P0001' then
    if sqlerrm <> '__chay_thu_huy__' then raise; end if;
  end;
  return res;
end $$;

-- Nạp thẳng một lô bản ghi (mảng [{collection, doc_id, data}]) vào legacy.raw_docs, dùng khi không gửi được cả file một lần
create or replace function legacy.load_docs(p_docs jsonb) returns integer
language sql as $$
  with ins as (
    insert into legacy.raw_docs (collection, doc_id, data)
    select x ->> 'collection', x ->> 'doc_id', x -> 'data' from jsonb_array_elements(p_docs) x
    on conflict on constraint raw_docs_pkey do update set data = excluded.data, loaded_at = now()
    returning 1)
  select count(*)::int from ins
$$;

-- Đối chiếu số liệu cũ ↔ mới (chạy sau run_import)
create or replace view legacy.reconcile as
with old_sd as (
  select d.doc_id, legacy.num(d.data -> 'qty') as qty,
         legacy.num(c.data #> '{costs,freightCost}') as freight,
         (select coalesce(sum(legacy.num(c.data -> 'costs' -> k)), 0) from unnest(array['loadingFee', 'unloadEmptyFee', 'liftFee', 'customsDeclFee', 'truckDetentionFee', 'otherFee']) k) as fees_other
  from legacy.raw_docs d left join legacy.raw_docs c on c.collection = 'costsGha' and c.doc_id = d.doc_id
  where d.collection = 'shipmentDetails'
), new_s as (
  select s.id, s.custom_fields ->> 'legacy_id' as legacy_id, s.freight_amount + s.fuel_support_amount as base,
         s.extra_fee_amount, s.pass_through_amount,
         (select coalesce(sum(i.quantity), 0) from public.shipment_items i where i.shipment_id = s.id) as qty
  from public.shipments s where s.custom_fields ? 'legacy_id'
)
select 'Số chuyến' as chi_tieu, (select count(*) from old_sd)::numeric as cu, (select count(*) from new_s)::numeric as moi
union all select 'Tổng số lượng hàng trên xe (kg)', (select sum(qty) from old_sd), (select sum(qty) from new_s)
union all select 'Tổng số lượng đơn hàng (kg)',
  (select sum(legacy.num(data -> 'qty')) from legacy.raw_docs where collection = 'orders'),
  (select sum(quantity) from public.transport_order_items i where i.custom_fields ? 'legacy_id')
union all select 'Tổng cước GHA (cước vận chuyển gồm dầu + phụ thu)',
  (select sum(freight) from old_sd),
  (select sum(n.base) + coalesce(sum(n.extra_fee_amount), 0)
     - coalesce((select sum(f.amount) from public.shipment_fees f join public.fee_types t on t.id = f.fee_type_id
                 join new_s x on x.id = f.shipment_id
                 where f.fee_kind = 'revenue' and t.name in ('Phí neo xe', 'Phí tờ khai theo cont', 'Phí bổ sung khác')), 0)
   from new_s n)
union all select 'Tổng phí khác (bốc xếp, hạ, nâng, tờ khai, neo, khác)',
  (select sum(fees_other) from old_sd),
  (select coalesce(sum(f.amount), 0) from public.shipment_fees f join public.fee_types t on t.id = f.fee_type_id
   join new_s x on x.id = f.shipment_id
   where f.fee_kind = 'pass_through' or t.name in ('Phí neo xe', 'Phí tờ khai theo cont', 'Phí bổ sung khác'));
