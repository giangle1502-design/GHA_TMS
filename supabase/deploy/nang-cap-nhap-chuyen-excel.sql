-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Nhập đơn hàng, chuyến từ Excel
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('public.import_transport_order(jsonb,jsonb)') is not null then
    raise exception 'CSDL đã được nâng cấp Nhập đơn hàng, chuyến từ Excel trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261101000036_import_trips.sql
-- =============================================================================
-- 0036: Nhập đơn hàng / chuyến từ Excel (yêu cầu Khánh Hà 01/11/2026)
--   - Mỗi lần gọi = một đơn hàng (một giao dịch): lỗi ở chuyến nào thì cả đơn không lưu.
--   - Trạng thái từng chuyến trong file:
--       draft     = Chờ phân công (bỏ qua tài xế nếu có)
--       assigned  = Đã phân công: đi đúng luồng thường, bật duyệt thì chuyến "Chờ GĐ duyệt"
--       completed = Đã hoàn thành (chuyến cũ đã chạy trước khi dùng phần mềm): KHÔNG gửi Giám đốc duyệt,
--                   không báo tài xế, chuyển thẳng sang "Tài xế đã hoàn thành", chứng từ để "Thiếu".
--   - Có đơn giá trong file: dùng đúng đơn giá đó (chuyến cũ đã chốt giá), không lấy bảng giá.
--     Để trống đơn giá: tính theo bảng giá như tạo tay; không có bảng giá thì "giá tính sau".
--   - Phí thu khách nhập cùng chuyến (dùng lại set_shipment_fees).
-- =============================================================================

-- Trong lúc nhập chuyến cũ đã hoàn thành: coi như tắt duyệt (chỉ trong giao dịch đó)
create or replace function private.trip_approval_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(current_setting('app.trip_import_done', true), '') <> 'on'
     and coalesce((select value = 'true'::jsonb from public.system_settings where key = 'dispatch.require_director_approval'), false);
$$;
revoke all on function private.trip_approval_on() from public, anon;
grant execute on function private.trip_approval_on() to authenticated;

create or replace function public.import_transport_order(p_order jsonb, p_shipments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  v_idx integer := 0;
  v_order jsonb := p_order;
  v_res jsonb;
  v_order_id uuid;
  v_order_code text;
  v_sid uuid;
  v_status text;
  v_driver uuid;
  v_vehicle uuid;
  v_done timestamptz;
  v_3pl boolean;
  s public.shipments;
  v_out jsonb := '[]'::jsonb;
  v_msg text;
  v_state text;
  v_price numeric;
  v_customer uuid;
  v_top uuid;
begin
  if not private.has_perm('dispatch.create') then
    raise exception 'Bạn không có quyền tạo đơn hàng' using errcode = '42501';
  end if;
  if jsonb_typeof(p_shipments) <> 'array' or jsonb_array_length(p_shipments) = 0 then
    raise exception 'Đơn hàng phải có ít nhất một chuyến' using errcode = '22023';
  end if;
  if jsonb_array_length(p_shipments) > 100 then
    raise exception 'Mỗi đơn nhập tối đa 100 chuyến' using errcode = '22023';
  end if;

  for item in select * from jsonb_array_elements(p_shipments) loop
    v_idx := v_idx + 1;
    v_driver := nullif(item ->> 'driver_id', '')::uuid;
    v_vehicle := nullif(item ->> 'vehicle_id', '')::uuid;
    v_status := coalesce(nullif(item ->> 'import_status', ''), case when v_driver is not null then 'assigned' else 'draft' end);
    if v_status not in ('draft', 'assigned', 'completed') then
      raise exception 'Chuyến %: trạng thái không hợp lệ', v_idx using errcode = '22023';
    end if;
    if v_status = 'assigned' and v_driver is null then
      raise exception 'Chuyến %: trạng thái "Đã phân công" phải có tài xế', v_idx using errcode = '22023';
    end if;
    if v_status = 'completed' and v_driver is null and v_vehicle is null then
      raise exception 'Chuyến %: chuyến đã hoàn thành phải có xe hoặc tài xế', v_idx using errcode = '22023';
    end if;
    if v_status <> 'assigned' then
      -- Chờ phân công: không phân công; Đã hoàn thành: phân công riêng bên dưới, không qua duyệt
      item := item - 'driver_id';
    end if;
    if v_status = 'draft' then
      v_driver := null;
    end if;

    -- Đơn giá trong file: chọn tạm bảng giá đầu tiên (tránh lỗi "nhiều bảng giá ngang nhau"), ghi đè giá sau khi tạo
    v_price := nullif(item ->> 'unit_price', '')::numeric;
    if v_price is not null and nullif(item ->> 'price_list_id', '') is null then
      v_customer := coalesce(nullif(v_order ->> 'customer_id', '')::uuid, (select o.customer_id from public.transport_orders o where o.id = (v_order ->> 'id')::uuid));
      select c.id into v_top from private.price_candidates(v_customer, nullif(item ->> 'pickup_location_id', '')::uuid,
        nullif(item ->> 'delivery_location_id', '')::uuid, nullif(item ->> 'vehicle_type_id', '')::uuid,
        ((item ->> 'pickup_at')::timestamptz at time zone 'Asia/Ho_Chi_Minh')::date) c limit 1;
      if v_top is not null then
        item := item || jsonb_build_object('price_list_id', v_top);
      end if;
    end if;

    begin
      v_res := public.create_transport_order(v_order, jsonb_build_array(item - 'fees' - 'import_status' - 'completed_at'));
    exception when others then
      get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
      raise exception 'Chuyến %: %', v_idx, regexp_replace(v_msg, '^Chuyến 1: ', '') using errcode = v_state;
    end;
    v_order_id := (v_res ->> 'order_id')::uuid;
    v_order_code := v_res ->> 'order_code';
    v_order := jsonb_build_object('id', v_order_id);
    v_sid := (v_res -> 'shipments' -> 0 ->> 'id')::uuid;

    if v_price is not null then
      update public.shipments
         set unit_price = v_price,
             pricing_unit = coalesce(nullif(item ->> 'pricing_unit', ''), pricing_unit),
             price_list_id = null,
             pricing_snapshot = pricing_snapshot || jsonb_build_object('price_source', 'excel', 'price_list_code', null)
       where id = v_sid and (unit_price, price_list_id) is distinct from (v_price, null::uuid);
    end if;

    if v_status = 'completed' then
      perform set_config('app.trip_import_done', 'on', true);
      select * into s from public.shipments where id = v_sid;
      v_done := coalesce(nullif(item ->> 'completed_at', '')::timestamptz, s.expected_delivery_at, s.pickup_at);
      if v_done < s.pickup_at then
        v_done := s.pickup_at;
      end if;
      if v_driver is not null then
        if not exists (select 1 from public.drivers d where d.id = v_driver and d.archived_at is null) then
          raise exception 'Chuyến %: tài xế không tồn tại hoặc đã lưu trữ', v_idx using errcode = '22023';
        end if;
        insert into public.shipment_assignments (shipment_id, driver_id, vehicle_id, assigned_by, response, responded_at)
        values (v_sid, v_driver, v_vehicle, auth.uid(), 'accepted', now());
        -- Chuyến cũ: không báo tài xế
        delete from public.notifications where type = 'shipment_assigned' and entity_type = 'shipment' and entity_id = v_sid;
      end if;
      update public.shipments set driver_id = v_driver, vehicle_id = coalesce(v_vehicle, vehicle_id), status = 'assigned' where id = v_sid;
      update public.shipments set status = 'accepted' where id = v_sid;
      update public.shipments set status = 'in_transit', departed_pickup_at = pickup_at where id = v_sid returning * into s;
      v_3pl := private.shipment_is_3pl(s);
      update public.shipments
         set status = 'driver_completed',
             completed_at = v_done,
             arrived_delivery_at = v_done,
             delivery_result = 'full',
             completion_note = 'Nhập từ Excel: chuyến đã chạy trước khi dùng phần mềm',
             photo_skip_reason = 'Chuyến cũ nhập từ Excel',
             expense_declaration = case when v_3pl then null else 'none' end,
             expense_declared_at = case when v_3pl then null else v_done end
       where id = v_sid;
      perform set_config('app.trip_import_done', '', true);
    end if;

    if jsonb_typeof(item -> 'fees') = 'array' and jsonb_array_length(item -> 'fees') > 0 then
      begin
        perform public.set_shipment_fees(v_sid, item -> 'fees');
      exception when others then
        get stacked diagnostics v_msg = message_text, v_state = returned_sqlstate;
        raise exception 'Chuyến %: %', v_idx, v_msg using errcode = v_state;
      end;
    end if;

    select * into s from public.shipments where id = v_sid;
    v_out := v_out || jsonb_build_object('id', s.id, 'shipment_code', s.shipment_code, 'status', s.status, 'dispatch_approval', s.dispatch_approval);
  end loop;

  return jsonb_build_object('order_id', v_order_id, 'order_code', v_order_code, 'shipments', v_out);
end;
$$;
revoke all on function public.import_transport_order(jsonb, jsonb) from public, anon;
grant execute on function public.import_transport_order(jsonb, jsonb) to authenticated;
comment on function public.import_transport_order(jsonb, jsonb) is
  'Nhập một đơn hàng từ Excel: chuyến Chờ phân công / Đã phân công (qua duyệt GĐ) / Đã hoàn thành (chuyến cũ, không duyệt)';

commit;
