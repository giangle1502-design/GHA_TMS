-- =============================================================================
-- KHÁNH HÀ TMS - 0066: Thông tin tài xế gửi khách: người dùng tự chọn, đổi tên, sắp xếp, thêm trường (08/11/2026)
--   * system_settings 'driver.share_template': danh sách dòng [{label, source}] dùng chung cho mọi người.
--     source: trường có sẵn (full_name, phone, national_id_issued_date...) hoặc trường bổ sung của tài xế
--     ('cf.<khóa>') / của xe ('vcf.<khóa>').
--   * set_driver_share_template(jsonb): điều phối (dispatch.update) hoặc người cấu hình hệ thống lưu mẫu.
--   * shipment_driver_share(ids): đủ dữ liệu tài xế, giấy tờ, xe, chuyến (dạng jsonb) để ghép theo mẫu.
-- Không xóa dữ liệu.
-- =============================================================================

insert into public.system_settings (key, value, description, is_public) values
  ('driver.share_template',
   '[{"label":"Tên","source":"full_name"},{"label":"Số xe","source":"plate_number"},{"label":"Số CCCD","source":"national_id"},{"label":"Số GPLX","source":"license_no"}]',
   'Mẫu "Thông tin tài xế" gửi khách hàng: các dòng (tên dòng, trường lấy dữ liệu) theo thứ tự', false)
on conflict (key) do nothing;

create or replace function public.set_driver_share_template(p_template jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  it jsonb;
begin
  if not (private.has_perm('dispatch.update') or private.has_perm('settings.configure')) then
    raise exception 'Bạn không có quyền sửa mẫu thông tin tài xế' using errcode = '42501';
  end if;
  if jsonb_typeof(p_template) <> 'array' or jsonb_array_length(p_template) = 0 then
    raise exception 'Mẫu phải có ít nhất một dòng' using errcode = '22023';
  end if;
  if jsonb_array_length(p_template) > 40 then
    raise exception 'Mẫu tối đa 40 dòng' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(p_template) loop
    if jsonb_typeof(it) <> 'object'
       or length(trim(coalesce(it ->> 'label', ''))) not between 1 and 60
       or coalesce(it ->> 'source', '') !~ '^(v?cf\.)?[a-z][a-z0-9_]{0,62}$' then
      raise exception 'Dòng mẫu không hợp lệ: cần tên dòng (tối đa 60 ký tự) và trường dữ liệu' using errcode = '22023';
    end if;
  end loop;
  insert into public.system_settings (key, value, description)
  values ('driver.share_template', p_template, 'Mẫu "Thông tin tài xế" gửi khách hàng')
  on conflict (key) do update set value = excluded.value;
end;
$$;
revoke all on function public.set_driver_share_template(jsonb) from public, anon;
grant execute on function public.set_driver_share_template(jsonb) to authenticated;

create or replace function public.shipment_driver_share(p_shipment_ids uuid[])
returns table (shipment_id uuid, shipment_code text, driver_id uuid, data jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.has_perm('dispatch.view') or private.has_perm('shipments.view')) then
    raise exception 'Bạn không có quyền xem thông tin tài xế của chuyến' using errcode = '42501';
  end if;
  return query
    select s.id, s.shipment_code, d.id,
      case when d.id is null then null else jsonb_build_object(
        'full_name', d.full_name,
        'driver_code', d.code,
        'phone', d.phone,
        'email', d.email,
        'date_of_birth', d.date_of_birth,
        'address', d.address,
        'national_id', ds.national_id,
        'national_id_issued_date', ds.national_id_issued_date,
        'national_id_issued_place', ds.national_id_issued_place,
        'license_no', ds.license_no,
        'license_class', ds.license_class,
        'license_expiry', ds.license_expiry,
        'plate_number', v.plate_number,
        'vehicle_type', vt.name,
        'vehicle_brand', v.brand,
        'shipment_code', s.shipment_code,
        'pickup_at', s.pickup_at,
        'customer_name', c.name,
        'cf', d.custom_fields,
        'vcf', coalesce(v.custom_fields, '{}'::jsonb)) end
    from public.shipments s
    left join public.drivers d on d.id = s.driver_id
    left join public.vehicles v on v.id = s.vehicle_id
    left join public.vehicle_types vt on vt.id = v.vehicle_type_id
    left join public.transport_orders o on o.id = s.order_id
    left join public.customers c on c.id = o.customer_id
    left join public.driver_sensitive ds on ds.driver_id = s.driver_id
    where s.id = any (p_shipment_ids)
    order by s.pickup_at, s.shipment_code;
end;
$$;
revoke all on function public.shipment_driver_share(uuid[]) from public, anon;
grant execute on function public.shipment_driver_share(uuid[]) to authenticated;
