-- =============================================================================
-- KHÁNH HÀ TMS – NÂNG CẤP CƠ SỞ DỮ LIỆU: Xóa vĩnh viễn chuyến đã hủy
-- Dán toàn bộ tệp vào Supabase → SQL Editor → Run. Chạy MỘT LẦN trên CSDL đang dùng.
-- Không xóa và không thêm dữ liệu nghiệp vụ. Tệp được ghép tự động – không sửa tay.
-- =============================================================================
begin;

do $$ begin
  if to_regprocedure('public.delete_cancelled_shipments(uuid[],text)') is not null then
    raise exception 'CSDL đã được nâng cấp Xóa vĩnh viễn chuyến đã hủy trước đó, không cần chạy lại.';
  end if;
end $$;

-- >>> 20261111000070_delete_cancelled_shipments.sql
-- =============================================================================
-- KHÁNH HÀ TMS - 0070: Xóa vĩnh viễn chuyến đã hủy (khách hàng yêu cầu 11/11/2026)
--   * Danh sách Chuyến hủy đầy rất nhanh: cho người có quyền hủy chuyến xóa hẳn chuyến đã hủy.
--   * Chỉ xóa chuyến trạng thái Đã hủy, chưa phát sinh chi phí, tạm ứng, thanh toán, công nợ
--     (chuyến có các nghiệp vụ đó được giữ lại để đối chiếu và báo lý do).
--   * Xóa kèm lịch sử trạng thái, phân công, yêu cầu Giám đốc duyệt chuyến, chứng từ đính kèm,
--     hàng hóa, phí, chi phí 3PL. Đơn hàng không còn chuyến nào cũng bị xóa.
--   * Mỗi dòng xóa được ghi vào Nhật ký hệ thống (trigger audit sẵn có) kèm một dòng tổng hợp.
-- Không xóa dữ liệu khi chạy nâng cấp. Chạy lại nhiều lần không lỗi.
-- =============================================================================

-- Cho phép xóa chuyến đã hủy khi đi qua hàm delete_cancelled_shipments (cờ app.shipment_purge)
create or replace function private.guard_shipment_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (old.status = 'draft' or (old.status = 'cancelled' and coalesce(current_setting('app.shipment_purge', true), '') = 'on'))
     or exists (select 1 from public.shipment_expenses where shipment_id = old.id)
     or exists (select 1 from public.advance_requests where shipment_id = old.id)
     or exists (select 1 from public.payments where shipment_id = old.id)
     or exists (select 1 from public.receivables where shipment_id = old.id)
     or exists (select 1 from public.payables where shipment_id = old.id)
     or exists (select 1 from public.approval_requests where shipment_id = old.id) then
    raise exception 'Chuyến đã phát sinh nghiệp vụ, chỉ được hủy (không xóa)' using errcode = '42501';
  end if;
  delete from public.shipment_status_history where shipment_id = old.id;
  delete from public.shipment_assignments where shipment_id = old.id;
  return old;
end;
$$;

-- Xóa vĩnh viễn các chuyến đã hủy. Trả về số chuyến, số đơn đã xóa và các chuyến giữ lại kèm lý do.
create or replace function public.delete_cancelled_shipments(p_ids uuid[], p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shipments;
  v_reason text;
  v_deleted int := 0;
  v_orders int := 0;
  v_codes text[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_order_ids uuid[] := '{}';
  v_oid uuid;
begin
  if not (private.has_perm('dispatch.delete') or private.has_perm('shipments.delete')) then
    raise exception 'Bạn không có quyền xóa chuyến hủy' using errcode = '42501';
  end if;
  if coalesce(upper(trim(p_confirm)), '') <> 'XOA' then
    raise exception 'Gõ XOA để xác nhận xóa vĩnh viễn.' using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Chưa chọn chuyến nào' using errcode = '22023';
  end if;
  if cardinality(p_ids) > 2000 then
    raise exception 'Mỗi lần xóa tối đa 2.000 chuyến' using errcode = '22023';
  end if;

  perform set_config('app.shipment_purge', 'on', true);
  for s in select * from public.shipments where id = any(p_ids) order by shipment_code for update loop
    v_reason := case
      when s.status <> 'cancelled' then 'chưa ở trạng thái Đã hủy'
      when s.receivable_id is not null
        or exists (select 1 from public.receivables where shipment_id = s.id)
        or exists (select 1 from public.payables where shipment_id = s.id) then 'đã có công nợ'
      when exists (select 1 from public.shipment_expenses where shipment_id = s.id) then 'đã có chi phí tài xế'
      when exists (select 1 from public.advance_requests where shipment_id = s.id)
        or exists (select 1 from public.advance_transactions where shipment_id = s.id) then 'đã có tạm ứng'
      when exists (select 1 from public.payments where shipment_id = s.id) then 'đã có thanh toán'
      when exists (
        select 1 from public.approval_requests ar
         where ar.shipment_id = s.id
           and (exists (select 1 from public.shipment_expenses where approval_request_id = ar.id)
             or exists (select 1 from public.advance_requests where approval_request_id = ar.id)
             or exists (select 1 from public.payments where approval_request_id = ar.id)
             or exists (select 1 from public.driver_payrolls where approval_request_id = ar.id)
             or exists (select 1 from public.purchase_requests where approval_request_id = ar.id)
             or exists (select 1 from public.shipments where dispatch_approval_request_id = ar.id and id <> s.id))) then 'đã có phiếu duyệt dùng chung'
      else null end;
    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_object('code', s.shipment_code, 'reason', v_reason);
      continue;
    end if;

    -- Yêu cầu Giám đốc duyệt chuyến của chuyến này
    update public.shipments set dispatch_approval_request_id = null where id = s.id and dispatch_approval_request_id is not null;
    delete from public.approval_steps where request_id in (select id from public.approval_requests where shipment_id = s.id);
    delete from public.approval_requests where shipment_id = s.id;
    delete from public.documents where entity_type = 'shipment' and entity_id = s.id;
    delete from public.shipments where id = s.id;
    v_deleted := v_deleted + 1;
    v_codes := v_codes || s.shipment_code;
    if not s.order_id = any(v_order_ids) then
      v_order_ids := v_order_ids || s.order_id;
    end if;
  end loop;
  perform set_config('app.shipment_purge', 'off', true);

  -- Đơn hàng không còn chuyến nào: xóa luôn
  foreach v_oid in array v_order_ids loop
    if not exists (select 1 from public.shipments where order_id = v_oid)
       and not exists (select 1 from public.receivables where order_id = v_oid) then
      delete from public.documents where entity_type = 'transport_order' and entity_id = v_oid;
      delete from public.transport_orders where id = v_oid;
      v_orders := v_orders + 1;
    end if;
  end loop;

  if v_deleted > 0 then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data, reason)
    values (auth.uid(), 'shipments.delete_cancelled', 'shipment', null,
            jsonb_build_object('shipment_codes', to_jsonb(v_codes), 'orders_deleted', v_orders),
            'Xóa vĩnh viễn ' || v_deleted || ' chuyến đã hủy');
  end if;
  return jsonb_build_object('deleted', v_deleted, 'orders_deleted', v_orders, 'skipped', v_skipped);
end;
$$;
revoke all on function public.delete_cancelled_shipments(uuid[], text) from public, anon;
grant execute on function public.delete_cancelled_shipments(uuid[], text) to authenticated;

commit;
