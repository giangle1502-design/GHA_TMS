-- =============================================================================
-- KHÁNH HÀ TMS - 0055: Nút "Thông tin tài xế" ở Điều phối và Quản lý chuyến (02/11/2026)
--   * driver_sensitive thêm Số GPLX (giấy phép lái xe), hạng GPLX, ngày hết hạn GPLX.
--   * shipment_driver_info(ids): trả về tên tài xế, biển số, số CCCD, số GPLX của các chuyến để điều phối
--     chép gửi khách hàng đăng ký xe vào kho / cảng. Người có quyền xem điều phối hoặc chuyến xe dùng được
--     (kể cả khi không có quyền xem giấy tờ tùy thân trong hồ sơ tài xế).
--   * set_driver_share_info: điền nhanh CCCD / GPLX còn thiếu ngay trong hộp thông tin.
--     Người có quyền sửa giấy tờ tài xế sửa được mọi giá trị; điều phối (dispatch.update) chỉ điền ô đang trống.
-- Không xóa dữ liệu.
-- =============================================================================

alter table public.driver_sensitive
  add column if not exists license_no text check (license_no is null or length(license_no) <= 30),
  add column if not exists license_class text check (license_class is null or length(license_class) <= 20),
  add column if not exists license_expiry date;
comment on column public.driver_sensitive.license_no is 'Số giấy phép lái xe (GPLX)';
comment on column public.driver_sensitive.license_class is 'Hạng GPLX (C, FC...)';
comment on column public.driver_sensitive.license_expiry is 'Ngày hết hạn GPLX';

create or replace function public.shipment_driver_info(p_shipment_ids uuid[])
returns table (
  shipment_id uuid,
  shipment_code text,
  driver_id uuid,
  driver_name text,
  plate_number text,
  national_id text,
  license_no text
)
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
    select s.id, s.shipment_code, d.id, d.full_name, v.plate_number, ds.national_id, ds.license_no
    from public.shipments s
    left join public.drivers d on d.id = s.driver_id
    left join public.vehicles v on v.id = s.vehicle_id
    left join public.driver_sensitive ds on ds.driver_id = s.driver_id
    where s.id = any (p_shipment_ids)
    order by s.pickup_at, s.shipment_code;
end;
$$;
revoke all on function public.shipment_driver_info(uuid[]) from public, anon;
grant execute on function public.shipment_driver_info(uuid[]) to authenticated;

create or replace function public.set_driver_share_info(p_driver_id uuid, p_national_id text, p_license_no text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  full_edit boolean := private.has_perm('drivers.view_sensitive') and private.has_perm('drivers.update');
  cur public.driver_sensitive;
  nid text := nullif(regexp_replace(coalesce(p_national_id, ''), '\s', '', 'g'), '');
  lic text := nullif(regexp_replace(coalesce(p_license_no, ''), '\s', '', 'g'), '');
begin
  if not (full_edit or private.has_perm('dispatch.update')) then
    raise exception 'Bạn không có quyền cập nhật giấy tờ tài xế' using errcode = '42501';
  end if;
  if not exists (select 1 from public.drivers where id = p_driver_id) then
    raise exception 'Không tìm thấy tài xế';
  end if;
  if nid is not null and length(nid) > 20 then
    raise exception 'Số CCCD tối đa 20 ký tự';
  end if;
  if lic is not null and length(lic) > 30 then
    raise exception 'Số GPLX tối đa 30 ký tự';
  end if;
  select * into cur from public.driver_sensitive where driver_id = p_driver_id;
  -- Ô để trống: giữ giá trị cũ (xóa thì vào hồ sơ tài xế)
  nid := coalesce(nid, cur.national_id);
  lic := coalesce(lic, cur.license_no);
  if not full_edit then
    -- Điều phối chỉ điền ô đang trống, không sửa giá trị đã có
    if cur.national_id is not null then nid := cur.national_id; end if;
    if cur.license_no is not null then lic := cur.license_no; end if;
  end if;
  insert into public.driver_sensitive (driver_id, national_id, license_no)
  values (p_driver_id, nid, lic)
  on conflict (driver_id) do update
    set national_id = excluded.national_id, license_no = excluded.license_no;
end;
$$;
revoke all on function public.set_driver_share_info(uuid, text, text) from public, anon;
grant execute on function public.set_driver_share_info(uuid, text, text) to authenticated;
