-- =============================================================================
-- GHA-TMS 9003: gộp tài xế trùng tên do dữ liệu cũ ghi CCCD khác nhau / thiếu CCCD
-- (một người có 2 dòng). Giữ dòng có CCCD và nhiều chuyến nhất, chuyển mọi chuyến,
-- xe, tạm ứng... sang dòng giữ lại, ghi CCCD còn lại vào ghi chú rồi xóa dòng thừa.
-- =============================================================================

create or replace function legacy.merge_driver(p_keep uuid, p_drop uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  fk record;
  v_other text;
begin
  if p_keep = p_drop then return; end if;
  -- CCCD: giữ CCCD của dòng giữ lại; CCCD của dòng thừa ghi vào ghi chú
  select national_id into v_other from public.driver_sensitive where driver_id = p_drop;
  if not exists (select 1 from public.driver_sensitive where driver_id = p_keep) then
    update public.driver_sensitive set driver_id = p_keep where driver_id = p_drop;
    v_other := null;
  else
    delete from public.driver_sensitive where driver_id = p_drop;
  end if;
  update public.drivers k
     set notes = concat_ws(E'\n', nullif(k.notes, ''),
                   'Gộp từ dòng trùng tên' || coalesce(' (CCCD khác: ' || v_other || ')', '')),
         custom_fields = k.custom_fields || jsonb_build_object('legacy_merged_keys',
                   coalesce(k.custom_fields -> 'legacy_merged_keys', '[]'::jsonb) || jsonb_build_array(d.custom_fields ->> 'legacy_key'))
    from public.drivers d
   where k.id = p_keep and d.id = p_drop;

  for fk in
    select n.nspname, c.relname, a.attname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.contype = 'f' and con.confrelid = 'public.drivers'::regclass
      and not (n.nspname = 'public' and c.relname = 'driver_sensitive')
  loop
    execute format('update %I.%I set %I = $1 where %I = $2', fk.nspname, fk.relname, fk.attname, fk.attname)
      using p_keep, p_drop;
  end loop;

  update legacy.id_map set target_id = p_keep where collection = 'drivers' and target_id = p_drop;
  delete from public.drivers where id = p_drop;
end;
$$;

-- Tên tài xế + CCCD trên từng bản ghi gốc (hồ sơ, xe nội bộ, chuyến)
create or replace view legacy.driver_name_sources as
select upper(regexp_replace(btrim(legacy.txt(d.data -> 'driverName')), '\s+', ' ', 'g')) as nm,
       regexp_replace(coalesce(legacy.txt(d.data -> case d.collection when 'driverProfiles' then 'idNumber' else 'driverIdNumber' end), ''), '\s', '', 'g') as idno
from legacy.raw_docs d
where d.collection in ('driverProfiles', 'internalTrucks', 'shipmentDetails')
  and legacy.txt(d.data -> 'driverName') is not null;

-- Gộp các tài xế chuyển từ app cũ có cùng tên (không phân biệt hoa thường, khoảng trắng)
do $$
declare
  g record;
  v_keep uuid;
  v_drop uuid;
begin
  perform set_config('gha.system_op', 'on', true);
  -- a) Tài xế chỉ có tên (không CCCD) mà bản ghi khác cùng tên có CCCD: gộp vào tài xế có CCCD đó
  for g in
    select n.id as drop_id, k.id as keep_id, n.full_name as nm
    from public.drivers n
    join lateral (
      select distinct 'ID:' || s.idno as key from legacy.driver_name_sources s
      where s.nm = upper(regexp_replace(btrim(n.full_name), '\s+', ' ', 'g')) and s.idno ~ '^[0-9]{9,12}$'
    ) src on true
    join public.drivers k on k.custom_fields ->> 'legacy_key' = src.key
    where n.custom_fields ->> 'legacy_key' like 'NM:%'
  loop
    if exists (select 1 from public.drivers where id = g.drop_id) then
      -- tên trên bản ghi có CCCD có thể gõ sai (VD "TIỄB"): lấy tên của dòng chỉ có tên nếu khác
      update public.drivers set full_name = g.nm where id = g.keep_id and full_name <> g.nm;
      perform legacy.merge_driver(g.keep_id, g.drop_id);
    end if;
  end loop;
  -- b) Cùng tên nhưng CCCD khác (gõ sai số / CMND cũ và CCCD mới): gộp, CCCD còn lại ghi vào ghi chú
  for g in
    select upper(regexp_replace(btrim(d.full_name), '\s+', ' ', 'g')) as nm,
           array_agg(d.id order by (s.national_id is not null) desc,
                     (select count(*) from public.shipments sh where sh.driver_id = d.id) desc,
                     d.created_at) as ids
    from public.drivers d
    left join public.driver_sensitive s on s.driver_id = d.id
    where d.custom_fields ? 'legacy_key'
    group by 1
    having count(*) > 1
  loop
    v_keep := g.ids[1];
    foreach v_drop in array g.ids[2:] loop
      perform legacy.merge_driver(v_keep, v_drop);
    end loop;
  end loop;
end;
$$;
