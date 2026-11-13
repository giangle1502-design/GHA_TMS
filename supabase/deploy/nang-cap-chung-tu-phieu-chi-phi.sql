-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Chụp chứng từ theo yêu cầu của đơn, tài xế chụp phiếu chi phí
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shipments' and column_name = 'pod_photo_required') then
    raise exception 'CSDL đã được nâng cấp Chụp chứng từ theo yêu cầu của đơn, tài xế chụp phiếu chi phí trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261102000054_pod_photo_expense_sheet.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0054: Chụp chứng từ theo yêu cầu của đơn; tài xế chụp phiếu chi phí thay cho nhập từng khoản (02/11/2026)
--   * shipments.pod_photo_required: điều phối tích "Khách yêu cầu chụp chứng từ" khi tạo / sửa đơn.
--     Tích thì tài xế bắt buộc chụp ảnh giao hàng; không tích thì app tài xế bỏ qua bước chụp ảnh.
--     Giá trị mặc định cho đơn mới (kể cả Lập kế hoạch, nhập Excel) = tham số shipment.require_delivery_photo.
--   * driver.expense_sheet_photo (mới, mặc định bật): bước Hoàn thành chuyến mặc định "Có chi phí", tài xế bắt buộc
--     chụp phiếu chi phí (công ty phát, tài xế ghi từng loại phí); không chụp thì báo "Vui lòng chụp hình chứng từ
--     chuyến có chi phí", tài xế chọn "Không có chi phí" mới qua. Điều phối / kế toán mở ảnh, nhập chi phí.
--     Tắt tham số này: tài xế tự nhập từng khoản như trước.
--   * driver_link_add_sheet: gửi thêm ảnh phiếu chi phí sau khi hoàn thành (trước khi văn phòng đóng chuyến).
--   * driver_link_trip_flags: cờ của từng chuyến cho màn hình tài xế.
-- Không xóa dữ liệu.
-- =============================================================================

grant execute on function private.setting_bool(text, boolean) to authenticated;

alter table public.shipments
  add column if not exists pod_photo_required boolean not null
  default private.setting_bool('shipment.require_delivery_photo', true);
comment on column public.shipments.pod_photo_required is
  'Khách yêu cầu chụp chứng từ: tài xế bắt buộc chụp ảnh hàng đã giao / phiếu ký nhận khi hoàn thành chuyến';

insert into public.system_settings (key, value, description, is_public) values
  ('driver.expense_sheet_photo', 'true',
   'Ứng dụng tài xế: chụp phiếu chi phí thay cho nhập từng khoản (văn phòng nhập theo phiếu)', true)
on conflict (key) do nothing;
update public.system_settings
   set description = 'Đơn mới mặc định tích "Khách yêu cầu chụp chứng từ" (tài xế bắt buộc chụp ảnh giao hàng)'
 where key = 'shipment.require_delivery_photo';

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
    'expense_enabled', private.setting_bool('driver.expense_enabled', true),
    'expense_sheet_photo', private.setting_bool('driver.photos_enabled', true)
                           and private.setting_bool('driver.expense_sheet_photo', true));
$$;

-- Cờ từng chuyến cho màn hình tài xế: đơn có yêu cầu chụp chứng từ, số ảnh phiếu chi phí đã gửi
create or replace function public.driver_link_trip_flags(p_token text)
returns table (shipment_id uuid, pod_photo_required boolean, sheet_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.pod_photo_required,
         (select count(*) from public.documents doc
           where doc.entity_type = 'shipment' and doc.entity_id = s.id and doc.doc_type = 'receipt' and doc.archived_at is null)
  from private.driver_link_session(p_token) me
  join public.shipments s on private.driver_link_visible(me.vehicle_id, s)
  where s.status in ('assigned', 'accepted', 'in_transit')
     or (s.status in ('driver_completed', 'closed') and s.pickup_at > now() - interval '3 days');
$$;
revoke all on function public.driver_link_trip_flags(text) from public;
grant execute on function public.driver_link_trip_flags(text) to anon, authenticated;

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
  v_photo_on boolean := private.setting_bool('driver.photos_enabled', true);
  v_sheet_mode boolean := private.setting_bool('driver.expense_sheet_photo', true);
  v_sheets int;
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
    v_counts := private.driver_attach_uploads(p_ticket, v_me.vehicle_id, 'shipment', v_s.id, array['photo', 'delivery_note', 'receipt']);
  exception when sqlstate '22023' then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  v_photos := coalesce((v_counts ->> 'photo')::int, 0) + coalesce((v_counts ->> 'delivery_note')::int, 0);
  v_sheets := coalesce((v_counts ->> 'receipt')::int, 0);
  -- Ảnh giao hàng chỉ bắt buộc khi đơn yêu cầu chụp chứng từ (điều phối chọn lúc tạo / sửa đơn)
  if v_photos = 0 and v_photo_on and v_s.pod_photo_required then
    raise exception 'Đơn này yêu cầu chụp chứng từ: chụp ít nhất 1 ảnh hàng đã giao hoặc phiếu ký nhận' using errcode = '22023';
  end if;
  -- Có chi phí: chụp phiếu chi phí (văn phòng nhập chi phí theo phiếu). Không chụp được thì chọn "Không có chi phí".
  if v_exp_on and not v_3pl and v_sheet_mode and v_photo_on and p_no_expense is false and v_sheets = 0 then
    raise exception 'Vui lòng chụp hình chứng từ chuyến có chi phí. Chuyến không có chi phí thì chọn "Không có chi phí".' using errcode = '22023';
  end if;

  update public.shipments
     set status = 'driver_completed',
         completed_at = now(),
         arrived_delivery_at = coalesce(arrived_delivery_at, now()),
         delivery_result = p_result,
         completion_note = nullif(trim(coalesce(p_note, '')), ''),
         document_status = case when v_photos > 0 and document_status in ('missing', 'rejected') then 'submitted' else document_status end,
         expense_declaration = case when v_3pl or not v_exp_on then null when p_no_expense then 'none' else 'has' end,
         expense_declared_at = case when v_3pl or not v_exp_on then null else now() end
   where id = v_s.id;
  select full_name into v_name from public.drivers where id = v_s.driver_id;
  perform private.driver_link_note(v_s.id, 'driver_completed', v_name || ' hoàn thành chuyến trên điện thoại (' || v_photos || ' ảnh'
    || case when v_3pl or not v_exp_on then '' when p_no_expense then ', không phát sinh chi phí'
            when v_sheets > 0 then ', có chi phí, ' || v_sheets || ' ảnh phiếu chi phí' else ', có chi phí' end || ')');
  perform private.notify_dispatcher(v_s.id, 'shipment_completed', 'Tài xế ' || v_name || ' đã hoàn thành chuyến ' || v_s.shipment_code);
  return jsonb_build_object('ok', true, 'photos', v_photos, 'sheets', v_sheets);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;


-- Gửi thêm ảnh phiếu chi phí sau khi hoàn thành chuyến
create or replace function public.driver_link_add_sheet(p_token text, p_shipment_id uuid, p_ticket uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me record;
  v_s public.shipments;
  v_counts jsonb;
  v_n int;
begin
  select * into v_me from private.driver_link_session(p_token);
  if v_me.vehicle_id is null then
    return jsonb_build_object('ok', false, 'error', 'Phiên đã hết hạn. Vui lòng nhập lại số xe.', 'expired', true);
  end if;
  select * into v_s from public.shipments where id = p_shipment_id for update;
  if v_s.id is null or not private.driver_link_visible(v_me.vehicle_id, v_s) then
    return jsonb_build_object('ok', false, 'error', 'Chọn chuyến của xe bạn.');
  end if;
  if v_s.status = 'closed' then
    return jsonb_build_object('ok', false, 'error', 'Chuyến đã được văn phòng đóng, không gửi thêm được. Vui lòng gọi kế toán.');
  end if;
  if v_s.status <> 'driver_completed' then
    return jsonb_build_object('ok', false, 'error', 'Phiếu chi phí được gửi khi bấm Hoàn thành chuyến.');
  end if;
  if private.shipment_is_3pl(v_s) or not private.setting_bool('driver.expense_enabled', true) then
    return jsonb_build_object('ok', false, 'error', 'Chuyến này không khai chi phí trên điện thoại.');
  end if;
  v_counts := private.driver_attach_uploads(p_ticket, v_me.vehicle_id, 'shipment', v_s.id, array['receipt']);
  v_n := coalesce((v_counts ->> 'receipt')::int, 0);
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'error', 'Chụp ít nhất 1 ảnh phiếu chi phí.');
  end if;
  update public.shipments set expense_declaration = 'has', expense_declared_at = coalesce(expense_declared_at, now())
   where id = v_s.id and expense_declaration is distinct from 'has';
  perform private.notify_dispatcher(v_s.id, 'shipment_completed', 'Tài xế gửi phiếu chi phí chuyến ' || v_s.shipment_code || ', cần nhập chi phí');
  return jsonb_build_object('ok', true, 'sheets', v_n);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
revoke all on function public.driver_link_add_sheet(text, uuid, uuid) from public;
grant execute on function public.driver_link_add_sheet(text, uuid, uuid) to anon, authenticated;

commit;
