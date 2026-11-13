-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Sửa khôi phục chuyến hủy trước bản trả cont về kế hoạch
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if position('-infinity' in pg_get_functiondef(to_regprocedure('public.restore_shipment(uuid)'))) > 0 then
    raise exception 'CSDL đã được nâng cấp Sửa khôi phục chuyến hủy trước bản trả cont về kế hoạch trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261102000047_restore_legacy_fix.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0047: Sửa khôi phục chuyến hủy trước bản 0046 (02/11/2026)
--   Chuyến từ kế hoạch bị hủy trước khi có "trả cont về kế hoạch" vẫn gắn kế hoạch đang ở trạng thái Đã tạo đơn,
--   nên restore_shipment chặn nhầm ("đã được tạo đơn lại"). Chỉ chặn khi kế hoạch tạo đơn sau lúc chuyến bị hủy.
-- =============================================================================

-- Khôi phục chuyến đã hủy: về "Chưa phân công" (bỏ xe, tài xế), mở lại đơn, lấy lại cont khỏi kế hoạch
create or replace function public.restore_shipment(p_shipment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  q public.transport_plans;
  parent public.transport_plans;
  v_code text;
begin
  if not (private.has_perm('dispatch.delete') or private.has_perm('shipments.delete')) then
    raise exception 'Bạn không có quyền khôi phục chuyến' using errcode = '42501';
  end if;
  select * into s from public.shipments where id = p_shipment_id for update;
  if s.id is null then
    raise exception 'Không tìm thấy chuyến' using errcode = 'P0001';
  end if;
  if s.status <> 'cancelled' then
    raise exception 'Chuyến % không ở trạng thái đã hủy', s.shipment_code using errcode = '22023';
  end if;
  if s.receivable_id is not null then
    raise exception 'Chuyến % đã gắn công nợ, không khôi phục được', s.shipment_code using errcode = '22023';
  end if;

  -- Cont đã trở về kế hoạch: lấy lại (chặn nếu kế hoạch đó đã tạo đơn mới cho cont này)
  if s.plan_id is not null then
    select * into q from public.transport_plans where id = s.plan_id for update;
    -- Chặn khi cont đã trở về kế hoạch và được tích tạo đơn lại (kế hoạch tạo đơn SAU lúc chuyến bị hủy).
    -- Chuyến hủy trước bản 0046 vẫn gắn kế hoạch "đã tạo đơn" cũ: cho khôi phục.
    if q.status = 'ordered' and q.ordered_at > coalesce(s.cancelled_at, '-infinity'::timestamptz) then
      raise exception 'Cont của chuyến % đã được tạo đơn lại từ kế hoạch % (%). Không khôi phục để tránh trùng đơn.', s.shipment_code, q.code, q.order_codes
        using errcode = '22023';
    end if;
  end if;

  update public.transport_orders set status = 'open' where id = s.order_id and status = 'cancelled';

  perform set_config('app.shipment_restore', 'on', true);
  update public.shipments
     set status = 'draft', driver_id = null, vehicle_id = null, vehicle_day_order = null,
         cancel_reason = null, cancelled_at = null, cancelled_by = null
   where id = s.id;
  perform set_config('app.shipment_restore', 'off', true);
  update public.shipment_status_history h set note = 'Khôi phục chuyến đã hủy'
   where h.id = (select max(id) from public.shipment_status_history where shipment_id = s.id and status_field = 'status' and to_status = 'draft');

  if q.id is not null and q.status = 'ordered' then
    perform private.plan_sync_ordered(q.id);
  elsif q.id is not null and q.status = 'planned' then
    if q.source_plan_id is not null then
      select * into parent from public.transport_plans where id = q.source_plan_id for update;
    end if;
    perform set_config('app.plan_ordering', 'on', true);
    if parent.id is not null and parent.status = 'ordered' then
      -- Gắn lại vào kế hoạch gốc đang chạy
      update public.shipments set plan_id = parent.id where id = s.id;
      if q.container_qty <= 1 then
        if not exists (select 1 from public.shipments where plan_id = q.id) then
          delete from public.transport_plans where id = q.id;
        end if;
      else
        update public.transport_plans set container_qty = container_qty - 1 where id = q.id;
      end if;
      perform set_config('app.plan_ordering', 'off', true);
      perform private.plan_sync_ordered(parent.id);
    elsif q.container_qty <= 1 then
      select order_code into v_code from public.transport_orders where id = s.order_id;
      update public.transport_plans
         set status = 'ordered', ordered_at = now(), ordered_by = auth.uid(), order_pickup_date = (s.pickup_at at time zone 'Asia/Ho_Chi_Minh')::date
       where id = q.id;
      perform set_config('app.plan_ordering', 'off', true);
      perform private.plan_sync_ordered(q.id);
    else
      update public.transport_plans set container_qty = container_qty - 1 where id = q.id;
      update public.shipments set plan_id = null where id = s.id;
      perform set_config('app.plan_ordering', 'off', true);
    end if;
  end if;

  return jsonb_build_object('shipment_code', s.shipment_code);
end;
$$;
revoke all on function public.restore_shipment(uuid) from public, anon;
grant execute on function public.restore_shipment(uuid) to authenticated;

commit;
