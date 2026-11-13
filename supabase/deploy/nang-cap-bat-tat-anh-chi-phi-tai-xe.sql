-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Bật / tắt chụp ảnh và nhập chi phí trên ứng dụng tài xế
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('public.driver_app_settings()') is not null then
    raise exception 'CSDL đã được nâng cấp Bật / tắt chụp ảnh và nhập chi phí trên ứng dụng tài xế trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261102000052_driver_app_toggles.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0052: Bật / tắt chụp hình và nhập chi phí trên ứng dụng tài xế (02/11/2026)
--   Cấu hình → Ứng dụng tài xế:
--   * driver.photos_enabled (mới, mặc định bật): tắt thì ứng dụng tài xế không hiện ô chụp ảnh
--     (hoàn thành chuyến, hóa đơn chi phí) và không bắt buộc ảnh ở đâu cả.
--   * shipment.require_delivery_photo (đã có từ đầu nhưng trước đây chưa có tác dụng): tắt thì vẫn chụp được
--     nhưng hoàn thành chuyến không bắt buộc ảnh.
--   * driver.expense_enabled (mới, mặc định bật): tắt thì bước Hoàn thành chuyến không hỏi chi phí,
--     ẩn "Bổ sung chi phí", "Sửa" chi phí; tài xế báo chi phí cho văn phòng nhập.
-- Không xóa dữ liệu. Ứng tiền (tạm ứng) không đổi.
-- =============================================================================

insert into public.system_settings (key, value, description, is_public) values
  ('driver.photos_enabled', 'true',
   'Ứng dụng tài xế: cho chụp ảnh (giao hàng, hóa đơn). Tắt = ẩn ô chụp ảnh, không bắt buộc ảnh', true),
  ('driver.expense_enabled', 'true',
   'Ứng dụng tài xế: cho tài xế nhập chi phí chuyến. Tắt = không hỏi chi phí khi hoàn thành chuyến, văn phòng nhập thay', true)
on conflict (key) do nothing;
update public.system_settings
   set description = 'Ứng dụng tài xế: bắt buộc ít nhất 1 ảnh giao hàng / phiếu ký nhận khi hoàn thành chuyến'
 where key = 'shipment.require_delivery_photo';

-- Đọc tham số bật/tắt (thiếu hoặc sai kiểu thì dùng mặc định)
create or replace function private.setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select case when jsonb_typeof(value) = 'boolean' then value::text::boolean end
                     from public.system_settings where key = p_key), p_default);
$$;
revoke all on function private.setting_bool(text, boolean) from public, anon, authenticated;

-- Tham số cho màn hình tài xế (link biển số và trang Tiền)
create or replace function public.driver_app_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'photos_enabled', private.setting_bool('driver.photos_enabled', true),
    'delivery_photo_required', private.setting_bool('driver.photos_enabled', true)
                               and private.setting_bool('shipment.require_delivery_photo', true),
    'expense_enabled', private.setting_bool('driver.expense_enabled', true));
$$;
revoke all on function public.driver_app_settings() from public;
grant execute on function public.driver_app_settings() to anon, authenticated;

create or replace function public.driver_link_complete(
  p_token text, p_shipment_id uuid, p_ticket uuid, p_result text default 'full', p_note text default null, p_no_expense boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_s public.shipments;
  v_name text;
  v_counts jsonb;
  v_photos int;
  v_3pl boolean;
  v_exp_on boolean;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  select * into v_s from public.shipments where id = p_shipment_id for update;
  if v_s.id is null or not private.driver_link_visible(v_me.vehicle_id, v_s) then
    return jsonb_build_object('ok', false, 'error', 'Chuyến này không còn được phân công cho xe của bạn. Tải lại trang để xem.');
  end if;
  if v_s.status = 'driver_completed' then
    return jsonb_build_object('ok', true);
  end if;
  if v_s.status <> 'in_transit' then
    return jsonb_build_object('ok', false, 'error', 'Bấm "Bắt đầu chạy" trước khi hoàn thành chuyến.');
  end if;
  if coalesce(p_result, '') not in ('full', 'partial', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'Chọn kết quả giao hàng.');
  end if;
  if p_result <> 'full' and length(trim(coalesce(p_note, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Giao thiếu hoặc không giao được: vui lòng ghi lý do.');
  end if;
  v_3pl := private.shipment_is_3pl(v_s);
  -- Tắt nhập chi phí tài xế (Cấu hình → Ứng dụng tài xế): không hỏi chi phí, coi như chuyến không khai chi phí
  v_exp_on := private.setting_bool('driver.expense_enabled', true);
  if v_exp_on and p_no_expense is null and not v_3pl then
    return jsonb_build_object('ok', false, 'error', 'Chọn "Có chi phí" và nhập chi phí, hoặc chọn "Không phát sinh chi phí".');
  end if;

  begin
    v_counts := private.driver_attach_uploads(p_ticket, v_me.vehicle_id, 'shipment', v_s.id, array['photo', 'delivery_note']);
  exception when sqlstate '22023' then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  v_photos := coalesce((v_counts ->> 'photo')::int, 0) + coalesce((v_counts ->> 'delivery_note')::int, 0);
  if v_photos = 0 and private.setting_bool('driver.photos_enabled', true)
     and private.setting_bool('shipment.require_delivery_photo', true) then
    raise exception 'Cần ít nhất 1 ảnh giao hàng hoặc phiếu ký nhận' using errcode = '22023';
  end if;

  update public.shipments
     set status = 'driver_completed',
         completed_at = now(),
         arrived_delivery_at = coalesce(arrived_delivery_at, now()),
         delivery_result = p_result,
         completion_note = nullif(trim(coalesce(p_note, '')), ''),
         document_status = case when document_status in ('missing', 'rejected') then 'submitted' else document_status end,
         expense_declaration = case when v_3pl or not v_exp_on then null when p_no_expense then 'none' else 'has' end,
         expense_declared_at = case when v_3pl or not v_exp_on then null else now() end
   where id = v_s.id;
  select full_name into v_name from public.drivers where id = v_s.driver_id;
  perform private.driver_link_note(v_s.id, 'driver_completed', v_name || ' hoàn thành chuyến trên điện thoại (' || v_photos || ' ảnh'
    || case when v_3pl or not v_exp_on then '' when p_no_expense then ', không phát sinh chi phí' else '' end || ')');
  perform private.notify_dispatcher(v_s.id, 'shipment_completed', 'Tài xế ' || v_name || ' đã hoàn thành chuyến ' || v_s.shipment_code);
  return jsonb_build_object('ok', true, 'photos', v_photos);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;


create or replace function public.driver_link_add_expense(
  p_token text, p_shipment_id uuid, p_category_id uuid, p_amount numeric, p_note text default null,
  p_ticket uuid default null, p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_s public.shipments;
  c public.expense_categories;
  v_id uuid;
  v_counts jsonb;
  v_files int;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  if p_client_request_id is not null and exists (select 1 from public.shipment_expenses where client_request_id = p_client_request_id) then
    return jsonb_build_object('ok', true);
  end if;
  select * into v_s from public.shipments where id = p_shipment_id;
  if v_s.id is null or not private.driver_link_visible(v_me.vehicle_id, v_s) then
    return jsonb_build_object('ok', false, 'error', 'Chọn chuyến của xe bạn.');
  end if;
  if v_s.status = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'Chuyến đã được văn phòng đóng, không bổ sung chi phí được. Vui lòng gọi kế toán.');
  end if;
  if private.shipment_is_3pl(v_s) then
    return jsonb_build_object('ok', false, 'error', 'Chuyến chạy xe thuê ngoài 3PL không nhập chi phí tài xế.');
  end if;
  if not private.setting_bool('driver.expense_enabled', true) then
    return jsonb_build_object('ok', false, 'error', 'Công ty đã tắt nhập chi phí trên điện thoại. Báo chi phí cho văn phòng.');
  end if;
  if v_s.status <> 'driver_completed' then
    return jsonb_build_object('ok', false, 'error', 'Chi phí được nhập khi bấm Hoàn thành chuyến.');
  end if;
  select * into c from public.expense_categories
   where id = p_category_id and is_active and 'driver' = any (allowed_role_codes);
  if c.id is null then
    return jsonb_build_object('ok', false, 'error', 'Chọn loại chi phí.');
  end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > 1000000000 then
    return jsonb_build_object('ok', false, 'error', 'Nhập số tiền.');
  end if;

  v_id := private.insert_expense(v_s, c, round(p_amount), now(), left(p_note, 500), 'driver', 'driver', v_s.driver_id, null,
    '{}'::jsonb, p_client_request_id, (select full_name from public.drivers where id = v_s.driver_id) || ' (điện thoại)');
  v_counts := private.driver_attach_uploads(p_ticket, v_me.vehicle_id, 'shipment_expense', v_id, array['receipt', 'invoice', 'photo']);
  v_files := coalesce((select sum(value::int) from jsonb_each_text(v_counts)), 0);
  if c.requires_image and v_files = 0 and private.setting_bool('driver.photos_enabled', true) then
    raise exception 'Loại chi phí "%" cần ảnh hóa đơn/biên lai', c.name using errcode = '22023';
  end if;
  update public.shipments set expense_declaration = 'has', expense_declared_at = coalesce(expense_declared_at, now())
   where id = v_s.id and expense_declaration is distinct from 'has';
  return jsonb_build_object('ok', true, 'code', (select code from public.shipment_expenses where id = v_id),
                            'needs_approval', c.requires_approval);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;


create or replace function public.driver_me_update_expense(
  p_expense_id uuid, p_category_id uuid, p_amount numeric, p_note text default null, p_ticket uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.drivers := private.driver_me_driver();
  e public.shipment_expenses;
  v_s public.shipments;
  c public.expense_categories;
  v_id uuid;
  v_counts jsonb;
  v_files int;
begin
  if d.id is null then
    return jsonb_build_object('ok', false, 'error', 'Tài khoản chưa gắn với hồ sơ tài xế.', 'unlinked', true);
  end if;
  select * into e from public.shipment_expenses where id = p_expense_id and driver_id = d.id for update;
  select * into v_s from public.shipments where id = e.shipment_id;
  if e.id is null or v_s.id is null then
    return jsonb_build_object('ok', false, 'error', 'Không tìm thấy khoản chi phí của bạn.');
  end if;
  if not private.setting_bool('driver.expense_enabled', true) then
    return jsonb_build_object('ok', false, 'error', 'Công ty đã tắt nhập chi phí trên điện thoại. Báo văn phòng sửa giúp.');
  end if;
  if not private.driver_expense_editable(e, v_s) then
    return jsonb_build_object('ok', false, 'error', 'Khoản này đã được duyệt, đã vào bảng lương hoặc chuyến đã đóng nên không sửa được. Vui lòng gọi kế toán.');
  end if;
  select * into c from public.expense_categories
   where id = p_category_id and is_active and 'driver' = any (allowed_role_codes);
  if c.id is null then
    return jsonb_build_object('ok', false, 'error', 'Chọn loại chi phí.');
  end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > 1000000000 then
    return jsonb_build_object('ok', false, 'error', 'Nhập số tiền.');
  end if;

  perform private.driver_cancel_expense(e, d.full_name || ' (điện thoại)', 'Tài xế sửa khoản chi phí');
  v_id := private.insert_expense(v_s, c, round(p_amount), e.incurred_at, left(p_note, 500), 'driver', 'driver', e.driver_id, null,
    e.custom_fields, null, d.full_name || ' (điện thoại)');
  update public.shipment_expenses
     set note = coalesce(note, '') || case when note is null then '' else ' ' end || '(sửa từ ' || e.code || ')'
   where id = v_id;
  v_counts := private.driver_attach_uploads(p_ticket, null, 'shipment_expense', v_id, array['receipt', 'invoice', 'photo'], d.id);
  v_files := coalesce((select sum(value::int) from jsonb_each_text(v_counts)), 0);
  if v_files = 0 then
    -- Không chụp lại: dùng chứng từ của khoản cũ
    update public.documents set entity_id = v_id where entity_type = 'shipment_expense' and entity_id = e.id and archived_at is null;
    get diagnostics v_files = row_count;
  end if;
  if c.requires_image and v_files = 0 and private.setting_bool('driver.photos_enabled', true) then
    raise exception 'Loại chi phí "%" cần ảnh hóa đơn/biên lai', c.name using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'code', (select code from public.shipment_expenses where id = v_id), 'needs_approval', c.requires_approval);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;

revoke all on function public.driver_me_update_expense(uuid, uuid, numeric, text, uuid) from public, anon;
grant execute on function public.driver_me_update_expense(uuid, uuid, numeric, text, uuid) to authenticated;

commit;
